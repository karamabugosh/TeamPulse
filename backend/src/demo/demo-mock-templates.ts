/**
 * Name-free mock templates for Demo Workspace generation.
 * Assignees / owners are bound at runtime to real Jira workspace members.
 */

export type DemoIssueStatus =
  | 'To Do'
  | 'In Progress'
  | 'Blocked'
  | 'Done'
  | 'In Review';

export type DemoIssueTemplate = {
  key: string;
  summary: string;
  status: DemoIssueStatus;
  issueType: string;
  priority: string;
  /** Stable slot → mapped to members[slot % members.length] */
  assigneeSlot: number;
};

export type DemoBlockerTemplate = {
  ownerSlot: number;
  title: string;
  descriptionTemplate: string;
  category: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'resolved' | 'monitoring';
  linkedIssueKey: string;
  dayOffset: number;
  resolveDayOffset?: number;
  withUpdate?: boolean;
  resolvedBySlot?: number;
};

/** Rotating role labels (not people). First member becomes Tech Lead. */
export const DEMO_ROLE_CYCLE = [
  'Tech Lead',
  'Frontend Engineer',
  'Backend Engineer',
  'Full Stack Engineer',
  'QA Engineer',
  'DevOps Engineer',
  'UI/UX Designer',
] as const;

export const DEMO_ISSUE_TEMPLATES: DemoIssueTemplate[] = [
  { key: 'SCRUM-1', summary: 'Implement standup response aggregation API', status: 'Done', issueType: 'Story', priority: 'High', assigneeSlot: 2 },
  { key: 'SCRUM-2', summary: 'Redesign dashboard KPI cards', status: 'Done', issueType: 'Story', priority: 'Medium', assigneeSlot: 1 },
  { key: 'SCRUM-3', summary: 'Add Slack reminder retry backoff', status: 'Done', issueType: 'Task', priority: 'Medium', assigneeSlot: 5 },
  { key: 'SCRUM-4', summary: 'Write QA checklist for check-in flows', status: 'Done', issueType: 'Task', priority: 'Low', assigneeSlot: 4 },
  { key: 'SCRUM-5', summary: 'Design sprint goal board visuals', status: 'Done', issueType: 'Story', priority: 'High', assigneeSlot: 6 },
  { key: 'SCRUM-6', summary: 'Migrate digest storage to AiDigest schema', status: 'Done', issueType: 'Story', priority: 'High', assigneeSlot: 2 },
  { key: 'SCRUM-7', summary: 'Polish AI Workspace empty state', status: 'Done', issueType: 'Task', priority: 'Low', assigneeSlot: 1 },
  { key: 'SCRUM-8', summary: 'Ship Atlassian OAuth consent + marketplace copy', status: 'In Review', issueType: 'Story', priority: 'High', assigneeSlot: 1 },
  { key: 'SCRUM-9', summary: 'Fix timezone drift in report cron', status: 'Done', issueType: 'Bug', priority: 'High', assigneeSlot: 3 },
  { key: 'SCRUM-10', summary: 'Add health check for Slack socket mode', status: 'Done', issueType: 'Task', priority: 'Medium', assigneeSlot: 5 },
  { key: 'SCRUM-11', summary: 'Build blocker dashboard filters', status: 'In Progress', issueType: 'Story', priority: 'High', assigneeSlot: 1 },
  { key: 'SCRUM-12', summary: 'Stabilize Jira OAuth token refresh', status: 'Blocked', issueType: 'Bug', priority: 'Critical', assigneeSlot: 2 },
  { key: 'SCRUM-13', summary: 'Implement RAG citation ranking', status: 'In Progress', issueType: 'Story', priority: 'High', assigneeSlot: 2 },
  { key: 'SCRUM-14', summary: 'Add participant profile section to reports', status: 'In Progress', issueType: 'Story', priority: 'Medium', assigneeSlot: 3 },
  { key: 'SCRUM-15', summary: 'Automate staging deploy pipeline', status: 'In Progress', issueType: 'Story', priority: 'High', assigneeSlot: 5 },
  { key: 'SCRUM-16', summary: 'Regression suite for standup DM flow', status: 'In Progress', issueType: 'Task', priority: 'Medium', assigneeSlot: 4 },
  { key: 'SCRUM-17', summary: 'Prioritize AI Workspace prompts backlog', status: 'In Progress', issueType: 'Task', priority: 'Medium', assigneeSlot: 6 },
  { key: 'SCRUM-18', summary: 'Cache Jira issue search results', status: 'In Progress', issueType: 'Story', priority: 'Medium', assigneeSlot: 2 },
  { key: 'SCRUM-19', summary: 'Improve TopNav workspace switcher UX', status: 'In Progress', issueType: 'Task', priority: 'Low', assigneeSlot: 1 },
  { key: 'SCRUM-20', summary: 'Investigate Slack rate limit spikes', status: 'Blocked', issueType: 'Bug', priority: 'High', assigneeSlot: 5 },
  { key: 'SCRUM-21', summary: 'Design weekly digest email template', status: 'To Do', issueType: 'Story', priority: 'Medium', assigneeSlot: 6 },
  { key: 'SCRUM-22', summary: 'Add multi-workspace admin scoping', status: 'To Do', issueType: 'Story', priority: 'High', assigneeSlot: 0 },
  { key: 'SCRUM-23', summary: 'Support SCALE_1_5 in analytics charts', status: 'To Do', issueType: 'Task', priority: 'Medium', assigneeSlot: 3 },
  { key: 'SCRUM-24', summary: 'Write load test for collection service', status: 'To Do', issueType: 'Task', priority: 'Low', assigneeSlot: 4 },
  { key: 'SCRUM-25', summary: 'Encrypt bot tokens at rest', status: 'To Do', issueType: 'Story', priority: 'Critical', assigneeSlot: 5 },
  { key: 'SCRUM-26', summary: 'Ship team memory search UI', status: 'To Do', issueType: 'Story', priority: 'High', assigneeSlot: 1 },
  { key: 'SCRUM-27', summary: 'Handle deleted Slack users in sync', status: 'To Do', issueType: 'Bug', priority: 'Medium', assigneeSlot: 2 },
  { key: 'SCRUM-28', summary: 'Add sprint burndown widget', status: 'To Do', issueType: 'Story', priority: 'Medium', assigneeSlot: 3 },
  { key: 'SCRUM-29', summary: 'Clarify blocker severity taxonomy', status: 'To Do', issueType: 'Task', priority: 'Low', assigneeSlot: 6 },
  { key: 'SCRUM-30', summary: 'Upgrade Prisma to latest 5.x', status: 'To Do', issueType: 'Task', priority: 'Low', assigneeSlot: 0 },
  { key: 'SCRUM-31', summary: 'Fix flaky e2e on reminder path', status: 'Blocked', issueType: 'Bug', priority: 'High', assigneeSlot: 4 },
  { key: 'SCRUM-32', summary: 'Resolve Postgres connection pool exhaustion', status: 'Blocked', issueType: 'Bug', priority: 'Critical', assigneeSlot: 5 },
  { key: 'SCRUM-33', summary: 'Unblock Atlassian app review feedback', status: 'Blocked', issueType: 'Task', priority: 'High', assigneeSlot: 0 },
  { key: 'SCRUM-34', summary: 'Ship dark-theme accessibility pass', status: 'Done', issueType: 'Task', priority: 'Medium', assigneeSlot: 6 },
  { key: 'SCRUM-35', summary: 'Index team memory by issue key', status: 'In Progress', issueType: 'Story', priority: 'High', assigneeSlot: 2 },
  { key: 'SCRUM-36', summary: 'Add CSV export for blocker register', status: 'To Do', issueType: 'Task', priority: 'Medium', assigneeSlot: 3 },
  { key: 'SCRUM-37', summary: 'Document RAG grounding guarantees', status: 'Done', issueType: 'Task', priority: 'Medium', assigneeSlot: 6 },
  { key: 'SCRUM-38', summary: 'Optimize standup thread reply posting', status: 'In Progress', issueType: 'Task', priority: 'Low', assigneeSlot: 5 },
  { key: 'SCRUM-39', summary: 'Create smoke tests for AI chat citations', status: 'To Do', issueType: 'Task', priority: 'High', assigneeSlot: 4 },
  { key: 'SCRUM-40', summary: 'Plan cross-team demo day agenda', status: 'To Do', issueType: 'Story', priority: 'Low', assigneeSlot: 6 },
];

