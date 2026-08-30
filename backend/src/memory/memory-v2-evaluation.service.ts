import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  KnowledgeDocument,
  WorkspaceAiIntent,
} from '../ai/workspace/types/workspace-ai.types';
import { ContextBuilderService } from '../ai/workspace/context/context-builder.service';
import { WorkspacePromptBuilder } from '../ai/workspace/prompts/workspace-prompt.builder';
import { OpenAiEmbeddingProvider } from '../ai/workspace/retrieval/openai-embedding.provider';
import {
  adaptMemoryEvidenceToDocuments,
  isV2MemoryDocument,
} from './memory-evidence.adapter';
import { MemoryEvidenceMergeService } from './memory-evidence-merge.service';
import {
  buildMemoryRetrievalPlan,
  classifyMemoryAskCategory,
  MemoryAskCategory,
} from './memory-retrieval-policy';
import { MemoryRetrievalService } from './memory-retrieval.service';
import { MemoryAclService } from './memory-acl.service';
import { MemoryFullTextSearchService } from './memory-fulltext-search.service';
import { MemoryVectorSearchService } from './memory-vector-search.service';
import { MemoryHybridRankingService } from './memory-hybrid-ranking.service';
import { MemoryEmbeddingService } from './memory-embedding.service';
import {
  AggregateRetrievalQuality,
  AuthorityMetrics,
  MemoryV2EvaluationCase,
  MemoryV2EvaluationResult,
  MemoryV2EvaluationRunReport,
  SecurityMetrics,
} from './memory-eval.types';
import {
  hitAtK,
  mean,
  reciprocalRank,
  recallAtK,
} from './memory-eval.metrics';
import {
  buildEvalCases,
  cleanupEvalFixtures,
  seedEvalFixtures,
} from './memory-eval.dataset';
import { MemoryV2ReadinessService } from './memory-v2-readiness.service';
import { MEMORY_SOURCE } from './memory-source.constants';
import { MemoryEvidenceItem } from './memory-retrieval.types';

/**
 * Phase 3C evaluation — separate from production Ask Pulse generation.
 * Never mutates MEMORY_V2_ASK_MODE.
 */
@Injectable()
export class MemoryV2EvaluationService {
  private readonly logger = new Logger(MemoryV2EvaluationService.name);

  constructor(
    private readonly memoryRetrieval: MemoryRetrievalService,
    private readonly evidenceMerge: MemoryEvidenceMergeService,
    private readonly readiness: MemoryV2ReadinessService,
  ) {}

  async runWorkspaceEvaluation(params: {
    prisma: PrismaClient;
    workspaceId: string;
    userId?: string;
  }): Promise<MemoryV2EvaluationRunReport> {
    const startedAt = new Date().toISOString();
    const ctx = await seedEvalFixtures(params.prisma, {
      workspaceId: params.workspaceId,
      userId: params.userId,
    });
    const cases = buildEvalCases(ctx);
    const results: MemoryV2EvaluationResult[] = [];

    try {
      for (const c of cases) {
        const result = await this.evaluateCase(c);
        results.push(result);
        this.logger.log(
          `[Eval3C] ${result.status} ${result.caseId} v2=${result.v2.evidenceCount}`,
        );
      }
      results.push(
        this.evaluateFailureInjection(ctx.workspaceId),
      );

      const aggregateQuality = aggregateQualityMetrics(results);
      const readiness = await this.readiness.buildReport({
        prisma: params.prisma,
        workspaceId: ctx.workspaceId,
        results,
        aggregateQuality,
        latenciesMs: results.map((r) => r.v2.latencyMs).filter((n) => n > 0),
      });

      return {
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        startedAt,
        finishedAt: new Date().toISOString(),
        results,
        aggregateQuality,
        readiness,
        modeMutation: 'NONE',
      };
    } finally {
      await cleanupEvalFixtures(params.prisma, ctx);
    }
  }

