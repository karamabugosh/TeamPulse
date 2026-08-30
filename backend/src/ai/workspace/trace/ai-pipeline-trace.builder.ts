import { randomBytes } from 'crypto';
import {
  documentAuthorityClass,
  isV2MemoryDocument,
} from '../../../memory/memory-evidence.adapter';
import { getMemoryAskMode } from '../../../memory/memory-ask.config';
import { MemoryRetrievalPlan } from '../../../memory/memory-retrieval-policy';
import {
  AiChatConfidence,
  BuiltContext,
  DetectedIntent,
  KnowledgeDocument,
  RetrievalDiagnostics,
  WorkspaceAiIntent,
} from '../types/workspace-ai.types';
import {
  getAiPipelineTraceMode,
  isAiPipelineTraceEnabled,
} from './ai-pipeline-trace.config';
import {
  AiPipelineTrace,
  OpenAiErrorCategory,
  PipelineHealth,
  PipelineStageKey,
  PipelineStageStatus,
  PipelineStageTrace,
  RagPipelineTraceMetrics,
} from './ai-pipeline-trace.types';

export function createPipelineRequestId(): string {
  return randomBytes(3).toString('hex').toUpperCase();
}

export function sanitizeOpenAiError(error: unknown): {
  message: string;
  category: OpenAiErrorCategory;
} {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  let category: OpenAiErrorCategory = 'UNKNOWN';
  if (lower.includes('timeout') || lower.includes('timed out')) {
    category = 'TIMEOUT';
  } else if (lower.includes('rate limit') || lower.includes('429')) {
    category = 'RATE_LIMIT';
  } else if (lower.includes('empty response')) {
    category = 'INVALID_RESPONSE';
  } else if (lower.includes('unavailable') || lower.includes('not enabled')) {
    category = 'UNAVAILABLE';
  } else if (
    lower.includes('openai') ||
    lower.includes('provider') ||
    lower.includes('api')
  ) {
    category = 'PROVIDER_ERROR';
  }
  const sanitized = raw
    .replace(/sk-[a-zA-Z0-9_-]+/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/gi, '[REDACTED]')
    .slice(0, 200);
  return { message: sanitized, category };
}

