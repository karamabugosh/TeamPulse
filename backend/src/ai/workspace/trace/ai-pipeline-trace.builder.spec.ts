/**
 * AI Pipeline Trace builder tests.
 * Run: npx ts-node src/ai/workspace/trace/ai-pipeline-trace.builder.spec.ts
 */
import { WorkspaceAiIntent } from '../types/workspace-ai.types';
import { buildMemoryRetrievalPlan } from '../../../memory/memory-retrieval-policy';
import {
  buildAiPipelineTrace,
  computeQualityWarnings,
  createPipelineRequestId,
  sanitizeOpenAiError,
} from './ai-pipeline-trace.builder';
import { RagPipelineTraceMetrics } from './ai-pipeline-trace.types';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function baseMetrics(overrides: Partial<RagPipelineTraceMetrics> = {}): RagPipelineTraceMetrics {
  return {
    requestId: createPipelineRequestId(),
    startedAt: Date.now() - 500,
    workspaceId: 'ws-1',
    question: 'What blocker did Karam report in the latest standup?',
    intentMs: 3,
    policyMs: 1,
    identityAclMs: 4,
    temporalMs: 8,
    legacyMs: 24,
    v2Ms: 31,
    mergeMs: 2,
    contextMs: 3,
    trustedUserId: 'user-1',
    subjectUserId: 'user-karam',
    subjectDisplayName: 'Karam',
    aclUserInWorkspace: true,
    temporalRunStartedAt: '2026-08-22T15:05:27.814Z',
    temporalRunCompletedAt: null,
    temporalSubmissionCompletedAt: '2026-08-22T15:08:39.988Z',
    temporalCheckInId: 'check-in-1',
    v2FullDiagnostics: {
      mergedCandidateCount: 18,
      finalCount: 5,
      vectorBackend: 'pgvector',
    },
    v2SourceTypeBreakdown: { STANDUP_ANSWER: 3, BLOCKER: 1, REPORT: 1 },
    legacyDocumentCount: 7,
    liveJiraDocumentCount: 0,
    mergeInputCount: 12,
    mergeResult: {
      droppedLegacyDuplicates: 1,
      droppedByBudget: 0,
      v2Count: 5,
      liveJiraCount: 0,
      legacyCount: 2,
      finalCount: 7,
    },
    promptSize: 4200,
    authorityBreakdown: {
      TEAM_MEMORY_HISTORICAL: 5,
      LEGACY_SUPPORTING: 2,
    },
    qualityWarnings: [],
    ...overrides,
  };
}