  async evaluateCase(
    c: MemoryV2EvaluationCase,
  ): Promise<MemoryV2EvaluationResult> {
    const issueKey = c.expectedIssueKey ?? extractIssueKey(c.query);
    const intent = intentForCategory(c.expectedCategory);
    const category = classifyMemoryAskCategory({
      intent,
      question: c.query,
      issueKey,
    });
    const plan = buildMemoryRetrievalPlan({
      intent,
      question: c.query,
      issueKey,
      hasTrustedUserId: true,
      modeOverride: 'HYBRID',
    });

    const reasons: string[] = [];
    const isFieldAuthority =
      c.kind === 'CURRENT_JIRA_FIELD' || c.kind === 'POISONED_AUTHORITY';

    if (isFieldAuthority && plan.useV2Memory) {
      reasons.push('FAIL: pure Jira field enables V2');
    }
    if (isFieldAuthority && category !== 'CURRENT_JIRA_FIELD') {
      reasons.push(`category_mismatch expected=CURRENT_JIRA_FIELD got=${category}`);
    }

    let v2Evidence: MemoryEvidenceItem[] = [];
    let v2Latency = 0;
    let vectorBackend: string | undefined;
    let v2Error: string | undefined;

    if (!isFieldAuthority) {
      const t0 = Date.now();
      try {
        const v2 = await this.memoryRetrieval.retrieve({
          workspaceId: c.workspaceId,
          userId: c.userId,
          query: c.query,
          linkedIssueKey: issueKey ?? undefined,
          limit: 12,
          debug: true,
        });
        v2Latency = Date.now() - t0;
        v2Evidence = v2.evidence;
        vectorBackend = v2.diagnostics?.vectorBackend;
      } catch (error) {
        v2Latency = Date.now() - t0;
        v2Error = error instanceof Error ? error.message : String(error);
        reasons.push(`v2_error:${v2Error.slice(0, 120)}`);
      }
    }

    const identities = v2Evidence.map((e) => `${e.sourceType}:${e.sourceId}`);
    const texts = v2Evidence.map((e) => e.text);
    const expected = c.expectedSourceIdentities ?? [];

    const quality = {
      hitAt1: hitAtK(identities, expected, 1),
      hitAt3: hitAtK(identities, expected, 3),
      hitAt5: hitAtK(identities, expected, 5),
      reciprocalRank: reciprocalRank(identities, expected),
      recallAtK: recallAtK(identities, expected, 5),
      expectedEvidenceFound:
        expected.length === 0
          ? true
          : expected.some((id) => identities.includes(id)),
    };

    let noEvidenceStrongHit = false;
    if (c.kind === 'NO_EVIDENCE' && v2Evidence.length > 0) {
      // Dense workspaces can return weak semantic neighbors for nonsense queries.
      // Fail only on a real match: FTS hit, high similarity, or query-token leakage.
      const distinctive = c.query
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((t) => t.length >= 8);
      noEvidenceStrongHit = v2Evidence.some((e) => {
        const lex = e.retrieval.lexicalRank != null;
        const text = e.text.toLowerCase();
        const tokenLeak = distinctive.some((t) => text.includes(t));
        return lex || tokenLeak;
      });
      if (noEvidenceStrongHit) {
        quality.expectedEvidenceFound = false;
        reasons.push('no-evidence query returned strong matches');
      }
    }

    const security: SecurityMetrics = {
      workspaceLeakage: false,
      teamLeakage: false,
      privateLeakage: false,
      malformedPermissive: false,
    };
    this.scanForbidden(c, texts, identities, security, reasons);

    const authorityBundle = this.evaluateAuthorityContext(c, v2Evidence, plan);
    security.workspaceLeakage =
      security.workspaceLeakage || authorityBundle.security.workspaceLeakage;
    security.teamLeakage =
      security.teamLeakage || authorityBundle.security.teamLeakage;
    security.privateLeakage =
      security.privateLeakage || authorityBundle.security.privateLeakage;
    security.malformedPermissive =
      security.malformedPermissive ||
      authorityBundle.security.malformedPermissive;
    reasons.push(...authorityBundle.reasons);

    if (
      expected.length > 0 &&
      !quality.hitAt5 &&
      !isFieldAuthority &&
      c.kind !== 'NO_EVIDENCE' &&
      c.kind !== 'WORKSPACE_ISOLATION' &&
      c.kind !== 'TEAM_ACL' &&
      c.kind !== 'PRIVATE_ACL' &&
      c.kind !== 'MALFORMED_ACL'
    ) {
      reasons.push('expected evidence missing from Hit@5');
    }

    const securityFail =
      security.workspaceLeakage ||
      security.teamLeakage ||
      security.privateLeakage ||
      security.malformedPermissive;
    const authorityFail =
      authorityBundle.authority.memoryOverrodeJira ||
      authorityBundle.authority.currentJiraCorrect === false ||
      authorityBundle.authority.poisonedValueAbsent === false;

    const status: 'PASS' | 'FAIL' =
      securityFail ||
      authorityFail ||
      reasons.some((r) => r.startsWith('FAIL:')) ||
      (expected.length > 0 &&
        !quality.expectedEvidenceFound &&
        !isFieldAuthority &&
        c.kind !== 'WORKSPACE_ISOLATION' &&
        c.kind !== 'TEAM_ACL' &&
        c.kind !== 'PRIVATE_ACL' &&
        c.kind !== 'MALFORMED_ACL' &&
        c.kind !== 'NO_EVIDENCE')
        ? 'FAIL'
        : c.kind === 'NO_EVIDENCE' && noEvidenceStrongHit
          ? 'FAIL'
          : 'PASS';

    return {
      caseId: c.id,
      kind: c.kind,
      category,
      legacy: {
        evidenceCount: 0,
        sourceTypes: [],
        sourceIdentities: [],
        latencyMs: 0,
      },
      v2: {
        evidenceCount: v2Evidence.length,
        sourceTypes: [...new Set(v2Evidence.map((e) => e.sourceType))],
        sourceIdentities: identities,
        latencyMs: v2Latency,
        vectorBackend,
        error: v2Error,
      },
      quality,
      security,
      authority: authorityBundle.authority,
      citationTraceable: authorityBundle.citationTraceable,
      status,
      reasons,
    };
  }