export function computeAuthorityBreakdown(
  documents: KnowledgeDocument[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const doc of documents) {
    const key = documentAuthorityClass(doc);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export function computeQualityWarnings(params: {
  temporalIntent: string | null;
  resolvedRunId: string | null;
  subjectUserId: string | null;
  documents: KnowledgeDocument[];
}): string[] {
  const warnings: string[] = [];
  const { temporalIntent, resolvedRunId, subjectUserId, documents } = params;

  if (temporalIntent === 'LATEST_STANDUP' && resolvedRunId) {
    const runIds = new Set<string>();
    for (const doc of documents) {
      const runId =
        typeof doc.metadata?.runId === 'string' ? doc.metadata.runId : null;
      if (runId) runIds.add(runId);
    }
    if (runIds.size > 1) {
      warnings.push(
        'Evidence spans multiple runs for a latest-run query.',
      );
    }
  }

  if (subjectUserId) {
    const wrongOwner = documents.filter((doc) => {
      const entity = doc.entity;
      const owner =
        typeof doc.metadata?.ownerUserId === 'string'
          ? doc.metadata.ownerUserId
          : typeof doc.metadata?.userId === 'string'
            ? doc.metadata.userId
            : null;
      return (
        (entity === 'standup_submission' ||
          doc.metadata?.memorySourceType === 'STANDUP_ANSWER') &&
        owner &&
        owner !== subjectUserId
      );
    });
    if (wrongOwner.length > 0) {
      warnings.push(
        'Selected standup evidence includes answers from a different user than requested.',
      );
    }
  }

  return warnings;
}

export type CompletePipelineTraceInput = {
  metrics: RagPipelineTraceMetrics;
  intent: DetectedIntent;
  plan: MemoryRetrievalPlan;
  diagnostics: RetrievalDiagnostics;
  context: BuiltContext;
  documents: KnowledgeDocument[];
  openai?: {
    durationMs: number;
    model: string | null;
    provider: string;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
    error?: { message: string; category: OpenAiErrorCategory };
    skipped?: boolean;
    skipReason?: string;
  };
  answer?: {
    confidence: AiChatConfidence;
    evidenceCount: number;
    insufficientData: boolean;
    provider: string;
    model: string | null;
  };
  traceCollectionError?: string;
};

export function buildAiPipelineTrace(
  input: CompletePipelineTraceInput,
): AiPipelineTrace | null {
  if (!isAiPipelineTraceEnabled()) {
    return null;
  }

  const mode = getAiPipelineTraceMode();
  const startedAtIso = new Date(input.metrics.startedAt).toISOString();
  const completedAt = Date.now();
  const completedAtIso = new Date(completedAt).toISOString();
  const totalDurationMs = completedAt - input.metrics.startedAt;
  const warnings = [
    ...input.metrics.qualityWarnings,
    ...(input.traceCollectionError
      ? [`Trace collection partial: ${input.traceCollectionError.slice(0, 120)}`]
      : []),
  ];

  const stages: PipelineStageTrace[] = [];

  stages.push(
    stage({
      key: 'question',
      label: 'Question',
      status: 'SUCCESS',
      startedAt: startedAtIso,
      completedAt: startedAtIso,
      durationMs: 0,
      summary: 'Request received',
      metadata: {
        workspaceId: input.metrics.workspaceId,
        questionLength: input.metrics.question.length,
      },
    }),
  );

  stages.push(
    stage({
      key: 'intent',
      label: 'Intent',
      status: 'SUCCESS',
      durationMs: input.metrics.intentMs,
      summary: intentSummary(input.intent),
      metadata: intentMetadata(input.intent, input.diagnostics),
    }),
  );

  stages.push(
    stage({
      key: 'policy',
      label: 'Retrieval Policy',
      status: 'SUCCESS',
      durationMs: input.metrics.policyMs,
      summary: `Mode: ${input.plan.mode}`,
      metadata: {
        memoryV2AskMode: getMemoryAskMode(),
        category: input.plan.category,
        useV2Memory: input.plan.useV2Memory,
        v2AffectsAnswer: input.plan.v2AffectsAnswer,
        useLegacyRetrieval: input.plan.useLegacyRetrieval ?? true,
        jiraFieldsOnly: input.plan.jiraFieldsOnly,
        useLiveJira: input.plan.useLiveJira,
      },
    }),
  );

  const aclStatus: PipelineStageStatus = input.metrics.aclUserInWorkspace
    ? 'SUCCESS'
    : 'WARNING';
  stages.push(
    stage({
      key: 'identity_acl',
      label: 'Identity / ACL',
      status: aclStatus,
      durationMs: input.metrics.identityAclMs,
      summary: input.metrics.aclUserInWorkspace
        ? 'Workspace access verified'
        : 'ACL context limited',
      metadata: {
        trustedUserResolved: Boolean(input.metrics.trustedUserId),
        requestedPersonResolved: Boolean(input.metrics.subjectUserId),
        workspaceMembershipValid: input.metrics.aclUserInWorkspace,
        aclFilteringApplied: true,
        subjectDisplayName: input.metrics.subjectDisplayName,
      },
    }),
  );

  const temporal = input.diagnostics.temporalScope;
  if (temporal?.temporalIntent) {
    const temporalStatus: PipelineStageStatus = temporal.resolvedRunId
      ? 'SUCCESS'
      : temporal.resolutionReason
        ? 'WARNING'
        : 'WARNING';
    stages.push(
      stage({
        key: 'temporal_scope',
        label: 'Temporal Scope',
        status: temporalStatus,
        durationMs: input.metrics.temporalMs,
        summary: `Intent: ${temporal.temporalIntent}`,
        metadata: {
          temporalIntent: temporal.temporalIntent,
          resolvedCheckInId: input.metrics.temporalCheckInId,
          resolvedRunId: temporal.resolvedRunId,
          resolvedSubmissionId: temporal.resolvedSubmissionId,
          runStartedAt: input.metrics.temporalRunStartedAt,
          runCompletedAt: input.metrics.temporalRunCompletedAt,
          submissionCompletedAt: input.metrics.temporalSubmissionCompletedAt,
          scopedSourceCount: temporal.scopedSourceCount,
          legacyFilteredOut: temporal.legacyFilteredOut,
          v2FilteredOut: temporal.v2FilteredOut,
          resolutionReason: temporal.resolutionReason,
        },
      }),
    );
  } else {
    stages.push(
      skippedStage('temporal_scope', 'Temporal Scope', 'No temporal constraint'),
    );
  }

  stages.push(buildV2Stage(input));
  stages.push(buildLegacyStage(input));
  stages.push(buildLiveJiraStage(input, input.documents));
  stages.push(buildMergeStage(input));
  stages.push(buildContextStage(input));
  stages.push(buildOpenAiStage(input));
  stages.push(buildAnswerStage(input, totalDurationMs));

  const { pipelineHealth, failedAtStage } = derivePipelineHealth(stages, warnings);

  const trace: AiPipelineTrace = {
    requestId: input.metrics.requestId,
    startedAt: startedAtIso,
    completedAt: completedAtIso,
    totalDurationMs,
    pipelineHealth,
    failedAtStage,
    warnings,
    stages: mode === 'minimal' ? simplifyStages(stages) : stages,
    visible: mode !== 'off',
    traceMode: mode,
  };

  return trace;
}

function buildV2Stage(input: CompletePipelineTraceInput): PipelineStageTrace {
  const v2 = input.diagnostics.v2Memory;
  if (!input.plan.useV2Memory) {
    return skippedStage(
      'v2_memory',
      'V2 Memory',
      v2?.reason?.join('; ') || 'Not selected by policy',
    );
  }
  if (!input.metrics.trustedUserId) {
    return skippedStage('v2_memory', 'V2 Memory', 'No trusted ACL user');
  }

  const hasError = Boolean(v2?.error);
  const status: PipelineStageStatus = hasError
    ? input.plan.v2AffectsAnswer
      ? 'WARNING'
      : 'WARNING'
    : v2?.invoked
      ? 'SUCCESS'
      : 'SKIPPED';

  const backend =
    v2?.vectorBackend ??
    input.metrics.v2FullDiagnostics?.vectorBackend ??
    'unknown';

  return stage({
    key: 'v2_memory',
    label: 'V2 Memory',
    status,
    durationMs: input.metrics.v2Ms,
    summary: hasError
      ? 'Retrieval error — fallback may apply'
      : `Backend: ${backend}`,
    metadata: {
      backend,
      candidateCount:
        input.metrics.v2FullDiagnostics?.mergedCandidateCount ??
        input.metrics.v2FullDiagnostics?.lexicalCandidateCount,
      aclSafeCandidateCount: input.metrics.v2FullDiagnostics?.finalCount,
      selectedEvidenceCount: v2?.evidenceCount ?? 0,
      affectsAnswer: input.plan.v2AffectsAnswer,
      sourceTypeBreakdown: input.metrics.v2SourceTypeBreakdown,
      error: v2?.error ? sanitizeOpenAiError(v2.error).message : undefined,
      mode: input.plan.mode,
    },
  });
}

function buildLegacyStage(
  input: CompletePipelineTraceInput,
): PipelineStageTrace {
  const hybrid = input.diagnostics.hybrid;
  const hasError = Boolean(input.metrics.legacyError);
  const docCount = input.metrics.legacyDocumentCount;
  const v2Evidence = input.diagnostics.v2Memory?.evidenceCount ?? 0;

  if (input.plan.jiraFieldsOnly && docCount === 0) {
    return skippedStage('legacy_retrieval', 'Legacy Retrieval', 'Jira fields-only');
  }

  const status: PipelineStageStatus = hasError
    ? 'WARNING'
    : docCount > 0 || v2Evidence > 0
      ? 'SUCCESS'
      : 'WARNING';

  return stage({
    key: 'legacy_retrieval',
    label: 'Legacy Retrieval',
    status,
    durationMs: input.metrics.legacyMs,
    summary: hasError
      ? 'Partial failure'
      : `Documents: ${docCount}`,
    metadata: {
      documents: docCount,
      hybridMode: hybrid?.mode,
      keywordHits: hybrid?.keywordHits,
      semanticHits: hybrid?.semanticHits,
      vectorBackend: hybrid?.vectorBackend,
      semanticMs: hybrid?.semanticMs,
      error: input.metrics.legacyError,
    },
  });
}

function buildLiveJiraStage(
  input: CompletePipelineTraceInput,
  documents: KnowledgeDocument[],
): PipelineStageTrace {
  const issueKey = input.diagnostics.pipeline?.issueKey ?? null;
  const jiraFieldsOnly = input.plan.jiraFieldsOnly;
  const requiresLive = input.plan.useLiveJira && Boolean(issueKey);
  const liveRefreshedCount = documents.filter(
    (d) =>
      (d.entity === 'jira_issue' || d.source === 'jira') &&
      d.metadata?.liveRefreshed === true,
  ).length;
  const jiraDoc = issueKey
    ? documents.find(
        (d) =>
          (d.entity === 'jira_issue' || d.source === 'jira') &&
          String(d.metadata?.issueKey ?? d.reference?.entityId ?? '')
            .toUpperCase()
            .includes(issueKey.toUpperCase()),
      )
    : null;
  const cacheOnly = Boolean(jiraDoc && !jiraDoc.metadata?.liveRefreshed);

  if (!requiresLive && liveRefreshedCount === 0) {
    return skippedStage('live_jira', 'Live Jira', 'Not required for this query');
  }

  if (liveRefreshedCount > 0 && jiraDoc) {
    const meta = jiraDoc.metadata ?? {};
    return stage({
      key: 'live_jira',
      label: 'Live Jira',
      status: 'SUCCESS',
      summary: issueKey ? `Issue: ${issueKey}` : `${liveRefreshedCount} live document(s)`,
      metadata: {
        issueKey,
        liveRefreshed: true,
        status: meta.status ?? null,
        priority: meta.priority ?? null,
        assigneeName: meta.assigneeName ?? null,
        summary: meta.summary ?? null,
        authorityClass: 'LIVE_JIRA_CURRENT',
      },
    });
  }

  if (requiresLive && cacheOnly) {
    return stage({
      key: 'live_jira',
      label: 'Live Jira',
      status: 'WARNING',
      summary: `Live API unavailable — using cache for ${issueKey}`,
      metadata: {
        issueKey,
        liveRefreshed: false,
        liveApiFailed: true,
        usedCache: true,
        status: jiraDoc?.metadata?.status ?? null,
        priority: jiraDoc?.metadata?.priority ?? null,
        assigneeName: jiraDoc?.metadata?.assigneeName ?? null,
      },
    });
  }

  if (requiresLive && !jiraDoc) {
    return stage({
      key: 'live_jira',
      label: 'Live Jira',
      status: jiraFieldsOnly ? 'FAILED' : 'WARNING',
      summary: issueKey ? `Issue ${issueKey} — not retrieved` : 'No live Jira data',
      metadata: { issueKey, liveApiFailed: true, currentFieldsRetrieved: 0 },
    });
  }

  return skippedStage('live_jira', 'Live Jira', 'Not required for this query');
}

function buildMergeStage(input: CompletePipelineTraceInput): PipelineStageTrace {
  const m = input.metrics.mergeResult;
  const mergeWarnings = input.metrics.qualityWarnings.length > 0;
  return stage({
    key: 'evidence_merge',
    label: 'Evidence Merge',
    status: mergeWarnings ? 'WARNING' : 'SUCCESS',
    durationMs: input.metrics.mergeMs,
    summary: `Final: ${m.finalCount}`,
    metadata: {
      inputEvidenceCount: input.metrics.mergeInputCount,
      deduplicatedCount:
        input.metrics.mergeInputCount - m.droppedLegacyDuplicates,
      finalCount: m.finalCount,
      v2Count: m.v2Count,
      legacyCount: m.legacyCount,
      liveJiraCount: m.liveJiraCount,
      duplicatesRemoved: m.droppedLegacyDuplicates,
      budgetDrops: m.droppedByBudget,
      authorityBreakdown: input.metrics.authorityBreakdown,
    },
  });
}

function buildContextStage(input: CompletePipelineTraceInput): PipelineStageTrace {
  return stage({
    key: 'context',
    label: 'Context',
    status: 'SUCCESS',
    durationMs: input.metrics.contextMs,
    summary: `Documents: ${input.context.chunks.length}`,
    metadata: {
      documentsUsed: input.context.chunks.length,
      approximateContextSize: input.metrics.promptSize,
      authorityClasses: input.metrics.authorityBreakdown,
      sections: input.context.sections?.map((s) => s.id),
    },
  });
}

function buildOpenAiStage(input: CompletePipelineTraceInput): PipelineStageTrace {
  const o = input.openai;
  if (!o) {
    return skippedStage('openai', 'OpenAI', 'Not reached');
  }
  if (o.skipped) {
    return skippedStage('openai', 'OpenAI', o.skipReason ?? 'Skipped');
  }
  if (o.error) {
    return stage({
      key: 'openai',
      label: 'OpenAI',
      status: 'FAILED',
      durationMs: o.durationMs,
      summary: o.error.category,
      metadata: {
        errorCategory: o.error.category,
        errorMessage: o.error.message,
      },
    });
  }
  return stage({
    key: 'openai',
    label: 'OpenAI',
    status: 'SUCCESS',
    durationMs: o.durationMs,
    summary: o.model ?? o.provider,
    metadata: {
      model: o.model,
      provider: o.provider,
      promptTokens: o.usage?.promptTokens,
      completionTokens: o.usage?.completionTokens,
      totalTokens: o.usage?.totalTokens,
    },
  });
}

function buildAnswerStage(
  input: CompletePipelineTraceInput,
  totalDurationMs: number,
): PipelineStageTrace {
  const a = input.answer;
  if (!a) {
    return skippedStage('answer', 'Answer', 'Not generated');
  }
  return stage({
    key: 'answer',
    label: 'Answer',
    status: a.insufficientData ? 'WARNING' : 'SUCCESS',
    summary: `Confidence: ${a.confidence}`,
    metadata: {
      confidence: a.confidence,
      evidenceCount: a.evidenceCount,
      insufficientData: a.insufficientData,
      provider: a.provider,
      model: a.model,
      totalDurationMs,
    },
  });
}

function derivePipelineHealth(
  stages: PipelineStageTrace[],
  warnings: string[],
): { pipelineHealth: PipelineHealth; failedAtStage: PipelineStageKey | null } {
  const failed = stages.find((s) => s.status === 'FAILED');
  if (failed) {
    return { pipelineHealth: 'FAILED', failedAtStage: failed.key };
  }

  const apiFallback = stages.some((s) => {
    if (s.key === 'openai' && s.status === 'FAILED') return true;
    if (s.key === 'v2_memory' && s.metadata?.error) return true;
    if (s.key === 'legacy_retrieval' && s.metadata?.error) return true;
    if (s.key === 'live_jira' && s.metadata?.liveApiFailed === true) return true;
    return false;
  });

  if (apiFallback) {
    return { pipelineHealth: 'FALLBACK_USED', failedAtStage: null };
  }

  if (
    warnings.length > 0 ||
    stages.some((s) => s.status === 'WARNING')
  ) {
    return { pipelineHealth: 'PARTIAL_SUCCESS', failedAtStage: null };
  }

  return { pipelineHealth: 'ALL_STAGES_PASSED', failedAtStage: null };
}

function intentSummary(intent: DetectedIntent): string {
  const parts: string[] = [intent.intent.replace(/_/g, ' ')];
  if (intent.filters.temporalScope) {
    parts.push(intent.filters.temporalScope.replace(/_/g, ' '));
  }
  if (intent.filters.issueKey) {
    parts.push(intent.filters.issueKey);
  }
  return parts.join(' · ');
}

function intentMetadata(
  intent: DetectedIntent,
  diagnostics: RetrievalDiagnostics,
): Record<string, unknown> {
  const category = diagnostics.v2Memory?.category ?? 'OTHER';
  return {
    intent: intent.intent,
    confidence: intent.confidence,
    category,
    signals: {
      jiraField: intent.filters.jiraFieldsOnly ?? false,
      historical: category === 'HISTORICAL_NARRATIVE' || category === 'COMPOSITE_JIRA_MEMORY',
      narrative: category !== 'CURRENT_JIRA_FIELD',
      latestTemporal: Boolean(intent.filters.temporalScope),
      person: Boolean(intent.filters.userQuery || intent.filters.subjectUserId),
      issueKey: intent.filters.issueKey ?? null,
    },
    rationale: intent.rationale?.slice(0, 160),
  };
}

function stage(p: Omit<PipelineStageTrace, 'key' | 'label'> & {
  key: PipelineStageKey;
  label: string;
}): PipelineStageTrace {
  return { ...p };
}

function skippedStage(
  key: PipelineStageKey,
  label: string,
  reason: string,
): PipelineStageTrace {
  return {
    key,
    label,
    status: 'SKIPPED',
    summary: reason,
  };
}

function simplifyStages(stages: PipelineStageTrace[]): PipelineStageTrace[] {
  return stages.map((s) => ({
    key: s.key,
    label: s.label,
    status: s.status,
    durationMs: s.durationMs,
    summary: s.summary,
  }));
}

export function countV2SourceTypes(
  documents: KnowledgeDocument[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const doc of documents) {
    if (!isV2MemoryDocument(doc)) continue;
    const t =
      typeof doc.metadata?.memorySourceType === 'string'
        ? doc.metadata.memorySourceType
        : 'UNKNOWN';
    out[t] = (out[t] ?? 0) + 1;
  }
  return out;
}

export function countLiveJiraDocuments(
  documents: KnowledgeDocument[],
): number {
  return documents.filter(
    (d) =>
      (d.entity === 'jira_issue' || d.source === 'jira') &&
      d.metadata?.liveRefreshed === true,
  ).length;
}

export function buildAiPipelineTraceSafe(
  input: CompletePipelineTraceInput,
): AiPipelineTrace | null {
  try {
    return buildAiPipelineTrace(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isAiPipelineTraceEnabled()) return null;
    return {
      requestId: input.metrics.requestId,
      startedAt: new Date(input.metrics.startedAt).toISOString(),
      completedAt: new Date().toISOString(),
      totalDurationMs: Date.now() - input.metrics.startedAt,
      pipelineHealth: 'PARTIAL_SUCCESS',
      failedAtStage: null,
      warnings: [`Trace build failed: ${message.slice(0, 120)}`],
      stages: [],
      visible: true,
      traceMode: getAiPipelineTraceMode(),
    };
  }
}