function main() {
  assert(createPipelineRequestId().length === 6, 'request id length');

  const sanitized = sanitizeOpenAiError(new Error('Bearer sk-secret123 timeout'));
  assert(!sanitized.message.includes('sk-secret'), 'api key redacted');
  assert(sanitized.category === 'TIMEOUT', 'timeout category');

  const multiRunWarnings = computeQualityWarnings({
    temporalIntent: 'LATEST_STANDUP',
    resolvedRunId: 'run-new',
    subjectUserId: 'user-karam',
    documents: [
      {
        id: '1',
        workspaceId: 'ws',
        source: 'team_memory',
        entity: 'standup_submission',
        title: 't',
        content: 'c',
        timestamp: null,
        url: null,
        reference: {
          source: 'team_memory',
          entity: 'standup_submission',
          entityId: 'a1',
          timestamp: null,
          workspaceId: 'ws',
          url: null,
          label: 'l',
        },
        metadata: { runId: 'run-old' },
      },
      {
        id: '2',
        workspaceId: 'ws',
        source: 'team_memory',
        entity: 'standup_submission',
        title: 't2',
        content: 'c2',
        timestamp: null,
        url: null,
        reference: {
          source: 'team_memory',
          entity: 'standup_submission',
          entityId: 'a2',
          timestamp: null,
          workspaceId: 'ws',
          url: null,
          label: 'l2',
        },
        metadata: { runId: 'run-new' },
      },
    ],
  });
  assert(
    multiRunWarnings.some((w) => w.includes('multiple runs')),
    'multi-run warning',
  );

  const plan = buildMemoryRetrievalPlan({
    intent: WorkspaceAiIntent.TEAM_MEMORY_SEARCH,
    question: 'What blocker did Karam report in the latest standup?',
    hasTrustedUserId: true,
    modeOverride: 'HYBRID',
  });

  const trace = buildAiPipelineTrace({
    metrics: baseMetrics(),
    intent: {
      intent: WorkspaceAiIntent.TEAM_MEMORY_SEARCH,
      confidence: 0.9,
      filters: { temporalScope: 'LATEST_STANDUP', subjectUserId: 'user-karam' },
      rationale: 'historical standup',
    },
    plan,
    diagnostics: {
      sources: [],
      summary: 'test',
      temporalScope: {
        temporalIntent: 'LATEST_STANDUP',
        resolvedUserId: 'user-karam',
        resolvedRunId: 'run-new',
        resolvedSubmissionId: 'sub-new',
        scopedSourceCount: 6,
        legacyFilteredOut: 0,
        v2FilteredOut: 0,
        resolutionReason: null,
      },
      v2Memory: {
        mode: 'HYBRID',
        category: 'HISTORICAL_NARRATIVE',
        invoked: true,
        affectsAnswer: true,
        evidenceCount: 5,
        vectorBackend: 'pgvector',
        durationMs: 31,
        reason: ['hybrid_merge'],
      },
      evidenceMerge: {
        inputCount: 12,
        finalCount: 7,
        v2Count: 5,
        legacyCount: 2,
        liveJiraCount: 0,
        duplicatesRemoved: 1,
        budgetDrops: 0,
      },
    },
    context: {
      intent: WorkspaceAiIntent.TEAM_MEMORY_SEARCH,
      chunks: [],
      sections: [{ id: 'team_memory', title: 'Team Memory', chunks: [], text: '' }],
      contextText: '',
      tokenEstimate: 100,
      insufficientData: false,
      references: [],
      finalSourcesUsed: ['team_memory'],
    },
    documents: [],
    openai: {
      durationMs: 1240,
      model: 'gpt-4o-mini',
      provider: 'openai',
      usage: { totalTokens: 900 },
    },
    answer: {
      confidence: 'High',
      evidenceCount: 5,
      insufficientData: false,
      provider: 'openai',
      model: 'gpt-4o-mini',
    },
  });

  assert(trace, 'trace built');
  assert(trace!.stages.length >= 10, 'all stages present');
  assert(
    trace!.stages.find((s) => s.key === 'temporal_scope')?.status === 'SUCCESS',
    'temporal stage success',
  );
  assert(
    trace!.stages.find((s) => s.key === 'live_jira')?.status === 'SKIPPED',
    'live jira skipped for latest standup',
  );
  assert(trace!.requestId.length > 0, 'request id on trace');

  const jiraPlan = buildMemoryRetrievalPlan({
    intent: WorkspaceAiIntent.ISSUE_STATUS,
    question: 'Who is assigned to SCRUM-9?',
    issueKey: 'SCRUM-9',
    hasTrustedUserId: true,
    modeOverride: 'HYBRID',
  });
  const jiraTrace = buildAiPipelineTrace({
    metrics: baseMetrics({
      question: 'Who is assigned to SCRUM-9?',
      temporalMs: 0,
      v2Ms: 0,
      liveJiraDocumentCount: 1,
    }),
    intent: {
      intent: WorkspaceAiIntent.ISSUE_STATUS,
      confidence: 0.95,
      filters: { issueKey: 'SCRUM-9', jiraFieldsOnly: true },
      rationale: 'current jira field',
    },
    plan: jiraPlan,
    diagnostics: {
      sources: [],
      summary: 'jira only',
      pipeline: {
        intent: WorkspaceAiIntent.ISSUE_STATUS,
        workspaceId: 'ws-1',
        issueKey: 'SCRUM-9',
        sourcesSelected: ['jira'],
        sourcesQueried: ['jira'],
        retrievedDocumentsCount: 1,
        documentsAfterMerge: 1,
        documentsAfterDeduplication: 1,
        documentsAfterReranking: 1,
        finalSourcesUsed: ['jira'],
      },
    },
    context: {
      intent: WorkspaceAiIntent.ISSUE_STATUS,
      chunks: [],
      sections: [{ id: 'jira', title: 'Jira', chunks: [], text: '' }],
      contextText: '',
      tokenEstimate: 50,
      insufficientData: false,
      references: [],
      finalSourcesUsed: ['jira'],
    },
    documents: [
      {
        id: 'j1',
        workspaceId: 'ws',
        source: 'jira',
        entity: 'jira_issue',
        title: 'SCRUM-9',
        content: 'Authority: LIVE_JIRA_CURRENT',
        timestamp: null,
        url: null,
        reference: {
          source: 'jira',
          entity: 'jira_issue',
          entityId: 'SCRUM-9',
          timestamp: null,
          workspaceId: 'ws',
          url: null,
          label: 'SCRUM-9',
        },
        metadata: { authorityClass: 'LIVE_JIRA_CURRENT', liveRefreshed: true, issueKey: 'SCRUM-9', status: 'In Progress', priority: 'High', assigneeName: 'Karam', summary: 'Test' },
      },
    ],
    openai: {
      durationMs: 800,
      model: 'gpt-4o-mini',
      provider: 'openai',
    },
    answer: {
      confidence: 'High',
      evidenceCount: 1,
      insufficientData: false,
      provider: 'openai',
      model: 'gpt-4o-mini',
    },
  });

  assert(
    jiraTrace!.stages.find((s) => s.key === 'v2_memory')?.status === 'SKIPPED',
    'v2 skipped for jira field question',
  );
  assert(
    jiraTrace!.stages.find((s) => s.key === 'live_jira')?.status === 'SUCCESS',
    'live jira success',
  );

  console.log('✓ ai-pipeline-trace.builder.spec.ts passed');
}

main();
