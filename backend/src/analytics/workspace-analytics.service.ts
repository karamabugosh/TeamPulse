import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JiraBlockerService } from '../jira/jira-blocker.service';
import { JiraCacheService } from '../jira/jira-cache.service';
import { WorkspaceMembersService } from '../common/workspace-members.service';
import {
  computeBlockerStats,
  isOpenBlockerStatus,
} from '../jira/blocker-stats.util';
import {
  workspaceBlockerFilter,
  workspaceJiraCacheFilter,
  workspaceRunFilter,
  workspaceSubmissionFilter,
} from '../common/workspace-context';
import {
  AnalyticsTimeRange,
  WorkspaceAnalyticsSnapshot,
} from './workspace-analytics.types';

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function isDoneStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return (
    s.includes('done') ||
    s.includes('closed') ||
    s.includes('resolved') ||
    s.includes('complete')
  );
}

function isInProgressStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return (
    s.includes('progress') ||
    s.includes('review') ||
    s.includes('qa') ||
    s.includes('testing')
  );
}

function isBlockedStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return status.toLowerCase().includes('block');
}

/**
 * Authoritative workspace analytics — single source of truth for Reports,
 * Overview, Dashboard, AI summaries, and Blockers page consistency.
 *
 * Every query filters by workspaceId. Never reads previously generated reports
 * for numeric metrics.
 */
@Injectable()
export class WorkspaceAnalyticsService {
  private readonly logger = new Logger(WorkspaceAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jiraBlockers: JiraBlockerService,
    private readonly jiraCache: JiraCacheService,
    private readonly workspaceMembers: WorkspaceMembersService,
  ) {}

  defaultTimeRange(now = new Date(), days = 7): AnalyticsTimeRange {
    const from = startOfDay(new Date(now));
    from.setDate(from.getDate() - (days - 1));
    return {
      from: from.toISOString(),
      to: endOfDay(now).toISOString(),
      label: `Last ${days} days`,
    };
  }

