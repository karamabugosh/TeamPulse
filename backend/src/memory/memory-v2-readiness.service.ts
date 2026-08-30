import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { MemoryBackfillService } from './memory-backfill.service';
import { MemoryOutboxService } from './memory-outbox.service';
import { MEMORY_EVAL_CONFIG, GateStatus, VectorBackendReadiness } from './memory-eval.config';
import {
  AggregateRetrievalQuality,
  GateResult,
  MemoryV2EvaluationResult,
  MemoryV2ReadinessReport,
  MemoryV2RecommendedMode,
} from './memory-eval.types';
import {
  duplicateRate,
  mean,
  percentile,
  sourceDiversityScore,
} from './memory-eval.metrics';

/**
 * Phase 3C readiness — recommendation only.
 * NEVER mutates MEMORY_V2_ASK_MODE or production config.
 */
@Injectable()
export class MemoryV2ReadinessService {
  classifyVectorBackend(backend: string | undefined): VectorBackendReadiness {
    if (backend === 'pgvector') return 'PGVECTOR_READY';
    if (backend === 'json_acl_bounded') return 'BOUNDED_JSON_ONLY';
    return 'VECTOR_DISABLED';
  }

  evaluateVectorGate(readiness: VectorBackendReadiness): GateResult {
    if (readiness === 'PGVECTOR_READY') {
      return { status: 'PASS', reasons: ['pgvector available'] };
    }
    if (readiness === 'BOUNDED_JSON_ONLY') {
      if (MEMORY_EVAL_CONFIG.requirePgvectorForV2Primary) {
        return {
          status: 'BLOCKED',
          reasons: [
            'pgvector unavailable — json_acl_bounded is interim only; V2_PRIMARY at scale BLOCKED',
          ],
        };
      }
      return {
        status: 'WARN',
        reasons: ['bounded JSON vector fallback — acceptable for HYBRID/local only'],
      };
    }
    return {
      status: 'BLOCKED',
      reasons: ['vector backend unavailable'],
    };
  }

  async buildReport(params: {
    prisma: PrismaClient;
    workspaceId: string;
    results: MemoryV2EvaluationResult[];
    aggregateQuality: AggregateRetrievalQuality;
    latenciesMs: number[];
    vectorBackend?: string;
  }): Promise<MemoryV2ReadinessReport> {
    const outbox = new MemoryOutboxService(params.prisma as any);
    const backfill = new MemoryBackfillService(params.prisma as any, outbox);
    const verify = await backfill.verifyWorkspace(params.workspaceId);

    const eligible = verify.sources.reduce((s, x) => s + x.eligible, 0);
    const indexed = verify.sources.reduce((s, x) => s + x.indexed, 0);
    const inconsistent = verify.sources.reduce((s, x) => s + x.inconsistent, 0);
    const indexedRatio = eligible > 0 ? indexed / eligible : 1;
    const embeddingCoverage =
      verify.chunks.total > 0
        ? verify.chunks.withEmbedding / verify.chunks.total
        : 1;

    const backend =
      params.vectorBackend ??
      params.results.map((r) => r.v2.vectorBackend).find(Boolean) ??
      'unknown';
    const vectorReadiness = this.classifyVectorBackend(backend);

    const security = this.evaluateSecurityGate(params.results);
    const jiraAuthority = this.evaluateAuthorityGate(params.results);
    const citations = this.evaluateCitationGate(params.results);
    const retrievalQuality = this.evaluateQualityGate(params.aggregateQuality);
    const coverage = this.evaluateCoverageGate({
      indexedRatio,
      embeddingCoverage,
      failedOutbox: verify.outbox.FAILED,
      pendingOutbox: verify.outbox.PENDING,
      inconsistent,
      totalOutbox:
        verify.outbox.FAILED +
        verify.outbox.PENDING +
        verify.outbox.PROCESSING +
        verify.outbox.COMPLETED,
    });
    const performance = this.evaluatePerformanceGate(params.latenciesMs);
    const vectorBackend = this.evaluateVectorGate(vectorReadiness);
    const regressions = this.evaluateRegressionGate(params.results);

    const allIdentities = params.results.flatMap((r) => r.v2.sourceIdentities);
    const allTypes = params.results.flatMap((r) => r.v2.sourceTypes);

    const report: MemoryV2ReadinessReport = {
      workspaceId: params.workspaceId,
      workspaceName: verify.workspaceName,
      overall: 'PASS',
      gates: {
        retrievalQuality,
        security,
        jiraAuthority,
        citations,
        coverage,
        performance,
        vectorBackend,
        regressions,
      },
      recommendedMode: 'LEGACY_ONLY',
      reasons: [],
      metrics: {
        aggregateQuality: params.aggregateQuality,
        coverage: {
          eligible,
          indexed,
          indexedRatio,
          embeddingCoverage,
          failedOutbox: verify.outbox.FAILED,
          pendingOutbox: verify.outbox.PENDING,
          inconsistent,
        },
        vector: {
          backend,
          readiness: vectorReadiness,
        },
        performance: {
          sampleCount: params.latenciesMs.length,
          p50Ms: percentile(params.latenciesMs, 50),
          p95Ms: percentile(params.latenciesMs, 95),
          meanMs: mean(params.latenciesMs),
        },
        context: {
          duplicateRate: duplicateRate(allIdentities),
          sourceDiversityScore: sourceDiversityScore(allTypes),
        },
      },
      modeMutation: 'NONE',
    };

    this.recomputeOverall(report);
    return report;
  }