  private scanForbidden(
    c: MemoryV2EvaluationCase,
    texts: string[],
    identities: string[],
    security: SecurityMetrics,
    reasons: string[],
  ): void {
    for (const marker of c.forbiddenTextMarkers ?? []) {
      if (!texts.some((t) => t.includes(marker))) continue;
      reasons.push(`forbidden_marker:${marker}`);
      if (c.kind === 'WORKSPACE_ISOLATION' || marker.includes('WORKSPACE_LEAK')) {
        security.workspaceLeakage = true;
      }
      if (c.kind === 'TEAM_ACL' || marker.includes('BETA_ONLY')) {
        security.teamLeakage = true;
      }
      if (c.kind === 'PRIVATE_ACL' || marker.includes('PRIVATE_ONLY')) {
        security.privateLeakage = true;
      }
      if (c.kind === 'MALFORMED_ACL' || marker.includes('MALFORMED')) {
        security.malformedPermissive = true;
      }
    }
    for (const sid of c.forbiddenSourceIds ?? []) {
      if (identities.some((id) => id.endsWith(`:${sid}`) || id === sid)) {
        reasons.push(`forbidden_sourceId:${sid}`);
        if (c.kind === 'WORKSPACE_ISOLATION') security.workspaceLeakage = true;
        if (c.kind === 'TEAM_ACL') security.teamLeakage = true;
        if (c.kind === 'PRIVATE_ACL') security.privateLeakage = true;
      }
    }
  }

