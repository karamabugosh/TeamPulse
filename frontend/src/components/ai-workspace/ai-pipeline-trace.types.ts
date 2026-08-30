/** Pipeline trace types mirrored from backend (sanitized diagnostics only). */

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
  visible: boolean;
  traceMode: 'full' | 'minimal' | 'off';
};
