import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SlackService } from './slack.service';
import { CreateRunThreadResult } from './check-in-thread.types';
import {
  buildAdditionalUpdatePostedBlocks,
  buildAiReportHeader,
  buildParentMessageBlocks,
  buildParentMessageText,
  buildParticipantSummaryBlocks,
  buildParticipantSummaryText,
} from './slack-checkin.views';

@Injectable()
export class CheckInThreadService {
  private readonly logger = new Logger(CheckInThreadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly slackService: SlackService,
    private readonly configService: ConfigService,
  ) {}

  resolveUpdatesChannelRef(checkIn: {
    updatesChannelId?: string | null;
    team?: { slackChannelId?: string | null } | null;
  }): { ref: string | null; source: string } {
    if (checkIn.updatesChannelId?.trim()) {
      return {
        ref: checkIn.updatesChannelId.trim(),
        source: 'checkIn.updatesChannelId',
      };
    }

    if (checkIn.team?.slackChannelId?.trim()) {
      return {
        ref: checkIn.team.slackChannelId.trim(),
        source: 'team.slackChannelId',
      };
    }

    const envUpdates =
      this.configService.get<string>('SLACK_UPDATES_CHANNEL_ID')?.trim();
    if (envUpdates) {
      return { ref: envUpdates, source: 'SLACK_UPDATES_CHANNEL_ID' };
    }

    const envDigest =
      this.configService.get<string>('SLACK_DIGEST_CHANNEL_ID')?.trim();
    if (envDigest) {
      return { ref: envDigest, source: 'SLACK_DIGEST_CHANNEL_ID' };
    }

    return { ref: null, source: 'none' };
  }

  /**
   * Posts the parent message for a CheckIn run and stores thread anchor on StandupRun.
   */
  async createRunThread(runId: string): Promise<CreateRunThreadResult> {
    const run = await this.prisma.standupRun.findUnique({
      where: { id: runId },
      include: {
        checkIn: {
          include: { team: true },
        },
        submissions: true,
      },
    });

    if (!run?.checkIn) {
      const reason = `Run ${runId} has no CheckIn — cannot create thread.`;
      this.logger.error(`[Thread] ${reason}`);
      return { ok: false, reason };
    }

    if (run.slackThreadTs && run.slackChannelId) {
      this.logger.log(
        `[Thread] Run ${runId} already has thread ${run.slackThreadTs} in ${run.slackChannelId}`,
      );
      return {
        ok: true,
        channelId: run.slackChannelId,
        threadTs: run.slackThreadTs,
      };
    }

    const { ref: channelRef, source } = this.resolveUpdatesChannelRef(run.checkIn);

    this.logger.log(
      `[Thread] Channel config for "${run.checkIn.name}": source=${source}, ref=${channelRef ?? 'null'}, checkIn.updatesChannelId=${run.checkIn.updatesChannelId ?? 'null'}, team.slackChannelId=${run.checkIn.team?.slackChannelId ?? 'null'}`,
    );

    if (!channelRef) {
      const reason =
        `No Slack channel configured for CheckIn "${run.checkIn.name}". Set updatesChannelId on the CheckIn, team.slackChannelId on the team, or SLACK_UPDATES_CHANNEL_ID in env.`;
      this.logger.error(`[Thread] ${reason}`);
      return { ok: false, reason };
    }

    const channelId = await this.slackService.resolveChannelId(channelRef);
    if (!channelId) {
      const reason = `Could not resolve Slack channel "${channelRef}" (from ${source}) to a channel ID. Use a channel ID like C0123456789 or ensure the bot can list channels.`;
      this.logger.error(`[Thread] ${reason}`);
      return { ok: false, reason };
    }

    const joined = await this.slackService.joinChannel(channelId);
    if (!joined) {
      const reason = `Bot could not join Slack channel ${channelId} (from ${source}). Invite the bot to the channel or grant channels:join scope.`;
      this.logger.error(`[Thread] ${reason}`);
      return { ok: false, reason };
    }

    const totalCount =
      run.submissions.length ||
      (await this.prisma.checkInParticipant.count({
        where: { checkInId: run.checkInId!, isActive: true },
      }));

    const blocks = buildParentMessageBlocks({
      checkInName: run.checkIn.name,
      completedCount: 0,
      totalCount,
    });

    const text = buildParentMessageText({
      checkInName: run.checkIn.name,
      completedCount: 0,
      totalCount,
    });

    this.logger.log(
      `[Thread] Posting public standup announcement for "${run.checkIn.name}" to channel ${channelId} (resolved from ${source}: "${channelRef}")`,
    );

    const posted = await this.slackService.postMessage({ channelId, text, blocks });
    if (!posted.ok || !posted.ts) {
      const reason = [
        `chat.postMessage failed for run ${runId} in channel ${channelId}.`,
        posted.slackError ? `slack_error=${posted.slackError}` : null,
        posted.needed ? `needed=${posted.needed}` : null,
        posted.provided ? `provided=${posted.provided}` : null,
        posted.error ? `message=${posted.error}` : null,
      ]
        .filter(Boolean)
        .join(' ');

      this.logger.error(`[Thread] ${reason}`);
      return { ok: false, reason };
    }

    await this.prisma.standupRun.update({
      where: { id: runId },
      data: {
        slackChannelId: channelId,
        slackThreadTs: posted.ts,
      },
    });

    await this.prisma.standupThreadUpdate.create({
      data: {
        runId,
        userId: run.submissions[0]?.userId || (await this.getFallbackUserId(run.checkIn.teamId)),
        type: 'parent',
        slackMessageTs: posted.ts,
        content: text,
      },
    });

    this.logger.log(
      `[Thread] Created public thread ${posted.ts} for run ${runId} in channel ${channelId}`,
    );

    return { ok: true, channelId, threadTs: posted.ts as string };
  }

