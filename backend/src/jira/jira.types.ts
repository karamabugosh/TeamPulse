export type JiraConnectionStatus = {
  connected: boolean;
  atlassianDisplayName?: string;
  siteName?: string;
  siteUrl?: string;
  lastSyncAt?: string;
  connectedAt?: string;
  tokenExpiresAt?: string | null;
  syncStatus?: 'never' | 'success' | 'failed';
  syncError?: string | null;
};

export type JiraWorkspaceMember = {
  accountId: string;
  displayName: string;
  emailAddress?: string | null;
  avatarUrl?: string | null;
  active: boolean;
  accountType?: string | null;
};

export type JiraUserSummary = {
  accountId: string;
  displayName: string;
  emailAddress?: string | null;
  active?: boolean;
};

export type JiraProjectSummary = {
  id: string;
  key: string;
  name: string;
  projectTypeKey?: string | null;
  simplified?: boolean;
  style?: string | null;
};

export type JiraIssueSummary = {
  id: string;
  key: string;
  summary: string;
  status: string | null;
  issueType: string | null;
  assignee: string | null;
  assigneeAccountId?: string | null;
  reporter?: string | null;
  projectKey: string | null;
  projectName: string | null;
  priority: string | null;
  updatedAt: string | null;
  issueUrl: string | null;
  labels?: string[];
  components?: string[];
  dueDate?: string | null;
  resolution?: string | null;
  sprint?: string | null;
};

export type JiraSyncResult = {
  synced: true;
  lastSyncAt: string;
  checked: {
    user: boolean;
    projects: number;
    myIssues: number;
  };
};

export type AtlassianTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

export type AtlassianAccessibleResource = {
  id: string;
  url: string;
  name: string;
  scopes: string[];
  avatarUrl?: string;
};

export type AtlassianUserProfile = {
  accountId: string;
  displayName: string;
  emailAddress?: string;
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
