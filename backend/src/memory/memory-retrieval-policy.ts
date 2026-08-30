import { WorkspaceAiIntent } from '../ai/workspace/types/workspace-ai.types';
import { shouldUseJiraFieldsOnly } from '../ai/workspace/retrieval/jira-field-question';
import { MemorySourceType, MEMORY_SOURCE_TYPES } from './memory-source.constants';
import { getMemoryAskMode, MemoryAskMode } from './memory-ask.config';

/**
 * Question category for Phase 3B retrieval policy.
 */
export type MemoryAskCategory =
  | 'CURRENT_JIRA_FIELD'
  | 'HISTORICAL_NARRATIVE'
  | 'COMPOSITE_JIRA_MEMORY'
  | 'OTHER';

export type EvidenceAuthorityClass =
  | 'LIVE_JIRA_CURRENT'
  | 'TEAM_MEMORY_HISTORICAL'
  | 'LEGACY_SUPPORTING';

export type MemoryRetrievalPlan = {
  mode: MemoryAskMode;
  category: MemoryAskCategory;
  useLiveJira: boolean;
  jiraFieldsOnly: boolean;
  /** Whether to invoke MemoryRetrievalService at all. */
  useV2Memory: boolean;
  /** Whether V2 evidence may enter the final prompt/answer. */
  v2AffectsAnswer: boolean;
  useLegacyRetrieval: boolean;
  memorySourceTypes: readonly MemorySourceType[];
  reason: string[];
};

const NARRATIVE_SIGNAL =
  /\b(why|what\s+happened|root\s+cause|delayed|delay|blocked|blocker|blockers|blocking|timeline|history|previous|before|after|last\s+week|last\s+sprint|resolved|resolution|discuss|conversation|standup|report|reported|team\s+said|reason|prevented|dependency|affected|impediment)\b/i;

const CURRENT_FIELD_SIGNAL =
  /\b(status|assignee|assigned|priority|summary|title|reporter|sprint|owner|owns|who\s+is\s+working|working\s+on|current\s+status)\b/i;

/**
 * Pure current Jira field question (no narrative component).
 */
export function isPureCurrentJiraFieldQuestion(params: {
  intent: WorkspaceAiIntent;
  question: string;
  issueKey?: string | null;
}): boolean {
  return shouldUseJiraFieldsOnly(params);
}

/**
 * Historical / narrative question that Team Memory should own.
 */
export function isHistoricalNarrativeQuestion(params: {
  intent: WorkspaceAiIntent;
  question: string;
  issueKey?: string | null;
}): boolean {
  if (isPureCurrentJiraFieldQuestion(params)) return false;
  const q = params.question?.trim() ?? '';
  if (
    params.intent === WorkspaceAiIntent.ISSUE_ANALYSIS ||
    params.intent === WorkspaceAiIntent.PROJECT_DETECTIVE ||
    params.intent === WorkspaceAiIntent.ROOT_CAUSE_ANALYSIS ||
    params.intent === WorkspaceAiIntent.TEAM_MEMORY_SEARCH ||
    params.intent === WorkspaceAiIntent.GET_BLOCKERS ||
    params.intent === WorkspaceAiIntent.SUMMARIZE_STANDUP
  ) {
    return true;
  }
  if (NARRATIVE_SIGNAL.test(q)) return true;
  return false;
}

/**
 * Asks for both historical context AND current Jira field(s).
 */
export function isCompositeJiraMemoryQuestion(params: {
  intent: WorkspaceAiIntent;
  question: string;
  issueKey?: string | null;
}): boolean {
  const key = params.issueKey?.trim();
  if (!key) return false;
  const q = params.question?.trim() ?? '';
  if (!q) return false;
  const wantsNarrative = NARRATIVE_SIGNAL.test(q);
  const wantsCurrent = CURRENT_FIELD_SIGNAL.test(q) || /\bnow\b/i.test(q);
  return wantsNarrative && wantsCurrent;
}