export const DEMO_BLOCKER_TEMPLATES: DemoBlockerTemplate[] = [
  {
    ownerSlot: 1,
    title: 'OAuth callback not working in staging',
    descriptionTemplate:
      '{owner} is blocked waiting for OAuth callback. SCRUM-8 consent UI is ready but backend refresh (SCRUM-12) returns 401 after credential rotation.',
    category: 'integration',
    severity: 'critical',
    status: 'resolved',
    linkedIssueKey: 'SCRUM-8',
    dayOffset: 16,
    resolveDayOffset: 9,
    withUpdate: true,
    resolvedBySlot: 2,
  },
  {
    ownerSlot: 1,
    title: 'SCRUM-8 delayed by OAuth marketplace review',
    descriptionTemplate:
      'Atlassian marketplace rejected consent-screen wording. {owner} revised copy; legal sign-off on SCRUM-33 still pending.',
    category: 'process',
    severity: 'high',
    status: 'monitoring',
    linkedIssueKey: 'SCRUM-8',
    dayOffset: 14,
    withUpdate: true,
  },
  {
    ownerSlot: 2,
    title: 'OAuth token refresh returning 401',
    descriptionTemplate:
      '{owner} owns SCRUM-12. Credential rotation broke refresh tokens used by the consent flow.',
    category: 'backend',
    severity: 'critical',
    status: 'open',
    linkedIssueKey: 'SCRUM-12',
    dayOffset: 15,
    withUpdate: true,
  },
  {
    ownerSlot: 5,
    title: 'Slack rate limit spikes during reminders',
    descriptionTemplate:
      '{owner} investigating SCRUM-20 — bursty reminder fan-out trips Slack rate limits.',
    category: 'infrastructure',
    severity: 'high',
    status: 'open',
    linkedIssueKey: 'SCRUM-20',
    dayOffset: 10,
    withUpdate: true,
  },
  {
    ownerSlot: 5,
    title: 'Postgres pool exhaustion on report generation',
    descriptionTemplate:
      'AiDigest generation opens too many connections when digests land together (SCRUM-32). Owner: {owner}.',
    category: 'infrastructure',
    severity: 'critical',
    status: 'open',
    linkedIssueKey: 'SCRUM-32',
    dayOffset: 2,
    withUpdate: true,
  },
  {
    ownerSlot: 4,
    title: 'Flaky e2e on reminder path',
    descriptionTemplate:
      'CI fails ~30% on reminder scheduling assertion (SCRUM-31). Owner: {owner}.',
    category: 'qa',
    severity: 'high',
    status: 'open',
    linkedIssueKey: 'SCRUM-31',
    dayOffset: 7,
    withUpdate: true,
  },
  {
    ownerSlot: 0,
    title: 'Atlassian app review feedback unresolved',
    descriptionTemplate:
      'Marketplace review asked for clearer OAuth scopes copy. Waiting on legal wording (SCRUM-33). Owner: {owner}.',
    category: 'process',
    severity: 'high',
    status: 'open',
    linkedIssueKey: 'SCRUM-33',
    dayOffset: 12,
    withUpdate: true,
  },
  {
    ownerSlot: 3,
    title: 'Report timezone drift in cron',
    descriptionTemplate:
      '{owner} fixed SCRUM-9 earlier; monitoring residual DST edge cases.',
    category: 'reporting',
    severity: 'medium',
    status: 'resolved',
    linkedIssueKey: 'SCRUM-9',
    dayOffset: 20,
    resolveDayOffset: 11,
    withUpdate: true,
    resolvedBySlot: 3,
  },
  {
    ownerSlot: 1,
    title: 'Blocker dashboard filters incomplete',
    descriptionTemplate:
      '{owner} still wiring filter chips for SCRUM-11.',
    category: 'frontend',
    severity: 'medium',
    status: 'open',
    linkedIssueKey: 'SCRUM-11',
    dayOffset: 5,
    withUpdate: true,
  },
  {
    ownerSlot: 6,
    title: 'Digest email template blocked on brand tokens',
    descriptionTemplate:
      '{owner} waiting on brand tokens for SCRUM-21 weekly digest template.',
    category: 'design',
    severity: 'low',
    status: 'open',
    linkedIssueKey: 'SCRUM-21',
    dayOffset: 4,
    withUpdate: false,
  },
];

