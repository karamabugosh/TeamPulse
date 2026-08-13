import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { SlackService } from './slack.service';
import { CreateRunThreadResult } from './check-in-thread.types';
import {
  buildAdditionalUpdatePostedBlocks,
  buildAdditionalUpdateButtonBlocks,
  buildAiReportHeader,
  buildParentMessageBlocks,
  buildParentMessageText,
  buildParticipantSummaryBlocks,
  buildParticipantSummaryText,
  buildSlackArchiveUrl,
  buildSlackThreadUrl,
  formatRunDateShort,
} from './slack-checkin.views';

export type ThreadAnchorResult = {
  ok: boolean;
  channelId?: string;
  threadTs?: string;
  threadUrl?: string | null;
  reason?: string;
  repaired?: boolean;
};

@Injectable()
export class CheckInThreadService implements OnApplicationBootstrap {  private readonly logger = new Logger(CheckInThreadService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly slackService: SlackService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const repaired = await this.repairAllMissingThreadAnchors();
      if (repaired > 0) {
        this.logger.log(
          `[Thread] Repaired ${repaired} run(s) with missing Slack thread anchors.`,
        );
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[Thread] Startup anchor repair failed: ${message}`);
    }
  }
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

    const runDateLabel = formatRunDateShort(
      run.scheduledFor,
      run.checkIn.timezone || 'UTC',
    );

    const blocks = buildParentMessageBlocks({
      checkInName: run.checkIn.name,
      runDateLabel,
      completedCount: 0,
      totalCount,
    });

    const text = buildParentMessageText({
      checkInName: run.checkIn.name,
      runDateLabel,
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

    await this.persistThreadAnchor({
      runId,
      channelId,
      messageTs: posted.ts as string,
    });

    await this.prisma.standupThreadUpdate.create({      data: {
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

  /**
   * Loads the stored thread anchor, repairing from StandupThreadUpdate when possible.
   * Never creates a new public message for completed runs.
   */
  async ensureThreadAnchor(runId: string): Promise<ThreadAnchorResult> {
    const run = await this.prisma.standupRun.findUnique({
      where: { id: runId },
      include: {
        checkIn: {
          include: {
            team: {
              include: {
                workspace: {
                  select: {
                    slackWorkspaceId: true,
                    slackWorkspaceName: true,
                  },
                },
              },
            },
          },
        },
        threadUpdates: {
          where: { type: 'parent' },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });

    if (!run) {
      return { ok: false, reason: `Run ${runId} was not found.` };
    }

    if (run.slackChannelId && run.slackThreadTs) {
      const threadUrl = await this.ensureThreadUrl(run);
      return {
        ok: true,
        channelId: run.slackChannelId,
        threadTs: run.slackThreadTs,
        threadUrl,
      };
    }

    const parentUpdate = run.threadUpdates[0];
    if (parentUpdate?.slackMessageTs) {
      const channelId = await this.resolveStoredChannelId(run);
      if (channelId) {
        await this.persistThreadAnchor({
          runId,
          channelId,
          messageTs: parentUpdate.slackMessageTs,
        });
        this.logger.warn(
          `[Thread] Repaired missing anchor for run ${runId} from parent StandupThreadUpdate (${parentUpdate.slackMessageTs}).`,
        );
        const refreshed = await this.prisma.standupRun.findUnique({
          where: { id: runId },
          select: {
            slackChannelId: true,
            slackThreadTs: true,
            slackThreadUrl: true,
          },
        });
        return {
          ok: true,
          channelId: refreshed?.slackChannelId ?? channelId,
          threadTs: refreshed?.slackThreadTs ?? parentUpdate.slackMessageTs,
          threadUrl: refreshed?.slackThreadUrl ?? null,
          repaired: true,
        };
      }

      this.logger.error(
        `[Thread] Run ${runId} has a parent StandupThreadUpdate (${parentUpdate.slackMessageTs}) but no resolvable Slack channel — check updatesChannelId / team.slackChannelId.`,
      );
      return {
        ok: false,
        reason:
          'Parent Slack message exists in history but the channel ID could not be resolved.',
      };
    }

    if (run.status === 'collecting') {
      const created = await this.createRunThread(runId);
      if (created.ok) {
        const refreshed = await this.prisma.standupRun.findUnique({
          where: { id: runId },
          select: {
            slackChannelId: true,
            slackThreadTs: true,
            slackThreadUrl: true,
          },
        });
        return {
          ok: true,
          channelId: refreshed?.slackChannelId ?? created.channelId,
          threadTs: refreshed?.slackThreadTs ?? created.threadTs,
          threadUrl: refreshed?.slackThreadUrl ?? null,
          repaired: true,
        };
      }

      return {
        ok: false,
        reason:
          created.ok === false
            ? created.reason
            : 'Could not create Slack thread for active run.',
      };
    }

    const checkInLabel = run.checkIn?.name ?? runId;
    const reason =
      `Check-In "${checkInLabel}" never started in Slack — no parent message was posted, so reports and reminders cannot use a thread.`;

    this.logger.warn(`[Thread] ${reason} (runId=${runId}, status=${run.status})`);

    return { ok: false, reason };
  }

  private async repairAllMissingThreadAnchors(): Promise<number> {
    const runs = await this.prisma.standupRun.findMany({
      where: {
        checkInId: { not: null },
        OR: [
          { slackThreadTs: null },
          { slackChannelId: null },
          { slackThreadUrl: null, slackThreadTs: { not: null } },
        ],
      },
      select: { id: true },
      take: 100,
    });

    let repaired = 0;

    for (const run of runs) {
      const result = await this.ensureThreadAnchor(run.id);
      if (result.ok && result.repaired) {
        repaired += 1;
      }
    }

    return repaired;
  }

  private async persistThreadAnchor(params: {
    runId: string;
    channelId: string;
    messageTs: string;
  }): Promise<void> {
    const threadUrl = await this.buildThreadUrlForRun(
      params.runId,
      params.channelId,
      params.messageTs,
    );

    await this.prisma.standupRun.update({
      where: { id: params.runId },
      data: {
        slackChannelId: params.channelId,
        slackThreadTs: params.messageTs,
        slackRootMessageTs: params.messageTs,
        slackThreadUrl: threadUrl,
      },
    });
  }

  private async ensureThreadUrl(
    run: {
      id: string;
      slackChannelId: string | null;
      slackThreadTs: string | null;
      slackThreadUrl?: string | null;
    },
  ): Promise<string | null> {
    if (run.slackThreadUrl) {
      return run.slackThreadUrl;
    }

    if (!run.slackChannelId || !run.slackThreadTs) {
      return null;
    }

    const threadUrl = await this.buildThreadUrlForRun(
      run.id,
      run.slackChannelId,
      run.slackThreadTs,
    );

    if (threadUrl) {
      await this.prisma.standupRun.update({
        where: { id: run.id },
        data: { slackThreadUrl: threadUrl },
      });
    }

    return threadUrl;
  }

  private async buildThreadUrlForRun(
    runId: string,
    channelId: string,
    messageTs: string,
  ): Promise<string | null> {
    try {
      const permalink = await this.slackService.getPermalink(
        channelId,
        messageTs,
      );
      if (permalink) {
        return permalink;
      }
    } catch {
      // Fall back to constructed URL below.
    }

    const run = await this.prisma.standupRun.findUnique({
      where: { id: runId },
      select: {
        team: {
          select: {
            workspace: {
              select: {
                slackWorkspaceId: true,
                slackWorkspaceName: true,
              },
            },
          },
        },
      },
    });

    const workspaceId =
      run?.team?.workspace?.slackWorkspaceId ||
      this.configService.get<string>('SLACK_TEAM_ID')?.trim() ||
      '';

    if (workspaceId && !workspaceId.startsWith('T0000')) {
      return buildSlackThreadUrl(workspaceId, channelId, messageTs);
    }

    const domain = run?.team?.workspace?.slackWorkspaceName
      ?.toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (domain && domain.length > 2) {
      return buildSlackArchiveUrl(domain, channelId, messageTs);
    }

    return workspaceId
      ? buildSlackThreadUrl(workspaceId, channelId, messageTs)
      : null;
  }

  private async resolveStoredChannelId(run: {
    slackChannelId?: string | null;
    checkIn?: {
      updatesChannelId?: string | null;
      team?: { slackChannelId?: string | null } | null;
    } | null;
  }): Promise<string | null> {
    if (run.slackChannelId) {
      return run.slackChannelId;
    }

    if (!run.checkIn) {
      return null;
    }

    const { ref: channelRef } = this.resolveUpdatesChannelRef(run.checkIn);
    if (!channelRef) {
      return null;
    }

    return this.slackService.resolveChannelId(channelRef);
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

    const runDateLabel = formatRunDateShort(
      run.scheduledFor,
      run.checkIn.timezone || 'UTC',
    );

    const blocks = buildParentMessageBlocks({
      checkInName: run.checkIn.name,
      runDateLabel,
      completedCount,
      totalCount,
    });

    const text = buildParentMessageText({
      checkInName: run.checkIn.name,
      runDateLabel,
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

    const qaPairs = [...submission.answers]
      .sort((a, b) => a.question.order - b.question.order)
      .map((a) => ({
        question: a.question.question,
        answer: a.text,
        type: a.question.type,
        structuredValue: a.structuredValue,
      }));

    const checkInName = submission.run.checkIn.name;

    const blocks = buildParticipantSummaryBlocks({
      displayName: submission.user.slackDisplayName,
      checkInName,
      qaPairs,
    });

    const text = buildParticipantSummaryText({
      displayName: submission.user.slackDisplayName,
      checkInName,
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
      checkInName: run.checkIn.name,
      text: params.text.trim(),
    });

    const posted = await this.slackService.postMessage({
      channelId: run.slackChannelId,
      threadTs: run.slackThreadTs,
      text: `${user.slackDisplayName} posted an additional update for ${run.checkIn.name}:\n${params.text.trim()}`,
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

  /** Posts the "Add Additional Update" button in the participant's DM thread. */
  async postAdditionalUpdateButtonForUser(params: {
    runId: string;
    slackUserId: string;
  }): Promise<boolean> {
    const submission = await this.prisma.standupSubmission.findFirst({
      where: {
        runId: params.runId,
        user: { slackUserId: params.slackUserId },
      },
      select: {
        slackDmChannelId: true,
        slackDmThreadTs: true,
      },
    });

    if (!submission?.slackDmChannelId || !submission.slackDmThreadTs) {
      this.logger.warn(
        `[Thread] Cannot post additional-update button — no DM anchor for user ${params.slackUserId} on run ${params.runId}`,
      );
      return false;
    }

    const blocks = buildAdditionalUpdateButtonBlocks(params.runId);

    const posted = await this.slackService.postMessage({
      channelId: submission.slackDmChannelId,
      threadTs: submission.slackDmThreadTs,
      text: 'Finished your check-in? You can add another update anytime.',
      blocks: blocks as any,
    });

    if (posted.ok) {
      this.logger.log(
        `[Thread] Posted additional-update button for user ${params.slackUserId} on run ${params.runId}`,
      );
    }

    return posted.ok;
  }

  async postAiReportToThread(
    runId: string,
    digestText: string,
    blocks?: unknown[],
    options?: { skipHeader?: boolean },
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

    let body = digestText;

    if (!options?.skipHeader) {
      const completedCount = run.submissions.filter((s) => s.status === 'completed').length;
      const totalCount = run.submissions.length;
      const header = buildAiReportHeader({
        checkInName: run.checkIn.name,
        completedCount,
        totalCount,
      });
      body = `${header}\n\n${digestText}`;
    }

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
