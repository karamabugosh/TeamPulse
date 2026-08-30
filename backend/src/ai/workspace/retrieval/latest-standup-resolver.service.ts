import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ResolvedLatestStandupScope,
  TemporalRetrievalScope,
} from './temporal-retrieval.util';

export type ResolveLatestStandupParams = {
  workspaceId: string;
  temporalScope: TemporalRetrievalScope;
  /** When set, scope to this user's most recent completed submission. */
  subjectUserId?: string | null;
  checkInId?: string | null;
};

@Injectable()
export class LatestStandupResolverService {
  private readonly logger = new Logger(LatestStandupResolverService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the latest applicable standup scope.
   * Uses submission.completedAt — not run.status — so in-progress runs with
   * completed submissions (common in Slack collection) are included.
   */
  async resolve(
    params: ResolveLatestStandupParams,
  ): Promise<ResolvedLatestStandupScope | null> {
    const workspaceId = params.workspaceId?.trim();
    if (!workspaceId) return null;

    const submission = await this.prisma.standupSubmission.findFirst({
      where: {
        status: 'completed',
        user: { workspaceId },
        ...(params.subjectUserId ? { userId: params.subjectUserId } : {}),
        ...(params.checkInId ? { run: { checkInId: params.checkInId } } : {}),
      },
      orderBy: { completedAt: 'desc' },
      include: {
        user: { select: { id: true, slackDisplayName: true } },
        answers: { select: { id: true } },
        run: {
          select: {
            id: true,
            teamId: true,
            checkInId: true,
            startedAt: true,
            completedAt: true,
          },
        },
      },
    });

    if (!submission?.run) {
      this.logger.warn(
        `Latest standup scope unresolved workspace=${workspaceId} subjectUserId=${params.subjectUserId ?? 'any'}`,
      );
      return null;
    }

    const blockers = await this.prisma.pulseBlocker.findMany({
      where: {
        workspaceId,
        OR: [
          { submissionId: submission.id },
          { runId: submission.runId, userId: submission.userId },
        ],
      },
      select: { id: true },
    });

    const scopedSourceIds = [
      ...submission.answers.map((a) => a.id),
      ...blockers.map((b) => b.id),
    ];

    return {
      temporalScope: params.temporalScope,
      workspaceId,
      checkInId: submission.run.checkInId,
      teamId: submission.run.teamId,
      runId: submission.runId,
      submissionId: submission.id,
      subjectUserId: submission.userId,
      subjectDisplayName: submission.user.slackDisplayName,
      runStartedAt: submission.run.startedAt,
      runCompletedAt: submission.run.completedAt,
      submissionCompletedAt: submission.completedAt ?? submission.updatedAt,
      scopedSourceIds,
    };
  }
}