export const THREAD_DISCUSSION_SNIPPETS = [
  'Can we confirm OAuth callback ownership before Review?',
  'Sprint checkpoint — call out open blockers in digests.',
  'Citation ranking looks better after the recency boost.',
  'Reminder backoff helped overnight; watching rate limits.',
  'Need a fixture list for ISSUE_REF QA tomorrow.',
  'Executive brief should highlight the OAuth critical path.',
];

export const YESTERDAY_SNIPPETS = [
  'Pushed progress on {issue} — {summary}',
  'Reviewed PR feedback for {issue}',
  'Paired on {issue} acceptance criteria',
  'Unblocked a dependency related to {issue}',
  'Updated docs / notes for {issue}',
];

export const TODAY_SNIPPETS = [
  'Continue {issue} toward {status}',
  'Ship remaining work on {issue}',
  'Follow up on blockers for {issue}',
  'Prepare review notes for {issue}',
  'Sync with teammates on {issue}',
];

export function fillTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

export function demoIssueStoryPoints(key: string): number {
  if (key === 'SCRUM-8') return 8;
  if (key === 'SCRUM-12') return 5;
  if (key === 'SCRUM-11') return 5;
  const n = Number(key.replace(/\D/g, '')) || 1;
  return (n % 5) + 1;
}

export function demoIssueSprint(status: string, key: string): string {
  const n = Number(key.replace(/\D/g, '')) || 1;
  if (status === 'To Do' && n > 25) return 'Sprint 15';
  return 'Sprint 14';
}

export function demoIssueLabels(status: string): string[] {
  if (status === 'Blocked') return ['blocked', 'risk'];
  if (status === 'Done') return ['shipped'];
  if (status === 'In Review') return ['review', 'oauth'];
  return ['active'];
}
