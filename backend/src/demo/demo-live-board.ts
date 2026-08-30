import { createHash } from 'crypto';
import type { JiraIssueSummary, JiraWorkspaceMember } from '../jira/jira.types';

/** Live board snapshot used to seed Demo (real keys / summaries / people). */
export type DemoLiveBoard = {
  siteUrl: string;
  projects: Array<{ key: string; name: string }>;
  issues: JiraIssueSummary[];
};

/**
 * Maps legacy narrative placeholders (SCRUM-8/12/…) onto real Live issue keys
 * so synthetic Slack/Memory/Reports stay coherent without inventing keys.
 */
export type DemoIssueKeyAlias = {
  /** Former SCRUM-8 hero (in progress / review) */
  hero: string;
  /** Former SCRUM-12 dependency (blocked / critical) */
  dependency: string;
  /** Former SCRUM-33 leadership ticket */
  leadership: string;
  /** Extra keys for blocker templates, sorted */
  extras: string[];
  /** Replace map: legacy key → live key */
  rewrite: Record<string, string>;
};

export function fingerprintDemoBoard(
  members: JiraWorkspaceMember[],
  board: DemoLiveBoard,
): string {
  const memberPart = members
    .map((m) => `${m.accountId}|${m.displayName.trim()}`)
    .sort()
    .join('\n');
  const issuePart = board.issues
    .map(
      (i) =>
        `${i.key}|${i.summary}|${i.status ?? ''}|${i.assigneeAccountId ?? ''}|${i.updatedAt ?? ''}`,
    )
    .sort()
    .join('\n');
  const projectPart = board.projects
    .map((p) => `${p.key}|${p.name}`)
    .sort()
    .join('\n');
  return createHash('sha256')
    .update(`${memberPart}\n---\n${projectPart}\n---\n${issuePart}`)
    .digest('hex');
}

/**
 * Pick stable hero issues from Live board for synthetic narratives.
 * Deterministic given the same issue set.
 */
export function bindDemoIssueAliases(
  issues: JiraIssueSummary[],
): DemoIssueKeyAlias | null {
  if (issues.length === 0) return null;

  const sorted = [...issues].sort((a, b) => a.key.localeCompare(b.key));
  const byStatus = (needle: RegExp) =>
    sorted.filter((i) => needle.test(i.status ?? ''));

  const inReview = byStatus(/review/i);
  const inProgress = byStatus(/progress/i);
  const blocked = byStatus(/block/i);
  const critical = sorted.filter((i) => /critical/i.test(i.priority ?? ''));

  const hero =
    inReview[0]?.key ??
    inProgress[0]?.key ??
    sorted[0]!.key;
  const dependency =
    blocked.find((i) => i.key !== hero)?.key ??
    critical.find((i) => i.key !== hero)?.key ??
    sorted.find((i) => i.key !== hero)?.key ??
    hero;
  const leadership =
    sorted.find((i) => i.key !== hero && i.key !== dependency)?.key ?? hero;

  const extras = sorted
    .map((i) => i.key)
    .filter((k) => k !== hero && k !== dependency && k !== leadership);

  const rewrite: Record<string, string> = {
    'SCRUM-8': hero,
    'SCRUM-12': dependency,
    'SCRUM-33': leadership,
    'SCRUM-20': extras[0] ?? dependency,
    'SCRUM-32': extras[1] ?? dependency,
    'SCRUM-31': extras[2] ?? hero,
    'SCRUM-11': extras[3] ?? hero,
  };

  return { hero, dependency, leadership, extras, rewrite };
}

/** Rewrite legacy SCRUM-* placeholders to live keys (deterministic). */
export function rewriteDemoIssueKeys(
  text: string,
  rewrite: Record<string, string>,
): string {
  let out = text;
  // Longest keys first to avoid partial replacements
  const keys = Object.keys(rewrite).sort((a, b) => b.length - a.length);
  for (const legacy of keys) {
    const live = rewrite[legacy];
    if (!live || legacy === live) continue;
    out = out.split(legacy).join(live);
  }
  return out;
}

/** Stable day offset from issue key (no Math.random). */
export function deterministicDayOffset(issueKey: string, mod = 20): number {
  let hash = 0;
  for (let i = 0; i < issueKey.length; i += 1) {
    hash = (hash * 31 + issueKey.charCodeAt(i)) >>> 0;
  }
  return hash % mod;
}
