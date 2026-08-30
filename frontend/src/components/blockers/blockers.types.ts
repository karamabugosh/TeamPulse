/** Real blocker DTO from GET /api/blockers — never fabricate fields. */
export type BlockerPriority = 'critical' | 'high' | 'medium' | 'low';

export type BlockerStatus =
  | 'open'
  | 'investigating'
  | 'in_progress'
  | 'waiting'
  | 'resolved'
  | 'closed';

export type BlockerJiraIssue = {
  key: string;
  summary: string | null;
  status: string | null;
  assignee: string | null;
  url: string | null;
};

export type BlockerSlackContext = {
  question: string | null;
  answer: string | null;
  timestamp: string | null;
  slackUser: string | null;
  threadUrl: string | null;
};

export type BlockerUpdate = {
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
};

/**
 * Reserved for future OpenAI integration.
 * Backend returns nulls today — UI must not invent values.
 */
export type BlockerAiPlaceholders = {
  aiSummary: string | null;
  aiRootCause: string | null;
  aiRecommendation: string | null;
  aiPriority: string | null;
};

export type DashboardBlocker = BlockerAiPlaceholders & {
  id: string;
  title: string;
  description: string;
  reporter: string;
  reporterUserId: string;
  slackUserId: string;
  slackDisplayName: string;
  slackAvatarUrl: string | null;
  createdAt: string;
  /** ISO timestamp when resolved; null if not resolved. */
  resolvedAt?: string | null;
  status: string;
  statusLabel: string;
  priority: string;
  category: string | null;
  expectedResolution: string | null;
  preventingAllWork: boolean;
  ownerLabel: string | null;
  standupName: string | null;
  checkInId: string | null;
  teamId: string | null;
  runId: string | null;
  submissionId: string | null;
  answerId: string | null;
  slackThreadUrl: string | null;
  jiraIssue: BlockerJiraIssue | null;
  slackContext: BlockerSlackContext;
  updates: BlockerUpdate[];
};

export type BlockerStats = {
  openBlockers: number;
  critical: number;
  waitingMoreThan3Days: number;
  resolvedThisWeek: number;
};

export function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function normalizePriority(priority: string): BlockerPriority {
  const normalized = priority.trim().toLowerCase();
  if (normalized === 'critical') return 'critical';
  if (normalized === 'high') return 'high';
  if (normalized === 'medium') return 'medium';
  return 'low';
}

export function normalizeBlockerStatus(status: string): string {
  return status.trim().toLowerCase().replace(/\s+/g, '_');
}

/** Still open = not Resolved and not Closed. */
export function isOpenBlockerStatus(status: string): boolean {
  const normalized = normalizeBlockerStatus(status);
  return normalized !== 'resolved' && normalized !== 'closed';
}

function startOfCurrentWeek(now = new Date()): Date {
  const start = new Date(now);
  const day = start.getDay(); // 0 = Sunday
  const daysFromMonday = day === 0 ? 6 : day - 1;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - daysFromMonday);
  return start;
}

/**
 * Stats are derived ONLY from the same blocker collection rendered in the list.
 * Never use a separate cache, mock data, or hardcoded counters.
 */
export function computeBlockerStats(blockers: DashboardBlocker[]): BlockerStats {
  const now = Date.now();
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  const weekStart = startOfCurrentWeek(new Date(now)).getTime();

  const open = blockers.filter((b) => isOpenBlockerStatus(b.status));

  const critical = open.filter(
    (b) => normalizePriority(b.priority) === 'critical',
  );

  const waitingMoreThan3Days = open.filter((b) => {
    const createdAt = new Date(b.createdAt).getTime();
    if (Number.isNaN(createdAt)) return false;
    return now - createdAt > threeDaysMs;
  });

  const resolvedThisWeek = blockers.filter((b) => {
    if (normalizeBlockerStatus(b.status) !== 'resolved') return false;
    if (!b.resolvedAt) return false;
    const resolvedAt = new Date(b.resolvedAt).getTime();
    if (Number.isNaN(resolvedAt)) return false;
    return resolvedAt >= weekStart && resolvedAt <= now;
  });

  return {
    openBlockers: open.length,
    critical: critical.length,
    waitingMoreThan3Days: waitingMoreThan3Days.length,
    resolvedThisWeek: resolvedThisWeek.length,
  };
}

/** Keep first occurrence of each blocker id. */
export function dedupeBlockersById(blockers: DashboardBlocker[]): DashboardBlocker[] {
  const seen = new Set<string>();
  const unique: DashboardBlocker[] = [];
  for (const blocker of blockers) {
    if (!blocker?.id || seen.has(blocker.id)) continue;
    seen.add(blocker.id);
    unique.push(blocker);
  }
  return unique;
}