  recomputeOverall(report: MemoryV2ReadinessReport): void {
    const gates = Object.values(report.gates);
    const blocked = gates.filter((g) => g.status === 'BLOCKED');
    const warns = gates.filter((g) => g.status === 'WARN');

    // Release blockers always win
    const hardBlocked = [
      report.gates.security,
      report.gates.jiraAuthority,
      report.gates.citations,
      report.gates.regressions,
    ].some((g) => g.status === 'BLOCKED');

    if (hardBlocked || blocked.length > 0) {
      report.overall = 'BLOCKED';
    } else if (warns.length > 0) {
      report.overall = 'WARN';
    } else {
      report.overall = 'PASS';
    }

    report.recommendedMode = this.recommendMode(report);
    report.reasons = this.buildReasons(report);
  }

  private recommendMode(
    report: MemoryV2ReadinessReport,
  ): MemoryV2RecommendedMode {
    const { gates, overall } = report;

    if (
      gates.security.status === 'BLOCKED' ||
      gates.jiraAuthority.status === 'BLOCKED' ||
      gates.citations.status === 'BLOCKED' ||
      gates.regressions.status === 'BLOCKED'
    ) {
      return 'LEGACY_ONLY';
    }

    // V2_PRIMARY_ELIGIBLE requires all PASS including pgvector when required
    if (
      overall === 'PASS' &&
      gates.vectorBackend.status === 'PASS' &&
      gates.retrievalQuality.status === 'PASS' &&
      gates.coverage.status === 'PASS'
    ) {
      return 'V2_PRIMARY_ELIGIBLE';
    }

    // HYBRID: security+authority PASS; vector may WARN (not BLOCKED for soft local)
    // Note: when requirePgvectorForV2Primary, vector gate is BLOCKED → recommend V2_SHADOW instead.
    if (
      gates.security.status === 'PASS' &&
      gates.jiraAuthority.status === 'PASS' &&
      gates.citations.status === 'PASS' &&
      gates.retrievalQuality.status !== 'BLOCKED' &&
      gates.vectorBackend.status !== 'BLOCKED'
    ) {
      return 'HYBRID';
    }

    // Controlled HYBRID still allowed when only vector is BLOCKED (operator may accept WARN path
    // via env MEMORY_EVAL_REQUIRE_PGVECTOR=false). With default true, fall through to V2_SHADOW.

    // Safe next step when security/authority ok
    if (
      gates.security.status === 'PASS' &&
      gates.jiraAuthority.status === 'PASS'
    ) {
      return 'V2_SHADOW';
    }

    return 'LEGACY_ONLY';
  }

