/**
 * Shared keyword helpers for workspace knowledge retrieval.
 * Never treat a full natural-language question as a Prisma `contains` phrase.
 */

const STOP_WORDS = new Set([
  'who',
  'what',
  'when',
  'where',
  'why',
  'how',
  'are',
  'the',
  'in',
  'on',
  'a',
  'an',
  'did',
  'do',
  'does',
  'is',
  'was',
  'were',
  'about',
  'for',
  'to',
  'of',
  'and',
  'or',
  'my',
  'our',
  'your',
  'their',
  'members',
  'member',
  'slack',
  'team',
  'yesterday',
  'today',
  'standup',
  'standups',
  'stand-up',
  'please',
  'show',
  'tell',
  'me',
  'from',
  'with',
  'this',
  'that',
  'which',
  'have',
  'has',
  'had',
  'been',
  'being',
  'can',
  'could',
  'would',
  'should',
  'will',
  'any',
  'all',
  'some',
  'into',
  'over',
  'under',
  'after',
  'before',
  'since',
  'until',
  'there',
  'here',
  'just',
  'also',
  'only',
  'still',
  'many',
  'much',
  'most',
  'find',
  'list',
  'give',
  'get',
  'need',
  'want',
  'know',
  'users',
  'user',
  'people',
  'person',
  'workspace',
  'pulse',
  'jira',
  'report',
  'reports',
  'summary',
  'summarize',
  'generate',
  'status',
  'update',
  'updates',
  'answer',
  'answers',
  'activity',
  'working',
  'work',
  'worked',
]);

/** Synonym groups — query tokens expand to related workspace vocabulary. */
const SYNONYM_GROUPS: string[][] = [
  ['vacation', 'pto', 'leave', 'absent', 'absence', 'away', 'off', 'holiday'],
  [
    'blocked',
    'blocker',
    'blocking',
    'waiting',
    'dependency',
    'stuck',
    'impediment',
  ],
  [
    'finished',
    'completed',
    'done',
    'resolved',
    'shipped',
    'closed',
    'complete',
  ],
  ['delayed', 'delay', 'slipped', 'slip', 'late', 'behind'],
  ['workload', 'capacity', 'busy', 'assignment', 'assigned', 'bandwidth'],
  ['architecture', 'architectural', 'decision', 'decisions', 'design'],
  ['sprint', 'iteration', 'milestone'],
  ['oauth', 'auth', 'authentication', 'callback', 'token', 'refresh'],
  ['standup', 'stand-up', 'check-in', 'checkin', 'daily'],
  ['report', 'digest', 'summary', 'recap'],
];

export function meaningfulTokens(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)) {
    if (raw.length < 3) continue;
    if (STOP_WORDS.has(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    tokens.push(raw);
  }
  return tokens;
}

/**
 * Expand query tokens with synonyms for retrieval + ranking.
 * Always includes the original meaningful tokens.
 */
export function expandQueryTokens(text: string | null | undefined): string[] {
  const base = meaningfulTokens(text);
  const seen = new Set(base);
  const expanded = [...base];

  for (const token of base) {
    for (const group of SYNONYM_GROUPS) {
      if (!group.includes(token)) continue;
      for (const syn of group) {
        if (seen.has(syn)) continue;
        seen.add(syn);
        expanded.push(syn);
      }
    }
  }

  const lower = (text ?? '').toLowerCase();
  for (const group of SYNONYM_GROUPS) {
    if (!group.some((g) => lower.includes(g))) continue;
    for (const syn of group) {
      if (seen.has(syn)) continue;
      seen.add(syn);
      expanded.push(syn);
    }
  }

  return expanded;
}

/** Extract likely person-name candidates from a question. */
export function extractUserNameCandidates(question: string): string[] {
  const candidates: string[] = [];
  const patterns = [
    /\bwhat did ([A-Za-z][\w.-]{1,40}) do\b/i,
    /\b([A-Za-z][\w.-]{1,40})'s (?:standup|update|answers?|activity|blocker)\b/i,
    /\bdid ([A-Za-z][\w.-]{1,40}) (?:resolve|submit|finish|complete|do)\b/i,
    /\b(?:for|about|from) ([A-Za-z][\w.-]{1,40})\b/i,
    /\bsummarize ([A-Za-z][\w.-]{1,40})(?:'s)?\b/i,
    /\bassigned to\s+([A-Za-z][\w.-]{0,40}(?:\s+[A-Za-z]\.?)?)/i,
    /\bassignee\s+([A-Za-z][\w.-]{1,40})\b/i,
  ];

  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match?.[1] && !STOP_WORDS.has(match[1].toLowerCase())) {
      candidates.push(match[1]);
    }
  }

  const capitalized = question.match(/\b([A-Z][a-z]{2,30})\b/g) ?? [];
  for (const name of capitalized) {
    if (!STOP_WORDS.has(name.toLowerCase())) {
      candidates.push(name);
    }
  }

  return [...new Set(candidates)];
}
