import { Injectable, Logger } from '@nestjs/common';
import { WorkspaceKnowledgeService } from '../knowledge/workspace-knowledge.service';
import { WorkspaceRetrievalService } from '../retrieval/workspace-retrieval.service';
import { IntentDetectionService } from '../intent/intent-detection.service';
import { ContextBuilderService } from '../context/context-builder.service';
import { WorkspacePromptBuilder } from '../prompts/workspace-prompt.builder';
import {
  extractAssigneeFromQuestion,
  isAssigneeListQuestion,
} from '../retrieval/assignee-match.util';
import { extractUserNameCandidates } from '../retrieval/keyword.util';
import { selectRelevantSources } from '../retrieval/source-selection';
import { shouldUseJiraFieldsOnly } from '../retrieval/jira-field-question';
import { isBlockerCountOrListQuestion } from '../../../jira/blocker-stats.util';
import { MemoryRetrievalService } from '../../../memory/memory-retrieval.service';
import { MemoryEvidenceMergeService } from '../../../memory/memory-evidence-merge.service';
import { adaptMemoryEvidenceToDocuments } from '../../../memory/memory-evidence.adapter';
import { buildMemoryRetrievalPlan } from '../../../memory/memory-retrieval-policy';
import { LatestStandupResolverService } from '../retrieval/latest-standup-resolver.service';
import {
  latestStandupScopeFromFilters,
  documentMatchesLatestStandupFilters,
} from '../retrieval/temporal-retrieval.util';
import {
  KnowledgeDocument,
  RagPrepareResponse,
  WorkspaceAiIntent,
  WorkspaceAskRequest,
  WorkspaceSearchFilters,
  WorkspaceSearchResult,
} from '../types/workspace-ai.types';
import { ResolvedLatestStandupScope } from '../retrieval/temporal-retrieval.util';
import { isAiPipelineTraceEnabled } from '../trace/ai-pipeline-trace.config';
import {
  computeAuthorityBreakdown,
  computeQualityWarnings,
  countLiveJiraDocuments,
  createPipelineRequestId,
} from '../trace/ai-pipeline-trace.builder';
import { RagPipelineTraceMetrics } from '../trace/ai-pipeline-trace.types';

/**
 * Multi-source RAG Pipeline
 *
 * Question → Intent → Retrieval Policy → Legacy (+ optional V2 Memory)
 * → Authority-aware merge → Context → Prompt → (OpenAI via AiChatService)
 *
 * Phase 3B: V2 Memory is gated by MEMORY_V2_ASK_MODE (default LEGACY_ONLY).
 * Live Jira remains authoritative for current Jira fields.
 */
@Injectable()
export class RagPipelineService {
  private readonly logger = new Logger(RagPipelineService.name);

  constructor(
    private readonly knowledge: WorkspaceKnowledgeService,
    private readonly retrieval: WorkspaceRetrievalService,
    private readonly intentDetection: IntentDetectionService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly promptBuilder: WorkspacePromptBuilder,
    private readonly memoryRetrieval: MemoryRetrievalService,
    private readonly evidenceMerge: MemoryEvidenceMergeService,
    private readonly latestStandupResolver: LatestStandupResolverService,
  ) {}

