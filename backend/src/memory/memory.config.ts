/**
 * Pulse V2 Phase 2B — worker / chunk / embedding configuration.
 * Overridable via environment where noted.
 */
export const MEMORY_WORKER_CONFIG = {
  /** Events claimed per tick. */
  batchSize: Number(process.env.MEMORY_WORKER_BATCH_SIZE ?? 8) || 8,
  /** Cron interval handled by Nest schedule decorator (see worker). */
  lockTimeoutMs:
    Number(process.env.MEMORY_WORKER_LOCK_TIMEOUT_MS ?? 5 * 60 * 1000) ||
    5 * 60 * 1000,
  maxAttempts: Number(process.env.MEMORY_WORKER_MAX_ATTEMPTS ?? 8) || 8,
  /** Base delay for exponential backoff (ms). */
  retryBaseMs: Number(process.env.MEMORY_WORKER_RETRY_BASE_MS ?? 15_000) || 15_000,
  /** Soft cap on backoff. */
  retryMaxMs:
    Number(process.env.MEMORY_WORKER_RETRY_MAX_MS ?? 30 * 60 * 1000) ||
    30 * 60 * 1000,
  /** Max characters per chunk (deterministic, no tokenizer). */
  maxChunkChars: Number(process.env.MEMORY_CHUNK_MAX_CHARS ?? 1800) || 1800,
  /** Overlap when splitting long sections. */
  chunkOverlapChars: Number(process.env.MEMORY_CHUNK_OVERLAP_CHARS ?? 120) || 120,
} as const;

export function memoryRetryDelayMs(attemptAfterIncrement: number): number {
  const exp = Math.min(
    MEMORY_WORKER_CONFIG.retryMaxMs,
    MEMORY_WORKER_CONFIG.retryBaseMs *
      Math.pow(2, Math.max(0, attemptAfterIncrement - 1)),
  );
  return exp;
}
