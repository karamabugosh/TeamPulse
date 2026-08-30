/** Per-stage execution status for Ask Pulse pipeline trace. */
export type PipelineStageStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCESS'
  | 'WARNING'
  | 'FAILED'
  | 'SKIPPED';

export type PipelineStageKey =
  | 'question'
  | 'intent'
  | 'policy'
  | 'identity_acl'
  | 'temporal_scope'
  | 'v2_memory'
  | 'legacy_retrieval'
  | 'live_jira'
  | 'evidence_merge'
  | 'context'
  | 'openai'
  | 'answer';

export type PipelineHealth =
  | 'ALL_STAGES_PASSED'
  | 'PARTIAL_SUCCESS'
  | 'FALLBACK_USED'
  | 'FAILED';

export type OpenAiErrorCategory =
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'PROVIDER_ERROR'
  | 'INVALID_RESPONSE'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

export type PipelineStageTrace = {
  key: PipelineStageKey;
  label: string;
  status: PipelineStageStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  summary?: string;
  metadata?: Record<string, unknown>;
};

export type AiPipelineTrace = {
  requestId: string;
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
  pipelineHealth: PipelineHealth;
  failedAtStage?: PipelineStageKey | null;
  warnings: string[];
  stages: PipelineStageTrace[];
  /** When false, frontend should hide detailed trace (minimal/off mode). */
  visible: boolean;
  traceMode: 'full' | 'minimal' | 'off';
};

/** Timings + metrics collected during RAG prepare (no answer logic changes). */
export type RagPipelineTraceMetrics = {
  requestId: string;
  startedAt: number;
  workspaceId: string;
  question: string;
  intentMs: number;
  policyMs: number;
  identityAclMs: number;
  temporalMs: number;
  legacyMs: number;
  v2Ms: number;
  mergeMs: number;
  contextMs: number;
  trustedUserId: string | null;
  subjectUserId: string | null;
  subjectDisplayName: string | null;
  aclUserInWorkspace: boolean;
  temporalRunStartedAt: string | null;
  temporalRunCompletedAt: string | null;
  temporalSubmissionCompletedAt: string | null;
  temporalCheckInId: string | null;
  v2FullDiagnostics?: Record<string, unknown>;
  v2SourceTypeBreakdown?: Record<string, number>;
  legacyDocumentCount: number;
  legacyError?: string;
  liveJiraDocumentCount: number;
  mergeInputCount: number;
  mergeResult: {
    droppedLegacyDuplicates: number;
    droppedByBudget: number;
    v2Count: number;
    liveJiraCount: number;
    legacyCount: number;
    finalCount: number;
  };
  promptSize: number;
  authorityBreakdown: Record<string, number>;
  qualityWarnings: string[];
};
