/**
 * Retrieval quality formulas (deterministic).
 *
 * Hit@K: 1 if any expected identity appears in the top-K ranked evidence, else 0.
 * MRR: 1/rank of the first expected identity (0 if none in the list).
 * Recall@K: |expected ∩ top-K| / |expected| (0 if no expectations).
 */
export function hitAtK(
  rankedIdentities: string[],
  expected: string[],
  k: number,
): boolean {
  if (expected.length === 0) return true;
  const top = new Set(rankedIdentities.slice(0, k));
  return expected.some((id) => top.has(id));
}

export function reciprocalRank(
  rankedIdentities: string[],
  expected: string[],
): number {
  if (expected.length === 0) return 1;
  const want = new Set(expected);
  for (let i = 0; i < rankedIdentities.length; i += 1) {
    if (want.has(rankedIdentities[i])) return 1 / (i + 1);
  }
  return 0;
}

export function recallAtK(
  rankedIdentities: string[],
  expected: string[],
  k: number,
): number {
  if (expected.length === 0) return 1;
  const top = new Set(rankedIdentities.slice(0, k));
  let hit = 0;
  for (const id of expected) {
    if (top.has(id)) hit += 1;
  }
  return hit / expected.length;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Simple percentile; returns null when sample too small for meaningful p95. */
export function percentile(
  values: number[],
  p: number,
  minSamplesForP95 = 5,
): number | null {
  if (values.length === 0) return null;
  if (p >= 95 && values.length < minSamplesForP95) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

/**
 * Diversity score in [0,1]: unique sourceTypes / min(evidenceCount, 4).
 * Penalizes single-source domination when multiple types are expected.
 */
export function sourceDiversityScore(
  sourceTypes: string[],
  expectedTypeCount = 4,
): number {
  if (sourceTypes.length === 0) return 0;
  const unique = new Set(sourceTypes).size;
  return Math.min(1, unique / Math.max(1, Math.min(expectedTypeCount, 4)));
}

/**
 * Duplicate rate among identities that appear more than once.
 * Exact identity duplicates only (sourceType:sourceId).
 */
export function duplicateRate(identities: string[]): number {
  if (identities.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const id of identities) {
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let dupItems = 0;
  for (const n of counts.values()) {
    if (n > 1) dupItems += n - 1;
  }
  return dupItems / identities.length;
}