  private buildReasons(report: MemoryV2ReadinessReport): string[] {
    const reasons: string[] = [
      `overall=${report.overall}`,
      `recommendedMode=${report.recommendedMode}`,
      `modeMutation=NONE`,
    ];
    for (const [name, gate] of Object.entries(report.gates)) {
      for (const r of gate.reasons) {
        reasons.push(`${name}:${gate.status}:${r}`);
      }
    }
    return reasons;
  }

  private evaluateSecurityGate(results: MemoryV2EvaluationResult[]): GateResult {
    const leak = results.find(
      (r) =>
        r.security.workspaceLeakage ||
        r.security.teamLeakage ||
        r.security.privateLeakage ||
        r.security.malformedPermissive,
    );
    if (leak) {
      return {
        status: 'BLOCKED',
        reasons: [
          `ACL leakage in case=${leak.caseId}`,
          ...leak.reasons.filter((r) => r.includes('forbidden') || r.includes('leak')),
        ],
      };
    }
    const securityCases = results.filter((r) =>
      ['WORKSPACE_ISOLATION', 'TEAM_ACL', 'PRIVATE_ACL', 'MALFORMED_ACL'].includes(
        r.kind,
      ),
    );
    if (securityCases.some((r) => r.status === 'FAIL')) {
      return {
        status: 'BLOCKED',
        reasons: securityCases
          .filter((r) => r.status === 'FAIL')
          .map((r) => `security case failed: ${r.caseId}`),
      };
    }
    return { status: 'PASS', reasons: ['no workspace/team/private/malformed leakage'] };
  }

  private evaluateAuthorityGate(results: MemoryV2EvaluationResult[]): GateResult {
    const bad = results.find(
      (r) =>
        r.authority.memoryOverrodeJira ||
        r.authority.currentJiraCorrect === false ||
        r.authority.poisonedValueAbsent === false,
    );
    if (bad) {
      return {
        status: 'BLOCKED',
        reasons: [
          `jira authority failed case=${bad.caseId}`,
          ...bad.reasons,
        ],
      };
    }
    const authorityCases = results.filter(
      (r) =>
        r.kind === 'CURRENT_JIRA_FIELD' ||
        r.kind === 'POISONED_AUTHORITY' ||
        r.kind === 'COMPOSITE_JIRA_MEMORY' ||
        r.kind === 'TEMPORAL_CONFLICT',
    );
    if (authorityCases.some((r) => r.status === 'FAIL')) {
      return {
        status: 'BLOCKED',
        reasons: authorityCases
          .filter((r) => r.status === 'FAIL')
          .map((r) => `authority case failed: ${r.caseId}`),
      };
    }
    return {
      status: 'PASS',
      reasons: ['Live Jira wins current fields; poisoned memory did not override'],
    };
  }

  private evaluateCitationGate(results: MemoryV2EvaluationResult[]): GateResult {
    const withV2 = results.filter((r) => r.v2.evidenceCount > 0);
    const bad = withV2.find((r) => !r.citationTraceable);
    if (bad) {
      return {
        status: 'BLOCKED',
        reasons: [`untraceable V2 evidence in case=${bad.caseId}`],
      };
    }
    return { status: 'PASS', reasons: ['V2 evidence retains sourceType/sourceId/chunkIndex'] };
  }

