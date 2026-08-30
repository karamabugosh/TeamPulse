import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolveActiveWorkspaceId } from '../../../common/workspace-context';
import { JiraService } from '../../../jira/jira.service';
import { JiraCacheService } from '../../../jira/jira-cache.service';
import { SlackMemberCacheService } from '../../../slack/slack-member-cache.service';
import { JiraMemberCacheService } from '../../../jira/jira-member-cache.service';
import { JiraBlockerService } from '../../../jira/jira-blocker.service';
import { isOpenBlockerStatus } from '../../../jira/blocker-stats.util';
import { isPlaceholderSlackUser } from '../../../common/slack-member.util';
import { DEMO_SLACK_WORKSPACE_ID } from '../../../demo/demo.constants';
import { meaningfulTokens } from '../retrieval/keyword.util';
import {
  AssigneeMatchCandidate,
  assigneeMatchesPersonQuery,
  normalizePersonName,
  rankAssigneeCandidateScore,
} from '../retrieval/assignee-match.util';
import { resolveBlockerOwner } from '../retrieval/blocker-owner.util';
import {
  KnowledgeDocument,
  KnowledgeEntityType,
  SourceReference,
  SourceSearchDiagnostic,
  SourceSearchReasonCode,
  WorkspaceKnowledgeSnapshot,
  WorkspaceSearchFilters,
  WorkspaceSourceType,
} from '../types/workspace-ai.types';

const DEFAULT_LIMIT = 40;

type CollectorResult = {
  docs: KnowledgeDocument[];
  diagnostic: SourceSearchDiagnostic;
};

function buildDocument(params: {
  workspaceId: string;
  source: WorkspaceSourceType;
  entity: KnowledgeEntityType;
  entityId: string;
  title: string;
  content: string;
  timestamp?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown>;
}): KnowledgeDocument {
  const reference: SourceReference = {
    source: params.source,
    entity: params.entity,
    entityId: params.entityId,
    timestamp: params.timestamp ?? null,
    workspaceId: params.workspaceId,
    url: params.url ?? null,
    label: `${params.source}:${params.entity}:${params.entityId}`,
  };

  return {
    id: `${params.entity}:${params.entityId}`,
    workspaceId: params.workspaceId,
    source: params.source,
    entity: params.entity,
    title: params.title,
    content: params.content,
    timestamp: params.timestamp ?? null,
    url: params.url ?? null,
    reference,
    metadata: params.metadata,
  };
}

function buildAuthoritativeJiraDocument(params: {
  workspaceId: string;
  issueKeyUpper: string;
  summaryDisplay: string | null;
  statusDisplay: string | null;
  assigneeDisplay: string | null;
  priorityDisplay: string | null;
  reporterName: string | null;
  issueUrl: string | null;
  projectKey: string | null;
  projectName: string | null;
  issueType: string | null;
  labels: string[];
  components: string[];
  dueDate: string | null;
  resolution: string | null;
  sprint: string | null;
  sourceLabel: 'Live Jira' | 'Cache';
  liveRefreshed: boolean;
  hasLiveJira: boolean;
  fieldsOnly: boolean;
  timestamp: string;
}): KnowledgeDocument {
  const liveCurrent =
    params.liveRefreshed && params.sourceLabel === 'Live Jira';
  const authoritative =
    liveCurrent || (!params.hasLiveJira && params.sourceLabel === 'Cache');

  return buildDocument({
    workspaceId: params.workspaceId,
    source: 'jira',
    entity: 'jira_issue',
    entityId: params.issueKeyUpper,
    title: params.summaryDisplay
      ? `${params.issueKeyUpper} — ${params.summaryDisplay}`
      : params.issueKeyUpper,
    content: [
      `Key: ${params.issueKeyUpper}`,
      params.summaryDisplay
        ? `Summary: ${params.summaryDisplay}`
        : 'Summary: (not set in Jira)',
      params.statusDisplay
        ? `Status: ${params.statusDisplay}`
        : 'Status: (not set in Jira)',
      params.assigneeDisplay
        ? `Assignee: ${params.assigneeDisplay}`
        : 'Assignee: (unassigned in Jira)',
      params.priorityDisplay
        ? `Priority: ${params.priorityDisplay}`
        : 'Priority: (not set in Jira)',
      params.reporterName ? `Reporter: ${params.reporterName}` : null,
      params.projectName
        ? `Project: ${params.projectName}`
        : params.projectKey
          ? `Project: ${params.projectKey}`
          : null,
      params.issueType ? `Type: ${params.issueType}` : null,
      params.labels.length ? `Labels: ${params.labels.join(', ')}` : null,
      params.components.length
        ? `Components: ${params.components.join(', ')}`
        : null,
      params.dueDate ? `Due Date: ${params.dueDate}` : null,
      params.resolution ? `Resolution: ${params.resolution}` : null,
      params.sprint ? `Sprint/Fix Version: ${params.sprint}` : null,
      `Data source: ${
        params.sourceLabel === 'Live Jira'
          ? 'Live Jira API (GET /rest/api/3/issue — refreshed for this question)'
          : 'JiraIssueCacheEntry (no live connection for this workspace — NOT authoritative when Live Jira is connected)'
      }`,
      `Answer Source: ${params.sourceLabel === 'Live Jira' ? 'Live Jira API' : 'Cache (offline only)'}`,
      'ISSUE_FOUND: true',
      authoritative
        ? 'AUTHORITATIVE_JIRA_FIELDS: assignee, status, priority, summary, sprint, reporter, issue type — use ONLY these values.'
        : 'NOT_AUTHORITATIVE: do not use for current Jira field values.',
      params.fieldsOnly
        ? 'JIRA_FIELDS_ONLY: true — ignore Team Memory, Reports, Slack, Demo, and conversation history.'
        : 'Slack, Team Memory, Reports, Digests, and standups must NEVER overwrite these fields.',
    ]
      .filter(Boolean)
      .join('\n'),
    timestamp: params.timestamp,
    url: params.issueUrl,
    metadata: {
      issueKey: params.issueKeyUpper,
      issueFound: true,
      status: params.statusDisplay,
      summary: params.summaryDisplay,
      assigneeName: params.assigneeDisplay,
      priority: params.priorityDisplay,
      reporterName: params.reporterName,
      projectKey: params.projectKey,
      projectName: params.projectName,
      issueType: params.issueType,
      labels: params.labels,
      components: params.components,
      dueDate: params.dueDate,
      resolution: params.resolution,
      sprint: params.sprint,
      liveRefreshed: params.liveRefreshed,
      jiraSource: params.sourceLabel,
      hasLiveJiraConnection: params.hasLiveJira,
      authoritativeJiraFields: authoritative,
      authorityClass: liveCurrent ? 'LIVE_JIRA_CURRENT' : 'LEGACY_SUPPORTING',
      answerSource:
        params.sourceLabel === 'Live Jira' ? 'Live Jira API' : 'Cache',
    },
  });
}

function explainEmpty(params: {
  found: number;
  totalInWorkspace: number;
  keyword?: string | null;
  userQuery?: string | null;
  issueKey?: string | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
}): { reasonCode: SourceSearchReasonCode; reason: string } {
  if (params.found > 0) {
    return { reasonCode: 'ok', reason: `Found ${params.found} record(s)` };
  }
  if (params.totalInWorkspace === 0) {
    return {
      reasonCode: 'no_records_in_db',
      reason: 'No records exist in the database for this workspace',
    };
  }

  const filterBits = [
    params.keyword ? `keyword=${params.keyword}` : null,
    params.userQuery ? `userQuery=${params.userQuery}` : null,
    params.issueKey ? `issueKey=${params.issueKey}` : null,
    params.dateFrom || params.dateTo
      ? `date=${params.dateFrom?.toISOString() ?? '*'}..${params.dateTo?.toISOString() ?? '*'}`
      : null,
  ].filter(Boolean);

  return {
    reasonCode: 'filters_excluded_all',
    reason: `Workspace has ${params.totalInWorkspace} record(s), but filters excluded all (${filterBits.join(', ') || 'no explicit filters'})`,
  };
}

/**
 * Workspace Knowledge Service — single source of truth for RAG.
 * Collects and normalizes real workspace data into KnowledgeDocument[].
 * Never fabricates content. No embeddings yet.
 */