export function classifyMemoryAskCategory(params: {
  intent: WorkspaceAiIntent;
  question: string;
  issueKey?: string | null;
}): MemoryAskCategory {
  if (isCompositeJiraMemoryQuestion(params)) return 'COMPOSITE_JIRA_MEMORY';
  if (isPureCurrentJiraFieldQuestion(params)) return 'CURRENT_JIRA_FIELD';
  if (isHistoricalNarrativeQuestion(params)) return 'HISTORICAL_NARRATIVE';
  return 'OTHER';
}

/**
 * Single policy decision for Ask Pulse Phase 3B.
 * Does not trust client-supplied mode or teamIds.
 */
export function buildMemoryRetrievalPlan(params: {
  intent: WorkspaceAiIntent;
  question: string;
  issueKey?: string | null;
  /** Optional override for tests only. */
  modeOverride?: MemoryAskMode;
  /** When false, V2 cannot run (fail closed). */
  hasTrustedUserId: boolean;
}): MemoryRetrievalPlan {
  const mode = params.modeOverride ?? getMemoryAskMode();
  const category = classifyMemoryAskCategory(params);
  const reason: string[] = [`mode=${mode}`, `category=${category}`];

  const jiraFieldsOnly = category === 'CURRENT_JIRA_FIELD';
  const narrativeEligible =
    category === 'HISTORICAL_NARRATIVE' ||
    category === 'COMPOSITE_JIRA_MEMORY';

  // Directory / vacation / report generators stay on existing paths (OTHER).
  const otherBlocksMemory =
    category === 'OTHER' &&
    (params.intent === WorkspaceAiIntent.SLACK_MEMBERS ||
      params.intent === WorkspaceAiIntent.LIST_MEMBERS ||
      params.intent === WorkspaceAiIntent.JIRA_MEMBERS ||
      params.intent === WorkspaceAiIntent.VACATION_CATCHUP ||
      params.intent === WorkspaceAiIntent.GENERATE_REPORT ||
      params.intent === WorkspaceAiIntent.SPRINT_REPORT ||
      params.intent === WorkspaceAiIntent.EXECUTIVE_REPORT);

  let useV2Memory = false;
  let v2AffectsAnswer = false;

  if (jiraFieldsOnly) {
    reason.push('pure_jira_field_bypasses_v2');
  } else if (otherBlocksMemory) {
    reason.push('intent_keeps_existing_non_memory_path');
  } else if (!narrativeEligible && category === 'OTHER') {
    reason.push('other_intent_no_v2');
  } else if (!params.hasTrustedUserId) {
    reason.push('missing_trusted_userId_skip_v2');
  } else if (mode === 'LEGACY_ONLY') {
    reason.push('legacy_only');
  } else if (mode === 'V2_SHADOW') {
    useV2Memory = narrativeEligible;
    v2AffectsAnswer = false;
    reason.push('shadow_diagnostics_only');
  } else if (mode === 'HYBRID' || mode === 'V2_PRIMARY') {
    useV2Memory = narrativeEligible;
    v2AffectsAnswer = narrativeEligible;
    reason.push(mode === 'HYBRID' ? 'hybrid_merge' : 'v2_primary');
  }

  const useLiveJira =
    jiraFieldsOnly ||
    category === 'COMPOSITE_JIRA_MEMORY' ||
    Boolean(params.issueKey?.trim());

  // Legacy always available for rollback / fallback except we still run it
  // so current product behavior remains. V2_PRIMARY may prefer V2 in merge.
  const useLegacyRetrieval = true;

  return {
    mode,
    category,
    useLiveJira,
    jiraFieldsOnly,
    useV2Memory,
    v2AffectsAnswer,
    useLegacyRetrieval,
    memorySourceTypes: MEMORY_SOURCE_TYPES,
    reason,
  };
}
