import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JiraAuditService } from './jira-audit.service';
import {
  sanitizeJiraSummary,
  toFriendlyJiraErrorMessage,
} from './jira-issue-payload.util';
import { JiraService } from './jira.service';
import { MemoryOutboxService } from '../memory/memory-outbox.service';
import { MEMORY_SOURCE } from '../memory/memory-source.constants';

export type ProposedActionResult = {
  actionId: string;
  actionType: string;
  jiraIssueKey?: string | null;
  status: string;
};

@Injectable()
export class JiraActionService {
  private readonly logger = new Logger(JiraActionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jiraService: JiraService,
    private readonly jiraAuditService: JiraAuditService,
    private readonly memoryOutbox: MemoryOutboxService,
  ) {}

  async proposeAddComment(params: {
    userId: string;
    blockerId: string;
    issueKey: string;
    commentBody: string;
    slackChannelId: string;
    slackMessageTs?: string;
    idempotencySeed?: string;
  }): Promise<ProposedActionResult> {
    const idempotencyKey = this.buildIdempotencyKey(
      'add_comment',
      params.userId,
      params.blockerId,
      params.issueKey,
      params.idempotencySeed,
    );

    const existing = await this.prisma.jiraProposedAction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      return this.toResult(existing);
    }

    const action = await this.prisma.jiraProposedAction.create({
      data: {
        userId: params.userId,
        blockerId: params.blockerId,
        actionType: 'add_comment',
        status: 'proposed',
        idempotencyKey,
        jiraIssueKey: params.issueKey,
        slackChannelId: params.slackChannelId,
        slackMessageTs: params.slackMessageTs ?? null,
        payload: {
          commentBody: params.commentBody,
        },
      },
    });

    await this.jiraAuditService.record({
      userId: params.userId,
      proposedActionId: action.id,
      actionType: 'add_comment',
      jiraIssueKey: params.issueKey,
      status: 'proposed',
      metadata: { blockerId: params.blockerId },
    });

