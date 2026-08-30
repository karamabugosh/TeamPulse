/**
 * Canonical blocker open/priority/stats rules — same semantics as the Blockers page
 * (`frontend/.../blockers.types.ts` computeBlockerStats / isOpenBlockerStatus).
 *
 * AI and GET /api/blockers/stats MUST use these helpers so counts never diverge.
 */

export type BlockerStatsInput = {
  status: string;
  /** UI "priority" — sourced from PulseBlocker.severity */
  priority: string;
  createdAt: string | Date;
  resolvedAt?: string | Date | null;
};

export type WorkspaceBlockerStats = {
  openBlockers: number;
  critical: number;
  waitingMoreThan3Days: number;
  resolvedThisWeek: number;
  /** All blockers in the workspace collection (same as Blockers page unfiltered list). */
  total: number;
  resolved: number;
};

export function normalizeBlockerStatus(status: string): string {
  const raw = status.trim().toLowerCase().replace(/\s+/g, '_');
  if (raw === 'inprogress') return 'in_progress';
  return raw;
}

export function normalizeBlockerPriority(priority: string): string {
  const normalized = priority.trim().toLowerCase();
  if (
    normalized === 'critical' ||
    normalized === 'high' ||
    normalized === 'medium' ||
    normalized === 'low'
  ) {
    return normalized;
  }
  return 'medium';
}

/** Still open = not Resolved and not Closed (matches Blockers page). */
export function isOpenBlockerStatus(status: string): boolean {
  const normalized = normalizeBlockerStatus(status);
  return normalized !== 'resolved' && normalized !== 'closed';
}

export function startOfCurrentWeek(now = new Date()): Date {
  const start = new Date(now);
  const day = start.getDay(); // 0 = Sunday
  const daysFromMonday = day === 0 ? 6 : day - 1;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - daysFromMonday);
  return start;
}

/**
 * Stats derived ONLY from the blocker collection (same rules as Blockers page cards).
 */
export function computeBlockerStats(
  blockers: BlockerStatsInput[],
  nowMs = Date.now(),
): WorkspaceBlockerStats {
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  const weekStart = startOfCurrentWeek(new Date(nowMs)).getTime();

  const open = blockers.filter((b) => isOpenBlockerStatus(b.status));

  const critical = open.filter(
    (b) => normalizeBlockerPriority(b.priority) === 'critical',
  );

  const waitingMoreThan3Days = open.filter((b) => {
    const createdAt = new Date(b.createdAt).getTime();
    if (Number.isNaN(createdAt)) return false;
    return nowMs - createdAt > threeDaysMs;
  });

  const resolvedThisWeek = blockers.filter((b) => {
    if (normalizeBlockerStatus(b.status) !== 'resolved') return false;
    if (!b.resolvedAt) return false;
    const resolvedAt = new Date(b.resolvedAt).getTime();
    if (Number.isNaN(resolvedAt)) return false;
    return resolvedAt >= weekStart && resolvedAt <= nowMs;
  });

  const resolved = blockers.filter(
    (b) => normalizeBlockerStatus(b.status) === 'resolved',
  ).length;

  return {
    openBlockers: open.length,
    critical: critical.length,
    waitingMoreThan3Days: waitingMoreThan3Days.length,
    resolvedThisWeek: resolvedThisWeek.length,
    total: blockers.length,
    resolved,
  };
}

/** Detect count/list/summary blocker questions that must use the full dashboard set. */
export function isBlockerCountOrListQuestion(question: string): boolean {
  const lower = question.trim().toLowerCase();
  return (
    /\bhow many\b.*\bblockers?\b/.test(lower) ||
    /\bblockers?\b.*\bhow many\b/.test(lower) ||
    /\b(open|current|all)\s+blockers?\b/.test(lower) ||
    /\blist\s+(all\s+)?(open\s+)?blockers?\b/.test(lower) ||
    /\bblocker\s+summary\b/.test(lower) ||
    /\bsummary\s+of\s+blockers?\b/.test(lower) ||
    /\bcritical\s+blockers?\b/.test(lower) ||
    /\bwho\s+is\s+blocked\b/.test(lower) ||
    /\bshow\s+(me\s+)?(the\s+)?blockers?\b/.test(lower) ||
    /\bgive\s+me\s+(the\s+)?blockers?\b/.test(lower)
  );
}