  /**
   * Refresh JiraIssueCacheEntry from Live Jira when workspace has OAuth.
   */
  async refreshJiraCacheIfConnected(
    workspaceId: string,
  ): Promise<{ attempted: boolean; success: boolean; issuesRefreshed: number }> {
    const connection = await this.prisma.jiraConnection.findFirst({
      where: { workspaceId },
      select: { userId: true },
      orderBy: { connectedAt: 'desc' },
    });

    if (!connection) {
      return { attempted: false, success: false, issuesRefreshed: 0 };
    }

    try {
      const count = await this.jiraCache.refreshUserCache(connection.userId);
      return { attempted: true, success: count > 0, issuesRefreshed: count };
    } catch (error) {
      this.logger.warn(
        `Live Jira refresh failed workspace=${workspaceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { attempted: true, success: false, issuesRefreshed: 0 };
    }
  }

  /**
   * Collect full workspace analytics snapshot — recalculated on every call.
   */
  async collectSnapshot(params: {
    workspaceId: string;
    timeRange?: AnalyticsTimeRange;
    refreshJira?: boolean;
  }): Promise<WorkspaceAnalyticsSnapshot> {
    const started = Date.now();
    const workspaceId = params.workspaceId;
    const timeRange = params.timeRange ?? this.defaultTimeRange();
    const from = new Date(timeRange.from);
    const to = new Date(timeRange.to);
    const queriesExecuted: string[] = [];

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, slackWorkspaceName: true },
    });
    queriesExecuted.push('workspace.findUnique');

    let liveJiraRefresh = {
      attempted: false,
      success: false,
      issuesRefreshed: 0,
    };
    if (params.refreshJira !== false) {
      liveJiraRefresh = await this.refreshJiraCacheIfConnected(workspaceId);
      if (liveJiraRefresh.attempted) {
        queriesExecuted.push('jiraCache.refreshUserCache');
      }
    }

    const members = await this.workspaceMembers.listHumanMembers(workspaceId, {
      bypassCache: true,
    });
    queriesExecuted.push('workspaceMembers.listHumanMembers');

    const participants = await this.prisma.checkInParticipant.findMany({
      where: {
        isActive: true,
        checkIn: { team: { workspaceId }, enabled: true },
        teamMember: { optedOut: false },
      },
      include: {
        teamMember: {
          include: {
            user: { select: { id: true, slackDisplayName: true } },
          },
        },
      },
    });
    queriesExecuted.push('checkInParticipant.findMany');

    const expectedMemberIds = [
      ...new Set(participants.map((p) => p.teamMember.userId)),
    ];

    const submissionScope = workspaceSubmissionFilter(workspaceId);
    const submissions = await this.prisma.standupSubmission.findMany({
      where: {
        ...submissionScope,
        OR: [
          { completedAt: { gte: from, lte: to } },
          { completedAt: null, createdAt: { gte: from, lte: to } },
        ],
      },
      include: {
        user: { select: { id: true, slackDisplayName: true } },
      },
    });
    queriesExecuted.push('standupSubmission.findMany');

    const completedSubmissions = submissions.filter(
      (s) => s.status === 'completed',
    );
    const pendingSubmissions = submissions.filter(
      (s) => s.status === 'pending' || s.status === 'in_progress',
    );
    const missedSubmissions = submissions.filter(
      (s) => s.status !== 'completed',
    );

    const responders = new Set(
      completedSubmissions.map((s) => s.userId),
    );
    const participationRate =
      expectedMemberIds.length > 0
        ? Math.round((responders.size / expectedMemberIds.length) * 1000) / 10
        : null;

    const runsInRange = await this.prisma.standupRun.count({
      where: {
        ...workspaceRunFilter(workspaceId),
        scheduledFor: { gte: from, lte: to },
      },
    });
    queriesExecuted.push('standupRun.count');

    const dailyActivity = await this.buildDailyActivity(
      workspaceId,
      from,
      to,
      queriesExecuted,
    );
    const weeklyTrend = await this.buildWeeklyTrend(
      workspaceId,
      queriesExecuted,
    );

    const dashboardBlockers =
      await this.jiraBlockers.listDashboardBlockersForWorkspace(workspaceId);
    queriesExecuted.push('jiraBlockers.listDashboardBlockersForWorkspace');

    const blockerStats = computeBlockerStats(
      dashboardBlockers.map((b) => ({
        status: b.status,
        priority: b.priority,
        createdAt: b.createdAt,
        resolvedAt: b.resolvedAt,
      })),
    );

    const createdInRange = dashboardBlockers.filter(
      (b) => new Date(b.createdAt) >= from && new Date(b.createdAt) <= to,
    ).length;
    const resolvedInRange = dashboardBlockers.filter(
      (b) =>
        b.resolvedAt &&
        new Date(b.resolvedAt) >= from &&
        new Date(b.resolvedAt) <= to,
    ).length;

    const blockerUpdates = await this.prisma.pulseBlockerUpdate.count({
      where: {
        createdAt: { gte: from, lte: to },
        blocker: workspaceBlockerFilter(workspaceId),
      },
    });
    queriesExecuted.push('pulseBlockerUpdate.count');

    const openBlockers = dashboardBlockers.filter((b) =>
      isOpenBlockerStatus(b.status),
    );

    const byOwner: Record<string, number> = {};
    const byIssue: Record<string, number> = {};
    for (const b of openBlockers) {
      const owner = b.reporter?.trim() || 'Unknown';
      byOwner[owner] = (byOwner[owner] ?? 0) + 1;
      if (b.jiraIssue?.key) {
        const key = b.jiraIssue.key.toUpperCase();
        byIssue[key] = (byIssue[key] ?? 0) + 1;
      }
    }

    const jiraRows = await this.prisma.jiraIssueCacheEntry.findMany({
      where: workspaceJiraCacheFilter(workspaceId),
      orderBy: { refreshedAt: 'desc' },
    });
    queriesExecuted.push('jiraIssueCacheEntry.findMany');

    const byKey = new Map<string, (typeof jiraRows)[number]>();
    for (const row of jiraRows) {
      if (!byKey.has(row.issueKey)) byKey.set(row.issueKey, row);
    }
    const uniqueIssues = [...byKey.values()];

    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    const byAssignee: Record<string, number> = {};
    let openIssues = 0;
    let closedIssues = 0;
    let inProgressIssues = 0;
    let blockedIssues = 0;

    for (const issue of uniqueIssues) {
      const status = issue.status?.trim() || 'Unknown';
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      const priority = issue.priority?.trim() || 'Unset';
      byPriority[priority] = (byPriority[priority] ?? 0) + 1;
      const assignee = issue.assigneeName?.trim() || 'Unassigned';
      byAssignee[assignee] = (byAssignee[assignee] ?? 0) + 1;

      if (isDoneStatus(status)) closedIssues += 1;
      else openIssues += 1;
      if (isInProgressStatus(status)) inProgressIssues += 1;
      if (isBlockedStatus(status)) blockedIssues += 1;
    }

    const issuesUpdatedInRange = uniqueIssues.filter((issue) => {
      const ts = issue.jiraUpdatedAt ?? issue.refreshedAt;
      return ts >= from && ts <= to;
    }).length;

    const completionByMember: Record<
      string,
      { completed: number; total: number; rate: number }
    > = {};
    for (const sub of submissions) {
      const name = sub.user.slackDisplayName?.trim() || 'Unknown';
      if (!completionByMember[name]) {
        completionByMember[name] = { completed: 0, total: 0, rate: 0 };
      }
      completionByMember[name].total += 1;
      if (sub.status === 'completed') completionByMember[name].completed += 1;
    }
    for (const entry of Object.values(completionByMember)) {
      entry.rate =
        entry.total > 0
          ? Math.round((entry.completed / entry.total) * 100)
          : 0;
    }

    const memberRates = Object.entries(completionByMember).sort(
      (a, b) => b[1].rate - a[1].rate || b[1].completed - a[1].completed,
    );
    const mostActiveMember = memberRates[0]?.[0] ?? null;
    const leastActiveMember =
      memberRates.length > 0
        ? memberRates[memberRates.length - 1][0]
        : null;

    const generationMs = Date.now() - started;

    this.logger.log(
      [
        '[WorkspaceAnalytics]',
        `WorkspaceId: ${workspaceId}`,
        `Standups: ${submissions.length} (${completedSubmissions.length} completed)`,
        `Jira Issues: ${uniqueIssues.length}`,
        `Blockers: ${blockerStats.total} (${blockerStats.openBlockers} open)`,
        `Members: ${members.length}`,
        `GenerationMs: ${generationMs}`,
        `Live Jira Refresh: attempted=${liveJiraRefresh.attempted} success=${liveJiraRefresh.success} issues=${liveJiraRefresh.issuesRefreshed}`,
        `Queries: ${queriesExecuted.join(', ')}`,
      ].join(' | '),
    );

    return {
      workspaceId,
      workspaceName: workspace?.slackWorkspaceName ?? 'Workspace',
      generatedAt: new Date().toISOString(),
      generationMs,
      timeRange,
      queriesExecuted,
      liveJiraRefresh,
      members: {
        total: members.length,
        activeParticipants: expectedMemberIds.length,
      },
      standups: {
        totalSubmissions: submissions.length,
        completedSubmissions: completedSubmissions.length,
        pendingSubmissions: pendingSubmissions.length,
        missedSubmissions: missedSubmissions.length,
        participationRate,
        runsInRange,
        dailyActivity,
        weeklyTrend,
      },
      blockers: {
        ...blockerStats,
        createdInRange,
        resolvedInRange,
        updatesInRange: blockerUpdates,
        active: openBlockers.slice(0, 30).map((b) => ({
          title: b.title?.trim() || b.description.slice(0, 80),
          status: b.status,
          severity: b.priority,
          reporter: b.reporter,
          linkedIssueKey: b.jiraIssue?.key ?? null,
        })),
        byOwner,
        byIssue,
      },
      jira: {
        totalIssues: uniqueIssues.length,
        openIssues,
        closedIssues,
        inProgressIssues,
        blockedIssues,
        issuesUpdatedInRange,
        byStatus,
        byPriority,
        byAssignee,
        sampleIssues: uniqueIssues.slice(0, 25).map((issue) => ({
          key: issue.issueKey,
          summary: issue.summary,
          status: issue.status,
          assignee: issue.assigneeName,
          priority: issue.priority,
          updatedAt: (issue.jiraUpdatedAt ?? issue.refreshedAt).toISOString(),
        })),
        fromLiveRefresh: liveJiraRefresh.success,
      },
      team: {
        mostActiveMember,
        leastActiveMember,
        completionByMember,
      },
    };
  }

  /** Blocker stats only — lightweight helper for cross-page consistency checks. */
  async getBlockerStats(workspaceId: string) {
    return this.jiraBlockers.getBlockerStatsForWorkspace(workspaceId);
  }

  private async buildDailyActivity(
    workspaceId: string,
    from: Date,
    to: Date,
    queriesExecuted: string[],
  ) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const submissionScope = workspaceSubmissionFilter(workspaceId);
    const result: WorkspaceAnalyticsSnapshot['standups']['dailyActivity'] = [];

    const cursor = startOfDay(from);
    while (cursor <= to) {
      const dayStart = new Date(cursor);
      const dayEnd = new Date(cursor);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const total = await this.prisma.standupSubmission.count({
        where: {
          createdAt: { gte: dayStart, lt: dayEnd },
          ...submissionScope,
        },
      });
      const completed = await this.prisma.standupSubmission.count({
        where: {
          status: 'completed',
          createdAt: { gte: dayStart, lt: dayEnd },
          ...submissionScope,
        },
      });

      result.push({
        day: days[dayStart.getDay()],
        completed,
        total,
        rate: total > 0 ? Math.round((completed / total) * 100) : 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    queriesExecuted.push('standupSubmission.count(dailyActivity)');
    return result;
  }

  private async buildWeeklyTrend(
    workspaceId: string,
    queriesExecuted: string[],
  ) {
    const submissionScope = workspaceSubmissionFilter(workspaceId);
    const result: WorkspaceAnalyticsSnapshot['standups']['weeklyTrend'] = [];

    for (let w = 3; w >= 0; w--) {
      const weekEnd = endOfDay(new Date());
      weekEnd.setDate(weekEnd.getDate() - w * 7);
      const weekStart = startOfDay(new Date(weekEnd));
      weekStart.setDate(weekStart.getDate() - 6);

      const total = await this.prisma.standupSubmission.count({
        where: {
          createdAt: { gte: weekStart, lte: weekEnd },
          ...submissionScope,
        },
      });
      const completed = await this.prisma.standupSubmission.count({
        where: {
          status: 'completed',
          createdAt: { gte: weekStart, lte: weekEnd },
          ...submissionScope,
        },
      });

      result.push({
        weekLabel: `W-${w === 0 ? 'current' : w}`,
        completed,
        total,
        rate: total > 0 ? Math.round((completed / total) * 100) : 0,
      });
    }

    queriesExecuted.push('standupSubmission.count(weeklyTrend)');
    return result;
  }
}
