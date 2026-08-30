import { extractIssueKeys, tokenize } from './scoring.util';

export type HallucinationFlag = {
  type:
    | 'invented_issue'
    | 'invented_user'
    | 'unsupported_claim'
    | 'missing_issue_referenced'
    | 'missing_user_referenced';
  detail: string;
  severity: 'low' | 'medium' | 'high';
};

export type HallucinationAssessment = {
  flags: HallucinationFlag[];
  penalty: number;
};

const KNOWN_SAFE_ISSUE_PREFIXES = ['SCRUM-', 'PULSE-', 'ENG-', 'DEMO-'];

/**
 * Heuristic hallucination detector.
 * Compares AI answer entities against workspace facts + expected answer.
 */
export function detectHallucinations(input: {
  aiAnswer: string;
  expectedAnswer: string;
  knownIssueKeys: string[];
  knownUserNames: string[];
  aiSources: string[];
  tags?: string[];
}): HallucinationAssessment {
  const flags: HallucinationFlag[] = [];
  const answer = input.aiAnswer;
  const expectedLower = input.expectedAnswer.toLowerCase();
  const knownIssues = new Set(input.knownIssueKeys.map((k) => k.toUpperCase()));
  const mentionedIssues = extractIssueKeys(answer);

  for (const issue of mentionedIssues) {
    if (knownIssues.has(issue)) continue;
    // Allow mentioning the trap issue as "not found"
    if (/not found|does not exist|no .*issue|unknown/i.test(answer)) {
      continue;
    }
    const looksPlausible = KNOWN_SAFE_ISSUE_PREFIXES.some((prefix) =>
      issue.startsWith(prefix),
    );
    flags.push({
      type: knownIssues.size > 0 ? 'invented_issue' : 'missing_issue_referenced',
      detail: `Referenced issue ${issue} was not found in workspace knowledge.`,
      severity: looksPlausible ? 'high' : 'medium',
    });
  }

  // Detect invented people: capitalized full names not in roster / expected text
  const nameMatches =
    answer.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g) ?? [];
  const roster = input.knownUserNames.map((name) => name.toLowerCase());
  for (const name of nameMatches) {
    const lower = name.toLowerCase();
    if (expectedLower.includes(lower)) continue;
    if (roster.some((member) => member.includes(lower) || lower.includes(member))) {
      continue;
    }
    // Ignore common non-person phrases
    if (
      /sprint|oauth|jira|slack|pulse|demo workspace|project detective/i.test(
        name,
      )
    ) {
      continue;
    }
    flags.push({
      type: 'invented_user',
      detail: `Referenced person "${name}" is not a known workspace member.`,
      severity: 'high',
    });
  }

  // Unsupported claims: assertive answer with zero sources when expected sources exist
  if (
    input.aiSources.length === 0 &&
    answer.length > 120 &&
    !/not found|insufficient|no data|don't have|do not have/i.test(answer)
  ) {
    flags.push({
      type: 'unsupported_claim',
      detail: 'Answer asserts details without citing any sources.',
      severity: 'medium',
    });
  }

  // Hallucination-trap cases: inventing content for missing entities
  if (input.tags?.includes('hallucination-trap')) {
    const denies = /not found|does not exist|no (member|user|issue|record)|unknown/i.test(
      answer,
    );
    if (!denies && answer.length > 80) {
      flags.push({
        type: 'invented_issue',
        detail:
          'Gold case expected a missing-entity denial, but the answer provided fabricated detail.',
        severity: 'high',
      });
    }
  }

  const penalty = Math.min(
    100,
    flags.reduce((sum, flag) => {
      if (flag.severity === 'high') return sum + 35;
      if (flag.severity === 'medium') return sum + 20;
      return sum + 10;
    }, 0),
  );

  return { flags, penalty };
}

export function extractLikelyUserMentions(text: string): string[] {
  return Array.from(
    new Set(
      (text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g) ?? []).map((n) =>
        n.trim(),
      ),
    ),
  );
}

export function answerMentionsToken(answer: string, token: string): boolean {
  return tokenize(answer).includes(token.toLowerCase());
}