  private evaluateQualityGate(q: AggregateRetrievalQuality): GateResult {
    if (q.caseCount === 0) {
      return { status: 'WARN', reasons: ['no historical quality cases scored'] };
    }
    const reasons: string[] = [
      `Hit@1=${q.hitAt1.toFixed(2)} Hit@3=${q.hitAt3.toFixed(2)} Hit@5=${q.hitAt5.toFixed(2)} MRR=${q.mrr.toFixed(2)} Recall@5=${q.recallAtK.toFixed(2)}`,
    ];
    if (q.hitAt5 < MEMORY_EVAL_CONFIG.minHitAt5 * 0.5) {
      return {
        status: 'BLOCKED',
        reasons: [...reasons, `Hit@5 far below target ${MEMORY_EVAL_CONFIG.minHitAt5}`],
      };
    }
    if (
      q.hitAt5 < MEMORY_EVAL_CONFIG.minHitAt5 ||
      q.mrr < MEMORY_EVAL_CONFIG.minMrr
    ) {
      return {
        status: 'WARN',
        reasons: [
          ...reasons,
          `below target Hit@5>=${MEMORY_EVAL_CONFIG.minHitAt5} or MRR>=${MEMORY_EVAL_CONFIG.minMrr}`,
        ],
      };
    }
    return { status: 'PASS', reasons };
  }

  private evaluateCoverageGate(c: {
    indexedRatio: number;
    embeddingCoverage: number;
    failedOutbox: number;
    pendingOutbox: number;
    inconsistent: number;
    totalOutbox: number;
  }): GateResult {
    const failedRatio =
      c.totalOutbox > 0 ? c.failedOutbox / c.totalOutbox : 0;
    const reasons = [
      `indexedRatio=${c.indexedRatio.toFixed(2)}`,
      `embeddingCoverage=${c.embeddingCoverage.toFixed(2)}`,
      `failedOutboxRatio=${failedRatio.toFixed(2)}`,
      `inconsistent=${c.inconsistent}`,
    ];
    if (
      c.indexedRatio < MEMORY_EVAL_CONFIG.minIndexedEligibleRatio * 0.4 &&
      c.indexedRatio < 0.2
    ) {
      return {
        status: 'BLOCKED',
        reasons: [...reasons, 'major historical coverage missing'],
      };
    }
    if (
      c.indexedRatio < MEMORY_EVAL_CONFIG.minIndexedEligibleRatio ||
      c.embeddingCoverage < MEMORY_EVAL_CONFIG.minEmbeddingCoverage ||
      failedRatio > MEMORY_EVAL_CONFIG.maxFailedOutboxRatio
    ) {
      return {
        status: 'WARN',
        reasons: [
          ...reasons,
          'coverage below evaluation thresholds (defaults are conservative)',
        ],
      };
    }
    if (c.inconsistent > 10) {
      return {
        status: 'WARN',
        reasons: [...reasons, 'elevated inconsistent source count'],
      };
    }
    return { status: 'PASS', reasons };
  }

  private evaluatePerformanceGate(latenciesMs: number[]): GateResult {
    if (latenciesMs.length === 0) {
      return { status: 'WARN', reasons: ['no latency samples'] };
    }
    const p95 = percentile(latenciesMs, 95);
    const meanMs = mean(latenciesMs);
    const reasons = [
      `n=${latenciesMs.length}`,
      `mean=${meanMs.toFixed(0)}ms`,
      `p50=${percentile(latenciesMs, 50) ?? 'n/a'}`,
      `p95=${p95 ?? 'n/a (need ≥5 samples)'}`,
    ];
    if (p95 != null && p95 > MEMORY_EVAL_CONFIG.warnP95LatencyMs) {
      return {
        status: 'WARN',
        reasons: [...reasons, `p95 above ${MEMORY_EVAL_CONFIG.warnP95LatencyMs}ms`],
      };
    }
    return { status: 'PASS', reasons };
  }

  private evaluateRegressionGate(
    results: MemoryV2EvaluationResult[],
  ): GateResult {
    const failure = results.find(
      (r) => r.kind === 'FAILURE_INJECTION' && r.status === 'FAIL',
    );
    if (failure) {
      return {
        status: 'BLOCKED',
        reasons: ['failure injection / rollback simulation failed', ...failure.reasons],
      };
    }
    return {
      status: 'PASS',
      reasons: [
        'shadow isolation + hybrid fallback + mode rollback simulation OK',
        'no MEMORY_V2_ASK_MODE mutation',
      ],
    };
  }
}