    return this.toResult(action);
  }

  async proposeCreateIssue(params: {
    userId: string;
    blockerId: string;
    summary: string;
    description: string;
    projectKey?: string | null;
    slackChannelId: string;
    slackMessageTs?: string;
    idempotencySeed?: string;
  }): Promise<ProposedActionResult> {
    const idempotencyKey = this.buildIdempotencyKey(
      'create_issue',
      params.userId,
      params.blockerId,
      'new',
      params.idempotencySeed,
    );

    const existing = await this.prisma.jiraProposedAction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      return this.toResult(existing);
    }

    const action = await this.prisma.jiraProposedAction.create({
      data: {
        userId: params.userId,
        blockerId: params.blockerId,
        actionType: 'create_issue',
        status: 'proposed',
        idempotencyKey,
        slackChannelId: params.slackChannelId,
        slackMessageTs: params.slackMessageTs ?? null,
        payload: {
          summary: sanitizeJiraSummary(params.summary),
          description: params.description,
          projectKey: params.projectKey ?? null,
        },
      },
    });

    await this.jiraAuditService.record({
      userId: params.userId,
      proposedActionId: action.id,
      actionType: 'create_issue',
      status: 'proposed',
      metadata: { blockerId: params.blockerId },
    });

    return this.toResult(action);
  }

  async approveAction(params: {
    actionId: string;
    userId: string;
    slackInteractionTs?: string;
  }) {
    const action = await this.prisma.jiraProposedAction.findUnique({
      where: { id: params.actionId },
      include: { blocker: true },
    });

    if (!action) {
      throw new NotFoundException('Proposed Jira action not found');
    }

    if (action.userId !== params.userId) {
      throw new BadRequestException('You can only approve your own Jira actions');
    }

    if (action.status === 'executed') {
      return action;
    }

    if (action.status !== 'proposed' && action.status !== 'failed') {
      return action;
    }

    const approved = await this.prisma.jiraProposedAction.update({
      where: { id: action.id },
      data: {
        status: 'approved',
        approvedAt: new Date(),
        errorMessage: null,
        slackInteractionTs: params.slackInteractionTs ?? null,
      },
    });

    await this.jiraAuditService.record({
      userId: params.userId,
      proposedActionId: action.id,
      actionType: action.actionType,
      jiraIssueKey: action.jiraIssueKey,
      status: 'approved',
    });

    return this.executeApprovedAction(approved);
  }

  async retryAction(params: {
    actionId: string;
    userId: string;
    slackInteractionTs?: string;
  }) {
    return this.approveAction(params);
  }

  async cancelAction(params: { actionId: string; userId: string }) {
    const action = await this.prisma.jiraProposedAction.findUnique({
      where: { id: params.actionId },
    });

    if (!action) {
      throw new NotFoundException('Proposed Jira action not found');
    }

    if (action.userId !== params.userId) {
      throw new BadRequestException('You can only cancel your own Jira actions');
    }

    if (action.status === 'executed' || action.status === 'cancelled') {
      return action;
    }

    const cancelled = await this.prisma.jiraProposedAction.update({
      where: { id: action.id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
      },
    });

    await this.jiraAuditService.record({
      userId: params.userId,
      proposedActionId: action.id,
      actionType: action.actionType,
      jiraIssueKey: action.jiraIssueKey,
      status: 'cancelled',
    });

    return cancelled;
  }

  private async executeApprovedAction(action: {
    id: string;
    userId: string;
    actionType: string;
    jiraIssueKey: string | null;
    payload: Prisma.JsonValue;
    blockerId: string | null;
  }) {
    try {
      let result: Record<string, unknown> = {};

      if (action.actionType === 'add_comment' && action.jiraIssueKey) {
        const payload = action.payload as { commentBody?: string };
        result = await this.jiraService.addCommentForUser(
          action.userId,
          action.jiraIssueKey,
          payload.commentBody ?? '',
        );
      } else if (action.actionType === 'create_issue') {
        const payload = action.payload as {
          summary?: string;
          description?: string;
          projectKey?: string | null;
        };
        result = await this.jiraService.createIssueForUser(action.userId, {
          summary: sanitizeJiraSummary(payload.summary ?? 'Pulse blocker'),
          description: payload.description ?? '',
          projectKey: payload.projectKey ?? undefined,
        });

        if (action.blockerId && result.issueKey) {
          await this.prisma.$transaction(async (tx) => {
            const updated = await tx.pulseBlocker.update({
              where: { id: action.blockerId! },
              data: {
                linkedIssueKey: String(result.issueKey),
                linkedIssueId: result.issueId ? String(result.issueId) : null,
                linkedIssueUrl: result.issueUrl ? String(result.issueUrl) : null,
              },
            });
            await this.memoryOutbox.enqueueUpsert({
              tx,
              workspaceId: updated.workspaceId,
              sourceType: MEMORY_SOURCE.BLOCKER,
              sourceId: updated.id,
            });
          });
        }
      } else {
        throw new BadRequestException(
          `Unsupported Jira action: ${action.actionType}`,
        );
      }

      const executed = await this.prisma.jiraProposedAction.update({
        where: { id: action.id },
        data: {
          status: 'executed',
          executedAt: new Date(),
          errorMessage: null,
          result: result as Prisma.InputJsonValue,
          jiraIssueKey:
            action.jiraIssueKey ??
            (result.issueKey ? String(result.issueKey) : null),
        },
      });

      await this.jiraAuditService.record({
        userId: action.userId,
        proposedActionId: action.id,
        actionType: action.actionType,
        jiraIssueKey: executed.jiraIssueKey,
        status: 'executed',
        metadata: result,
      });

      return executed;
    } catch (error: unknown) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Jira action ${action.id} failed: ${rawMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      const friendly = toFriendlyJiraErrorMessage(rawMessage);
      const failed = await this.prisma.jiraProposedAction.update({
        where: { id: action.id },
        data: {
          status: 'failed',
          errorMessage: friendly,
        },
      });

      await this.jiraAuditService.record({
        userId: action.userId,
        proposedActionId: action.id,
        actionType: action.actionType,
        jiraIssueKey: action.jiraIssueKey,
        status: 'failed',
        metadata: { error: rawMessage, friendly },
      });

      return failed;
    }
  }

  private buildIdempotencyKey(
    actionType: string,
    userId: string,
    blockerId: string,
    issueRef: string,
    seed?: string,
  ): string {
    return `jira:${actionType}:${userId}:${blockerId}:${issueRef}:${seed ?? 'v1'}`;
  }

  private toResult(action: {
    id: string;
    actionType: string;
    jiraIssueKey: string | null;
    status: string;
  }): ProposedActionResult {
    return {
      actionId: action.id,
      actionType: action.actionType,
      jiraIssueKey: action.jiraIssueKey,
      status: action.status,
    };
  }
}
