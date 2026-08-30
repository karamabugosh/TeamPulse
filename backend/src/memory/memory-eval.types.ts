import { MemoryAskCategory } from './memory-retrieval-policy';
import { MemorySourceType } from './memory-source.constants';
import { GateStatus, VectorBackendReadiness } from './memory-eval.config';

export type MemoryV2EvalCaseKind =
  | 'CURRENT_JIRA_FIELD'
  | 'HISTORICAL_NARRATIVE'
  | 'COMPOSITE_JIRA_MEMORY'
  | 'BLOCKER_HISTORY'
  | 'RESOLUTION_HISTORY'
  | 'REPORT_KNOWLEDGE'
  | 'STANDUP_KNOWLEDGE'
  | 'EXACT_ISSUE_KEY'
  | 'WORKSPACE_ISOLATION'
  | 'TEAM_ACL'
  | 'PRIVATE_ACL'
  | 'MALFORMED_ACL'
  | 'NO_EVIDENCE'
  | 'TEMPORAL_CONFLICT'
  | 'LEGACY_V2_DUPLICATE'
  | 'MULTI_SOURCE_CAUSE_RESOLUTION'
  | 'POISONED_AUTHORITY'
  | 'SECURITY_OVER_RELEVANCE'
  | 'FAILURE_INJECTION';

export type MemoryV2EvaluationCase = {
  id: string;
  kind: MemoryV2EvalCaseKind;
  workspaceId: string;
  userId: string;
  query: string;
  expectedCategory: MemoryAskCategory;
  expectedSourceTypes?: MemorySourceType[];
  /** Canonical sourceType:sourceId identities expected in top-K. */
  expectedSourceIdentities?: string[];
  expectedIssueKey?: string;
  forbiddenSourceIds?: string[];
  forbiddenTextMarkers?: string[];
  expectedCurrentJiraFields?: {
    status?: string;
    assignee?: string;
    priority?: string;
  };
  /** Optional Live Jira fixture used for authority checks (not from DB). */
  liveJiraFixture?: {
    status?: string;
    assignee?: string;
    priority?: string;
    summary?: string;
  };
  notes?: string;
};

export type EvalSideMetrics = {
  evidenceCount: number;
  sourceTypes: string[];
  sourceIdentities: string[];
  latencyMs: number;
  vectorBackend?: string;
  error?: string;
};

export type QualityMetrics = {
  hitAt1: boolean;
  hitAt3: boolean;
  hitAt5: boolean;
  reciprocalRank: number;
  recallAtK: number;
  expectedEvidenceFound: boolean;
};

export type SecurityMetrics = {
  workspaceLeakage: boolean;
  teamLeakage: boolean;
  privateLeakage: boolean;
  malformedPermissive: boolean;
};

export type AuthorityMetrics = {
  currentJiraCorrect: boolean | null;
  memoryOverrodeJira: boolean;
  poisonedValueAbsent: boolean | null;
};

export type MemoryV2EvaluationResult = {
  caseId: string;
  kind: MemoryV2EvalCaseKind;
  category: MemoryAskCategory;
  legacy: EvalSideMetrics;
  v2: EvalSideMetrics;
  quality: QualityMetrics;
  security: SecurityMetrics;
  authority: AuthorityMetrics;
  citationTraceable: boolean;
  status: 'PASS' | 'FAIL';
  reasons: string[];
};

export type AggregateRetrievalQuality = {
  caseCount: number;
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
  mrr: number;
  recallAtK: number;
  bySourceType: Record<
    string,
    { cases: number; hitAt5: number; mrr: number }
  >;
};

export type GateResult = {
  status: GateStatus;
  reasons: string[];
};

export type MemoryV2RecommendedMode =
  | 'LEGACY_ONLY'
  | 'V2_SHADOW'
  | 'HYBRID'
  | 'V2_PRIMARY_ELIGIBLE';

export type MemoryV2ReadinessReport = {
  workspaceId: string;
  workspaceName: string;
  overall: GateStatus;
  gates: {
    retrievalQuality: GateResult;
    security: GateResult;
    jiraAuthority: GateResult;
    citations: GateResult;
    coverage: GateResult;
    performance: GateResult;
    vectorBackend: GateResult;
    regressions: GateResult;
  };
  recommendedMode: MemoryV2RecommendedMode;
  reasons: string[];
  metrics: {
    aggregateQuality: AggregateRetrievalQuality;
    coverage: {
      eligible: number;
      indexed: number;
      indexedRatio: number;
      embeddingCoverage: number;
      failedOutbox: number;
      pendingOutbox: number;
      inconsistent: number;
    };
    vector: {
      backend: string;
      readiness: VectorBackendReadiness;
    };
    performance: {
      sampleCount: number;
      p50Ms: number | null;
      p95Ms: number | null;
      meanMs: number;
    };
    context: {
      duplicateRate: number;
      sourceDiversityScore: number;
    };
  };
  /** Explicit: readiness never mutates MEMORY_V2_ASK_MODE. */
  modeMutation: 'NONE';
};

export type MemoryV2EvaluationRunReport = {
  workspaceId: string;
  userId: string;
  startedAt: string;
  finishedAt: string;
  results: MemoryV2EvaluationResult[];
  aggregateQuality: AggregateRetrievalQuality;
  readiness: MemoryV2ReadinessReport;
  modeMutation: 'NONE';
};
