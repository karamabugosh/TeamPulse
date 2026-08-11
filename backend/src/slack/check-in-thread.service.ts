import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SlackService } from './slack.service';
import {
  buildAdditionalUpdateButtonBlocks,
  buildAdditionalUpdatePostedBlocks,
  buildParentMessageBlocks,
  buildParentMessageText,
  buildParticipantSummaryBlocks,
  buildParticipantSummaryText,
  formatRunDate,
} from './slack-checkin.views';

@Injectable()
export class CheckInThreadService {
  private readonly logger = new Logger(CheckInThreadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly slackService: SlackService,
    private readonly configService: ConfigService,
  ) {}

  resolveUpdatesChannelId(checkIn: {
    updatesChannelId?: string | null;
    team?: { slackChannelId?: string | null } | null;
  }): string | null {
    return (
      checkIn.updatesChannelId?.trim() ||
      checkIn.team?.slackChannelId?.trim() ||
      this.configService.get<string>('SLACK_UPDATES_CHANNEL_ID')?.trim() ||
      this.configService.get<string>('SLACK_DIGEST_CHANNEL_ID')?.trim() ||
      null
    );
  }

  /**
   * Posts the parent message for a CheckIn run and stores thread anchor on StandupRun.
   */
  async createRunThread(runId: string): Promise<{ channelId: string; threadTs: string } | null> {
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
      this.logger.error(`[Thread] Run ${runId} has no CheckIn — cannot create thread.`);
      return null;
    }

    if (run.slackThreadTs && run.slackChannelId) {
      this.logger.log(
        `[Thread] Run ${runId} already has thread ${run.slackThreadTs} in ${run.slackChannelId}`,
      );
      return { channelId: run.slackChannelId, threadTs: run.slackThreadTs };
    }

    const channelId = this.resolveUpdatesChannelId(run.checkIn);
    if (!channelId) {
      this.logger.error(
        `[Thread] No updates channel configured for CheckIn "${run.checkIn.name}". Set updatesChannelId on the CheckIn or SLACK_UPDATES_CHANNEL_ID in env.`,
      );
      return null;
    }

    const totalCount =
      run.submissions.length ||
      (await this.prisma.checkInParticipant.count({
        where: { checkInId: run.checkInId!, isActive: true },
      }));

    const dateLabel = formatRunDate(run.scheduledFor, run.checkIn.timezone);
    const blocks = buildParentMessageBlocks({
      checkInName: run.checkIn.name,
      description: run.checkIn.description,
      dateLabel,
      completedCount: 0,
      totalCount,
    });

    const text = buildParentMessageText({
      checkInName: run.checkIn.name,
      dateLabel,
      completedCount: 0,
      totalCount,
    });

    this.logger.log(
      `[Thread] Posting parent message for "${run.checkIn.name}" to channel ${channelId}`,
    );

    const posted = await this.slackService.postMessage({ channelId, text, blocks });
    if (!posted.ok || !posted.ts) {
      this.logger.error(`[Thread] Failed to post parent message for run ${runId}`);
      return null;
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

    await this.slackService.postMessage({
      channelId,
      threadTs: posted.ts,
      text: 'Participants can add additional updates after completing their check-in.',
      blocks: buildAdditionalUpdateButtonBlocks(runId),
    });

    this.logger.log(
      `[Thread] Created thread ${posted.ts} for run ${runId} in channel ${channelId}`,
    );

    return { channelId, threadTs: posted.ts };
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
    const dateLabel = formatRunDate(run.scheduledFor, run.checkIn.timezone);

    const blocks = buildParentMessageBlocks({
      checkInName: run.checkIn.name,
      description: run.checkIn.description,
      dateLabel,
      completedCount,
      totalCount,
    });

    const text = buildParentMessageText({
      checkInName: run.checkIn.name,
      dateLabel,
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
      checkInName: run.checkIn.name,
      qaPairs,
    });

    const text = buildParticipantSummaryText({
      displayName: submission.user.slackDisplayName,
      checkInName: run.checkIn.name,
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
    const header = `*${run.checkIn.name} Report*\n\n*Reported:* ${completedCount} of ${totalCount}\n\n${digestText}`;

    const posted = await this.slackService.postMessage({
      channelId: run.slackChannelId,
      threadTs: run.slackThreadTs,
      text: header,
      ...(blocks ? { blocks: blocks as any } : {}),
    });

    if (posted.ok) {
      await this.prisma.standupRun.update({
        where: { id: runId },
        data: {
          reportGeneratedAt: new Date(),
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
