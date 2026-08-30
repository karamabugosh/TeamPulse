/**
 * Pulse V2 Phase 3B — Ask Pulse rollout configuration.
 * Server/operator only — never accept mode from the client request body.
 */
export type MemoryAskMode =
  | 'LEGACY_ONLY'
  | 'V2_SHADOW'
  | 'HYBRID'
  | 'V2_PRIMARY';

const ALLOWED: readonly MemoryAskMode[] = [
  'LEGACY_ONLY',
  'V2_SHADOW',
  'HYBRID',
  'V2_PRIMARY',
] as const;

/** Default is rollback-safe. */
export const DEFAULT_MEMORY_V2_ASK_MODE: MemoryAskMode = 'LEGACY_ONLY';

export function getMemoryAskMode(): MemoryAskMode {
  const raw = (process.env.MEMORY_V2_ASK_MODE ?? DEFAULT_MEMORY_V2_ASK_MODE)
    .trim()
    .toUpperCase();
  if ((ALLOWED as readonly string[]).includes(raw)) {
    return raw as MemoryAskMode;
  }
  return DEFAULT_MEMORY_V2_ASK_MODE;
}

/** Final merged evidence budget (documents entering ContextBuilder). */
export const MEMORY_ASK_CONTEXT_BUDGET = {
  maxDocuments: Number(process.env.MEMORY_ASK_MAX_DOCS ?? 24) || 24,
  maxV2Documents: Number(process.env.MEMORY_ASK_MAX_V2_DOCS ?? 10) || 10,
  maxPerSourceId: Number(process.env.MEMORY_ASK_MAX_PER_SOURCE ?? 3) || 3,
} as const;