  async refreshParentProgress(runId: string): Promise<void> {
    const run = await this.prisma.standupRun.findUnique({
      where: { id: runId },
      include: {
        checkIn: true,
        submissions: true,
      },
    });

    if (!run?.checkIn || !run.slackChannelId || !run.slackThreadTs) return;

    const completedCount = run.submissions.filter((s) => s.status === 'completed').length;
    const totalCount = run.submissions.length;

    const blocks = buildParentMessageBlocks({
      checkInName: run.checkIn.name,
      completedCount,
      totalCount,
    });

    const text = buildParentMessageText({
      checkInName: run.checkIn.name,
      completedCount,
      totalCount,
    });

    await this.slackService.updateMessage({
      channelId: run.slackChannelId,
      ts: run.slackThreadTs,
      text,
      blocks,
    });
  }

  async postParticipantSummary(submissionId: string): Promise<void> {
    const submission = await this.prisma.standupSubmission.findUnique({
      where: { id: submissionId },
      include: {
        user: true,
        answers: {
          include: { question: true },
          orderBy: { createdAt: 'asc' },
        },
        run: {
          include: { checkIn: true },
        },
      },
    });

    if (!submission?.run?.checkIn) {
      this.logger.warn(`[Thread] Cannot post summary — submission ${submissionId} missing run/checkIn`);
      return;
    }

    const run = submission.run;
    if (!run.slackChannelId || !run.slackThreadTs) {
      this.logger.warn(
        `[Thread] Run ${run.id} has no Slack thread — skipping participant summary for ${submission.user.slackDisplayName}`,
      );
      return;
    }

    const qaPairs = submission.answers.map((a) => ({
      question: a.question.question,
      answer: a.text,
    }));

    const blocks = buildParticipantSummaryBlocks({
      displayName: submission.user.slackDisplayName,
      qaPairs,
    });

    const text = buildParticipantSummaryText({
      displayName: submission.user.slackDisplayName,
      qaPairs,
    });

    const posted = await this.slackService.postMessage({
      channelId: run.slackChannelId,
      threadTs: run.slackThreadTs,
      text,
      blocks,
    });

    if (posted.ok && posted.ts) {
      await this.prisma.$transaction([
        this.prisma.standupThreadUpdate.create({
          data: {
            runId: run.id,
            submissionId: submission.id,
            userId: submission.userId,
            type: 'participant_summary',
            slackMessageTs: posted.ts,
            content: text,
          },
        }),
        this.prisma.standupRun.update({
          where: { id: run.id },
          data: { threadReplyCount: { increment: 1 } },
        }),
      ]);

      await this.refreshParentProgress(run.id);
      this.logger.log(
        `[Thread] Posted summary for ${submission.user.slackDisplayName} in run ${run.id}`,
      );
    }
  }

  async postAdditionalUpdate(params: {
    runId: string;
    slackUserId: string;
    text: string;
  }): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { slackUserId: params.slackUserId },
    });

    if (!user) return false;

    const run = await this.prisma.standupRun.findUnique({
      where: { id: params.runId },
      include: { checkIn: true },
    });

    if (!run?.slackChannelId || !run.slackThreadTs) return false;

    const submission = await this.prisma.standupSubmission.findFirst({
      where: { runId: params.runId, userId: user.id },
    });

    const blocks = buildAdditionalUpdatePostedBlocks({
      displayName: user.slackDisplayName,
      text: params.text.trim(),
    });

    const posted = await this.slackService.postMessage({
      channelId: run.slackChannelId,
      threadTs: run.slackThreadTs,
      text: `${user.slackDisplayName} added an additional update:\n${params.text.trim()}`,
      blocks,
    });

    if (!posted.ok) return false;

    await this.prisma.$transaction([
      this.prisma.standupThreadUpdate.create({
        data: {
          runId: params.runId,
          submissionId: submission?.id,
          userId: user.id,
          type: 'additional_update',
          slackMessageTs: posted.ts,
          content: params.text.trim(),
        },
      }),
      this.prisma.standupRun.update({
        where: { id: params.runId },
        data: { threadReplyCount: { increment: 1 } },
      }),
    ]);

    return true;
  }

  async postAiReportToThread(
    runId: string,
    digestText: string,
    blocks?: unknown[],
  ): Promise<boolean> {
    const run = await this.prisma.standupRun.findUnique({
      where: { id: runId },
      include: {
        checkIn: true,
        submissions: true,
      },
    });

    if (!run?.checkIn || !run.slackChannelId || !run.slackThreadTs) {
      this.logger.error(`[Thread] Cannot post AI report — run ${runId} missing thread anchor`);
      return false;
    }

    const completedCount = run.submissions.filter((s) => s.status === 'completed').length;
    const totalCount = run.submissions.length;
    const header = buildAiReportHeader({
      checkInName: run.checkIn.name,
      completedCount,
      totalCount,
    });
    const body = `${header}\n\n${digestText}`;

    const posted = await this.slackService.postMessage({
      channelId: run.slackChannelId,
      threadTs: run.slackThreadTs,
      text: body,
      ...(blocks ? { blocks: blocks as any } : {}),
    });

    if (posted.ok) {
      await this.prisma.standupRun.update({
        where: { id: runId },
        data: {
          reportGeneratedAt: new Date(),
          reportStatus: 'completed',
          threadReplyCount: { increment: 1 },
        },
      });
    }

    return posted.ok;
  }

  private async getFallbackUserId(teamId: string): Promise<string> {
    const member = await this.prisma.teamMember.findFirst({
      where: { teamId },
      select: { userId: true },
    });
    if (!member) throw new Error(`No team members for team ${teamId}`);
    return member.userId;
  }
}
