import { QuestionType } from '@prisma/client';

/**
 * Which standup Answer question types may enter Team Memory as STANDUP_ANSWER.
 * ISSUE_REF is structured Jira identity (picker / link) — not narrative memory.
 * Issue keys will be derived later from AnswerJiraIssueLink by the worker.
 */
export function isMemoryEligibleAnswerType(type: QuestionType): boolean {
  return type !== QuestionType.ISSUE_REF;
}

/**
 * Whether a blocker follow-up choice is a resolution-relevant event
 * that should enqueue BLOCKER_RESOLUTION (not a plain BLOCKER UPSERT).
 */
export function isBlockerResolutionFollowUp(
  choice: string,
): boolean {
  return choice === 'resolved';
}

/**
 * Historical / update-row eligibility for BLOCKER_RESOLUTION.
 * Matches Phase 2A: follow-up choice `resolved` writes PulseBlockerUpdate
 * with newStatus = 'resolved'. Ordinary status notes are not resolution memory.
 */
export function isMemoryEligibleBlockerResolutionUpdate(params: {
  newStatus: string;
}): boolean {
  return params.newStatus === 'resolved';
}

/**
 * Whether an AiDigest is appropriate for REPORT memory indexing.
 * Failed / empty digests are skipped.
 */
export function isMemoryEligibleDigest(params: {
  source: string;
  summary?: string | null;
  generationError?: string | null;
}): boolean {
  if (params.source === 'failed') return false;
  if (params.generationError?.trim()) {
    // Persist may still store failed content under other sources — skip empty+error.
    if (!params.summary?.trim()) return false;
  }
  return Boolean(params.summary?.trim()) || params.source === 'ai' || params.source === 'rules_fallback';
}
