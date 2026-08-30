/**
 * Deterministic scoring helpers for AI Workspace evaluation.
 * No OpenAI judge — keyword / set overlap heuristics for regression stability.
 */

export type EvalScoreBreakdown = {
  retrievalAccuracy: number;
  answerAccuracy: number;
  contextCoverage: number;
  hallucinationRisk: number;
  sourceUsage: number;
  confidenceCalibration: number;
  correctness: number;
  completeness: number;
  responseLengthScore: number;
  overall: number;
};

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'to',
  'of',
  'in',
  'on',
  'for',
  'is',
  'was',
  'were',
  'be',
  'as',
  'at',
  'by',
  'with',
  'that',
  'this',
  'it',
  'from',
  'are',
  'should',
  'there',
  'their',
  'then',
  'than',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

export function extractIssueKeys(text: string): string[] {
  const matches = text.toUpperCase().match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [];
  return Array.from(new Set(matches));
}

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export function coverage(required: string[], haystack: string): number {
  if (required.length === 0) return 1;
  const lower = haystack.toLowerCase();
  let hits = 0;
  for (const phrase of required) {
    if (phrase.trim() && lower.includes(phrase.toLowerCase())) hits += 1;
  }
  return hits / required.length;
}

export function normalizeSourceLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[#_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sourceOverlap(
  expected: string[],
  actual: string[],
): number {
  if (expected.length === 0) return actual.length === 0 ? 1 : 0.7;
  const expectedNorm = expected.map(normalizeSourceLabel);
  const actualNorm = actual.map(normalizeSourceLabel);
  let hits = 0;
  for (const exp of expectedNorm) {
    if (
      actualNorm.some(
        (act) => act.includes(exp) || exp.includes(act) || shareToken(exp, act),
      )
    ) {
      hits += 1;
    }
  }
  return hits / expected.length;
}

function shareToken(a: string, b: string): boolean {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  for (const token of ta) {
    if (tb.has(token)) return true;
  }
  return false;
}

export function confidenceScore(
  expected: string | null | undefined,
  actual: string | null | undefined,
): number {
  if (!expected) return 70;
  if (!actual) return 40;
  const e = expected.toLowerCase();
  const a = actual.toLowerCase();
  if (e === a) return 100;
  const rank = (value: string) =>
    value === 'high' ? 3 : value === 'medium' ? 2 : value === 'low' ? 1 : 0;
  const distance = Math.abs(rank(e) - rank(a));
  if (distance === 1) return 70;
  if (distance === 2) return 35;
  return 50;
}

export function responseLengthScore(length: number): number {
  if (length < 40) return 35;
  if (length < 80) return 55;
  if (length <= 2500) return 90;
  if (length <= 6000) return 75;
  return 55;
}

export function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function computeEvalScores(input: {
  expectedAnswer: string;
  aiAnswer: string;
  expectedSources: string[];
  aiSources: string[];
  expectedConfidence?: string | null;
  aiConfidence?: string | null;
  mustInclude?: string[];
  hallucinationPenalty: number;
  missingContextPenalty: number;
}): EvalScoreBreakdown {
  const expectedTokens = tokenize(input.expectedAnswer);
  const answerTokens = tokenize(input.aiAnswer);
  const answerAccuracy = clampScore(jaccard(expectedTokens, answerTokens) * 100);

  const must = input.mustInclude?.length
    ? input.mustInclude
    : expectedTokens.filter((token) => token.length > 3).slice(0, 8);
  const completeness = clampScore(coverage(must, input.aiAnswer) * 100);
  const contextCoverage = completeness;

  const retrievalAccuracy = clampScore(
    sourceOverlap(input.expectedSources, input.aiSources) * 100,
  );
  const sourceUsage = retrievalAccuracy;

  const confidenceCalibration = clampScore(
    confidenceScore(input.expectedConfidence, input.aiConfidence),
  );

  const hallucinationRisk = clampScore(100 - input.hallucinationPenalty);
  const lengthScore = responseLengthScore(input.aiAnswer.length);

  const correctness = clampScore(
    answerAccuracy * 0.6 + completeness * 0.4 - input.missingContextPenalty * 0.15,
  );

  const overall = clampScore(
    answerAccuracy * 0.28 +
      retrievalAccuracy * 0.18 +
      contextCoverage * 0.18 +
      hallucinationRisk * 0.14 +
      sourceUsage * 0.1 +
      confidenceCalibration * 0.07 +
      lengthScore * 0.05 -
      input.missingContextPenalty * 0.1,
  );

  return {
    retrievalAccuracy,
    answerAccuracy,
    contextCoverage,
    hallucinationRisk,
    sourceUsage,
    confidenceCalibration,
    correctness,
    completeness,
    responseLengthScore: lengthScore,
    overall,
  };
}
