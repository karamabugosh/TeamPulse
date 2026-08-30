import { WorkspaceBlockerStats } from '../jira/blocker-stats.util';

export type AnalyticsTimeRange = {
  from: string;
  to: string;
  label: string;
};

export type WorkspaceAnalyticsSnapshot = {
  workspaceId: string;
  workspaceName: string;
  generatedAt: string;
  generationMs: number;
  timeRange: AnalyticsTimeRange;
  queriesExecuted: string[];
  liveJiraRefresh: {
    attempted: boolean;
    success: boolean;
    issuesRefreshed: number;
  };
  members: {
    total: number;
    activeParticipants: number;
  };
  standups: {
    totalSubmissions: number;
    completedSubmissions: number;
    pendingSubmissions: number;
    missedSubmissions: number;
    participationRate: number | null;
    runsInRange: number;
    dailyActivity: Array<{
      day: string;
      completed: number;
      total: number;
      rate: number;
    }>;
    weeklyTrend: Array<{
      weekLabel: string;
      completed: number;
      total: number;
      rate: number;
    }>;
  };
  blockers: WorkspaceBlockerStats & {
    createdInRange: number;
    resolvedInRange: number;
    updatesInRange: number;
    active: Array<{
      title: string;
      status: string;
      severity: string;
      reporter: string;
      linkedIssueKey: string | null;
    }>;
    byOwner: Record<string, number>;
    byIssue: Record<string, number>;
  };
  jira: {
    totalIssues: number;
    openIssues: number;
    closedIssues: number;
    inProgressIssues: number;
    blockedIssues: number;
    issuesUpdatedInRange: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    byAssignee: Record<string, number>;
    sampleIssues: Array<{
      key: string;
      summary: string;
      status: string | null;
      assignee: string | null;
      priority: string | null;
      updatedAt: string | null;
    }>;
    fromLiveRefresh: boolean;
  };
  team: {
    mostActiveMember: string | null;
    leastActiveMember: string | null;
    completionByMember: Record<string, { completed: number; total: number; rate: number }>;
  };
};