  async prepare(request: WorkspaceAskRequest): Promise<RagPrepareResponse> {
    const question = request.question?.trim() ?? '';
    if (!question) {
      throw new Error('question is required');
    }

    const traceEnabled = isAiPipelineTraceEnabled();
    const pipelineStartedAt = Date.now();
    const requestId = traceEnabled ? createPipelineRequestId() : '';
    let intentMs = 0;
    let policyMs = 0;
    let identityAclMs = 0;
    let temporalMs = 0;
    let legacyMs = 0;
    let v2Ms = 0;
    let mergeMs = 0;
    let contextMs = 0;
    let resolvedScope: ResolvedLatestStandupScope | null = null;
    let subjectDisplayName: string | null = null;
    let v2FullDiagnostics: Record<string, unknown> | undefined;
    let v2SourceTypeBreakdown: Record<string, number> | undefined;
    let aclUserInWorkspace = false;

    const workspaceId = await this.knowledge.resolveWorkspaceId(
      request.workspaceId,
    );
    if (!workspaceId) {
      const intent = this.intentDetection.detect(question);
      const emptyContext = this.contextBuilder.build({
        intent: intent.intent,
        search: {
          query: question,
          filters: intent.filters,
          hits: [],
          bySource: {},
          references: [],
          diagnostics: {
            sources: [],
            summary: 'No workspace resolved — retrieval did not run',
          },
        },
      });
      const prompt = this.promptBuilder.build({
        question,
        intent,
        context: emptyContext,
      });

      this.logger.warn('RAG prepare aborted: workspace could not be resolved');

      return {
        workspaceId: 'unknown',
        question,
        intent,
        retrieval: {
          hitCount: 0,
          filters: intent.filters,
          hits: [],
          references: [],
          diagnostics: {
            sources: [],
            summary: 'No workspace resolved — retrieval did not run',
          },
        },
        context: emptyContext,
        prompt,
        generation: {
          status: 'ready_for_openai',
          message:
            'No workspace resolved — OpenAI should not be called without context.',
        },
      };
    }

    const intentStarted = Date.now();
    const intent = this.intentDetection.detect(question);
    intentMs = Date.now() - intentStarted;
    let filters = this.refineFiltersForIntent(
      intent.intent,
      intent.filters,
      question,
    );

    if (!filters.userQuery) {
      const candidates = extractUserNameCandidates(question);
      const resolved = await this.knowledge.resolveUserQuery(
        workspaceId,
        candidates,
      );
      if (resolved) filters = { ...filters, userQuery: resolved };
    }

    if (isAssigneeListQuestion(question)) {
      const assignee =
        extractAssigneeFromQuestion(question) ?? filters.userQuery ?? null;
      if (assignee) {
        filters = {
          ...filters,
          jiraAssigneeList: true,
          assigneeQuery: assignee,
          userQuery: assignee,
        };
      }
    }

    const temporalDiag: NonNullable<
      WorkspaceSearchResult['diagnostics']['temporalScope']
    > = {
      temporalIntent: filters.temporalScope ?? null,
      resolvedUserId: null,
      resolvedRunId: null,
      resolvedSubmissionId: null,
      scopedSourceCount: 0,
      legacyFilteredOut: 0,
      v2FilteredOut: 0,
      resolutionReason: null,
    };

    if (filters.temporalScope === 'LATEST_STANDUP') {
      const temporalStarted = Date.now();
      const nameCandidates = extractUserNameCandidates(question);
      const subjectUserId = await this.knowledge.resolveSubjectUserId(
        workspaceId,
        nameCandidates,
      );
      if (subjectUserId) {
        filters = { ...filters, subjectUserId };
        temporalDiag.resolvedUserId = subjectUserId;
      }

      const scope = await this.latestStandupResolver.resolve({
        workspaceId,
        temporalScope: 'LATEST_STANDUP',
        subjectUserId: filters.subjectUserId,
      });

      if (scope) {
        resolvedScope = scope;
        subjectDisplayName = scope.subjectDisplayName;
        filters = {
          ...filters,
          latestStandupRunId: scope.runId,
          latestStandupSubmissionId: scope.submissionId,
          latestStandupScopedSourceIds: scope.scopedSourceIds,
          subjectUserId: scope.subjectUserId,
        };
        temporalDiag.resolvedRunId = scope.runId;
        temporalDiag.resolvedSubmissionId = scope.submissionId;
        temporalDiag.resolvedUserId = scope.subjectUserId;
        temporalDiag.scopedSourceCount = scope.scopedSourceIds.length;
        this.logger.log(
          `[TemporalScope] LATEST_STANDUP run=${scope.runId} submission=${scope.submissionId} user=${scope.subjectUserId} sources=${scope.scopedSourceIds.length}`,
        );
      } else {
        temporalDiag.resolutionReason = 'no_completed_submission_in_scope';
        this.logger.warn(
          `[TemporalScope] LATEST_STANDUP unresolved workspace=${workspaceId} subjectUserId=${filters.subjectUserId ?? 'any'}`,
        );
      }
      temporalMs = Date.now() - temporalStarted;
    }

    const identityStarted = Date.now();
    const trustedUserId = await this.knowledge.resolveMemoryAclUserId(
      workspaceId,
      request.userId,
    );
    identityAclMs = Date.now() - identityStarted;
    aclUserInWorkspace = Boolean(trustedUserId);

    const policyStarted = Date.now();
    const plan = buildMemoryRetrievalPlan({
      intent: intent.intent,
      question,
      issueKey: filters.issueKey,
      hasTrustedUserId: Boolean(trustedUserId),
    });
    policyMs = Date.now() - policyStarted;
    if (!subjectDisplayName && filters.userQuery) {
      subjectDisplayName = filters.userQuery;
    }
    if (!request.userId?.trim() && trustedUserId) {
      this.logger.log(
        `V2 ACL user resolved from workspace member (no request.userId) userId=${trustedUserId}`,
      );
    }

    // Policy is authoritative — never leave jiraFieldsOnly=true from refine when composite.
    filters = {
      ...filters,
      jiraFieldsOnly: plan.jiraFieldsOnly,
      memoryAskCategory: plan.category,
    };

    const sourcesSelected = selectRelevantSources({
      intent: intent.intent,
      question,
      filters,
    });
    filters = { ...filters, selectedSources: sourcesSelected };

    const routing = await this.knowledge.getWorkspaceRoutingSnapshot(workspaceId);
    this.logger.log(
      [
        `RAG intent=${intent.intent}`,
        `workspace="${routing.workspaceName}"`,
        `workspaceId=${workspaceId}`,
        `slackWorkspaceId=${routing.slackWorkspaceId}`,
        `jiraConnectionId=${routing.jiraConnectionId ?? 'none'}`,
        `jiraCloudId=${routing.jiraCloudId ?? 'none'}`,
        `hasLiveJira=${routing.hasLiveJira}`,
        `issueKey=${filters.issueKey ?? 'null'}`,
        `sourcesSelected=${sourcesSelected.join(',')}`,
        `v2Mode=${plan.mode}`,
        `v2Category=${plan.category}`,
        `useV2=${plan.useV2Memory}`,
        `v2AffectsAnswer=${plan.v2AffectsAnswer}`,
        `rationale="${intent.rationale}"`,
      ].join(' | '),
    );

    const legacyStarted = Date.now();
    const retrieval = await this.retrieval.retrieve({
      workspaceId,
      query: question,
      intent: intent.intent,
      filters,
      selectedSources: sourcesSelected,
      limit: 20,
    });
    legacyMs = Date.now() - legacyStarted;

    const jiraHits = retrieval.hits.filter((h) => h.source === 'jira').length;
    const slackHits = retrieval.hits.filter((h) => h.source === 'slack').length;
    this.logger.log(
      `[WorkspaceJira] retrieved jiraIssues=${jiraHits} slackMessages=${slackHits} totalHits=${retrieval.hits.length} workspaceId=${workspaceId}`,
    );

    const v2Diag: NonNullable<
      WorkspaceSearchResult['diagnostics']['v2Memory']
    > = {
      mode: plan.mode,
      category: plan.category,
      invoked: false,
      affectsAnswer: plan.v2AffectsAnswer,
      evidenceCount: 0,
      reason: [...plan.reason],
    };

    let v2Documents: KnowledgeDocument[] = [];

    if (plan.useV2Memory && trustedUserId) {
      const started = Date.now();
      try {
        const v2 = await this.memoryRetrieval.retrieve({
          workspaceId,
          userId: trustedUserId,
          query: question,
          linkedIssueKey: filters.issueKey?.trim() || undefined,
          limit: 12,
          debug: traceEnabled,
          runId: filters.latestStandupRunId ?? undefined,
          ownerUserId: filters.subjectUserId ?? undefined,
          scopedSourceIds: filters.latestStandupScopedSourceIds ?? undefined,
        });
        v2Ms = Date.now() - started;
        v2Diag.invoked = true;
        v2Diag.evidenceCount = v2.evidence.length;
        v2Diag.durationMs = v2Ms;
        v2Diag.vectorBackend = v2.diagnostics?.vectorBackend;
        if (v2.diagnostics) {
          aclUserInWorkspace = v2.diagnostics.userInWorkspace;
          v2FullDiagnostics = {
            lexicalCandidateCount: v2.diagnostics.lexicalCandidateCount,
            vectorCandidateCount: v2.diagnostics.vectorCandidateCount,
            mergedCandidateCount: v2.diagnostics.mergedCandidateCount,
            finalCount: v2.diagnostics.finalCount,
            vectorBackend: v2.diagnostics.vectorBackend,
            authorizedTeamCount: v2.diagnostics.authorizedTeamCount,
            userInWorkspace: v2.diagnostics.userInWorkspace,
          };
        }
        v2SourceTypeBreakdown = v2.evidence.reduce<Record<string, number>>(
          (acc, item) => {
            acc[item.sourceType] = (acc[item.sourceType] ?? 0) + 1;
            return acc;
          },
          {},
        );

        if (plan.v2AffectsAnswer) {
          v2Documents = adaptMemoryEvidenceToDocuments(v2);
        } else {
          // V2_SHADOW — metrics only; never enter answer path
          this.logger.log(
            `[V2_SHADOW] workspace=${workspaceId} evidence=${v2.evidence.length} backend=${v2.diagnostics?.vectorBackend ?? 'n/a'} ms=${v2Diag.durationMs}`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        v2Ms = Date.now() - started;
        v2Diag.invoked = true;
        v2Diag.error = message.slice(0, 200);
        v2Diag.durationMs = v2Ms;
        this.logger.warn(
          `[MemoryV2] retrieval failed mode=${plan.mode}: ${message.slice(0, 200)}`,
        );
        // Shadow / Hybrid / Primary: never fail Ask Pulse solely due to V2
        if (plan.mode === 'V2_SHADOW') {
          v2Diag.reason.push('shadow_error_ignored');
        } else {
          v2Diag.reason.push('v2_error_legacy_continues');
        }
      }
    }

    const legacyHitsBeforeScope = retrieval.hits.length;
    const scopedLegacyHits = latestStandupScopeFromFilters(filters)
      ? retrieval.hits.filter((doc) =>
          documentMatchesLatestStandupFilters(doc, filters),
        )
      : retrieval.hits;
    if (latestStandupScopeFromFilters(filters)) {
      temporalDiag.legacyFilteredOut =
        legacyHitsBeforeScope - scopedLegacyHits.length;
    }

    const scopedV2BeforeMerge = v2Documents.length;
    const scopedV2Documents = latestStandupScopeFromFilters(filters)
      ? v2Documents.filter((doc) =>
          documentMatchesLatestStandupFilters(doc, filters),
        )
      : v2Documents;
    if (latestStandupScopeFromFilters(filters)) {
      temporalDiag.v2FilteredOut = scopedV2BeforeMerge - scopedV2Documents.length;
    }

    const mergeStarted = Date.now();
    const merged = this.evidenceMerge.merge({
      plan,
      legacyHits: scopedLegacyHits,
      v2Documents: scopedV2Documents,
      temporalScoped: Boolean(latestStandupScopeFromFilters(filters)),
    });
    mergeMs = Date.now() - mergeStarted;

    const qualityWarnings = computeQualityWarnings({
      temporalIntent: temporalDiag.temporalIntent,
      resolvedRunId: temporalDiag.resolvedRunId,
      subjectUserId: filters.subjectUserId ?? null,
      documents: merged.documents,
    });

    const searchForContext: WorkspaceSearchResult = {
      ...retrieval,
      hits: merged.documents,
      bySource: groupBySource(merged.documents),
      references: merged.documents.map((d) => d.reference),
      diagnostics: {
        ...retrieval.diagnostics,
        v2Memory: v2Diag,
        temporalScope: temporalDiag,
        evidenceMerge: {
          inputCount:
            scopedLegacyHits.length + scopedV2Documents.length,
          finalCount: merged.documents.length,
          v2Count: merged.v2Count,
          legacyCount: merged.legacyCount,
          liveJiraCount: merged.liveJiraCount,
          duplicatesRemoved: merged.droppedLegacyDuplicates,
          budgetDrops: merged.droppedByBudget,
        },
        summary: [
          retrieval.diagnostics.summary,
          `v2Mode=${plan.mode}`,
          `v2Invoked=${v2Diag.invoked}`,
          `v2InAnswer=${plan.v2AffectsAnswer}`,
          `v2Evidence=${v2Diag.evidenceCount}`,
          `merged=${merged.documents.length}`,
        ].join(' | '),
      },
    };

    const contextStarted = Date.now();
    const context = this.contextBuilder.build({
      intent: intent.intent,
      search: searchForContext,
    });
    contextMs = Date.now() - contextStarted;

    const prompt = this.promptBuilder.build({
      question,
      intent,
      context,
      retrievalPlan: plan,
    });

    const promptSize = (prompt.system?.length ?? 0) + (prompt.user?.length ?? 0);

    const jiraDoc = merged.documents.find(
      (d) =>
        d.entity === 'jira_issue' &&
        filters.issueKey &&
        String(d.metadata?.issueKey ?? d.reference?.entityId ?? '')
          .toUpperCase()
          .includes(filters.issueKey.toUpperCase()),
    );
    this.logger.log(
      [
        '[RAG Multi-Source]',
        `workspace="${routing.workspaceName}"`,
        `workspaceId=${workspaceId}`,
        `question="${question.slice(0, 100)}"`,
        `intent=${intent.intent}`,
        `category=${plan.category}`,
        `issueKey=${filters.issueKey ?? 'none'}`,
        `jiraFieldsOnly=${Boolean(filters.jiraFieldsOnly)}`,
        `temporal=${filters.temporalScope ?? 'none'}`,
        `sources=${sourcesSelected.join(',')}`,
        `merged=${merged.documents.length}`,
        `v2=${merged.v2Count}`,
        `legacy=${merged.legacyCount}`,
        `liveJira=${merged.liveJiraCount}`,
        `liveRefreshed=${jiraDoc?.metadata?.liveRefreshed === true}`,
        jiraDoc
          ? `jiraStatus=${jiraDoc.metadata?.status ?? 'missing'}`
          : 'jiraStatus=n/a',
        jiraDoc
          ? `jiraPriority=${jiraDoc.metadata?.priority ?? 'missing'}`
          : 'jiraPriority=n/a',
        jiraDoc
          ? `jiraAssignee=${jiraDoc.metadata?.assigneeName ?? 'missing'}`
          : 'jiraAssignee=n/a',
        `promptSize=${promptSize}`,
        `contextChunks=${context.chunks.length}`,
      ].join(' | '),
    );

    if (searchForContext.diagnostics.pipeline) {
      searchForContext.diagnostics.pipeline.promptSize = promptSize;
      searchForContext.diagnostics.pipeline.finalSourcesUsed =
        context.finalSourcesUsed ??
        searchForContext.diagnostics.pipeline.finalSourcesUsed;
    }

    this.logger.log(
      [
        `RAG prepare complete`,
        `intent=${intent.intent}`,
        `hits=${merged.documents.length}`,
        `chunks=${context.chunks.length}`,
        `sections=${context.sections?.map((s) => s.id).join(',') || 'none'}`,
        `promptSize=${promptSize}`,
        `finalSources=${(context.finalSourcesUsed ?? []).join(',')}`,
        `v2Mode=${plan.mode}`,
      ].join(' | '),
    );

    if (merged.documents.length === 0) {
      this.logger.warn(
        `RAG empty retrieval — ${searchForContext.diagnostics.summary}`,
      );
    }

    this.warnIfSingleSourceRisk(intent.intent, filters, context);

    const traceMetrics: RagPipelineTraceMetrics | undefined = traceEnabled
      ? {
          requestId,
          startedAt: pipelineStartedAt,
          workspaceId,
          question,
          intentMs,
          policyMs,
          identityAclMs,
          temporalMs,
          legacyMs,
          v2Ms,
          mergeMs,
          contextMs,
          trustedUserId,
          subjectUserId: filters.subjectUserId ?? null,
          subjectDisplayName,
          aclUserInWorkspace,
          temporalRunStartedAt:
            resolvedScope?.runStartedAt?.toISOString() ?? null,
          temporalRunCompletedAt:
            resolvedScope?.runCompletedAt?.toISOString() ?? null,
          temporalSubmissionCompletedAt:
            resolvedScope?.submissionCompletedAt?.toISOString() ?? null,
          temporalCheckInId: resolvedScope?.checkInId ?? null,
          v2FullDiagnostics,
          v2SourceTypeBreakdown,
          legacyDocumentCount: scopedLegacyHits.length,
          liveJiraDocumentCount: countLiveJiraDocuments(merged.documents),
          mergeInputCount:
            scopedLegacyHits.length + scopedV2Documents.length,
          mergeResult: {
            droppedLegacyDuplicates: merged.droppedLegacyDuplicates,
            droppedByBudget: merged.droppedByBudget,
            v2Count: merged.v2Count,
            liveJiraCount: merged.liveJiraCount,
            legacyCount: merged.legacyCount,
            finalCount: merged.documents.length,
          },
          promptSize,
          authorityBreakdown: computeAuthorityBreakdown(merged.documents),
          qualityWarnings,
        }
      : undefined;

    return {
      workspaceId,
      question,
      intent: { ...intent, filters: searchForContext.filters },
      retrieval: {
        hitCount: merged.documents.length,
        filters: searchForContext.filters,
        hits: merged.documents,
        references: searchForContext.references,
        diagnostics: searchForContext.diagnostics,
      },
      context,
      prompt,
      generation: {
        status: 'ready_for_openai',
        message:
          'Multi-source RAG prepare complete. Use AiChatService.chat() to call OpenAI with prompt.messages.',
      },
      traceMetrics,
    };
  }

  private refineFiltersForIntent(
    intent: WorkspaceAiIntent,
    filters: WorkspaceSearchFilters,
    question = '',
  ): WorkspaceSearchFilters {
    const next = { ...filters };

    next.keyword = null;
    next.standupQuery = null;
    next.blockerQuery = null;
    next.sprintQuery = null;

    const fieldsOnly = shouldUseJiraFieldsOnly({
      intent,
      question,
      issueKey: next.issueKey,
    });
    next.jiraFieldsOnly = fieldsOnly;

    if (
      (intent === WorkspaceAiIntent.ISSUE_ANALYSIS ||
        intent === WorkspaceAiIntent.ISSUE_STATUS ||
        fieldsOnly) &&
      next.issueKey
    ) {
      next.keyword = next.issueKey;
      if (intent === WorkspaceAiIntent.ISSUE_STATUS || fieldsOnly) {
        next.userQuery = null;
        next.dateFrom = null;
        next.dateTo = null;
        next.searchTokens = null;
      }
    }

    if (
      intent === WorkspaceAiIntent.LIST_MEMBERS ||
      intent === WorkspaceAiIntent.SLACK_MEMBERS
    ) {
      next.userQuery = null;
      next.dateFrom = null;
      next.dateTo = null;
      next.slackMembersOnly = true;
      next.jiraMembersOnly = false;
      next.keyword = null;
      next.jiraFieldsOnly = false;
    }

    if (intent === WorkspaceAiIntent.JIRA_MEMBERS) {
      next.userQuery = null;
      next.dateFrom = null;
      next.dateTo = null;
      next.jiraMembersOnly = true;
      next.slackMembersOnly = false;
      next.keyword = null;
      next.jiraFieldsOnly = false;
    }

    if (
      intent === WorkspaceAiIntent.GET_BLOCKERS ||
      isBlockerCountOrListQuestion(question)
    ) {
      next.blockersFullList = true;
      next.userQuery = null;
      next.dateFrom = null;
      next.dateTo = null;
      next.keyword = question.trim() || null;
      next.searchTokens = null;
      next.jiraFieldsOnly = false;
    }

    if (intent === WorkspaceAiIntent.TEAM_MEMORY_SEARCH && !next.issueKey) {
      next.keyword = null;
    }

    return next;
  }

  private warnIfSingleSourceRisk(
    intent: WorkspaceAiIntent,
    filters: WorkspaceSearchFilters,
    context: { finalSourcesUsed?: string[]; sections?: Array<{ id: string }> },
  ): void {
    const issueKey = filters.issueKey?.trim();
    if (!issueKey) return;
    if (filters.jiraFieldsOnly) {
      this.logger.log(
        `Jira fields-only: issue ${issueKey} — single-source Jira is expected`,
      );
      return;
    }
    if (
      intent === WorkspaceAiIntent.SLACK_MEMBERS ||
      intent === WorkspaceAiIntent.LIST_MEMBERS ||
      intent === WorkspaceAiIntent.JIRA_MEMBERS
    ) {
      return;
    }

    const sources = context.finalSourcesUsed ?? [];
    const sectionIds = context.sections?.map((s) => s.id) ?? [];
    const hasJira = sectionIds.includes('jira') || sources.includes('jira');
    const supporting = sectionIds.filter((id) => id !== 'jira' && id !== 'other');

    if (!hasJira) {
      this.logger.warn(
        `Multi-source RAG: issue ${issueKey} has no Jira section — answer must say Jira unavailable if fields are requested`,
      );
    }
    if (supporting.length === 0 && hasJira) {
      this.logger.log(
        `Multi-source RAG: issue ${issueKey} has Jira only (other sources empty after filters) — graceful degrade`,
      );
    }
  }
}

function groupBySource(
  docs: KnowledgeDocument[],
): WorkspaceSearchResult['bySource'] {
  const out: WorkspaceSearchResult['bySource'] = {};
  for (const doc of docs) {
    const list = out[doc.source] ?? [];
    list.push(doc);
    out[doc.source] = list;
  }
  return out;
}