export function formatReadinessReport(report: MemoryV2ReadinessReport): string {
  const lines: string[] = [];
  lines.push('=== Pulse V2 Memory Readiness (Phase 3C) ===');
  lines.push(`Workspace: ${report.workspaceName} (${report.workspaceId})`);
  lines.push(`Overall: ${report.overall}`);
  lines.push(`Recommended mode: ${report.recommendedMode}`);
  lines.push('Mode mutation: NONE (operator must set MEMORY_V2_ASK_MODE manually)');
  lines.push('');
  lines.push('Gates:');
  for (const [name, gate] of Object.entries(report.gates)) {
    lines.push(`  ${name}: ${gate.status}`);
    for (const r of gate.reasons) lines.push(`    - ${r}`);
  }
  lines.push('');
  const q = report.metrics.aggregateQuality;
  lines.push('Retrieval quality:');
  lines.push(
    `  Hit@1=${q.hitAt1.toFixed(3)} Hit@3=${q.hitAt3.toFixed(3)} Hit@5=${q.hitAt5.toFixed(3)} MRR=${q.mrr.toFixed(3)} Recall@5=${q.recallAtK.toFixed(3)} (n=${q.caseCount})`,
  );
  lines.push('  By source:');
  for (const [st, m] of Object.entries(q.bySourceType)) {
    lines.push(
      `    ${st}: Hit@5=${m.hitAt5.toFixed(3)} MRR=${m.mrr.toFixed(3)} cases=${m.cases}`,
    );
  }
  lines.push('');
  lines.push('Coverage:');
  const c = report.metrics.coverage;
  lines.push(
    `  eligible=${c.eligible} indexed=${c.indexed} ratio=${c.indexedRatio.toFixed(3)} embedCoverage=${c.embeddingCoverage.toFixed(3)} failedOutbox=${c.failedOutbox} pending=${c.pendingOutbox} inconsistent=${c.inconsistent}`,
  );
  lines.push(
    `Vector: backend=${report.metrics.vector.backend} readiness=${report.metrics.vector.readiness}`,
  );
  const p = report.metrics.performance;
  lines.push(
    `Performance: n=${p.sampleCount} mean=${p.meanMs.toFixed(0)}ms p50=${p.p50Ms ?? 'n/a'} p95=${p.p95Ms ?? 'n/a'}`,
  );
  lines.push(
    `Context: duplicateRate=${report.metrics.context.duplicateRate.toFixed(3)} diversity=${report.metrics.context.sourceDiversityScore.toFixed(3)}`,
  );
  lines.push('');
  lines.push('Rollback: V2_PRIMARY → HYBRID → V2_SHADOW → LEGACY_ONLY (config only; no DB rollback).');
  return lines.join('\n');
}

export function formatEvaluationReport(
  run: import('./memory-eval.types').MemoryV2EvaluationRunReport,
): string {
  const lines: string[] = [];
  lines.push('=== Pulse V2 Memory Evaluation (Phase 3C) ===');
  lines.push(`Workspace: ${run.workspaceId}`);
  lines.push(`User: ${run.userId}`);
  lines.push(`Started: ${run.startedAt}`);
  lines.push(`Finished: ${run.finishedAt}`);
  lines.push(`Mode mutation: ${run.modeMutation}`);
  lines.push('');
  for (const r of run.results) {
    lines.push(
      `[${r.status}] ${r.caseId} kind=${r.kind} cat=${r.category} v2=${r.v2.evidenceCount} ms=${r.v2.latencyMs}`,
    );
    if (r.reasons.length) {
      lines.push(`  reasons: ${r.reasons.slice(0, 5).join('; ')}`);
    }
  }
  lines.push('');
  lines.push(formatReadinessReport(run.readiness));
  return lines.join('\n');
}

// silence unused GateStatus import usage for consumers
export type { GateStatus };