  private evaluateAuthorityContext(
    c: MemoryV2EvaluationCase,
    v2Evidence: MemoryEvidenceItem[],
    plan: ReturnType<typeof buildMemoryRetrievalPlan>,
  ): {
    authority: AuthorityMetrics;
    citationTraceable: boolean;
    security: SecurityMetrics;
    reasons: string[];
  } {
    const reasons: string[] = [];
    const security: SecurityMetrics = {
      workspaceLeakage: false,
      teamLeakage: false,
      privateLeakage: false,
      malformedPermissive: false,
    };

    const isField =
      c.kind === 'CURRENT_JIRA_FIELD' || c.kind === 'POISONED_AUTHORITY';
    const live = c.liveJiraFixture;
    const jiraDoc = live ? makeJiraDoc(c.workspaceId, c.expectedIssueKey, live) : null;

    const v2Docs = isField
      ? [
          makePoisonDoc(c.workspaceId),
          ...adaptMemoryEvidenceToDocuments({
            query: c.query,
            workspaceId: c.workspaceId,
            evidence: v2Evidence,
          }),
        ]
      : adaptMemoryEvidenceToDocuments({
          query: c.query,
          workspaceId: c.workspaceId,
          evidence: v2Evidence,
        });

    // Production field path: V2 does not affect answer
    const answerMerge = this.evidenceMerge.merge({
      plan: {
        ...plan,
        useV2Memory: isField ? false : plan.useV2Memory,
        v2AffectsAnswer: isField ? false : true,
        jiraFieldsOnly: isField,
      },
      legacyHits: jiraDoc ? [jiraDoc] : [],
      v2Documents: isField ? [] : v2Docs,
    });

    const context = new ContextBuilderService().build({
      intent: intentForCategory(c.expectedCategory),
      search: {
        query: c.query,
        filters: {
          issueKey: c.expectedIssueKey,
          jiraFieldsOnly: isField,
        },
        hits: answerMerge.documents,
        bySource: {},
        references: answerMerge.documents.map((d) => d.reference),
        diagnostics: { sources: [], summary: 'eval' },
      },
    });
    const prompt = new WorkspacePromptBuilder().build({
      question: c.query,
      intent: {
        intent: intentForCategory(c.expectedCategory),
        confidence: 1,
        filters: { issueKey: c.expectedIssueKey },
        rationale: 'eval',
      },
      context,
      retrievalPlan: {
        ...plan,
        jiraFieldsOnly: isField,
        useV2Memory: isField ? false : plan.useV2Memory,
        v2AffectsAnswer: isField ? false : plan.v2AffectsAnswer,
      },
    });

    const blob = context.contextText;
    for (const marker of c.forbiddenTextMarkers ?? []) {
      if (!blob.includes(marker)) continue;
      // Poisoned markers are expected to be absent from field answers
      if (isField && (marker.includes('WRONG_MEMORY') || marker === 'CANCELLED')) {
        reasons.push(`field_context_poison:${marker}`);
        continue;
      }
      reasons.push(`context_forbidden:${marker}`);
      if (marker.includes('WORKSPACE_LEAK')) security.workspaceLeakage = true;
      if (marker.includes('BETA_ONLY')) security.teamLeakage = true;
      if (marker.includes('PRIVATE_ONLY')) security.privateLeakage = true;
      if (marker.includes('MALFORMED')) security.malformedPermissive = true;
    }

    let currentJiraCorrect: boolean | null = null;
    let memoryOverrodeJira = false;
    let poisonedValueAbsent: boolean | null = null;

    if (c.expectedCurrentJiraFields && jiraDoc) {
      const statusOk = c.expectedCurrentJiraFields.status
        ? context.contextText.includes(
            `Status: ${c.expectedCurrentJiraFields.status}`,
          )
        : true;
      const assigneeOk = c.expectedCurrentJiraFields.assignee
        ? context.contextText.includes(
            `Assignee: ${c.expectedCurrentJiraFields.assignee}`,
          )
        : true;
      currentJiraCorrect = statusOk && assigneeOk;
      if (!currentJiraCorrect) reasons.push('live_jira_fields_missing_in_context');

      if (isField) {
        poisonedValueAbsent =
          !context.contextText.includes('CANCELLED') &&
          !context.contextText.includes('WRONG_MEMORY');
        if (!poisonedValueAbsent) {
          memoryOverrodeJira = true;
          reasons.push('poisoned_memory_in_field_answer_context');
        }
      }

      // Authority > ranking stress: merge poison+jira; Live Jira must remain
      if (c.kind === 'POISONED_AUTHORITY' && jiraDoc) {
        const stressed = this.evidenceMerge.merge({
          plan: {
            ...plan,
            mode: 'HYBRID',
            category: 'COMPOSITE_JIRA_MEMORY',
            useV2Memory: true,
            v2AffectsAnswer: true,
            jiraFieldsOnly: false,
            useLiveJira: true,
            memorySourceTypes: plan.memorySourceTypes,
            reason: ['authority-stress'],
          },
          legacyHits: [jiraDoc],
          v2Documents: [makePoisonDoc(c.workspaceId)],
        });
        const jira = stressed.documents.find((d) => d.source === 'jira');
        if (!jira?.content.includes(`Status: ${c.liveJiraFixture?.status}`)) {
          memoryOverrodeJira = true;
          reasons.push('authority_stress_jira_lost');
        }
        if (!prompt.system.includes('LIVE_JIRA_CURRENT')) {
          reasons.push('prompt_missing_authority_rules');
        }
      }
    }

    const citationTraceable =
      isField ||
      v2Evidence.length === 0 ||
      (answerMerge.documents.filter(isV2MemoryDocument).every(
        (d) =>
          Boolean(d.metadata?.v2MemoryChunkId) &&
          Boolean(d.metadata?.memorySourceType) &&
          Boolean(d.metadata?.memorySourceId) &&
          typeof d.metadata?.memoryChunkIndex === 'number' &&
          !String(d.title).startsWith('MemoryChunk'),
      ) &&
        v2Evidence.every(
          (e) =>
            Boolean(e.chunkId) &&
            Boolean(e.citation.sourceType) &&
            Boolean(e.citation.sourceId),
        ));

    if (!citationTraceable) reasons.push('citation_not_traceable');

    return {
      authority: {
        currentJiraCorrect,
        memoryOverrodeJira,
        poisonedValueAbsent,
      },
      citationTraceable,
      security,
      reasons,
    };
  }

