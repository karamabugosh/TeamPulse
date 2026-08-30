import { apiFetch } from './api';

export type JiraConnectionStatus = {
  connected: boolean;
  atlassianDisplayName?: string;
  siteName?: string;
  siteUrl?: string;
  lastSyncAt?: string;
  connectedAt?: string;
  projectCount?: number;
  visibleIssueCount?: number;
};

export type JiraHubOverview = {
  connection: JiraConnectionStatus;
  summary: {
    linkedIssues: number;
    openBlockers: number;
  };
};

export type JiraProjectCard = {
  id: string;
  key: string;
  name: string;
  issueCount: number;
  recentIssues: Array<{
    key: string;
    summary: string;
    status: string | null;
    issueUrl: string | null;
  }>;
};

export type LinkedIssueRow = {
  id: string;
  issueKey: string;
  summary: string;
  status: string | null;
  issueUrl: string | null;
  linkedCheckIn: string;
  linkedBy: string;
  linkedAt: string;
  submissionId: string;
  runId: string | null;
};

export type HubBlocker = {
  id: string;
  title: string;
  description?: string;
  reporter: string;
  reporterUserId?: string;
  linkedIssueKey: string | null;
  linkedIssueUrl: string | null;
  linkedIssueSummary: string | null;
  linkedIssueStatus: string | null;
  createdAt: string;
  status: string;
  owner: string | null;
  severity: string;
  category?: string | null;
  expectedResolution?: string | null;
  dependency?: string | null;
  teamId?: string | null;
  runId?: string | null;
  submissionId?: string | null;
};

export type JiraAnalytics = {
  kpis: {
    projects: number;
    linkedIssues: number;
    openIssues: number;
    doneIssues: number;
    blockedIssues: number;
  };
  statusDistribution: Array<{ name: string; value: number; key: string }>;
};

export type LinkedStandupIssue = {
  issueKey: string;
  summary: string;
  status: string | null;
  issueUrl: string | null;
  timeline: Array<{
    date: string;
    checkInName: string;
    participant: string;
    update: string;
    submissionId: string;
    runId: string | null;
  }>;
};

export type AiInsight = {
  type: string;
  title: string;
  issueKey: string | null;
  summary: string;
  metric: string;
};

export type TeamMemoryResult = {
  id: string;
  sourceType: string;
  title: string;
  excerpt: string;
  issueKey: string | null;
  runId: string | null;
  submissionId: string | null;
  indexedAt: string;
};

export type StandupHistoryFilterOption = {
  value: string;
  label: string;
};

export type StandupHistoryRecordDto = {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string | null;
  userInitials: string;
  date: string;
  standupName: string;
  checkInId: string | null;
  yesterdayAnswer: string;
  todayAnswer: string;
  blockersAnswer: string;
  linkedJiraIssue: {
    key: string;
    summary: string;
    url: string;
  } | null;
  linkedIssueKeys: string[];
  slackThreadUrl: string | null;
  runId: string;
  submissionId: string;
  hasBlocker: boolean;
  reportGeneratedAt: string | null;
  reportSummary: string | null;
  issueLinkedAt: string | null;
};

export type StandupHistoryResponse = {
  records: StandupHistoryRecordDto[];
  total: number;
  filters: {
    users: StandupHistoryFilterOption[];
    standups: StandupHistoryFilterOption[];
    issues: StandupHistoryFilterOption[];
  };
};

export type JiraIssueSummary = {
  id: string;
  key: string;
  summary: string;
  status: string | null;
  issueType: string | null;
  assignee: string | null;
  assigneeAccountId?: string | null;
  projectKey: string | null;
  projectName: string | null;
  priority: string | null;
  updatedAt: string | null;
  issueUrl: string | null;
};

export type JiraActivityType =
  | 'Status Changed'
  | 'Assigned'
  | 'Created'
  | 'Resolved'
  | 'Reopened'
  | 'Priority Changed'
  | 'Comment Added'
  | 'Label Added'
  | 'Sprint Changed';

export type JiraActivityItem = {
  id: string;
  issueKey: string;
  summary: string;
  activityType: JiraActivityType;
  previousValue: string | null;
  newValue: string | null;
  author: string | null;
  occurredAt: string;
  projectKey: string | null;
  projectName: string | null;
  issueUrl: string | null;
};

export type JiraActivityFeed = {
  available: boolean;
  message: string | null;
  activities: JiraActivityItem[];
  total: number;
  fetchedIssueCount: number;
};

