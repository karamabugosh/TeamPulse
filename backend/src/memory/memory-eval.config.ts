/**
 * Pulse V2 Phase 3C — evaluation / readiness configuration.
 * Conservative defaults for operator evaluation only — not production cutover.
 * Never mutates MEMORY_V2_ASK_MODE.
 */
export type GateStatus = 'PASS' | 'WARN' | 'BLOCKED';

export type VectorBackendReadiness =
  | 'PGVECTOR_READY'
  | 'BOUNDED_JSON_ONLY'
  | 'VECTOR_DISABLED';

export const MEMORY_EVAL_CONFIG = {
  /**
   * Production V2_PRIMARY eligibility requires pgvector when true.
   * Local/dev evaluation may still PASS quality while vector gate is BLOCKED.
   */
  requirePgvectorForV2Primary:
    (process.env.MEMORY_EVAL_REQUIRE_PGVECTOR ?? 'true').toLowerCase() !==
    'false',

  /** Hit@5 target across historical cases with expected evidence. */
  minHitAt5: Number(process.env.MEMORY_EVAL_MIN_HIT5 ?? 0.7) || 0.7,

  /** MRR target across historical cases with ranked expectations. */
  minMrr: Number(process.env.MEMORY_EVAL_MIN_MRR ?? 0.5) || 0.5,

  /**
   * Minimum fraction of eligible historical sources that are INDEXED.
   * Below → WARN; far below → BLOCKED for V2_PRIMARY.
   */
  minIndexedEligibleRatio:
    Number(process.env.MEMORY_EVAL_MIN_INDEXED_RATIO ?? 0.5) || 0.5,

  /** Chunks with non-empty embeddings / total chunks. */
  minEmbeddingCoverage:
    Number(process.env.MEMORY_EVAL_MIN_EMBED_COVERAGE ?? 0.5) || 0.5,

  /** Failed outbox / (failed+completed+pending+processing) max for WARN. */
  maxFailedOutboxRatio:
    Number(process.env.MEMORY_EVAL_MAX_FAILED_RATIO ?? 0.1) || 0.1,

  /** Soft p95 V2 latency (ms) for WARN — not a hard BLOCK alone. */
  warnP95LatencyMs:
    Number(process.env.MEMORY_EVAL_WARN_P95_MS ?? 3000) || 3000,

  /** K used for Hit@K / Recall@K defaults. */
  defaultK: 5,

  /** Marker prefix for ephemeral eval fixtures (safe cleanup). */
  fixtureMarker: 'PULSE_V2_EVAL3C',
} as const;