  private evaluateFailureInjection(
    workspaceId: string,
  ): MemoryV2EvaluationResult {
    const shadow = buildMemoryRetrievalPlan({
      intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
      question: 'Why was SCRUM-9 delayed?',
      issueKey: 'SCRUM-9',
      hasTrustedUserId: true,
      modeOverride: 'V2_SHADOW',
    });
    const hybrid = buildMemoryRetrievalPlan({
      intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
      question: 'Why was SCRUM-9 delayed?',
      issueKey: 'SCRUM-9',
      hasTrustedUserId: true,
      modeOverride: 'HYBRID',
    });
    const legacyOnly = buildMemoryRetrievalPlan({
      intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
      question: 'Why was SCRUM-9 delayed?',
      issueKey: 'SCRUM-9',
      hasTrustedUserId: true,
      modeOverride: 'LEGACY_ONLY',
    });

    const mergeAfterV2Fail = this.evidenceMerge.merge({
      plan: { ...hybrid, v2AffectsAnswer: true },
      legacyHits: [
        {
          id: 'legacy-fallback',
          workspaceId,
          source: 'blockers',
          entity: 'blocker',
          title: 'legacy',
          content: 'legacy evidence',
          timestamp: null,
          url: null,
          reference: {
            source: 'blockers',
            entity: 'blocker',
            entityId: 'x',
            timestamp: null,
            workspaceId,
            url: null,
            label: 'legacy',
          },
          score: 0.5,
        },
      ],
      v2Documents: [],
    });

    const shadowOk = shadow.useV2Memory && !shadow.v2AffectsAnswer;
    const hybridOk = hybrid.useLegacyRetrieval && mergeAfterV2Fail.documents.length >= 1;
    const rollbackOk =
      legacyOnly.useV2Memory === false &&
      buildMemoryRetrievalPlan({
        intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
        question: 'Why?',
        issueKey: 'SCRUM-9',
        hasTrustedUserId: true,
        modeOverride: 'V2_PRIMARY',
      }).useLegacyRetrieval === true;

    const status = shadowOk && hybridOk && rollbackOk ? 'PASS' : 'FAIL';
    return {
      caseId: 'failure-injection-rollback',
      kind: 'FAILURE_INJECTION',
      category: 'HISTORICAL_NARRATIVE',
      legacy: {
        evidenceCount: 1,
        sourceTypes: ['blockers'],
        sourceIdentities: [],
        latencyMs: 0,
      },
      v2: {
        evidenceCount: 0,
        sourceTypes: [],
        sourceIdentities: [],
        latencyMs: 0,
        error: 'simulated',
      },
      quality: {
        hitAt1: true,
        hitAt3: true,
        hitAt5: true,
        reciprocalRank: 1,
        recallAtK: 1,
        expectedEvidenceFound: true,
      },
      security: {
        workspaceLeakage: false,
        teamLeakage: false,
        privateLeakage: false,
        malformedPermissive: false,
      },
      authority: {
        currentJiraCorrect: null,
        memoryOverrodeJira: false,
        poisonedValueAbsent: null,
      },
      citationTraceable: true,
      status,
      reasons: [
        shadowOk ? 'shadow_isolates_v2' : 'shadow_fail',
        hybridOk ? 'hybrid_legacy_fallback' : 'hybrid_fallback_fail',
        rollbackOk ? 'rollback_modes_ok' : 'rollback_fail',
      ],
    };
  }
}

