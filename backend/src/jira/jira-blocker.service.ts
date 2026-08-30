import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { JiraActionService } from './jira-action.service';
import {
  extractBlockerDetailsFromAnswer,
  sanitizeJiraSummary,
} from './jira-issue-payload.util';
import { buildSlackThreadUrl } from '../slack/slack-checkin.views';
import { resolveActiveWorkspaceId } from '../common/workspace-context';
import { WorkspaceMembersService } from '../common/workspace-members.service';
import {
  memberDisplayLabel,
  resolveSlackMentionsInText,
} from '../common/slack-member.util';
import { resolveBlockerOwner } from '../ai/workspace/retrieval/blocker-owner.util';
import { WORKSPACE_KNOWLEDGE_CHANGED } from '../ai/workspace/retrieval/knowledge-events';
import {
  computeBlockerStats,
  isOpenBlockerStatus,
  WorkspaceBlockerStats,
} from './blocker-stats.util';
import { MemoryOutboxService } from '../memory/memory-outbox.service';
import { MEMORY_SOURCE } from '../memory/memory-source.constants';

export type DashboardBlockerDto = {
  id: string;
  title: string;
  description: string;
  reporter: string;
  reporterUserId: string;
  slackUserId: string;
  slackDisplayName: string;
  slackAvatarUrl: string | null;
  createdAt: string;
  resolvedAt: string | null;
  status: string;
  statusLabel: string;
  priority: string;
  category: string | null;
  expectedResolution: string | null;
  preventingAllWork: boolean;
  ownerLabel: string | null;
  ownerName: string;
  ownerSlackId: string | null;
  ownerUserId: string | null;
  standupName: string | null;
  checkInId: string | null;
  teamId: string | null;
  runId: string | null;
  submissionId: string | null;
  answerId: string | null;
  slackThreadUrl: string | null;
  jiraIssue: {
    key: string;
    summary: string | null;
    status: string | null;
    assignee: string | null;
    url: string | null;
  } | null;
  slackContext: {
    question: string | null;
    answer: string | null;
    timestamp: string | null;
    slackUser: string | null;
    threadUrl: string | null;
  };
  updates: Array<{
    id: string;
    createdAt: string;
    previousStatus: string;
    newStatus: string;
    newStatusLabel: string;
    notes: string | null;
    resolutionType: string | null;
    needsHelp: boolean | null;
    needsEscalation: boolean | null;
    daysOpen: number | null;
    updatedFrom: string;
    userName: string | null;
  }>;
  /** Reserved for future OpenAI integration — always null for now. */
  aiSummary: string | null;
  aiRootCause: string | null;
  aiRecommendation: string | null;
  aiPriority: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  investigating: 'Investigating',
  in_progress: 'In Progress',
  waiting: 'Waiting',
  resolved: 'Resolved',
  closed: 'Closed',
};

function normalizeStatus(status: string): string {
  const raw = status.trim().toLowerCase().replace(/\s+/g, '_');
  if (raw === 'inprogress') return 'in_progress';
  return raw || 'open';
}

function normalizePriority(severity: string): string {
  const raw = severity.trim().toLowerCase();
  if (raw === 'critical' || raw === 'high' || raw === 'medium' || raw === 'low') {
    return raw;
  }
  return 'medium';
}

function statusLabel(status: string): string {
  const normalized = normalizeStatus(status);
  return STATUS_LABELS[normalized] ?? status;
}

@Injectable()
export class JiraBlockerService {
  private readonly logger = new Logger(JiraBlockerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jiraActionService: JiraActionService,
    private readonly events: EventEmitter2,
    private readonly workspaceMembers: WorkspaceMembersService,
    private readonly memoryOutbox: MemoryOutboxService,
  ) {}

