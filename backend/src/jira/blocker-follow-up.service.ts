import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryOutboxService } from '../memory/memory-outbox.service';
import { MEMORY_SOURCE } from '../memory/memory-source.constants';
import { isBlockerResolutionFollowUp } from '../memory/memory-ingestion.policy';

export const ACTIVE_BLOCKER_STATUSES = ['open', 'in_progress'] as const;

export type FollowUpChoice = 'resolved' | 'working' | 'blocked';

export type ActiveBlockerForFollowUp = {
  id: string;
  title: string;
  description: string;
  status: string;
  severity: string;
  createdAt: Date;
  daysOpen: number;
  linkedIssueKey: string | null;
  linkedIssueUrl: string | null;
};

function daysOpenSince(createdAt: Date, now = new Date()): number {
  const ms = now.getTime() - createdAt.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * Blocker Follow-up before daily standup.
 * Active = status open | in_progress for the reporting user.
 */
@Injectable()
export class BlockerFollowUpService {
  private readonly logger = new Logger(BlockerFollowUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memoryOutbox: MemoryOutboxService,
  ) {}

  async listActiveBlockersForUser(
    userId: string,
  ): Promise<ActiveBlockerForFollowUp[]> {
    const blockers = await this.prisma.pulseBlocker.findMany({
      where: {
        userId,
        status: { in: [...ACTIVE_BLOCKER_STATUSES] },
      },
      orderBy: { createdAt: 'asc' },
    });

    return blockers.map((blocker) => ({
      id: blocker.id,
      title: blocker.title?.trim() || blocker.description.slice(0, 120),
      description: blocker.description,
      status: blocker.status,
      severity: blocker.severity,
      createdAt: blocker.createdAt,
      daysOpen: daysOpenSince(blocker.createdAt),
      linkedIssueKey: blocker.linkedIssueKey,
      linkedIssueUrl: blocker.linkedIssueUrl,
    }));
  }

  async listActiveBlockersForSlackUser(
    slackUserId: string,
  ): Promise<{ userId: string; blockers: ActiveBlockerForFollowUp[] } | null> {
    const user = await this.prisma.user.findUnique({
      where: { slackUserId },
      select: { id: true },
    });
    if (!user) return null;
    const blockers = await this.listActiveBlockersForUser(user.id);
    return { userId: user.id, blockers };
  }

  async startSession(params: {
    submissionId: string;
    userId: string;
    blockerIds: string[];
    channelId: string;
    threadTs: string;
  }) {
    return this.prisma.blockerFollowUpSession.upsert({
      where: { submissionId: params.submissionId },
      create: {
        submissionId: params.submissionId,
        userId: params.userId,
        pendingIds: params.blockerIds,
        completedIds: [],
        status: 'pending',
        channelId: params.channelId,
        threadTs: params.threadTs,
      },
      update: {
        pendingIds: params.blockerIds,
        completedIds: [],
        status: 'pending',
        channelId: params.channelId,
        threadTs: params.threadTs,
      },
    });
  }

  async getSessionBySubmission(submissionId: string) {
    return this.prisma.blockerFollowUpSession.findUnique({
      where: { submissionId },
    });
  }

  getPendingIds(session: { pendingIds: unknown }): string[] {
    return asStringArray(session.pendingIds);
  }

  async getBlockerById(blockerId: string) {
    return this.prisma.pulseBlocker.findUnique({
      where: { id: blockerId },
    });
  }

  async applyFollowUp(params: {
    blockerId: string;
    userId: string;
    choice: FollowUpChoice;
    notes: string;
    resolutionType?: string | null;
    needsHelp?: boolean | null;
    needsEscalation?: boolean | null;
    updatedFrom?: string;
  }) {
    const blocker = await this.prisma.pulseBlocker.findUnique({
      where: { id: params.blockerId },
    });
    if (!blocker || blocker.userId !== params.userId) {
      throw new Error('Blocker not found for this user');
    }

    const previousStatus = blocker.status;
    const daysOpen = daysOpenSince(blocker.createdAt);
    let newStatus: string;
    const data: Prisma.PulseBlockerUpdateInput = {};

    if (params.choice === 'resolved') {
      newStatus = 'resolved';
      data.status = 'resolved';
      data.resolvedAt = new Date();
      data.resolutionNotes = params.notes.trim();
      data.resolutionType = params.resolutionType?.trim() || null;
      data.needsHelp = null;
      data.needsEscalation = null;
    } else if (params.choice === 'working') {
      newStatus = 'in_progress';
      data.status = 'in_progress';
      data.resolvedAt = null;
    } else {
      newStatus = 'open';
      data.status = 'open';
      data.resolvedAt = null;
      data.needsHelp = params.needsHelp ?? false;
      data.needsEscalation = params.needsEscalation ?? false;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const blockerRow = await tx.pulseBlocker.update({
        where: { id: blocker.id },
        data,
      });

      const updateRow = await tx.pulseBlockerUpdate.create({
        data: {
          blockerId: blocker.id,
          userId: params.userId,
          previousStatus,
          newStatus,
          notes: params.notes.trim(),
          resolutionType: params.resolutionType?.trim() || null,
          needsHelp:
            params.choice === 'blocked' ? (params.needsHelp ?? false) : null,
          needsEscalation:
            params.choice === 'blocked'
              ? (params.needsEscalation ?? false)
              : null,
          daysOpen,
          updatedFrom: params.updatedFrom ?? 'Slack Follow-up',
        },
      });

      if (isBlockerResolutionFollowUp(params.choice)) {
        // Durable resolution event — PulseBlockerUpdate is the source of truth.
        await this.memoryOutbox.enqueueUpsert({
          tx,
          workspaceId: blocker.workspaceId,
          sourceType: MEMORY_SOURCE.BLOCKER_RESOLUTION,
          sourceId: updateRow.id,
        });
      } else {
        // Ordinary status/help edits re-index the blocker itself.
        await this.memoryOutbox.enqueueUpsert({
          tx,
          workspaceId: blocker.workspaceId,
          sourceType: MEMORY_SOURCE.BLOCKER,
          sourceId: blocker.id,
        });
      }

      return blockerRow;
    });

    this.logger.log(
      `Blocker follow-up ${blocker.id}: ${previousStatus} → ${newStatus}`,
    );

    return updated;
  }

  async markBlockerCompletedInSession(params: {
    submissionId: string;
    blockerId: string;
  }): Promise<{ remaining: string[]; done: boolean }> {
    const session = await this.prisma.blockerFollowUpSession.findUnique({
      where: { submissionId: params.submissionId },
    });
    if (!session) {
      return { remaining: [], done: true };
    }

    const pending = asStringArray(session.pendingIds).filter(
      (id) => id !== params.blockerId,
    );
    const completed = [
      ...new Set([...asStringArray(session.completedIds), params.blockerId]),
    ];
    const done = pending.length === 0;

    await this.prisma.blockerFollowUpSession.update({
      where: { id: session.id },
      data: {
        pendingIds: pending,
        completedIds: completed,
        status: done ? 'completed' : 'pending',
      },
    });

    return { remaining: pending, done };
  }

  async listUpdatesForBlocker(blockerId: string) {
    return this.prisma.pulseBlockerUpdate.findMany({
      where: { blockerId },
      include: {
        user: { select: { slackDisplayName: true, slackUserId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
