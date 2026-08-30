import { createHash } from 'crypto';

/** Cosine similarity for two equal-length embedding vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function hashContent(title: string, content: string): string {
  return createHash('sha256')
    .update(`${title}\n${content}`)
    .digest('hex');
}

export function parseEmbeddingJson(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const nums: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item)) return null;
    nums.push(item);
  }
  return nums.length > 0 ? nums : null;
}

/**
 * Reciprocal Rank Fusion — merge ranked lists without score-scale coupling.
 * Higher fused score = better.
 */
export function reciprocalRankFusion(
  rankedIdLists: string[][],
  k = 60,
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of rankedIdLists) {
    list.forEach((id, index) => {
      const contrib = 1 / (k + index + 1);
      scores.set(id, (scores.get(id) ?? 0) + contrib);
    });
  }
  return scores;
}

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;