  async createFromAnswer(params: {
    userId: string;
    teamId?: string | null;
    checkInId?: string | null;
    runId?: string | null;
    submissionId?: string | null;
    answerId?: string | null;
    title?: string | null;
    description: string;
    category?: string | null;
    severity?: string;
    dependency?: string | null;
    expectedResolution?: string | null;
    preventingAllWork?: boolean;
    ownerLabel?: string | null;
    linkedIssueKey?: string | null;
    linkedIssueId?: string | null;
    linkedIssueUrl?: string | null;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { workspaceId: true },
    });
    if (!user?.workspaceId) {
      throw new Error(`Cannot create blocker — user ${params.userId} has no workspace`);
    }

    let createdNew = false;
    const blocker = await this.prisma.$transaction(async (tx) => {
      // Idempotent: one PulseBlocker per Answer (Slack retries / double-save).
      if (params.answerId) {
        const existing = await tx.pulseBlocker.findFirst({
          where: { answerId: params.answerId },
        });
        if (existing) {
          this.logger.log(
            `Reusing existing Pulse blocker ${existing.id} for answer ${params.answerId}`,
          );
          return existing;
        }
      }

      const created = await tx.pulseBlocker.create({
        data: {
          workspaceId: user.workspaceId,
          userId: params.userId,
          teamId: params.teamId ?? null,
          checkInId: params.checkInId ?? null,
          runId: params.runId ?? null,
          submissionId: params.submissionId ?? null,
          answerId: params.answerId ?? null,
          title: params.title?.trim() || null,
          description: params.description.trim(),
          category: params.category?.trim() || null,
          severity: normalizePriority(params.severity ?? 'medium'),
          dependency: params.dependency ?? null,
          expectedResolution: params.expectedResolution?.trim() || null,
          preventingAllWork: params.preventingAllWork === true,
          ownerLabel: params.ownerLabel?.trim() || null,
          linkedIssueKey: params.linkedIssueKey ?? null,
          linkedIssueId: params.linkedIssueId ?? null,
          linkedIssueUrl: params.linkedIssueUrl ?? null,
          status: 'open',
        },
      });
      createdNew = true;

      await tx.pulseBlockerUpdate.create({
        data: {
          blockerId: created.id,
          userId: params.userId,
          previousStatus: 'none',
          newStatus: 'open',
          notes: 'Blocker created from Slack standup',
          daysOpen: 0,
          updatedFrom: 'Slack Standup',
        },
      });

      await this.memoryOutbox.enqueueUpsert({
        tx,
        workspaceId: user.workspaceId,
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: created.id,
      });

      return created;
    });

    if (createdNew) {
      this.logger.log(`Created Pulse blocker ${blocker.id} for user ${params.userId}`);
      this.events.emit(WORKSPACE_KNOWLEDGE_CHANGED, {
        workspaceId: user.workspaceId,
        reason: `blocker:${blocker.id}`,
      });
    }

