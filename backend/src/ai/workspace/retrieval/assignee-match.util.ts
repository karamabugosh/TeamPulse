/**
 * Assignee name / account matching for Jira issue list queries.
 * Supports partial matches: "Karam" → "Karam Waleed", "Karam W."
 */

export type AssigneeMatchCandidate = {
  /** Original query token(s) from the question. */
  query: string;
  /** Normalized display names to match against Jira assigneeName. */
  displayNames: string[];
  /** Jira accountIds when resolved. */
  accountIds: string[];
  /** Slack workspace member display names (ranked first). */
  workspaceMemberNames: string[];
};

/** Lowercase, collapse whitespace, strip trailing periods on initials. */
export function normalizePersonName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First token of a normalized person name. */
export function firstNameToken(normalized: string): string {
  return normalized.split(' ')[0] ?? normalized;
}

function namesPartiallyMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(b) || b.startsWith(a)) return true;

  const aFirst = firstNameToken(a);
  const bFirst = firstNameToken(b);
  if (aFirst.length >= 2 && bFirst.startsWith(aFirst)) return true;
  if (bFirst.length >= 2 && aFirst.startsWith(bFirst)) return true;
  return false;
}

/**
 * True when assignee field matches a person query (partial OK).
 */
export function assigneeMatchesPersonQuery(
  query: string,
  assigneeName: string | null | undefined,
  assigneeAccountId: string | null | undefined,
  candidates: AssigneeMatchCandidate,
): boolean {
  if (
    assigneeAccountId &&
    candidates.accountIds.some(
      (id) => id.toLowerCase() === assigneeAccountId.toLowerCase(),
    )
  ) {
    return true;
  }

  if (!assigneeName?.trim()) return false;

  const aNorm = normalizePersonName(assigneeName);
  if (!aNorm) return false;

  const queryVariants = new Set<string>([normalizePersonName(query)]);
  for (const name of candidates.displayNames) {
    const n = normalizePersonName(name);
    if (n) queryVariants.add(n);
  }
  for (const name of candidates.workspaceMemberNames) {
    const n = normalizePersonName(name);
    if (n) queryVariants.add(n);
  }

  for (const qNorm of queryVariants) {
    if (namesPartiallyMatch(qNorm, aNorm)) return true;
  }

  return false;
}

/** Detect list/search questions for issues assigned to a person (no issue key). */
export function isAssigneeListQuestion(question: string): boolean {
  const q = question.trim().toLowerCase();
  if (/\b[A-Z][A-Z0-9]+-\d+\b/i.test(question)) return false;
  return (
    /\b(show|list|find|get|what are|all)\b.*\bissues?\b.*\bassigned\b/.test(q) ||
    /\bissues?\b.*\bassigned to\b/.test(q) ||
    /\bassigned to\b.*\bissues?\b/.test(q) ||
    /\b(show|list)\b.*\bassigned to\b/.test(q) ||
    /\bworkload\b.*\bfor\b/.test(q) ||
    /\bwhat is\b.*\bworking on\b/.test(q) ||
    /\bwhat(?:'s| is)\b.*\bassigned to\b/.test(q)
  );
}

export function extractAssigneeFromQuestion(question: string): string | null {
  const patterns = [
    /\bassigned to\s+([A-Za-z][\w.-]{0,40}(?:\s+[A-Za-z][\w.-]{0,40})?)/i,
    /\bassignee\s+([A-Za-z][\w.-]{0,40}(?:\s+[A-Za-z][\w.-]{0,40})?)/i,
    /\bfor\s+([A-Za-z][\w.-]{1,40})\s*$/i,
  ];
  for (const pattern of patterns) {
    const m = question.match(pattern);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

export function rankAssigneeCandidateScore(
  query: string,
  displayName: string,
  isWorkspaceMember: boolean,
): number {
  const q = normalizePersonName(query);
  const n = normalizePersonName(displayName);
  let score = isWorkspaceMember ? 100 : 0;
  if (n === q) score += 50;
  else if (n.startsWith(q)) score += 40;
  else if (firstNameToken(n) === firstNameToken(q)) score += 30;
  else if (n.includes(q)) score += 15;
  return score;
}