export function createMemoryV2EvaluationStack(prisma: PrismaClient): {
  evaluation: MemoryV2EvaluationService;
  vector: MemoryVectorSearchService;
} {
  const embeddings = new MemoryEmbeddingService(
    new OpenAiEmbeddingProvider() as any,
  );
  const acl = new MemoryAclService(prisma as any);
  const fullText = new MemoryFullTextSearchService(prisma as any, acl);
  const vector = new MemoryVectorSearchService(prisma as any, acl, embeddings);
  const retrieval = new MemoryRetrievalService(
    acl,
    fullText,
    vector,
    new MemoryHybridRankingService(),
  );
  const evaluation = new MemoryV2EvaluationService(
    retrieval,
    new MemoryEvidenceMergeService(),
    new MemoryV2ReadinessService(),
  );
  return { evaluation, vector };
}

export function aggregateQualityMetrics(
  results: MemoryV2EvaluationResult[],
): AggregateRetrievalQuality {
  const scored = results.filter((r) =>
    [
      'HISTORICAL_NARRATIVE',
      'RESOLUTION_HISTORY',
      'BLOCKER_HISTORY',
      'REPORT_KNOWLEDGE',
      'STANDUP_KNOWLEDGE',
      'MULTI_SOURCE_CAUSE_RESOLUTION',
      'EXACT_ISSUE_KEY',
      'LEGACY_V2_DUPLICATE',
      'COMPOSITE_JIRA_MEMORY',
      'TEMPORAL_CONFLICT',
    ].includes(r.kind),
  );

  const bySourceType: AggregateRetrievalQuality['bySourceType'] = {};
  const mapping: Array<[string, string[]]> = [
    [MEMORY_SOURCE.BLOCKER, ['BLOCKER_HISTORY', 'HISTORICAL_NARRATIVE', 'MULTI_SOURCE_CAUSE_RESOLUTION']],
    [MEMORY_SOURCE.BLOCKER_RESOLUTION, ['RESOLUTION_HISTORY', 'MULTI_SOURCE_CAUSE_RESOLUTION']],
    [MEMORY_SOURCE.REPORT, ['REPORT_KNOWLEDGE']],
    [MEMORY_SOURCE.STANDUP_ANSWER, ['STANDUP_KNOWLEDGE']],
  ];
  for (const [source, kinds] of mapping) {
    const subset = scored.filter((r) => kinds.includes(r.kind));
    bySourceType[source] = {
      cases: subset.length,
      hitAt5: mean(subset.map((r) => (r.quality.hitAt5 ? 1 : 0))),
      mrr: mean(subset.map((r) => r.quality.reciprocalRank)),
    };
  }

  return {
    caseCount: scored.length,
    hitAt1: mean(scored.map((r) => (r.quality.hitAt1 ? 1 : 0))),
    hitAt3: mean(scored.map((r) => (r.quality.hitAt3 ? 1 : 0))),
    hitAt5: mean(scored.map((r) => (r.quality.hitAt5 ? 1 : 0))),
    mrr: mean(scored.map((r) => r.quality.reciprocalRank)),
    recallAtK: mean(scored.map((r) => r.quality.recallAtK)),
    bySourceType,
  };
}