    return blocker;
  }

  async listOpenBlockers(teamId?: string) {
    const workspaceId = await resolveActiveWorkspaceId(this.prisma);
    return this.prisma.pulseBlocker.findMany({
      where: {
        status: 'open',
        ...(teamId ? { teamId } : {}),
        ...(workspaceId ? { workspaceId } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            slackDisplayName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listDashboardBlockers(teamId?: string): Promise<DashboardBlockerDto[]> {
    const workspaceId = await resolveActiveWorkspaceId(this.prisma);
    return this.listDashboardBlockersForWorkspace(workspaceId, teamId);
  }

  /**
   * Single source of truth for Blockers page + AI:
   * ALL PulseBlocker rows for the workspace (optional teamId), no take/limit.
   */
  async listDashboardBlockersForWorkspace(
    workspaceId: string | null | undefined,
    teamId?: string,
  ): Promise<DashboardBlockerDto[]> {
    if (!workspaceId) {
      this.logger.warn('listDashboardBlockersForWorkspace: no workspaceId');
      return [];
    }

    const blockers = await this.prisma.pulseBlocker.findMany({
      where: {
        workspaceId,
        ...(teamId ? { teamId } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            slackUserId: true,
            slackDisplayName: true,
            workspace: {
              select: {
                slackWorkspaceId: true,
              },
            },
          },
        },
        updates: {
          include: {
            user: {
              select: { slackDisplayName: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (blockers.length === 0) {
      return [];
    }

    const nameMap = await this.workspaceMembers.getDisplayNameMap(workspaceId);

    const workspaceUsers = await this.prisma.user.findMany({
      where: { workspaceId },
      select: {
        id: true,
        slackUserId: true,
        slackDisplayName: true,
        slackRealName: true,
      },
    });
    const userBySlackId = new Map(
      workspaceUsers.map((u) => [u.slackUserId, u]),
    );

    const answerIds = blockers
      .map((b) => b.answerId)
      .filter((id): id is string => Boolean(id));
    const submissionIds = blockers
      .map((b) => b.submissionId)
      .filter((id): id is string => Boolean(id));
    const checkInIds = blockers
      .map((b) => b.checkInId)
      .filter((id): id is string => Boolean(id));
    const runIds = blockers
      .map((b) => b.runId)
      .filter((id): id is string => Boolean(id));
    const issueKeys = blockers
      .map((b) => b.linkedIssueKey)
      .filter((key): key is string => Boolean(key));

    const [answers, submissions, checkIns, runs, issueCaches] = await Promise.all([
      answerIds.length
        ? this.prisma.answer.findMany({
            where: { id: { in: answerIds } },
            include: {
              question: { select: { question: true } },
            },
          })
        : Promise.resolve([]),
      submissionIds.length
        ? this.prisma.standupSubmission.findMany({
            where: { id: { in: submissionIds } },
            select: {
              id: true,
              slackDmChannelId: true,
              slackDmThreadTs: true,
              runId: true,
            },
          })
        : Promise.resolve([]),
      checkInIds.length
        ? this.prisma.checkIn.findMany({
            where: { id: { in: checkInIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      runIds.length
        ? this.prisma.standupRun.findMany({
            where: { id: { in: runIds } },
            select: {
              id: true,
              slackThreadUrl: true,
              slackChannelId: true,
              slackThreadTs: true,
              checkIn: { select: { id: true, name: true } },
              team: {
                select: {
                  workspace: { select: { slackWorkspaceId: true } },
                },
              },
            },
          })
        : Promise.resolve([]),
      issueKeys.length
        ? this.prisma.jiraIssueCacheEntry.findMany({
            where: {
              issueKey: { in: issueKeys },
              workspaceId,
            },
            orderBy: { refreshedAt: 'desc' },
            select: {
              issueKey: true,
              status: true,
              summary: true,
              assigneeName: true,
              issueUrl: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const answerById = new Map(answers.map((a) => [a.id, a]));
    const submissionById = new Map(submissions.map((s) => [s.id, s]));
    const checkInById = new Map(checkIns.map((c) => [c.id, c]));
    const runById = new Map(runs.map((r) => [r.id, r]));
    const issueByKey = new Map<string, (typeof issueCaches)[number]>();
    for (const entry of issueCaches) {
      if (!issueByKey.has(entry.issueKey)) {
        issueByKey.set(entry.issueKey, entry);
      }
    }

    return blockers.map((blocker) => {
      const answer = blocker.answerId ? answerById.get(blocker.answerId) : undefined;
      const submission = blocker.submissionId
        ? submissionById.get(blocker.submissionId)
        : undefined;
      const run = blocker.runId ? runById.get(blocker.runId) : undefined;
      const checkIn =
        (blocker.checkInId ? checkInById.get(blocker.checkInId) : undefined) ??
        run?.checkIn ??
        null;

      const extracted = answer
        ? extractBlockerDetailsFromAnswer({
            text: answer.text,
            structuredValue: answer.structuredValue,
          })
        : null;

      const title =
        blocker.title?.trim() ||
        extracted?.title?.trim() ||
        blocker.description.trim();
      const description =
        extracted?.description?.trim() || blocker.description.trim();
      const category = blocker.category ?? extracted?.category ?? null;
      const expectedResolution =
        blocker.expectedResolution ?? extracted?.expectedResolution ?? null;
      const rawOwnerLabel = blocker.ownerLabel ?? extracted?.ownerLabel ?? null;
      const owner = resolveBlockerOwner({
        ownerLabel: rawOwnerLabel,
        nameBySlackId: nameMap,
        userBySlackId,
      });
      const ownerLabel = owner.ownerName;
      const preventingAllWork =
        blocker.preventingAllWork || extracted?.preventingAllWork === true;
      const priority = normalizePriority(
        blocker.severity || extracted?.severity || 'medium',
      );
      const status = normalizeStatus(blocker.status);

      const slackWorkspaceId =
        run?.team?.workspace?.slackWorkspaceId ||
        blocker.user.workspace.slackWorkspaceId ||
        null;

      let slackThreadUrl = run?.slackThreadUrl ?? null;
      if (
        !slackThreadUrl &&
        slackWorkspaceId &&
        submission?.slackDmChannelId &&
        submission?.slackDmThreadTs
      ) {
        slackThreadUrl = buildSlackThreadUrl(
          slackWorkspaceId,
          submission.slackDmChannelId,
          submission.slackDmThreadTs,
        );
      } else if (
        !slackThreadUrl &&
        slackWorkspaceId &&
        run?.slackChannelId &&
        run?.slackThreadTs
      ) {
        slackThreadUrl = buildSlackThreadUrl(
          slackWorkspaceId,
          run.slackChannelId,
          run.slackThreadTs,
        );
      }

      const issueCache = blocker.linkedIssueKey
        ? issueByKey.get(blocker.linkedIssueKey)
        : undefined;

      const jiraIssue = blocker.linkedIssueKey
        ? {
            key: blocker.linkedIssueKey,
            summary: issueCache?.summary ?? null,
            status: issueCache?.status ?? null,
            assignee: issueCache?.assigneeName ?? null,
            url: blocker.linkedIssueUrl ?? issueCache?.issueUrl ?? null,
          }
        : null;

      const slackAnswerText = resolveSlackMentionsInText(
        extracted && (extracted.title || extracted.description)
          ? [
              extracted.title ? `Title: ${extracted.title}` : null,
              extracted.description || null,
            ]
              .filter(Boolean)
              .join('\n')
          : answer?.text ?? blocker.description,
        nameMap,
      );

      return {
        id: blocker.id,
        title: resolveSlackMentionsInText(title, nameMap),
        description: resolveSlackMentionsInText(description, nameMap),
        reporter: memberDisplayLabel({
          slackDisplayName: blocker.user.slackDisplayName,
          slackUserId: blocker.user.slackUserId,
        }),
        reporterUserId: blocker.user.id,
        slackUserId: blocker.user.slackUserId,
        slackDisplayName: memberDisplayLabel({
          slackDisplayName: blocker.user.slackDisplayName,
          slackUserId: blocker.user.slackUserId,
        }),
        slackAvatarUrl: null,
        createdAt: blocker.createdAt.toISOString(),
        resolvedAt: blocker.resolvedAt?.toISOString() ?? null,
        status,
        statusLabel: statusLabel(status),
        priority,
        category,
        expectedResolution,
        preventingAllWork,
        ownerLabel,
        ownerName: owner.ownerName,
        ownerSlackId: owner.ownerSlackId,
        ownerUserId: owner.ownerUserId,
        standupName: checkIn?.name ?? null,
        checkInId: checkIn?.id ?? blocker.checkInId ?? null,
        teamId: blocker.teamId,
        runId: blocker.runId,
        submissionId: blocker.submissionId,
        answerId: blocker.answerId,
        slackThreadUrl,
        jiraIssue,
        slackContext: {
          question: answer?.question?.question ?? null,
          answer: slackAnswerText,
          timestamp: answer?.createdAt?.toISOString() ?? blocker.createdAt.toISOString(),
          slackUser: memberDisplayLabel({
            slackDisplayName: blocker.user.slackDisplayName,
            slackUserId: blocker.user.slackUserId,
          }),
          threadUrl: slackThreadUrl,
        },
        updates: blocker.updates.map((update) => ({
          id: update.id,
          createdAt: update.createdAt.toISOString(),
          previousStatus: update.previousStatus,
          newStatus: update.newStatus,
          newStatusLabel: statusLabel(update.newStatus),
          notes: update.notes
            ? resolveSlackMentionsInText(update.notes, nameMap)
            : null,
          resolutionType: update.resolutionType,
          needsHelp: update.needsHelp,
          needsEscalation: update.needsEscalation,
          daysOpen: update.daysOpen,
          updatedFrom: update.updatedFrom,
          userName: update.user.slackDisplayName,
        })),
        aiSummary: null,
        aiRootCause: null,
        aiRecommendation: null,
        aiPriority: null,
      };
    });
  }

  /**
   * Stats matching Blockers page cards. Same collection as listDashboardBlockers.
   */
  async getBlockerStatsForWorkspace(
    workspaceId: string,
  ): Promise<WorkspaceBlockerStats & { workspaceId: string }> {
    const blockers = await this.listDashboardBlockersForWorkspace(workspaceId);
    const stats = computeBlockerStats(
      blockers.map((b) => ({
        status: b.status,
        priority: b.priority,
        createdAt: b.createdAt,
        resolvedAt: b.resolvedAt,
      })),
    );

    this.logger.log(
      [
        'Blocker stats (shared service):',
        `Workspace ID: ${workspaceId}`,
        `Retrieved blockers: ${stats.total}`,
        `Open count: ${stats.openBlockers}`,
        `Critical count: ${stats.critical}`,
        `Waiting > 3 days: ${stats.waitingMoreThan3Days}`,
        `Resolved this week: ${stats.resolvedThisWeek}`,
        `Resolved count: ${stats.resolved}`,
      ].join('\n'),
    );

    return { workspaceId, ...stats };
  }

  /** Open blockers using Blockers-page definition (not status === 'open' only). */
  async listOpenDashboardBlockersForWorkspace(
    workspaceId: string,
  ): Promise<DashboardBlockerDto[]> {
    const all = await this.listDashboardBlockersForWorkspace(workspaceId);
    return all.filter((b) => isOpenBlockerStatus(b.status));
  }

  async proposeJiraActionForBlocker(params: {
    blockerId: string;
    userId: string;
    slackChannelId: string;
    slackMessageTs?: string;
    /** Blocker title only — never multiline description. */
    summary?: string;
    description?: string;
  }) {
    const blocker = await this.prisma.pulseBlocker.findUnique({
      where: { id: params.blockerId },
    });

    if (!blocker || blocker.userId !== params.userId || blocker.status !== 'open') {
      return null;
    }

    const description =
      (params.description?.trim() || blocker.description || '').trim() ||
      'Created from Pulse Standup blocker.';

    if (blocker.linkedIssueKey) {
      return this.jiraActionService.proposeAddComment({
        userId: params.userId,
        blockerId: blocker.id,
        issueKey: blocker.linkedIssueKey,
        commentBody: `Blocker reported in Pulse standup:\n\n${description}`,
        slackChannelId: params.slackChannelId,
        slackMessageTs: params.slackMessageTs,
      });
    }

    const summary = sanitizeJiraSummary(
      params.summary?.trim() ||
        blocker.title?.trim() ||
        this.buildIssueSummaryFromBlocker(description),
    );

    return this.jiraActionService.proposeCreateIssue({
      userId: params.userId,
      blockerId: blocker.id,
      summary,
      description: `Created from Pulse Standup blocker.\n\n${description}`,
      slackChannelId: params.slackChannelId,
      slackMessageTs: params.slackMessageTs,
    });
  }

  private buildIssueSummaryFromBlocker(description: string): string {
    const firstLine =
      description
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean) ?? 'Pulse blocker';
    return sanitizeJiraSummary(firstLine);
  }
}
