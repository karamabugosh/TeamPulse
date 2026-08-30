/**
 * Pulse V2 Team Memory — Phase 2A source type constants.
 * These are outbox / future MemoryChunk sourceType values (strings in Prisma).
 * AI conversations and arbitrary Slack messages are intentionally excluded.
 */
export const MEMORY_SOURCE = {
  STANDUP_ANSWER: 'STANDUP_ANSWER',
  BLOCKER: 'BLOCKER',
  BLOCKER_RESOLUTION: 'BLOCKER_RESOLUTION',
  REPORT: 'REPORT',
} as const;

export type MemorySourceType =
  (typeof MEMORY_SOURCE)[keyof typeof MEMORY_SOURCE];

export const MEMORY_SOURCE_TYPES: readonly MemorySourceType[] = [
  MEMORY_SOURCE.STANDUP_ANSWER,
  MEMORY_SOURCE.BLOCKER,
  MEMORY_SOURCE.BLOCKER_RESOLUTION,
  MEMORY_SOURCE.REPORT,
];