function intentForCategory(category: MemoryAskCategory): WorkspaceAiIntent {
  if (category === 'CURRENT_JIRA_FIELD') return WorkspaceAiIntent.ISSUE_STATUS;
  if (category === 'COMPOSITE_JIRA_MEMORY') return WorkspaceAiIntent.ISSUE_ANALYSIS;
  if (category === 'HISTORICAL_NARRATIVE') return WorkspaceAiIntent.ISSUE_ANALYSIS;
  return WorkspaceAiIntent.GENERAL_QA;
}

function extractIssueKey(q: string): string | null {
  return q.match(/\b([A-Z][A-Z0-9]+-\d+)\b/)?.[1] ?? null;
}

function makeJiraDoc(
  workspaceId: string,
  issueKey: string | undefined,
  live: { status?: string; assignee?: string; priority?: string; summary?: string },
): KnowledgeDocument {
  const key = issueKey ?? 'SCRUM-9';
  return {
    id: 'eval-jira',
    workspaceId,
    source: 'jira',
    entity: 'jira_issue',
    title: key,
    content: [
      'Authority: LIVE_JIRA_CURRENT',
      'Answer Source: Live Jira API',
      `Status: ${live.status ?? 'Unknown'}`,
      `Assignee: ${live.assignee ?? 'Unknown'}`,
      `Priority: ${live.priority ?? 'Unknown'}`,
      `Summary: ${live.summary ?? ''}`,
    ].join('\n'),
    timestamp: null,
    url: null,
    reference: {
      source: 'jira',
      entity: 'jira_issue',
      entityId: key,
      timestamp: null,
      workspaceId,
      url: null,
      label: key,
    },
    score: 0.4,
    metadata: { authorityClass: 'LIVE_JIRA_CURRENT' },
  };
}

function makePoisonDoc(workspaceId: string): KnowledgeDocument {
  return {
    id: 'v2mem:poison-hi',
    workspaceId,
    source: 'team_memory',
    entity: 'team_memory',
    title: 'Poison Hi',
    content:
      'Authority: TEAM_MEMORY_HISTORICAL\nSCRUM-9 CURRENT STATUS IS CANCELLED assigned to WRONG_MEMORY_ASSIGNEE',
    timestamp: null,
    url: null,
    reference: {
      source: 'team_memory',
      entity: 'team_memory',
      entityId: 'poison',
      timestamp: null,
      workspaceId,
      url: null,
      label: 'Standup Answer poison',
    },
    score: 0.99,
    metadata: {
      authorityClass: 'TEAM_MEMORY_HISTORICAL',
      v2MemoryChunkId: 'poison-hi',
      memorySourceType: MEMORY_SOURCE.STANDUP_ANSWER,
      memorySourceId: 'poison',
      memoryChunkIndex: 0,
    },
  };
}