export const jiraApi = {
  getOverview: () => apiFetch<JiraHubOverview>('/api/jira/hub/overview'),
  getProjects: () =>
    apiFetch<{ projects: JiraProjectCard[] }>('/api/jira/hub/projects'),
  getBlockers: () => apiFetch<HubBlocker[]>('/api/jira/hub/blockers'),
  getAnalytics: () => apiFetch<JiraAnalytics>('/api/jira/hub/analytics'),
  getActivity: (params?: {
    days?: number;
    limit?: number;
    maxIssues?: number;
  }) => {
    const search = new URLSearchParams();
    if (params?.days != null) search.set('days', String(params.days));
    if (params?.limit != null) search.set('limit', String(params.limit));
    if (params?.maxIssues != null) {
      search.set('maxIssues', String(params.maxIssues));
    }
    const query = search.toString();
    return apiFetch<JiraActivityFeed>(
      `/api/jira/hub/activity${query ? `?${query}` : ''}`,
    );
  },
  getLinkedStandups: (issueKey?: string) =>
    apiFetch<{ issues: LinkedStandupIssue[] }>(
      issueKey
        ? `/api/jira/hub/linked-standups?issueKey=${encodeURIComponent(issueKey)}`
        : '/api/jira/hub/linked-standups',
    ),
  getStandupHistory: (params?: {
    search?: string;
    userId?: string;
    checkInId?: string;
    issueKey?: string;
    preset?: string;
    from?: string;
    to?: string;
    limit?: number;
  }) => {
    const search = new URLSearchParams();
    if (params?.search) search.set('search', params.search);
    if (params?.userId && params.userId !== 'all') search.set('userId', params.userId);
    if (params?.checkInId && params.checkInId !== 'all') {
      search.set('checkInId', params.checkInId);
    }
    if (params?.issueKey && params.issueKey !== 'all') {
      search.set('issueKey', params.issueKey);
    }
    if (params?.preset) search.set('preset', params.preset);
    if (params?.from) search.set('from', params.from);
    if (params?.to) search.set('to', params.to);
    if (params?.limit != null) search.set('limit', String(params.limit));
    const query = search.toString();
    return apiFetch<StandupHistoryResponse>(
      `/api/jira/hub/standup-history${query ? `?${query}` : ''}`,
    );
  },
  getWorkspaceTimeline: (params?: {
    workspaceId?: string;
    userId?: string;
    eventType?: string;
    issueKey?: string;
    from?: string;
    to?: string;
    limit?: number;
  }) => {
    const search = new URLSearchParams();
    if (params?.workspaceId) search.set('workspaceId', params.workspaceId);
    if (params?.userId && params.userId !== 'all') search.set('userId', params.userId);
    if (params?.eventType && params.eventType !== 'all') {
      search.set('eventType', params.eventType);
    }
    if (params?.issueKey && params.issueKey !== 'all') {
      search.set('issueKey', params.issueKey);
    }
    if (params?.from) search.set('from', params.from);
    if (params?.to) search.set('to', params.to);
    if (params?.limit != null) search.set('limit', String(params.limit));
    const query = search.toString();
    return apiFetch<{
      workspaceId: string;
      workspaceName: string;
      events: Array<{
        id: string;
        workspaceId: string;
        workspaceName?: string;
        type: string;
        timestamp: string;
        userName: string;
        userId: string | null;
        eventType: string;
        description: string;
        jiraIssueKey: string | null;
        jiraIssueUrl: string | null;
        href: string | null;
        related: Record<string, string | null | undefined>;
      }>;
      filters: {
        users: StandupHistoryFilterOption[];
        eventTypes: StandupHistoryFilterOption[];
        issues: StandupHistoryFilterOption[];
      };
    }>(`/api/jira/hub/timeline${query ? `?${query}` : ''}`);
  },
  getInsights: () =>
    apiFetch<{ insights: AiInsight[] }>('/api/jira/hub/insights'),
  searchMemory: (query: string) =>
    apiFetch<{ results: TeamMemoryResult[] }>(
      `/api/jira/hub/memory/search?q=${encodeURIComponent(query)}`,
    ),
  getStatus: () => apiFetch<JiraConnectionStatus>('/api/auth/jira/status'),
  getIssues: (maxResults = 100, refresh = false) =>
    apiFetch<{
      total: number;
      issues: JiraIssueSummary[];
      fromCache?: boolean;
      error?: string | null;
    }>(
      `/api/jira/issues?maxResults=${maxResults}${refresh ? '&refresh=true' : ''}`,
    ),
  getPickerIssues: (params?: {
    q?: string;
    maxResults?: number;
    refresh?: boolean;
  }) => {
    const search = new URLSearchParams();
    if (params?.q) search.set('q', params.q);
    search.set('maxResults', String(params?.maxResults ?? 50));
    if (params?.refresh) search.set('refresh', 'true');
    const query = search.toString();
    return apiFetch<{
      total: number;
      issues: JiraIssueSummary[];
      fromCache?: boolean;
      error?: string | null;
    }>(`/api/jira/issues/picker${query ? `?${query}` : ''}`);
  },
  searchIssues: (query: string, maxResults = 20, refresh = false) =>
    apiFetch<{
      total: number;
      issues: JiraIssueSummary[];
      error?: string | null;
    }>(
      `/api/jira/issues/search?q=${encodeURIComponent(query)}&maxResults=${maxResults}${
        refresh ? '&refresh=true' : ''
      }`,
    ),
  sync: () => apiFetch('/api/jira/sync', { method: 'POST' }),
  disconnect: () => apiFetch('/api/auth/jira', { method: 'DELETE' }),
};
