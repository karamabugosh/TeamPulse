/**
 * Pulse V2 Phase 3A — retrieval configuration.
 */
export const MEMORY_RETRIEVAL_CONFIG = {
  /** Final evidence count returned to callers. */
  finalLimit: Number(process.env.MEMORY_RETRIEVAL_FINAL_LIMIT ?? 12) || 12,
  /** Lexical candidate pool size before merge. */
  lexicalCandidateLimit:
    Number(process.env.MEMORY_RETRIEVAL_LEXICAL_LIMIT ?? 30) || 30,
  /** Vector candidate pool size before merge. */
  vectorCandidateLimit:
    Number(process.env.MEMORY_RETRIEVAL_VECTOR_LIMIT ?? 30) || 30,
  /** RRF constant k (standard ~60). */
  rrfK: Number(process.env.MEMORY_RETRIEVAL_RRF_K ?? 60) || 60,
  /** Soft cap of chunks per sourceId after RRF (diversity). */
  maxPerSourceId:
    Number(process.env.MEMORY_RETRIEVAL_MAX_PER_SOURCE ?? 3) || 3,
  /** Modest linkedIssueKey boost added to RRF score when keys match. */
  linkedIssueBoost:
    Number(process.env.MEMORY_RETRIEVAL_ISSUE_BOOST ?? 0.04) || 0.04,
  /**
   * Soft boost when the query asks about blockers/resolutions and the
   * candidate sourceType matches (does not hardcode issue keys).
   */
  blockerSourceBoost:
    Number(process.env.MEMORY_RETRIEVAL_BLOCKER_SOURCE_BOOST ?? 0.02) || 0.02,
  resolutionSourceBoost:
    Number(process.env.MEMORY_RETRIEVAL_RESOLUTION_SOURCE_BOOST ?? 0.03) ||
    0.03,
  /** Min cosine similarity for vector hits. */
  minVectorSimilarity:
    Number(process.env.MEMORY_RETRIEVAL_MIN_VECTOR_SIM ?? 0.18) || 0.18,
  /**
   * Max ACL-authorized rows scanned for JSON cosine when pgvector absent.
   * Interim only — install pgvector for production-scale ANN.
   */
  jsonVectorScanCap:
    Number(process.env.MEMORY_RETRIEVAL_JSON_SCAN_CAP ?? 2000) || 2000,
  /**
   * When true (default), allow ACL-bounded JSON cosine if pgvector missing.
   * Set MEMORY_V2_VECTOR_JSON_FALLBACK=false to fail closed on vector (FTS still works).
   */
  allowJsonVectorFallback:
    process.env.MEMORY_V2_VECTOR_JSON_FALLBACK !== 'false',
  /** Shadow mode — never changes Ask Pulse answers. Default OFF. */
  shadowEnabled: process.env.MEMORY_V2_SHADOW_ENABLED === 'true',
} as const;

/** Detect Jira-like issue keys in free text (uppercase KEY-123). */
export function extractIssueKeys(query: string): string[] {
  const matches = query.toUpperCase().match(/\b[A-Z][A-Z0-9]+-\d+\b/g);
  if (!matches) return [];
  return [...new Set(matches)];
}