@Injectable()
export class WorkspaceKnowledgeService {
  private readonly logger = new Logger(WorkspaceKnowledgeService.name);
  /** Short TTL cache to avoid duplicate collector fan-out within one request burst. */
  private readonly snapshotCache = new Map<
    string,
    { at: number; snapshot: WorkspaceKnowledgeSnapshot }
  >();
  private readonly snapshotTtlMs = 5_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jiraService: JiraService,
    private readonly jiraCache: JiraCacheService,
    private readonly slackMemberCache: SlackMemberCacheService,
    private readonly jiraMemberCache: JiraMemberCacheService,
    private readonly jiraBlockers: JiraBlockerService,
  ) {}

  async resolveWorkspaceId(preferred?: string | null): Promise<string | null> {
    return resolveActiveWorkspaceId(this.prisma, preferred);
  }

  /**
   * Trusted Pulse User.id for Phase 3B V2 ACL.
   * Prefer explicit request/auth userId; otherwise first workspace member
   * (local Ask Pulse has no auth principal today).
   * Never invent team membership — MemoryAclService still loads TeamMember.
   */
  async resolveMemoryAclUserId(
    workspaceId: string,
    preferredUserId?: string | null,
  ): Promise<string | null> {
    const preferred = preferredUserId?.trim();
    if (preferred) {
      const match = await this.prisma.user.findFirst({
        where: { id: preferred, workspaceId },
        select: { id: true },
      });
      if (match) return match.id;
    }
    const fallback = await this.prisma.user.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return fallback?.id ?? null;
  }

  /** Routing diagnostics for logs — never crosses workspace boundaries. */
  async getWorkspaceRoutingSnapshot(workspaceId: string): Promise<{
    workspaceId: string;
    workspaceName: string | null;
    slackWorkspaceId: string | null;
    jiraConnectionId: string | null;
    jiraCloudId: string | null;
    jiraSiteUrl: string | null;
    hasLiveJira: boolean;
  }> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        slackWorkspaceName: true,
        slackWorkspaceId: true,
      },
    });
    const connection =
      await this.jiraService.findLiveConnectionForWorkspace(workspaceId);

    return {
      workspaceId,
      workspaceName: workspace?.slackWorkspaceName ?? null,
      slackWorkspaceId: workspace?.slackWorkspaceId ?? null,
      jiraConnectionId: connection?.id ?? null,
      jiraCloudId: connection?.cloudId ?? null,
      jiraSiteUrl: connection?.siteUrl ?? null,
      hasLiveJira: Boolean(connection),
    };
  }

  /**
   * Resolve assignee list queries against workspace members + Jira cache assignees.
   */
  async resolveAssigneeCandidates(
    workspaceId: string,
    query: string,
  ): Promise<AssigneeMatchCandidate> {
    const q = query.trim();
    const displayNames = new Set<string>();
    const accountIds = new Set<string>();
    const workspaceMemberNames: string[] = [];

    const users = await this.prisma.user.findMany({
      where: { workspaceId },
      select: {
        slackDisplayName: true,
        slackRealName: true,
        email: true,
      },
      take: 500,
    });

    const qNorm = normalizePersonName(q);
    const ranked = users
      .map((u) => {
        const label =
          u.slackRealName?.trim() ||
          u.slackDisplayName?.trim() ||
          u.email?.trim() ||
          '';
        return { label, score: rankAssigneeCandidateScore(q, label, true) };
      })
      .filter((r) => r.label && r.score >= 15)
      .sort((a, b) => b.score - a.score);

    for (const row of ranked.slice(0, 8)) {
      workspaceMemberNames.push(row.label);
      displayNames.add(row.label);
    }

    const cacheAssignees = await this.prisma.jiraIssueCacheEntry.findMany({
      where: { workspaceId },
      select: { assigneeName: true, assigneeAccountId: true },
      take: 500,
    });

    for (const row of cacheAssignees) {
      const candidate: AssigneeMatchCandidate = {
        query: q,
        displayNames: [...displayNames],
        accountIds: [...accountIds],
        workspaceMemberNames,
      };
      if (
        row.assigneeName &&
        assigneeMatchesPersonQuery(
          q,
          row.assigneeName,
          row.assigneeAccountId,
          candidate,
        )
      ) {
        displayNames.add(row.assigneeName);
        if (row.assigneeAccountId) {
          accountIds.add(row.assigneeAccountId);
        }
      }
    }

    try {
      const connection = await this.prisma.jiraConnection.findFirst({
        where: { workspaceId },
        select: { userId: true },
        orderBy: { connectedAt: 'desc' },
      });
      if (connection) {
        const members = await this.jiraMemberCache.listActiveCache(workspaceId);
        for (const m of members) {
          const name = m.displayName?.trim();
          if (!name) continue;
          if (
            rankAssigneeCandidateScore(q, name, false) >= 15 ||
            normalizePersonName(name).includes(qNorm)
          ) {
            displayNames.add(name);
            if (m.accountId) accountIds.add(m.accountId);
          }
        }
      }
    } catch {
      // Jira members optional
    }

    if (displayNames.size === 0 && workspaceMemberNames.length === 0) {
      displayNames.add(q);
    }

    return {
      query: q,
      displayNames: [...displayNames],
      accountIds: [...accountIds],
      workspaceMemberNames,
    };
  }

  /**
   * Resolve a free-text person name against workspace Slack users.
   */
  async resolveUserQuery(
    workspaceId: string,
    candidates: string[],
  ): Promise<string | null> {
    if (candidates.length === 0) return null;

    const users = await this.prisma.user.findMany({
      where: { workspaceId },
      select: { slackDisplayName: true, email: true },
      take: 200,
    });

    for (const candidate of candidates) {
      const lower = candidate.toLowerCase();
      const match = users.find((user) => {
        const name = user.slackDisplayName?.toLowerCase() ?? '';
        const email = user.email?.toLowerCase() ?? '';
        return (
          name === lower ||
          name.startsWith(lower) ||
          name.includes(lower) ||
          email.startsWith(lower)
        );
      });
      if (match) return match.slackDisplayName;
    }

    return candidates[0] ?? null;
  }

  /**
   * Resolve a person named in the question to a trusted workspace User.id.
   * Returns null when no unique safe match exists.
   */
  async resolveSubjectUserId(
    workspaceId: string,
    candidates: string[],
  ): Promise<string | null> {
    if (candidates.length === 0) return null;

    const users = await this.prisma.user.findMany({
      where: { workspaceId },
      select: { id: true, slackDisplayName: true, email: true },
      take: 200,
    });

    for (const candidate of candidates) {
      const lower = candidate.toLowerCase();
      const matches = users.filter((user) => {
        const name = user.slackDisplayName?.toLowerCase() ?? '';
        const email = user.email?.toLowerCase() ?? '';
        return (
          name === lower ||
          name.startsWith(`${lower} `) ||
          name.startsWith(lower) ||
          email.startsWith(lower)
        );
      });
      if (matches.length === 1) return matches[0].id;
      if (matches.length > 1) {
        const exact = matches.find(
          (u) => u.slackDisplayName?.toLowerCase() === lower,
        );
        if (exact) return exact.id;
        return null;
      }
    }

    return null;
  }

  async collectSnapshot(
    workspaceId: string,
    filters: WorkspaceSearchFilters = {},
    limit = DEFAULT_LIMIT,
  ): Promise<WorkspaceKnowledgeSnapshot> {
    const cacheKey = buildSnapshotCacheKey(workspaceId, filters, limit);
    const skipCache = Boolean(filters.issueKey?.trim());
    const cached = skipCache ? undefined : this.snapshotCache.get(cacheKey);
    if (cached && Date.now() - cached.at < this.snapshotTtlMs) {
      this.logger.log(
        `Knowledge snapshot cache hit workspace=${workspaceId} limit=${limit}`,
      );
      return cached.snapshot;
    }

    const slackMembersOnly = Boolean(filters.slackMembersOnly);
    const jiraMembersOnly = Boolean(filters.jiraMembersOnly);
    const selectedKeys = new Set(
      (filters.selectedSources ?? []).map((k) => String(k).toLowerCase()),
    );

    const allCollectors: Array<{
      key: string;
      label: string;
      run: () => Promise<CollectorResult>;
    }> = [
      {
        key: 'slack_standups',
        label: 'Slack Standups',
        run: () => this.collectStandups(workspaceId, filters, limit),
      },
      {
        key: 'slack_threads',
        label: 'Slack Threads',
        run: () => this.collectStandupThreads(workspaceId, filters, limit),
      },
      {
        key: 'standup_runs',
        label: 'Standup Runs',
        run: () => this.collectStandupRuns(workspaceId, filters, limit),
      },
      {
        key: 'check_ins',
        label: 'Check-ins',
        run: () => this.collectCheckIns(workspaceId, filters, limit),
      },
      {
        key: 'jira',
        label: 'Jira',
        run: () => this.collectJiraIssues(workspaceId, filters, limit),
      },
      {
        key: 'blockers',
        label: 'Blockers',
        run: () => this.collectBlockers(workspaceId, filters, limit),
      },
      {
        key: 'blocker_updates',
        label: 'Blocker Updates',
        run: () => this.collectBlockerUpdates(workspaceId, filters, limit),
      },
      {
        key: 'reports',
        label: 'Reports',
        run: () => this.collectReports(workspaceId, filters, limit),
      },
      {
        key: 'slack_members',
        label: 'Slack Members',
        run: () => this.collectUsers(workspaceId, filters, limit),
      },
      {
        key: 'jira_members',
        label: 'Jira Members',
        run: () => this.collectJiraMembers(workspaceId, filters, limit),
      },
      {
        key: 'slack_channels',
        label: 'Slack Channels',
        run: () => this.collectSlackChannels(workspaceId, filters, limit),
      },
      {
        key: 'team_memory',
        label: 'Team Memory',
        run: () => this.collectTeamMemory(workspaceId, filters, limit),
      },
      {
        key: 'jira_audit',
        label: 'Jira Audit Logs',
        run: () => this.collectJiraAudits(workspaceId, filters, limit),
      },
      {
        key: 'slack_ai_chat',
        label: 'Slack AI Conversations',
        run: () => this.collectSlackAiChats(workspaceId, filters, limit),
      },
      {
        key: 'ai_conversations',
        label: 'AI Conversation History',
        run: () => this.collectAiConversations(workspaceId, filters, limit),
      },
    ];

    // Multi-source RAG: run selected collectors (graceful per-source failure).
    // Factual Jira field questions pass selectedSources=['jira'] only.
    // Slack / Jira member roster questions remain directory-only.
    let collectors = allCollectors;
    if (jiraMembersOnly) {
      collectors = allCollectors.filter((c) => c.key === 'jira_members');
      this.logger.log(
        'Jira member authority mode — collectors limited to Jira members directory',
      );
    } else if (slackMembersOnly) {
      collectors = allCollectors.filter((c) => c.key === 'slack_members');
      this.logger.log(
        'Slack member authority mode — collectors limited to Slack members directory',
      );
    } else if (selectedKeys.size > 0) {
      collectors = allCollectors.filter((c) => selectedKeys.has(c.key));
      this.logger.log(
        `Multi-source RAG collectors selected=${[...selectedKeys].join(',')} running=${collectors.map((c) => c.key).join(',')}`,
      );
    }

    const results: Array<CollectorResult & { key: string }> = [];
    for (const collector of collectors) {
      this.logger.log(`Searching ${collector.label}...`);
      try {
        const result = await collector.run();
        results.push({ ...result, key: collector.key });
        if (result.docs.length === 0) {
          this.logger.warn(
            `${collector.label}: 0 hits — ${result.diagnostic.reason}`,
          );
        } else {
          this.logger.log(
            `${collector.label}: found ${result.docs.length} document(s)`,
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'unknown collector error';
        this.logger.error(`${collector.label}: collector failed — ${message}`);
        results.push({
          key: collector.key,
          docs: [],
          diagnostic: {
            sourceKey: collector.key,
            label: collector.label,
            searched: true,
            found: 0,
            totalInWorkspace: -1,
            reasonCode: 'collector_error',
            reason: message,
          },
        });
      }
    }

    const docsByKey = (key: string) =>
      results.find((r) => r.key === key)?.docs ?? [];

    const standups = docsByKey('slack_standups');
    const standupThreads = docsByKey('slack_threads');
    const standupRuns = docsByKey('standup_runs');
    const checkIns = docsByKey('check_ins');
    const jiraIssues = docsByKey('jira');
    const blockers = docsByKey('blockers');
    const blockerUpdates = docsByKey('blocker_updates');
    const reports = docsByKey('reports');
    const users = docsByKey('slack_members');
    const teamMemory = docsByKey('team_memory');

    const documents = results.flatMap((result) => result.docs);
    const diagnostics = results.map((result) => result.diagnostic);

    const byEntity: Partial<Record<KnowledgeEntityType, KnowledgeDocument[]>> =
      {};
    for (const doc of documents) {
      const bucket = byEntity[doc.entity] ?? [];
      bucket.push(doc);
      byEntity[doc.entity] = bucket;
    }

    this.logger.log(
      `Knowledge snapshot workspace=${workspaceId} docs=${documents.length} sourcesQueried=${results.map((r) => r.key).join(',')} isolation=workspaceId`,
    );

    const snapshot: WorkspaceKnowledgeSnapshot = {
      workspaceId,
      documents,
      byEntity,
      standups,
      standupRuns,
      standupThreads,
      checkIns,
      jiraIssues,
      blockers,
      blockerUpdates,
      reports,
      users,
      teamMemory,
      diagnostics,
    };
    this.snapshotCache.set(cacheKey, { at: Date.now(), snapshot });
    return snapshot;
  }

  private dateWhere(filters: WorkspaceSearchFilters) {
    if (!filters.dateFrom && !filters.dateTo) return undefined;
    return {
      ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
      ...(filters.dateTo ? { lte: filters.dateTo } : {}),
    };
  }

  private searchTokens(filters: WorkspaceSearchFilters): string[] {
    if (filters.searchTokens?.length) {
      return filters.searchTokens.slice(0, 24);
    }
    return meaningfulTokens(filters.keyword);
  }

  private async collectStandups(
    workspaceId: string,
    filters: WorkspaceSearchFilters,
    limit: number,
  ): Promise<CollectorResult> {
    const tokens = this.searchTokens(filters);
    const userQ = filters.userQuery?.trim();
    const createdAt = this.dateWhere(filters);

    const totalInWorkspace = await this.prisma.standupSubmission.count({
      where: { status: 'completed', user: { workspaceId } },
    });

    const tokenOr: Prisma.StandupSubmissionWhereInput[] = tokens.flatMap(
      (token) => [
        {
          run: {
            checkIn: { name: { contains: token, mode: 'insensitive' } },
          },
        },
        {
          answers: {
            some: { text: { contains: token, mode: 'insensitive' } },
          },
        },
        {
          user: {
            slackDisplayName: { contains: token, mode: 'insensitive' },
          },
        },
      ],
    );

    const submissions = await this.prisma.standupSubmission.findMany({
      where: {
        status: 'completed',
        user: { workspaceId },
        ...(createdAt ? { completedAt: createdAt } : {}),
        ...(userQ
          ? {
              user: {
                workspaceId,
                OR: [
                  {
                    slackDisplayName: {
                      contains: userQ,
                      mode: 'insensitive',
                    },
                  },
                  { slackUserId: { contains: userQ, mode: 'insensitive' } },
                  { email: { contains: userQ, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
        ...(filters.latestStandupSubmissionId
          ? { id: filters.latestStandupSubmissionId }
          : {}),
        ...(filters.latestStandupRunId && !filters.latestStandupSubmissionId
          ? { runId: filters.latestStandupRunId }
          : {}),
        ...(filters.subjectUserId && !filters.latestStandupSubmissionId
          ? { userId: filters.subjectUserId }
          : {}),
        ...(tokenOr.length ? { OR: tokenOr } : {}),
        ...(filters.issueKey
          ? {
              jiraIssueLinks: {
                some: {
                  issueKey: {
                    equals: filters.issueKey,
                    mode: 'insensitive',
                  },
                },
              },
            }
          : {}),
      },
      include: {
        user: { select: { slackDisplayName: true, slackUserId: true } },
        answers: {
          include: { question: { select: { question: true } } },
          orderBy: { createdAt: 'asc' },
        },
        run: {
          include: { checkIn: { select: { name: true } } },
        },
      },
      orderBy: { completedAt: 'desc' },
      take: limit,
    });

    const docs = submissions.map((submission) => {
      const standupName = submission.run.checkIn?.name ?? 'Standup';
      const lines = submission.answers.map(
        (answer) => `Q: ${answer.question.question}\nA: ${answer.text.trim()}`,
      );
      const ts = (submission.completedAt ?? submission.createdAt).toISOString();
      return buildDocument({
        workspaceId,
        source: 'slack',
        entity: 'standup_submission',
        entityId: submission.id,
        title: `${standupName} — ${submission.user.slackDisplayName}`,
        content: lines.join('\n\n') || '(no answers)',
        timestamp: ts,
        url: submission.run.slackThreadUrl ?? null,
        metadata: {
          submissionId: submission.id,
          runId: submission.runId,
          userId: submission.userId,
          standupName,
          userName: submission.user.slackDisplayName,
        },
      });
    });

    const explanation = explainEmpty({
      found: docs.length,
      totalInWorkspace,
      keyword: filters.keyword,
      userQuery: userQ,
      issueKey: filters.issueKey,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    });

    return {
      docs,
      diagnostic: {
        sourceKey: 'slack_standups',
        label: 'Slack Standups',
        searched: true,
        found: docs.length,
        totalInWorkspace,
        ...explanation,
      },
    };
  }

  private async collectStandupThreads(
    workspaceId: string,
    filters: WorkspaceSearchFilters,
    limit: number,
  ): Promise<CollectorResult> {
    const tokens = this.searchTokens(filters);
    const userQ = filters.userQuery?.trim();
    const createdAt = this.dateWhere(filters);

    const totalInWorkspace = await this.prisma.standupThreadUpdate.count({
      where: { run: { team: { workspaceId } } },
    });

    const tokenOr: Prisma.StandupThreadUpdateWhereInput[] = tokens.flatMap(
      (token) => [
        { content: { contains: token, mode: 'insensitive' } },
        { type: { contains: token, mode: 'insensitive' } },
        {
          user: {
            slackDisplayName: { contains: token, mode: 'insensitive' },
          },
        },
      ],
    );

    const threads = await this.prisma.standupThreadUpdate.findMany({
      where: {
        run: { team: { workspaceId } },
        ...(createdAt ? { createdAt } : {}),
        ...(userQ
          ? {
              user: {
                slackDisplayName: {
                  contains: userQ,
                  mode: 'insensitive',
                },
              },
            }
          : {}),
        ...(tokenOr.length ? { OR: tokenOr } : {}),
      },
      include: {
        user: { select: { slackDisplayName: true } },
        run: {
          include: { checkIn: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const docs = threads.map((thread) =>
      buildDocument({
        workspaceId,
        source: 'slack',
        entity: 'standup_thread',
        entityId: thread.id,
        title: `Thread update — ${thread.user.slackDisplayName}`,
        content: [
          `Type: ${thread.type}`,
          `Standup: ${thread.run.checkIn?.name ?? 'Standup'}`,
          `From: ${thread.user.slackDisplayName}`,
          `Content: ${thread.content}`,
        ].join('\n'),
        timestamp: thread.createdAt.toISOString(),
        metadata: {
          threadId: thread.id,
          runId: thread.runId,
          submissionId: thread.submissionId,
          type: thread.type,
        },
      }),
    );

    const explanation = explainEmpty({
      found: docs.length,
      totalInWorkspace,
      keyword: filters.keyword,
      userQuery: userQ,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    });

    return {
      docs,
      diagnostic: {
        sourceKey: 'slack_threads',
        label: 'Slack Threads',
        searched: true,
        found: docs.length,
        totalInWorkspace,
        ...explanation,
      },
    };
  }

  private async collectStandupRuns(
    workspaceId: string,
    filters: WorkspaceSearchFilters,
    limit: number,
  ): Promise<CollectorResult> {
    const tokens = this.searchTokens(filters);
    const createdAt = this.dateWhere(filters);

    const totalInWorkspace = await this.prisma.standupRun.count({
      where: { team: { workspaceId } },
    });

    const tokenOr: Prisma.StandupRunWhereInput[] = tokens.flatMap((token) => [
      { status: { contains: token, mode: 'insensitive' } },
      { checkIn: { name: { contains: token, mode: 'insensitive' } } },
    ]);

    const runs = await this.prisma.standupRun.findMany({
      where: {
        team: { workspaceId },
        ...(createdAt ? { scheduledFor: createdAt } : {}),
        ...(tokenOr.length ? { OR: tokenOr } : {}),
      },
      include: {
        checkIn: { select: { name: true } },
        team: { select: { name: true } },
        _count: { select: { submissions: true } },
      },
      orderBy: { scheduledFor: 'desc' },
      take: limit,
    });

    const docs = runs.map((run) =>
      buildDocument({
        workspaceId,
        source: 'standup_runs',
        entity: 'standup_run',
        entityId: run.id,
        title: `${run.checkIn?.name ?? 'Standup run'} — ${run.scheduledFor.toISOString().slice(0, 10)}`,
        content: [
          `Run status: ${run.status}`,
          `Team: ${run.team.name}`,
          `Submissions: ${run._count.submissions}`,
          `Trigger: ${run.triggerSource}`,
        ].join('\n'),
        timestamp: run.scheduledFor.toISOString(),
        url: run.slackThreadUrl ?? null,
        metadata: {
          runId: run.id,
          checkInId: run.checkInId,
          teamId: run.teamId,
          status: run.status,
        },
      }),
    );

    const explanation = explainEmpty({
      found: docs.length,
      totalInWorkspace,
      keyword: filters.keyword,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    });

    return {
      docs,
      diagnostic: {
        sourceKey: 'standup_runs',
        label: 'Standup Runs',
        searched: true,
        found: docs.length,
        totalInWorkspace,
        ...explanation,
      },
    };
  }

  private async collectCheckIns(
    workspaceId: string,
    filters: WorkspaceSearchFilters,
    limit: number,
  ): Promise<CollectorResult> {
    const tokens = this.searchTokens(filters);

    const totalInWorkspace = await this.prisma.checkIn.count({
      where: { team: { workspaceId } },
    });

    const tokenOr: Prisma.CheckInWhereInput[] = tokens.flatMap((token) => [
      { name: { contains: token, mode: 'insensitive' } },
      { description: { contains: token, mode: 'insensitive' } },
    ]);

    const checkIns = await this.prisma.checkIn.findMany({
      where: {
        team: { workspaceId },
        ...(tokenOr.length ? { OR: tokenOr } : {}),
      },
      include: {
        team: { select: { name: true } },
        _count: { select: { questions: true, participants: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });

    const docs = checkIns.map((checkIn) =>
      buildDocument({
        workspaceId,
        source: 'check_ins',
        entity: 'check_in',
        entityId: checkIn.id,
        title: checkIn.name,
        content: [
          checkIn.description ? `Description: ${checkIn.description}` : null,
          `Team: ${checkIn.team.name}`,
          `Enabled: ${checkIn.enabled}`,
          `Questions: ${checkIn._count.questions}`,
          `Participants: ${checkIn._count.participants}`,
          `Timezone: ${checkIn.timezone}`,
        ]
          .filter(Boolean)
          .join('\n'),
        timestamp: checkIn.updatedAt.toISOString(),
        metadata: {
          checkInId: checkIn.id,
          teamId: checkIn.teamId,
          enabled: checkIn.enabled,
        },
      }),
    );

    const explanation = explainEmpty({
      found: docs.length,
      totalInWorkspace,
      keyword: filters.keyword,
    });

    return {
      docs,
      diagnostic: {
        sourceKey: 'check_ins',
        label: 'Check-ins',
        searched: true,
        found: docs.length,
        totalInWorkspace,
        ...explanation,
      },
    };
  }

  private async collectJiraIssuesForAssignee(
    workspaceId: string,
    assigneeQuery: string,
    filters: WorkspaceSearchFilters,
    limit: number,
  ): Promise<CollectorResult> {
    const candidates = await this.resolveAssigneeCandidates(
      workspaceId,
      assigneeQuery,
    );

    this.logger.log(
      [
        'Jira assignee list:',
        `WorkspaceId: ${workspaceId}`,
        `Query: ${assigneeQuery}`,
        `Display names: ${candidates.displayNames.join(', ') || '(none)'}`,
        `Account IDs: ${candidates.accountIds.length}`,
        `Workspace members: ${candidates.workspaceMemberNames.join(', ') || '(none)'}`,
      ].join(' | '),
    );

    const docs: KnowledgeDocument[] = [];
    const seenKeys = new Set<string>();
    const hasLiveJira = await this.hasUsableLiveJiraConnection(workspaceId);

    const connection = await this.prisma.jiraConnection.findFirst({
      where: { workspaceId },
      select: { userId: true },
      orderBy: { connectedAt: 'desc' },
    });

    if (hasLiveJira && connection) {
      try {
        const live = await this.jiraService.searchIssuesByAssignee({
          userId: connection.userId,
          displayNames: candidates.displayNames,
          accountIds: candidates.accountIds,
          maxResults: Math.min(limit, 50),
        });

        for (const issue of live.issues) {
          const key = issue.key.toUpperCase();
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          await this.jiraCache.upsertFromSnapshot(connection.userId, {
            type: 'issue_ref',
            issueKey: issue.key,
            issueId: issue.id,
            summary: issue.summary,
            status: issue.status,
            projectKey: issue.projectKey,
            projectName: issue.projectName,
            issueType: issue.issueType,
            priority: issue.priority,
            issueUrl: issue.issueUrl,
            capturedAt: issue.updatedAt ?? new Date().toISOString(),
            assigneeName: issue.assignee,
            assigneeAccountId: issue.assigneeAccountId,
          });

          docs.push(
            buildAuthoritativeJiraDocument({
              workspaceId,
              issueKeyUpper: key,
              summaryDisplay: issue.summary?.trim() || null,
              statusDisplay: issue.status?.trim() || null,
              assigneeDisplay: issue.assignee?.trim() || null,
              priorityDisplay: issue.priority?.trim() || null,
              reporterName: issue.reporter ?? null,
              issueUrl: issue.issueUrl,
              projectKey: issue.projectKey,
              projectName: issue.projectName,
              issueType: issue.issueType,
              labels: issue.labels ?? [],
              components: issue.components ?? [],
              dueDate: issue.dueDate ?? null,
              resolution: issue.resolution ?? null,
              sprint: issue.sprint ?? null,
              sourceLabel: 'Live Jira',
              liveRefreshed: true,
              hasLiveJira: true,
              fieldsOnly: false,
              timestamp: new Date().toISOString(),
            }),
          );
        }
      } catch (error) {
        this.logger.warn(
          `Live Jira assignee search failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const cacheRows = await this.prisma.jiraIssueCacheEntry.findMany({
      where: { workspaceId },
      orderBy: { refreshedAt: 'desc' },
      take: 500,
    });

    for (const entry of cacheRows) {
      if (docs.length >= limit) break;
      const key = entry.issueKey.toUpperCase();
      if (seenKeys.has(key)) continue;
      if (
        !assigneeMatchesPersonQuery(
          assigneeQuery,
          entry.assigneeName,
          entry.assigneeAccountId,
          candidates,
        )
      ) {
        continue;
      }
      seenKeys.add(key);

      docs.push(
        buildAuthoritativeJiraDocument({
          workspaceId,
          issueKeyUpper: key,
          summaryDisplay: entry.summary?.trim() || null,
          statusDisplay: entry.status?.trim() || null,
          assigneeDisplay: entry.assigneeName?.trim() || null,
          priorityDisplay: entry.priority?.trim() || null,
          reporterName: null,
          issueUrl: entry.issueUrl,
          projectKey: entry.projectKey,
          projectName: entry.projectName,
          issueType: entry.issueType,
          labels: [],
          components: [],
          dueDate: null,
          resolution: null,
          sprint: null,
          sourceLabel: hasLiveJira ? 'Live Jira' : 'Cache',
          liveRefreshed: hasLiveJira,
          hasLiveJira,
          fieldsOnly: false,
          timestamp: (entry.refreshedAt ?? new Date()).toISOString(),
        }),
      );
    }

    if (docs.length === 0) {
      docs.push(
        buildDocument({
          workspaceId,
          source: 'jira',
          entity: 'jira_issue',
          entityId: `assignee:${normalizePersonName(assigneeQuery)}`,
          title: `No issues assigned to ${assigneeQuery}`,
          content: [
            `ASSIGNEE_LIST_EMPTY: ${assigneeQuery}`,
            `Searched Live Jira and JiraIssueCacheEntry for workspaceId=${workspaceId}.`,
            `Candidate display names: ${candidates.displayNames.join(', ') || '(none)'}`,
            'Do NOT invent issues. Say no matching assigned issues were found.',
          ].join('\n'),
          timestamp: new Date().toISOString(),
          metadata: {
            assigneeQuery,
            issueFound: false,
            assigneeList: true,
          },
        }),
      );
    } else {
      docs.unshift(
        buildDocument({
          workspaceId,
          source: 'jira',
          entity: 'jira_issue',
          entityId: `assignee-list:${normalizePersonName(assigneeQuery)}`,
          title: `Issues assigned to ${assigneeQuery}`,
          content: [
            'AUTHORITATIVE_ASSIGNEE_LIST: true',
            `Assignee query: ${assigneeQuery}`,
            `Matched issues: ${docs.length}`,
            `Workspace members matched first: ${candidates.workspaceMemberNames.join(', ') || '(none)'}`,
            `Jira display names used: ${candidates.displayNames.join(', ')}`,
            'Use ONLY these Jira issues for assignee list answers.',
          ].join('\n'),
          timestamp: new Date().toISOString(),
          metadata: {
            assigneeQuery,
            assigneeList: true,
            matchedCount: docs.length,
          },
        }),
      );
    }

    const totalInWorkspace = await this.prisma.jiraIssueCacheEntry.count({
      where: { workspaceId },
    });

    return {
      docs: docs.slice(0, limit + 1),
      diagnostic: {
        sourceKey: 'jira',
        label: 'Jira (assignee list)',
        searched: true,
        found: docs.length,
        totalInWorkspace,
        reasonCode: docs.length > 1 ? 'ok' : 'filters_excluded_all',
        reason: `Assignee list for "${assigneeQuery}": ${Math.max(0, docs.length - 1)} issue(s)`,
      },
    };
  }

  private async collectJiraIssues(
    workspaceId: string,
    filters: WorkspaceSearchFilters,
    limit: number,
  ): Promise<CollectorResult> {
    const assigneeQ =
      filters.assigneeQuery?.trim() ||
      (filters.jiraAssigneeList ? filters.userQuery?.trim() : null);
    if (assigneeQ && !filters.issueKey?.trim()) {
      return this.collectJiraIssuesForAssignee(
        workspaceId,
        assigneeQ,
        filters,
        limit,
      );
    }

    const tokens = this.searchTokens(filters);
    const issueKey = filters.issueKey?.trim() || null;
    const refreshedAt = this.dateWhere(filters);

    let liveRefresh: {
      status: string | null;
      summary: string;
      assigneeName?: string | null;
      priority?: string | null;
      reporterName?: string | null;
      issueUrl?: string | null;
      projectKey?: string | null;
      projectName?: string | null;
      issueType?: string | null;
      labels?: string[];
      components?: string[];
      dueDate?: string | null;
      resolution?: string | null;
      sprint?: string | null;
      source: 'live_jira';
    } | null = null;

    if (issueKey) {
      liveRefresh = await this.refreshIssueFromLiveJiraWithRetry(
        workspaceId,
        issueKey,
      );
    }

    const totalInWorkspace = await this.prisma.jiraIssueCacheEntry.count({
      where: { workspaceId },
    });

    const tokenOr: Prisma.JiraIssueCacheEntryWhereInput[] = tokens.flatMap(
      (token) => [
        { issueKey: { contains: token, mode: 'insensitive' } },
        { summary: { contains: token, mode: 'insensitive' } },
        { status: { contains: token, mode: 'insensitive' } },
        { projectKey: { contains: token, mode: 'insensitive' } },
        { assigneeName: { contains: token, mode: 'insensitive' } },
      ],
    );

    const entries = await this.prisma.jiraIssueCacheEntry.findMany({
      where: {
        workspaceId,
        ...(issueKey ? {} : refreshedAt ? { refreshedAt } : {}),
        ...(issueKey
          ? {
              issueKey: {
                equals: issueKey,
                mode: 'insensitive',
              },
            }
          : tokenOr.length
            ? { OR: tokenOr }
            : {}),
      },
      orderBy: { refreshedAt: 'desc' },
      take: limit,
    });

    // One row per issueKey — freshest cache wins (live values overlay below).
    const byKey = new Map<string, (typeof entries)[number]>();
    for (const entry of entries) {
      if (!entry.issueKey) continue;
      const key = String(entry.issueKey).toUpperCase();
      if (!byKey.has(key)) byKey.set(key, entry);
    }

    const docs: KnowledgeDocument[] = [];
    const issueKeyUpper = issueKey?.toUpperCase() ?? null;
    const hasLiveJira = await this.hasUsableLiveJiraConnection(workspaceId);

    // Issue-key questions: emit a single authoritative jira_issue document — never invent.
    if (issueKeyUpper) {
      const entry = byKey.get(issueKeyUpper) ?? null;
      const liveUsable = isUsableLiveIssuePayload(liveRefresh);
      const fieldsOnly = Boolean(filters.jiraFieldsOnly);
      // When workspace has Live Jira, field values must come from API — never stale cache.
      const mustUseLive = hasLiveJira;

      if (mustUseLive && !liveUsable) {
        const workspaceLabel =
          (
            await this.prisma.workspace.findUnique({
              where: { id: workspaceId },
              select: { slackWorkspaceName: true },
            })
          )?.slackWorkspaceName?.trim() || 'this workspace';

        docs.push(
          buildDocument({
            workspaceId,
            source: 'jira',
            entity: 'jira_issue',
            entityId: issueKeyUpper,
            title: `${issueKeyUpper} — not found (live)`,
            content: [
              `ISSUE_NOT_FOUND: ${issueKeyUpper}`,
              `I couldn't find ${issueKeyUpper} via Live Jira API for ${workspaceLabel}.`,
              'Answer Source: Live Jira API (miss) — cache was NOT used.',
              'Do NOT invent status, assignee, summary, or priority.',
              'Do NOT use Team Memory, Reports, Slack, Demo, or stale cache.',
            ].join('\n'),
            timestamp: new Date().toISOString(),
            metadata: {
              issueKey: issueKeyUpper,
              issueFound: false,
              jiraSource: 'live_miss',
              hasLiveJiraConnection: true,
              liveRefreshed: false,
              answerSource: 'Live Jira API',
              authoritativeJiraFields: false,
            },
          }),
        );

        this.logJiraStatusDebug({
          questionIssueKey: issueKeyUpper,
          workspaceId,
          source: 'live_miss',
          issueFound: false,
          status: null,
          summary: null,
          assignee: null,
          priority: null,
          reporter: null,
        });
      } else if (hasLiveJira && liveUsable) {
        // LIVE-ONLY: workspace has OAuth — never merge cache field values.
        const sourceLabel = 'Live Jira' as const;
        const status = liveRefresh?.status?.trim() || null;
        const summary = !isPlaceholderSummary(liveRefresh?.summary)
          ? liveRefresh!.summary.trim()
          : null;
        const assigneeName = liveRefresh?.assigneeName?.trim() || null;
        const priority = liveRefresh?.priority?.trim() || null;
        const reporterName = liveRefresh?.reporterName ?? null;
        const issueUrl = liveRefresh?.issueUrl ?? null;
        const projectKey = liveRefresh?.projectKey ?? null;
        const projectName = liveRefresh?.projectName ?? null;
        const issueType = liveRefresh?.issueType ?? null;
        const labels = liveRefresh?.labels ?? [];
        const components = liveRefresh?.components ?? [];
        const dueDate = liveRefresh?.dueDate ?? null;
        const resolution = liveRefresh?.resolution ?? null;
        const sprint = liveRefresh?.sprint ?? null;

        const summaryDisplay = summary?.trim() || null;
        const statusDisplay = status?.trim() || null;
        const assigneeDisplay = assigneeName?.trim() || null;
        const priorityDisplay = priority?.trim() || null;

        docs.push(
          buildAuthoritativeJiraDocument({
            workspaceId,
            issueKeyUpper,
            summaryDisplay,
            statusDisplay,
            assigneeDisplay,
            priorityDisplay,
            reporterName,
            issueUrl,
            projectKey,
            projectName,
            issueType,
            labels,
            components,
            dueDate,
            resolution,
            sprint,
            sourceLabel,
            liveRefreshed: true,
            hasLiveJira,
            fieldsOnly,
            timestamp: new Date().toISOString(),
          }),
        );

        this.logJiraStatusDebug({
          questionIssueKey: issueKeyUpper,
          workspaceId,
          source: sourceLabel,
          issueFound: true,
          status: statusDisplay,
          summary: summaryDisplay,
          assignee: assigneeDisplay,
          priority: priorityDisplay,
          reporter: reporterName,
        });
      } else if (!hasLiveJira && !liveUsable && !entry) {
        const workspaceMeta = await this.prisma.workspace.findUnique({
          where: { id: workspaceId },
          select: { slackWorkspaceName: true },
        });
        const workspaceLabel =
          workspaceMeta?.slackWorkspaceName?.trim() || 'this workspace';
        const notFoundMessage = hasLiveJira
          ? `I couldn't find ${issueKeyUpper} in the connected Jira site for ${workspaceLabel}.`
          : `Jira is not connected for ${workspaceLabel}. Open Jira settings, connect Atlassian while this workspace is selected, then ask again.`;

        docs.push(
          buildDocument({
            workspaceId,
            source: 'jira',
            entity: 'jira_issue',
            entityId: issueKeyUpper,
            title: hasLiveJira
              ? `${issueKeyUpper} — not found`
              : `Jira not connected — ${issueKeyUpper}`,
            content: [
              hasLiveJira
                ? `ISSUE_NOT_FOUND: ${issueKeyUpper}`
                : `JIRA_NOT_CONNECTED: workspaceId=${workspaceId}`,
              notFoundMessage,
              `Searched: Live Jira (usable connection=${hasLiveJira}) and JiraIssueCacheEntry for workspaceId=${workspaceId}.`,
              'Do NOT invent status, assignee, summary, or priority. Reply with the guidance above.',
              'Do NOT use Jira data from any other Pulse workspace.',
            ].join('\n'),
            timestamp: new Date().toISOString(),
            metadata: {
              issueKey: issueKeyUpper,
              issueFound: false,
              jiraSource: 'none',
              hasLiveJiraConnection: hasLiveJira,
              jiraNotConnected: !hasLiveJira,
              answerSource: hasLiveJira ? 'Live Jira API' : 'none',
            },
          }),
        );

        this.logJiraStatusDebug({
          questionIssueKey: issueKeyUpper,
          workspaceId,
          source: 'none',
          issueFound: false,
          status: null,
          summary: null,
          assignee: null,
          priority: null,
          reporter: null,
        });
      } else if (!hasLiveJira) {
        // No Live Jira connection — cache is the only offline source for field values.
        const sourceLabel: 'Live Jira' | 'Cache' = liveUsable
          ? 'Live Jira'
          : 'Cache';

        const status = liveUsable
          ? liveRefresh?.status?.trim() || null
          : entry?.status?.trim() || null;
        const summary = liveUsable
          ? !isPlaceholderSummary(liveRefresh?.summary)
            ? liveRefresh!.summary.trim()
            : null
          : entry?.summary?.trim() || null;
        const assigneeName = liveUsable
          ? liveRefresh?.assigneeName?.trim() || null
          : entry?.assigneeName?.trim() || null;
        const priority = liveUsable
          ? liveRefresh?.priority?.trim() || null
          : entry?.priority?.trim() || null;
        const reporterName = liveUsable
          ? liveRefresh?.reporterName?.trim() || null
          : null;
        const issueUrl =
          (liveUsable ? liveRefresh?.issueUrl : null) ??
          entry?.issueUrl ??
          null;
        const projectKey =
          (liveUsable ? liveRefresh?.projectKey : null) ??
          entry?.projectKey ??
          null;
        const projectName =
          (liveUsable ? liveRefresh?.projectName : null) ??
          entry?.projectName ??
          null;
        const issueType =
          (liveUsable ? liveRefresh?.issueType : null) ??
          entry?.issueType ??
          null;
        const labels = liveUsable ? liveRefresh?.labels ?? [] : [];
        const components = liveUsable ? liveRefresh?.components ?? [] : [];
        const dueDate = liveUsable ? liveRefresh?.dueDate ?? null : null;
        const resolution = liveUsable ? liveRefresh?.resolution ?? null : null;
        const sprint = liveUsable ? liveRefresh?.sprint ?? null : null;

        const summaryDisplay = summary?.trim() || null;
        const statusDisplay = status?.trim() || null;
        const assigneeDisplay = assigneeName?.trim() || null;
        const priorityDisplay = priority?.trim() || null;

        docs.push(
          buildAuthoritativeJiraDocument({
            workspaceId,
            issueKeyUpper,
            summaryDisplay,
            statusDisplay,
            assigneeDisplay,
            priorityDisplay,
            reporterName,
            issueUrl,
            projectKey,
            projectName,
            issueType,
            labels,
            components,
            dueDate,
            resolution,
            sprint,
            sourceLabel,
            liveRefreshed: liveUsable,
            hasLiveJira,
            fieldsOnly,
            timestamp: (entry?.refreshedAt ?? new Date()).toISOString(),
          }),
        );

        this.logger.log(
          [
            `[JiraLiveSource] Answer`,
            `WorkspaceId: ${workspaceId}`,
            `Issue: ${issueKeyUpper}`,
            `Answer Source: ${sourceLabel === 'Live Jira' ? 'Live Jira API' : 'Cache (offline)'}`,
            `Status: ${statusDisplay ?? '(none)'}`,
            `Assignee: ${assigneeDisplay ?? '(unassigned)'}`,
            `Priority: ${priorityDisplay ?? '(none)'}`,
          ].join(' | '),
        );

        this.logJiraStatusDebug({
          questionIssueKey: issueKeyUpper,
          workspaceId,
          source: sourceLabel,
          issueFound: true,
          status: statusDisplay,
          summary: summaryDisplay,
          assignee: assigneeDisplay,
          priority: priorityDisplay,
          reporter: reporterName,
        });
      }
    } else {
      for (const entry of byKey.values()) {
        if (hasLiveJira) {
          // Live Jira connected — bulk cache rows are not authoritative for field values.
          continue;
        }
        const assigneeDisplay = entry.assigneeName?.trim() || null;
        docs.push(
          buildDocument({
            workspaceId,
            source: 'jira',
            entity: 'jira_issue',
            entityId: entry.issueKey,
            title: `${entry.issueKey} — ${entry.summary}`,
            content: [
              `Key: ${entry.issueKey}`,
              `Summary: ${entry.summary}`,
              entry.status ? `Status: ${entry.status}` : 'Status: (not set in Jira)',
              assigneeDisplay
                ? `Assignee: ${assigneeDisplay}`
                : 'Assignee: (unassigned in Jira)',
              entry.priority
                ? `Priority: ${entry.priority}`
                : 'Priority: (not set in Jira)',
              entry.projectKey ? `Project: ${entry.projectKey}` : null,
              entry.issueType ? `Type: ${entry.issueType}` : null,
              'Data source: JiraIssueCacheEntry (offline — no Live Jira connection)',
              'ISSUE_FOUND: true',
              'AUTHORITATIVE_JIRA_FIELDS: assignee, status, priority, summary — use these values only when Live Jira is NOT connected.',
            ]
              .filter(Boolean)
              .join('\n'),
            timestamp: (entry.refreshedAt ?? new Date()).toISOString(),
            url: entry.issueUrl,
            metadata: {
              issueKey: entry.issueKey,
              issueFound: true,
              status: entry.status,
              summary: entry.summary,
              assigneeName: assigneeDisplay,
              priority: entry.priority,
              liveRefreshed: false,
              jiraSource: 'Cache',
              hasLiveJiraConnection: hasLiveJira,
              authoritativeJiraFields: !hasLiveJira,
              authorityClass: 'LEGACY_SUPPORTING',
            },
          }),
        );
      }
    }

    const explanation = explainEmpty({
      found: docs.length,
      totalInWorkspace,
      keyword: filters.keyword,
      issueKey,
      dateFrom: issueKey ? null : filters.dateFrom,
      dateTo: issueKey ? null : filters.dateTo,
    });

    return {
      docs,
      diagnostic: {
        sourceKey: 'jira',
        label: liveRefresh ? 'Jira (live refresh)' : 'Jira',
        searched: true,
        found: docs.length,
        totalInWorkspace,
        reasonCode: explanation.reasonCode,
        reason: liveRefresh
          ? `Live Jira refresh for ${issueKey}: status=${liveRefresh.status ?? 'unknown'}`
          : explanation.reason,
      },
    };
  }

  private logJiraStatusDebug(params: {
    questionIssueKey: string;
    workspaceId: string;
    source: string;
    issueFound: boolean;
    status: string | null;
    summary: string | null;
    assignee: string | null;
    priority: string | null;
    reporter: string | null;
  }): void {
    this.logger.log(
      [
        'Jira status debug:',
        `Question: ${params.questionIssueKey}`,
        `Workspace: ${params.workspaceId}`,
        `Source: ${params.source}`,
        `Issue found: ${params.issueFound}`,
        `Status: ${params.status ?? '(none)'}`,
        `Summary: ${params.summary ?? '(none)'}`,
        `Assignee: ${params.assignee ?? '(none)'}`,
        `Priority: ${params.priority ?? '(none)'}`,
        `Reporter: ${params.reporter ?? '(none)'}`,
      ].join('\n'),
    );
  }

  /**
   * True when the workspace has OAuth credentials that can call Atlassian.
   * Demo and Real use the same RAG path; Demo simply has no usable live tokens,
   * so answers come from JiraIssueCacheEntry like any offline workspace.
   */
  private async hasUsableLiveJiraConnection(
    workspaceId: string,
  ): Promise<boolean> {
    const connection = await this.findLiveJiraConnection(workspaceId);
    return Boolean(connection);
  }

  private async findLiveJiraConnection(workspaceId: string) {
    return this.jiraService.findLiveConnectionForWorkspace(workspaceId);
  }

  /**
   * Live refresh with one automatic retry on transient failure.
   */
  private async refreshIssueFromLiveJiraWithRetry(
    workspaceId: string,
    issueKey: string,
  ): Promise<Awaited<ReturnType<WorkspaceKnowledgeService['refreshIssueFromLiveJira']>>> {
    let result = await this.refreshIssueFromLiveJira(workspaceId, issueKey);
    if (!result) {
      this.logger.warn(
        `[WorkspaceJira] Live refresh retry issue=${issueKey} workspaceId=${workspaceId}`,
      );
      result = await this.refreshIssueFromLiveJira(workspaceId, issueKey);
    }
    return result;
  }

  /**
   * For issue-key questions, pull the latest fields from Atlassian and upsert cache.
   * Same for every workspace: if there is no usable OAuth connection, return null
   * and fall back to JiraIssueCacheEntry (Demo seeds live in that table).
   */
  private async refreshIssueFromLiveJira(
    workspaceId: string,
    issueKey: string,
  ): Promise<{
    status: string | null;
    summary: string;
    assigneeName?: string | null;
    priority?: string | null;
    reporterName?: string | null;
    issueUrl?: string | null;
    projectKey?: string | null;
    projectName?: string | null;
    issueType?: string | null;
    labels?: string[];
    components?: string[];
    dueDate?: string | null;
    resolution?: string | null;
    sprint?: string | null;
    source: 'live_jira';
  } | null> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, slackWorkspaceId: true, slackWorkspaceName: true },
    });
    const connection = await this.findLiveJiraConnection(workspaceId);

    this.logger.log(
      `[WorkspaceJira] refresh issue=${issueKey} workspace="${workspace?.slackWorkspaceName ?? '?'}" workspaceId=${workspaceId} slackWorkspaceId=${workspace?.slackWorkspaceId ?? '?'} jiraConnectionId=${connection?.id ?? 'none'} cloudId=${connection?.cloudId ?? 'none'}`,
    );

    if (!connection) {
      this.logger.log(
        `Jira live refresh skipped — no usable OAuth connection for workspace=${workspaceId} issue=${issueKey}`,
      );
      return null;
    }

    try {
      const live = await this.jiraService.lookupIssueForUser(
        connection.userId,
        issueKey,
      );
      if (!live?.issueKey) {
        this.logger.warn(
          `Jira live refresh: ${issueKey} not found on cloudId=${connection.cloudId} connectionId=${connection.id}`,
        );
        return null;
      }

      // Reject empty/placeholder live payloads so we do not overwrite good cache.
      if (isPlaceholderSummary(live.summary) && !live.status && !live.assigneeName) {
        this.logger.warn(
          `Jira live refresh returned empty placeholder fields for ${issueKey} — ignoring live payload`,
        );
        return null;
      }

      await this.jiraCache.upsertFromSnapshot(connection.userId, live);

      this.logger.log(
        [
          `[JiraLiveSource] Live API Response`,
          `Workspace: ${workspace?.slackWorkspaceName ?? '?'}`,
          `WorkspaceId: ${workspaceId}`,
          `JiraConnectionId: ${connection.id}`,
          `Issue: ${live.issueKey}`,
          `Status: ${live.status ?? '(none)'}`,
          `Assignee: ${live.assigneeName ?? '(unassigned)'}`,
          `Priority: ${live.priority ?? '(none)'}`,
          `Summary: ${live.summary}`,
          `Source: Live Jira API`,
        ].join(' | '),
      );

      return {
        status: live.status,
        summary: live.summary?.trim() || '',
        assigneeName: live.assigneeName ?? null,
        priority: live.priority ?? null,
        reporterName: live.reporterName ?? null,
        issueUrl: live.issueUrl ?? null,
        projectKey: live.projectKey ?? null,
        projectName: live.projectName ?? null,
        issueType: live.issueType ?? null,
        labels: live.labels ?? [],
        components: live.components ?? [],
        dueDate: live.dueDate ?? null,
        resolution: live.resolution ?? null,
        sprint: live.sprint ?? null,
        source: 'live_jira',
      };
    } catch (error) {
      this.logger.warn(
        `Jira live refresh failed for ${issueKey}: ${
          error instanceof Error ? error.message : String(error)
        } — falling back to JiraIssueCacheEntry only when jiraFieldsOnly is false`,
      );
      return null;
    }
  }

  private async collectBlockers(
    workspaceId: string,
    filters: WorkspaceSearchFilters,
    limit: number,
  ): Promise<CollectorResult> {
    // Full dashboard path — same service/query as Blockers page (no take / token filter).
    if (filters.blockersFullList) {
      return this.collectBlockersFromDashboard(workspaceId, filters);
    }

    const tokens = this.searchTokens(filters);
    const createdAt = this.dateWhere(filters);
    const userQ = filters.userQuery?.trim();

    const totalInWorkspace = await this.prisma.pulseBlocker.count({
      where: { workspaceId },
    });

    const tokenOr: Prisma.PulseBlockerWhereInput[] = tokens.flatMap((token) => [
      { title: { contains: token, mode: 'insensitive' } },
      { description: { contains: token, mode: 'insensitive' } },
      { category: { contains: token, mode: 'insensitive' } },
      { linkedIssueKey: { contains: token, mode: 'insensitive' } },
      { status: { contains: token, mode: 'insensitive' } },
    ]);

    const blockers = await this.prisma.pulseBlocker.findMany({
      where: {
        workspaceId,
        ...(createdAt ? { createdAt } : {}),
        ...(userQ
          ? {
              user: {
                workspaceId,
                slackDisplayName: {
                  contains: userQ,
                  mode: 'insensitive',
                },
              },
            }
          : {}),
        ...(filters.latestStandupRunId
          ? { runId: filters.latestStandupRunId }
          : {}),
        ...(filters.subjectUserId ? { userId: filters.subjectUserId } : {}),
        ...(tokenOr.length ? { OR: tokenOr } : {}),
        ...(filters.issueKey
          ? {
              linkedIssueKey: {
                equals: filters.issueKey,
                mode: 'insensitive',
              },
            }
          : {}),
      },
      include: {
        user: { select: { slackDisplayName: true, slackUserId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const docs = blockers.map((blocker) =>
      buildDocument({
        workspaceId,
        source: 'blockers',
        entity: 'blocker',
        entityId: blocker.id,
        title: blocker.title?.trim() || blocker.description.slice(0, 80),
        content: [
          blocker.title ? `Title: ${blocker.title}` : null,
          `Description: ${blocker.description}`,
          `Status: ${blocker.status}`,
          `Severity: ${blocker.severity}`,
          blocker.category ? `Category: ${blocker.category}` : null,
          blocker.linkedIssueKey
            ? `Linked Jira: ${blocker.linkedIssueKey}`
            : null,
          `Reporter: ${blocker.user.slackDisplayName}`,
        ]
          .filter(Boolean)
          .join('\n'),
        timestamp: blocker.createdAt.toISOString(),
        url: blocker.linkedIssueUrl,
        metadata: {
          blockerId: blocker.id,
          status: blocker.status,
          severity: blocker.severity,
          linkedIssueKey: blocker.linkedIssueKey,
        },
      }),
    );

    const explanation = explainEmpty({
      found: docs.length,
      totalInWorkspace,
      keyword: filters.keyword,
      userQuery: userQ,
      issueKey: filters.issueKey,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    });

    return {
      docs,
      diagnostic: {
        sourceKey: 'blockers',
        label: 'Blockers',
        searched: true,
        found: docs.length,
        totalInWorkspace,
        ...explanation,
      },
    };
  }

  /**
   * Authoritative blockers for count/list questions — JiraBlockerService only.
   * Matches Blockers page Open / Critical / Waiting>3d / Resolved-this-week.
   */
  private async collectBlockersFromDashboard(
    workspaceId: string,
    filters: WorkspaceSearchFilters,
  ): Promise<CollectorResult> {
    const stats =
      await this.jiraBlockers.getBlockerStatsForWorkspace(workspaceId);
    let dashboard =
      await this.jiraBlockers.listDashboardBlockersForWorkspace(workspaceId);

    // Optional focus: critical-only when question asks for critical
    const wantCritical = /\bcritical\b/i.test(
      `${filters.keyword ?? ''} ${(filters.searchTokens ?? []).join(' ')}`,
    );
    // Prefer open list for "open/current blockers" unless asking for resolved
    const wantResolved = /\bresolved\b/i.test(
      `${filters.keyword ?? ''} ${(filters.searchTokens ?? []).join(' ')}`,
    );

    if (wantCritical) {
      dashboard = dashboard.filter(
        (b) =>
          isOpenBlockerStatus(b.status) &&
          b.priority?.toLowerCase() === 'critical',
      );
    } else if (!wantResolved && !filters.issueKey) {
      // Default for GET_BLOCKERS count/list: include ALL (so totals match page),
      // but pin open ones first via ordering in docs below.
    }

    if (filters.issueKey) {
      const key = filters.issueKey.toUpperCase();
      dashboard = dashboard.filter(
        (b) => b.jiraIssue?.key?.toUpperCase() === key,
      );
    }

    const summaryDoc = buildDocument({
      workspaceId,
      source: 'blockers',
      entity: 'blocker',
      entityId: `stats:${workspaceId}`,
      title: 'Blockers dashboard stats (authoritative)',
      content: [
        'AUTHORITATIVE_BLOCKER_STATS: true',
        'Source: JiraBlockerService — same collection as Blockers page GET /api/blockers',
        `Workspace ID: ${workspaceId}`,
        `Retrieved blockers: ${stats.total}`,
        `Open blockers: ${stats.openBlockers}`,
        `Critical (open): ${stats.critical}`,
        `Waiting > 3 days (open by age): ${stats.waitingMoreThan3Days}`,
        `Resolved this week: ${stats.resolvedThisWeek}`,
        `Resolved (all): ${stats.resolved}`,
        'Use these counts exactly. Do not invent or estimate.',
        'Open = not Resolved and not Closed (same as Blockers page).',
      ].join('\n'),
      timestamp: new Date().toISOString(),
      metadata: {
        authoritativeBlockerStats: true,
        ...stats,
      },
    });

    const openFirst = [...dashboard].sort((a, b) => {
      const ao = isOpenBlockerStatus(a.status) ? 0 : 1;
      const bo = isOpenBlockerStatus(b.status) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const openBlockers = openFirst.filter((b) => isOpenBlockerStatus(b.status));
    const ownerLines = openBlockers.map((b) => {
      const label = b.title?.trim() || b.description.slice(0, 60);
      const owner = b.ownerName?.trim() || 'Unknown User';
      return `- ${label}: Owner ${owner}`;
    });

    const ownersDoc =
      ownerLines.length > 0
        ? buildDocument({
            workspaceId,
            source: 'blockers',
            entity: 'blocker',
            entityId: `owners:${workspaceId}`,
            title: 'Open blocker owners (authoritative)',
            content: [
              'AUTHORITATIVE_BLOCKER_OWNERS: true',
              'Use Owner names below — never output raw Slack user IDs (U… / W…).',
              'If Owner is Unknown User, say so — do not expose Slack IDs.',
              '',
              ...ownerLines,
            ].join('\n'),
            timestamp: new Date().toISOString(),
            metadata: {
              authoritativeBlockerOwners: true,
              openCount: openBlockers.length,
            },
          })
        : null;

    const docs = [
      summaryDoc,
      ...(ownersDoc ? [ownersDoc] : []),
      ...openFirst.map((blocker) =>
        buildDocument({
          workspaceId,
          source: 'blockers',
          entity: 'blocker',
          entityId: blocker.id,
          title: blocker.title?.trim() || blocker.description.slice(0, 80),
          content: [
            blocker.title ? `Title: ${blocker.title}` : null,
            `Description: ${blocker.description}`,
            `Status: ${blocker.statusLabel} (${blocker.status})`,
            `Priority: ${blocker.priority}`,
            blocker.category ? `Category: ${blocker.category}` : null,
            blocker.jiraIssue?.key
              ? `Linked Jira: ${blocker.jiraIssue.key}`
              : null,
            `Reporter: ${blocker.reporter}`,
            blocker.ownerName ? `Owner: ${blocker.ownerName}` : 'Owner: Unknown User',
            `Created: ${blocker.createdAt}`,
            blocker.resolvedAt ? `Resolved at: ${blocker.resolvedAt}` : null,
            'Data source: Blockers dashboard (JiraBlockerService)',
          ]
            .filter(Boolean)
            .join('\n'),
          timestamp: blocker.createdAt,
          url: blocker.jiraIssue?.url ?? blocker.slackThreadUrl,
          metadata: {
            blockerId: blocker.id,
            status: blocker.status,
            severity: blocker.priority,
            linkedIssueKey: blocker.jiraIssue?.key ?? null,
            ownerName: blocker.ownerName,
            ownerSlackId: blocker.ownerSlackId,
            ownerUserId: blocker.ownerUserId,
            fromDashboard: true,
          },
        }),
      ),
    ];

    this.logger.log(
      [
        'AI blockers (dashboard source):',
        `Workspace ID: ${workspaceId}`,
        `Retrieved blockers: ${stats.total}`,
        `Open count: ${stats.openBlockers}`,
        `Critical count: ${stats.critical}`,
        `Resolved count: ${stats.resolved}`,
        `Docs emitted: ${docs.length}`,
      ].join('\n'),
    );

    return {
      docs,
      diagnostic: {
        sourceKey: 'blockers',
        label: 'Blockers (dashboard)',
        searched: true,
        found: docs.length,
        totalInWorkspace: stats.total,
        reasonCode: stats.total > 0 ? 'ok' : 'no_records_in_db',
        reason: `Dashboard blockers open=${stats.openBlockers} critical=${stats.critical} total=${stats.total}`,
      },
    };
  }

  private async collectBlockerUpdates(
    workspaceId: string,
    filters: WorkspaceSearchFilters,
    limit: number,
  ): Promise<CollectorResult> {
    const tokens = this.searchTokens(filters);
    const createdAt = this.dateWhere(filters);

    const totalInWorkspace = await this.prisma.pulseBlockerUpdate.count({
      where: { blocker: { workspaceId } },
    });

    const tokenOr: Prisma.PulseBlockerUpdateWhereInput[] = tokens.flatMap(
      (token) => [
        { notes: { contains: token, mode: 'insensitive' } },
        { newStatus: { contains: token, mode: 'insensitive' } },
        {
          blocker: {
            OR: [
              { title: { contains: token, mode: 'insensitive' } },
              {
                linkedIssueKey: {
                  contains: token,
                  mode: 'insensitive',
                },
              },
            ],
          },
        },
      ],
    );

    const updates = await this.prisma.pulseBlockerUpdate.findMany({
      where: {
        blocker: {
          workspaceId,
          ...(filters.issueKey
            ? {
                linkedIssueKey: {
                  equals: filters.issueKey,
                  mode: 'insensitive',
                },
              }
            : {}),
        },
        ...(createdAt ? { createdAt } : {}),
        ...(tokenOr.length ? { OR: tokenOr } : {}),
      },
      include: {
        user: { select: { slackDisplayName: true } },
        blocker: {
          select: {
            id: true,
            title: true,
            linkedIssueKey: true,
            linkedIssueUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const docs = updates.map((update) =>
      buildDocument({
        workspaceId,
        source: 'blockers',
        entity: 'blocker_update',
        entityId: update.id,
        title: `Follow-up: ${update.blocker.title ?? update.blockerId}`,
        content: [
          `Blocker: ${update.blocker.title ?? update.blockerId}`,
          `Status: ${update.previousStatus} → ${update.newStatus}`,
          update.notes ? `Notes: ${update.notes}` : null,
          update.resolutionType
            ? `Resolution type: ${update.resolutionType}`
            : null,
          typeof update.daysOpen === 'number'
            ? `Days open: ${update.daysOpen}`
            : null,
          `From: ${update.updatedFrom}`,
          `By: ${update.user.slackDisplayName}`,
        ]
          .filter(Boolean)
          .join('\n'),
        timestamp: update.createdAt.toISOString(),
        url: update.blocker.linkedIssueUrl,
        metadata: {
          blockerId: update.blockerId,
          previousStatus: update.previousStatus,
          newStatus: update.newStatus,
          updatedFrom: update.updatedFrom,
        },
      }),
    );

    const explanation = explainEmpty({
      found: docs.length,
      totalInWorkspace,
      keyword: filters.keyword,
      issueKey: filters.issueKey,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    });

    return {
      docs,
      diagnostic: {
        sourceKey: 'blocker_updates',
        label: 'Blocker Updates',
        searched: true,
        found: docs.length,
        totalInWorkspace,
        ...explanation,
      },
    };
  }

  private async collectReports(
    workspaceId: string,
    filters: WorkspaceSearchFilters,
    limit: number,
  ): Promise<CollectorResult> {
    const tokens = this.searchTokens(filters);
    const createdAt = this.dateWhere(filters);

    const totalInWorkspace = await this.prisma.aiDigest.count({
      where: { team: { workspaceId } },
    });

    const tokenOr: Prisma.AiDigestWhereInput[] = tokens.flatMap((token) => [
      { summary: { contains: token, mode: 'insensitive' } },
      {
        run: {
          checkIn: { name: { contains: token, mode: 'insensitive' } },
        },
      },
    ]);

    const digests = await this.prisma.aiDigest.findMany({
      where: {
        team: { workspaceId },
        ...(createdAt ? { createdAt } : {}),
        ...(tokenOr.length ? { OR: tokenOr } : {}),
      },
      include: {
        run: { include: { checkIn: { select: { name: true } } } },
        team: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const docs = digests.map((digest) => {
      const standupName = digest.run.checkIn?.name ?? 'Standup report';
      return buildDocument({
        workspaceId,
        source: 'reports',
        entity: 'report',
        entityId: digest.id,
        title: `${standupName} — ${digest.team.name}`,
        content:
          [
            digest.summary ? `Summary: ${digest.summary}` : null,
            Array.isArray(digest.themes)
              ? `Themes: ${JSON.stringify(digest.themes)}`
              : null,
            Array.isArray(digest.blockers)
              ? `Blockers: ${JSON.stringify(digest.blockers)}`
              : null,
          ]
            .filter(Boolean)
            .join('\n') || '(empty report)',
        timestamp: digest.createdAt.toISOString(),
        metadata: {
          digestId: digest.id,
          runId: digest.runId,
          teamId: digest.teamId,
        },
      });
    });

    const explanation = explainEmpty({
      found: docs.length,
      totalInWorkspace,
      keyword: filters.keyword,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    });

    return {
      docs,
      diagnostic: {
        sourceKey: 'reports',
        label: 'Reports',
        searched: true,
        found: docs.length,
        totalInWorkspace,
        ...explanation,
      },
    };
  }

  private async collectUsers(
    workspaceId: string,
    filters: WorkspaceSearchFilters,
    limit: number,
  ): Promise<CollectorResult> {
    const tokens = meaningfulTokens(
      filters.userQuery?.trim() || filters.keyword,
    );
    const applyNameFilter = Boolean(filters.userQuery?.trim());
    const memberLimit = Math.max(limit, 80);

    let sourceUsed:
      | 'Live Slack'
      | 'SlackMemberCache'
      | 'TeamMember'
      | 'User'
      | 'Demo'
      | 'none' = 'none';

    // 1) Live Slack users.list → refresh SlackMemberCache (same idea as Live Jira).
    let liveHumans: Awaited<
      ReturnType<SlackMemberCacheService['syncFromLive']>
    >['humans'] = [];
    try {
      const live = await this.slackMemberCache.syncFromLive(workspaceId);
      if (live.source === 'live_slack' && live.humans.length > 0) {
        liveHumans = live.humans;
        sourceUsed = 'Live Slack';
      }
    } catch (error) {
      this.logger.warn(
        `Slack live member sync failed for workspace=${workspaceId}: ${
          error instanceof Error ? error.message : String(error)
        } — falling back to SlackMemberCache`,
      );
    }

    // 2) SlackMemberCache (also covers Demo when seeded)
    let members =
      liveHumans.length > 0
        ? liveHumans
        : await this.slackMemberCache.listHumanCache(workspaceId);

    if (members.length > 0 && sourceUsed === 'none') {
      sourceUsed = 'SlackMemberCache';
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { slackWorkspaceId: true },
      });
      if (workspace?.slackWorkspaceId === 'T_DEMO_PULSE_WS') {
        sourceUsed = 'Demo';
      }
    }

    // 3) TeamMember → User
    if (members.length === 0) {
      const teamMembers = await this.prisma.teamMember.findMany({
        where: { team: { workspaceId } },
        include: {
          user: {
            select: {
              slackUserId: true,
              slackDisplayName: true,
              slackRealName: true,
              email: true,
            },
          },
        },
        take: memberLimit,
      });

      const bySlackId = new Map<
        string,
        {
          slackUserId: string;
          displayName: string;
          realName: string | null;
          email: string | null;
          isBot: boolean;
          deleted: boolean;
        }
      >();
      for (const tm of teamMembers) {
        const u = tm.user;
        if (
          isPlaceholderSlackUser({
            slackUserId: u.slackUserId,
            slackDisplayName: u.slackDisplayName,
            email: u.email,
          })
        ) {
          continue;
        }
        bySlackId.set(u.slackUserId, {
          slackUserId: u.slackUserId,
          displayName:
            u.slackRealName?.trim() ||
            u.slackDisplayName?.trim() ||
            u.slackUserId,
          realName: u.slackRealName ?? u.slackDisplayName,
          email: u.email,
          isBot: false,
          deleted: false,
        });
      }
      members = [...bySlackId.values()];
      if (members.length > 0) sourceUsed = 'TeamMember';
    }

    // 4) User table (includes Demo roster when cache empty)
    if (members.length === 0) {
      const users = await this.prisma.user.findMany({
        where: { workspaceId },
        orderBy: { slackDisplayName: 'asc' },
        take: memberLimit,
      });
      members = users
        .filter(
          (u) =>
            !isPlaceholderSlackUser({
              slackUserId: u.slackUserId,
              slackDisplayName: u.slackDisplayName,
              email: u.email,
            }),
        )
        .map((u) => ({
          slackUserId: u.slackUserId,
          displayName:
            u.slackRealName?.trim() ||
            u.slackDisplayName?.trim() ||
            u.slackUserId,
          realName: u.slackRealName ?? u.slackDisplayName,
          email: u.email,
          isBot: false,
          deleted: false,
        }));
      if (members.length > 0) {
        const workspace = await this.prisma.workspace.findUnique({
          where: { id: workspaceId },
          select: { slackWorkspaceId: true },
        });
        sourceUsed =
          workspace?.slackWorkspaceId === 'T_DEMO_PULSE_WS' ? 'Demo' : 'User';
      }
    }

    if (applyNameFilter && tokens.length > 0) {
      members = members.filter((m) => {
        const hay = `${m.displayName} ${m.realName ?? ''} ${m.email ?? ''} ${m.slackUserId}`.toLowerCase();
        return tokens.some((t) => hay.includes(t.toLowerCase()));
      });
    }

    members = members.slice(0, memberLimit);

    const totalInWorkspace = await this.prisma.slackMemberCache.count({
      where: { workspaceId, isBot: false, deleted: false },
    });

    const docs = members.map((member) =>
      buildDocument({
        workspaceId,
        source: 'users',
        entity: 'user',
        entityId: member.slackUserId,
        title: member.displayName,
        content: [
          `Display name: ${member.displayName}`,
          member.realName ? `Real name: ${member.realName}` : null,
          `Slack user id: ${member.slackUserId}`,
          member.email ? `Email: ${member.email}` : null,
          `Data source: ${sourceUsed}`,
          'AUTHORITATIVE_SLACK_MEMBERS: true',
          'Use this roster for Slack member questions — ignore Team Memory, Reports, Digests, and standups.',
        ]
          .filter(Boolean)
          .join('\n'),
        timestamp: new Date().toISOString(),
        metadata: {
          slackUserId: member.slackUserId,
          slackMemberSource: sourceUsed,
          authoritativeSlackMembers: true,
        },
      }),
    );

    this.logSlackMembersDebug({
      question: filters.userQuery || filters.keyword || '(members list)',
      workspaceId,
      sourceUsed,
      members: members.map((m) => m.displayName),
    });

    const explanation = explainEmpty({
      found: docs.length,
      totalInWorkspace: Math.max(totalInWorkspace, docs.length),
      keyword: filters.keyword,
      userQuery: filters.userQuery,
    });

    return {
      docs,
      diagnostic: {
        sourceKey: 'slack_members',
        label:
          sourceUsed === 'Live Slack'
            ? 'Slack Members (live)'
            : 'Slack Members',
        searched: true,
        found: docs.length,
        totalInWorkspace: Math.max(totalInWorkspace, docs.length),
        reasonCode: explanation.reasonCode,
        reason:
          sourceUsed === 'none'
            ? explanation.reason
            : `Slack members from ${sourceUsed}: ${docs.length}`,
      },
    };
  }

  private logSlackMembersDebug(params: {
    question: string;
    workspaceId: string;
    sourceUsed: string;
    members: string[];
  }): void {
    this.logger.log(
      [
        'Slack members debug:',
        `Question: ${params.question}`,
        `Workspace: ${params.workspaceId}`,
        `Source used: ${params.sourceUsed}`,
        `Members returned: ${
          params.members.length
            ? params.members.join(', ')
            : '(none)'
        }`,
      ].join('\n'),
    );
  }

  /**
   * Jira member directory: Live Jira → JiraMemberCache → Demo cache.
   * Never answers from Slack / Team Memory / Reports / Standups / AI chats.
   */
  private async collectJiraMembers(
    workspaceId: string,
    filters: WorkspaceSearchFilters,
    limit: number,
  ): Promise<CollectorResult> {
    const tokens = meaningfulTokens(
      filters.userQuery?.trim() || filters.keyword,
    );
    const applyNameFilter = Boolean(filters.userQuery?.trim());
    const memberLimit = Math.max(limit, 80);

    let sourceUsed: 'Live Jira' | 'JiraMemberCache' | 'Demo' | 'none' = 'none';

    // 1) Live Jira users/search → refresh JiraMemberCache
    let liveMembers: Awaited<
      ReturnType<JiraMemberCacheService['syncFromLive']>
    >['members'] = [];
    try {
      const live = await this.jiraMemberCache.syncFromLive(workspaceId);
      if (live.source === 'live_jira' && live.members.length > 0) {
        liveMembers = live.members;
        sourceUsed = 'Live Jira';
      }
    } catch (error) {
      this.logger.warn(
        `Jira live member sync failed for workspace=${workspaceId}: ${
          error instanceof Error ? error.message : String(error)
        } — falling back to JiraMemberCache`,
      );
    }

    // 2) JiraMemberCache (also covers Demo when seeded)
    let members =
      liveMembers.length > 0
        ? liveMembers
        : await this.jiraMemberCache.listActiveCache(workspaceId);

    if (members.length > 0 && sourceUsed === 'none') {
      sourceUsed = 'JiraMemberCache';
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { slackWorkspaceId: true },
      });
      if (workspace?.slackWorkspaceId === DEMO_SLACK_WORKSPACE_ID) {
        sourceUsed = 'Demo';
      }
    }

    if (applyNameFilter && tokens.length > 0) {
      members = members.filter((m) => {
        const hay =
          `${m.displayName} ${m.email ?? ''} ${m.accountId}`.toLowerCase();
        return tokens.some((t) => hay.includes(t.toLowerCase()));
      });
    }

    members = members.slice(0, memberLimit);

    const totalInWorkspace = await this.prisma.jiraMemberCache.count({
      where: { workspaceId, active: true },
    });

    const docs = members.map((member) =>
      buildDocument({
        workspaceId,
        source: 'jira',
        entity: 'jira_member',
        entityId: member.accountId,
        title: member.displayName,
        content: [
          `Display name: ${member.displayName}`,
          `Account id: ${member.accountId}`,
          member.email ? `Email: ${member.email}` : null,
          member.accountType ? `Account type: ${member.accountType}` : null,
          `Active: ${member.active !== false}`,
          `Data source: ${sourceUsed}`,
          'AUTHORITATIVE_JIRA_MEMBERS: true',
          'Use this roster for Jira member questions — ignore Slack, Team Memory, Reports, Digests, and standups.',
        ]
          .filter(Boolean)
          .join('\n'),
        timestamp: new Date().toISOString(),
        metadata: {
          accountId: member.accountId,
          email: member.email,
          jiraMemberSource: sourceUsed,
          authoritativeJiraMembers: true,
        },
      }),
    );

    this.logJiraMembersDebug({
      question: filters.userQuery || filters.keyword || '(jira members list)',
      intent: 'JIRA_MEMBERS',
      workspaceId,
      sourceUsed,
      members: members.map((m) => m.displayName),
    });

    const explanation = explainEmpty({
      found: docs.length,
      totalInWorkspace: Math.max(totalInWorkspace, docs.length),
      keyword: filters.keyword,
      userQuery: filters.userQuery,
    });

    return {
      docs,
      diagnostic: {
        sourceKey: 'jira_members',
        label:
          sourceUsed === 'Live Jira' ? 'Jira Members (live)' : 'Jira Members',
        searched: true,
        found: docs.length,
        totalInWorkspace: Math.max(totalInWorkspace, docs.length),
        reasonCode: explanation.reasonCode,
        reason:
          sourceUsed === 'none'
            ? explanation.reason
            : `Jira members from ${sourceUsed}: ${docs.length}`,
      },
    };
  }

  private logJiraMembersDebug(params: {
    question: string;
    intent: string;
    workspaceId: string;
    sourceUsed: string;
    members: string[];
  }): void {
    this.logger.log(
      [
        'Jira members debug:',
        `Question: ${params.question}`,
        `Detected Intent: ${params.intent}`,
        `Workspace: ${params.workspaceId}`,
        `Source used: ${params.sourceUsed}`,
        `Members retrieved: ${
          params.members.length ? params.members.join(', ') : '(none)'
        }`,
      ].join('\n'),
    );
  }

  private async collectSlackChannels(
    workspaceId: string,
    filters: WorkspaceSearchFilters,
    limit: number,
  ): Promise<CollectorResult> {
    const tokens = this.searchTokens(filters);
    const totalInWorkspace = await this.prisma.slackChannel.count({
      where: { workspaceId },
    });

    const tokenOr: Prisma.SlackChannelWhereInput[] = tokens.flatMap(
      (token) => [
        { name: { contains: token, mode: 'insensitive' } },
        { slackChannelId: { contains: token, mode: 'insensitive' } },
        { topic: { contains: token, mode: 'insensitive' } },
        { purpose: { contains: token, mode: 'insensitive' } },
      ],
    );

    const channels = await this.prisma.slackChannel.findMany({
      where: {
        workspaceId,
        isArchived: false,
        ...(tokenOr.length ? { OR: tokenOr } : {}),
      },
      orderBy: { name: 'asc' },
      take: limit,
    });

    const docs = channels.map((channel) =>
      buildDocument({
        workspaceId,
        source: 'slack',
        entity: 'slack_channel',
        entityId: channel.slackChannelId,
        title: `#${channel.name}`,
        content: [
          `Channel: #${channel.name}`,
          `Slack channel id: ${channel.slackChannelId}`,
          channel.topic ? `Topic: ${channel.topic}` : null,
          channel.purpose ? `Purpose: ${channel.purpose}` : null,
          channel.memberCount != null
            ? `Approx members: ${channel.memberCount}`
            : null,
          channel.isPrivate ? 'Visibility: private' : 'Visibility: public',
        ]
          .filter(Boolean)
          .join('\n'),
        timestamp: channel.updatedAt.toISOString(),
        metadata: {
          slackChannelId: channel.slackChannelId,
          name: channel.name,
        },
      }),
    );

    const explanation = explainEmpty({
      found: docs.length,
      totalInWorkspace,
      keyword: filters.keyword,
    });

    return {
      docs,
      diagnostic: {
        sourceKey: 'slack_channels',
        label: 'Slack Channels',
        searched: true,
        found: docs.length,
        totalInWorkspace,
        ...explanation,
      },
    };
  }

  private async collectTeamMemory(
    workspaceId: string,
    filters: WorkspaceSearchFilters,
    limit: number,
  ): Promise<CollectorResult> {
    const tokens = this.searchTokens(filters);
    const indexedAt = this.dateWhere(filters);

    const totalInWorkspace = await this.prisma.teamMemoryDocument.count({
      where: { workspaceId },
    });

    const tokenOr: Prisma.TeamMemoryDocumentWhereInput[] = tokens.flatMap(
      (token) => [
        { title: { contains: token, mode: 'insensitive' } },
        { content: { contains: token, mode: 'insensitive' } },
        { issueKey: { contains: token, mode: 'insensitive' } },
      ],
    );

    const documents = await this.prisma.teamMemoryDocument.findMany({
      where: {
        workspaceId,
        ...(indexedAt ? { indexedAt } : {}),
        ...(filters.issueKey
          ? {
              issueKey: {
                equals: filters.issueKey,
                mode: 'insensitive',
              },
            }
          : tokenOr.length
            ? { OR: tokenOr }
            : {}),
      },
      orderBy: { indexedAt: 'desc' },
      take: limit,
    });

    const docs = documents.map((doc) =>
      buildDocument({
        workspaceId,
        source: 'team_memory',
        entity: 'team_memory',
        entityId: doc.id,
        title: doc.title,
        content: doc.content,
        timestamp: doc.indexedAt.toISOString(),
        metadata: {
          sourceType: doc.sourceType,
          sourceId: doc.sourceId,
          issueKey: doc.issueKey,
          runId: doc.runId,
        },
      }),
    );

    const explanation = explainEmpty({
      found: docs.length,
      totalInWorkspace,
      keyword: filters.keyword,
      issueKey: filters.issueKey,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    });

    return {
      docs,
      diagnostic: {
        sourceKey: 'team_memory',
        label: 'Team Memory',
        searched: true,
        found: docs.length,
        totalInWorkspace,
        ...explanation,
      },
    };
  }

  private async collectJiraAudits(
    workspaceId: string,
    filters: WorkspaceSearchFilters,
    limit: number,
  ): Promise<CollectorResult> {
    const tokens = this.searchTokens(filters);
    const createdAt = this.dateWhere(filters);
    const issueKey = filters.issueKey?.trim().toUpperCase() ?? null;

    const totalInWorkspace = await this.prisma.jiraAuditLog.count({
      where: { workspaceId },
    });

    const tokenOr: Prisma.JiraAuditLogWhereInput[] = tokens.flatMap(
      (token) => [
        { jiraIssueKey: { contains: token, mode: 'insensitive' } },
        { actionType: { contains: token, mode: 'insensitive' } },
        { status: { contains: token, mode: 'insensitive' } },
      ],
    );

    const logs = await this.prisma.jiraAuditLog.findMany({
      where: {
        workspaceId,
        ...(createdAt ? { createdAt } : {}),
        ...(issueKey
          ? {
              jiraIssueKey: {
                equals: issueKey,
                mode: 'insensitive',
              },
            }
          : tokenOr.length
            ? { OR: tokenOr }
            : {}),
      },
      include: {
        user: { select: { slackDisplayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const docs = logs.map((log) =>
      buildDocument({
        workspaceId,
        source: 'jira',
        entity: 'jira_audit',
        entityId: log.id,
        title: `Jira audit — ${log.actionType}${log.jiraIssueKey ? ` · ${log.jiraIssueKey}` : ''}`,
        content: [
          `Action: ${log.actionType}`,
          `Status: ${log.status}`,
          log.jiraIssueKey ? `Issue: ${log.jiraIssueKey}` : null,
          `Actor: ${log.user.slackDisplayName}`,
          log.metadata ? `Metadata: ${JSON.stringify(log.metadata)}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        timestamp: log.createdAt.toISOString(),
        metadata: {
          issueKey: log.jiraIssueKey,
          actionType: log.actionType,
          userName: log.user.slackDisplayName,
        },
      }),
    );

    const explanation = explainEmpty({
      found: docs.length,
      totalInWorkspace,
      keyword: filters.keyword,
      issueKey,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    });

    return {
      docs,
      diagnostic: {
        sourceKey: 'jira_audit',
        label: 'Jira Audit Logs',
        searched: true,
        found: docs.length,
        totalInWorkspace,
        ...explanation,
      },
    };
  }

  private async collectSlackAiChats(
    workspaceId: string,
    filters: WorkspaceSearchFilters,
    limit: number,
  ): Promise<CollectorResult> {
    const tokens = this.searchTokens(filters);
    const createdAt = this.dateWhere(filters);
    const userQ = filters.userQuery?.trim();

    const totalInWorkspace = await this.prisma.slackAiChatLog.count({
      where: { workspaceId },
    });

    const tokenOr: Prisma.SlackAiChatLogWhereInput[] = tokens.flatMap(
      (token) => [
        { question: { contains: token, mode: 'insensitive' } },
        { answer: { contains: token, mode: 'insensitive' } },
        { intent: { contains: token, mode: 'insensitive' } },
      ],
    );

    const chats = await this.prisma.slackAiChatLog.findMany({
      where: {
        workspaceId,
        ...(createdAt ? { createdAt } : {}),
        ...(userQ
          ? {
              user: {
                OR: [
                  {
                    slackDisplayName: {
                      contains: userQ,
                      mode: 'insensitive',
                    },
                  },
                  { slackUserId: { contains: userQ, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
        ...(tokenOr.length ? { OR: tokenOr } : {}),
      },
      include: {
        user: { select: { slackDisplayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const docs = chats.map((chat) =>
      buildDocument({
        workspaceId,
        source: 'ai_history',
        entity: 'ai_chat',
        entityId: chat.id,
        title: `AI chat — ${chat.user.slackDisplayName}`,
        content: [
          `Question: ${chat.question}`,
          `Answer: ${chat.answer}`,
          chat.intent ? `Intent: ${chat.intent}` : null,
          chat.confidence ? `Confidence: ${chat.confidence}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        timestamp: chat.createdAt.toISOString(),
        metadata: {
          userName: chat.user.slackDisplayName,
          conversationId: chat.conversationId,
          intent: chat.intent,
        },
      }),
    );

    const explanation = explainEmpty({
      found: docs.length,
      totalInWorkspace,
      keyword: filters.keyword,
      issueKey: filters.issueKey,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    });

    return {
      docs,
      diagnostic: {
        sourceKey: 'slack_ai_chat',
        label: 'Slack AI Conversations',
        searched: true,
        found: docs.length,
        totalInWorkspace,
        ...explanation,
      },
    };
  }

  /**
   * Prior AI Workspace conversations (AiConversation / AiConversationMessage).
   * Conversation context only — never authoritative for Jira fields.
   * Always filtered by workspaceId (Demo/Real isolation).
   */
  private async collectAiConversations(
    workspaceId: string,
    filters: WorkspaceSearchFilters,
    limit: number,
  ): Promise<CollectorResult> {
    const tokens = this.searchTokens(filters);
    const createdAt = this.dateWhere(filters);
    const issueKey = filters.issueKey?.trim()?.toUpperCase() ?? null;

    const totalInWorkspace = await this.prisma.aiConversation.count({
      where: { workspaceId },
    });

    const tokenOr: Prisma.AiConversationMessageWhereInput[] = tokens.flatMap(
      (token) => [{ content: { contains: token, mode: 'insensitive' } }],
    );
    if (issueKey) {
      tokenOr.push({ content: { contains: issueKey, mode: 'insensitive' } });
    }

    const messages = await this.prisma.aiConversationMessage.findMany({
      where: {
        conversation: { workspaceId },
        ...(createdAt ? { createdAt } : {}),
        ...(tokenOr.length ? { OR: tokenOr } : {}),
      },
      include: {
        conversation: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 20),
    });

    const docs = messages.map((msg) =>
      buildDocument({
        workspaceId,
        source: 'ai_history',
        entity: 'ai_chat',
        entityId: msg.id,
        title: `AI history — ${msg.conversation.title ?? msg.conversation.id.slice(0, 8)}`,
        content: [
          `Role: ${msg.role}`,
          `Content: ${msg.content}`,
          msg.intent ? `Intent: ${msg.intent}` : null,
          'CONTEXT_ONLY: prior conversation — never overwrite Jira fields.',
        ]
          .filter(Boolean)
          .join('\n'),
        timestamp: msg.createdAt.toISOString(),
        metadata: {
          conversationId: msg.conversationId,
          intent: msg.intent,
          role: msg.role,
          issueKey: issueKey ?? undefined,
          contextOnly: true,
        },
      }),
    );

    const explanation = explainEmpty({
      found: docs.length,
      totalInWorkspace,
      keyword: filters.keyword,
      issueKey: filters.issueKey,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    });

    return {
      docs,
      diagnostic: {
        sourceKey: 'ai_conversations',
        label: 'AI Conversation History',
        searched: true,
        found: docs.length,
        totalInWorkspace,
        ...explanation,
      },
    };
  }
}

function isPlaceholderSummary(summary: string | null | undefined): boolean {
  const value = summary?.trim().toLowerCase() ?? '';
  return !value || value === 'untitled issue';
}

function isUsableLiveIssuePayload(
  live:
    | {
        status: string | null;
        summary: string;
        assigneeName?: string | null;
        priority?: string | null;
        reporterName?: string | null;
      }
    | null
    | undefined,
): boolean {
  if (!live) return false;
  const hasRealSummary = !isPlaceholderSummary(live.summary);
  const hasStatus = Boolean(live.status?.trim());
  const hasAssignee = Boolean(live.assigneeName?.trim());
  const hasPriority = Boolean(live.priority?.trim());
  return hasRealSummary || hasStatus || hasAssignee || hasPriority;
}

function pickPreferredField(
  liveValue: string | null | undefined,
  cacheValue: string | null | undefined,
): string | null {
  const live = liveValue?.trim() || null;
  if (live && !isPlaceholderSummary(live)) return live;
  const cache = cacheValue?.trim() || null;
  return cache;
}

function buildSnapshotCacheKey(
  workspaceId: string,
  filters: WorkspaceSearchFilters,
  limit: number,
): string {
  return JSON.stringify({
    workspaceId,
    limit,
    issueKey: filters.issueKey ?? null,
    userQuery: filters.userQuery ?? null,
    keyword: filters.keyword ?? null,
    sprintQuery: filters.sprintQuery ?? null,
    dateFrom: filters.dateFrom?.toISOString?.() ?? null,
    dateTo: filters.dateTo?.toISOString?.() ?? null,
    tokens: filters.searchTokens ?? null,
    selectedSources: filters.selectedSources ?? null,
    slackMembersOnly: filters.slackMembersOnly ?? null,
    jiraMembersOnly: filters.jiraMembersOnly ?? null,
  });
}
