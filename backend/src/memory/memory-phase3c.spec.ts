/**
 * Pulse V2 Phase 3C — production validation / readiness tests.
 * Run: npm run test:memory-phase3c
 *
 * Never mutates MEMORY_V2_ASK_MODE.
 */
import { PrismaClient } from '@prisma/client';
import {
  createMemoryV2EvaluationStack,
  aggregateQualityMetrics,
} from './memory-v2-evaluation.service';
import { buildMemoryRetrievalPlan } from './memory-retrieval-policy';
import { WorkspaceAiIntent } from '../ai/workspace/types/workspace-ai.types';
import { getMemoryAskMode, DEFAULT_MEMORY_V2_ASK_MODE } from './memory-ask.config';
import { hitAtK, reciprocalRank, recallAtK } from './memory-eval.metrics';
import { MEMORY_EVAL_CONFIG } from './memory-eval.config';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  console.log('memory-phase3c.spec.ts');

  // Metric formulas
  assert(hitAtK(['a', 'b', 'c'], ['b'], 1) === false, 'Hit@1');
  assert(hitAtK(['a', 'b', 'c'], ['b'], 2) === true, 'Hit@2');
  assert(reciprocalRank(['a', 'b'], ['b']) === 0.5, 'MRR');
  assert(recallAtK(['a', 'b', 'c'], ['a', 'c', 'd'], 3) === 2 / 3, 'Recall@3');
  console.log('✓ Metric formulas');

  // Default mode unchanged / no auto cutover
  assert(DEFAULT_MEMORY_V2_ASK_MODE === 'LEGACY_ONLY', 'default LEGACY_ONLY');
  const before = getMemoryAskMode();
  buildMemoryRetrievalPlan({
    intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
    question: 'Why was SCRUM-9 delayed?',
    issueKey: 'SCRUM-9',
    hasTrustedUserId: true,
    modeOverride: 'V2_PRIMARY',
  });
  assert(getMemoryAskMode() === before, 'eval does not mutate env mode');
  console.log('✓ No automatic mode mutation');

  // Rollback ladder (config only)
  for (const mode of ['V2_PRIMARY', 'HYBRID', 'V2_SHADOW', 'LEGACY_ONLY'] as const) {
    const p = buildMemoryRetrievalPlan({
      intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
      question: 'Why was SCRUM-9 delayed?',
      issueKey: 'SCRUM-9',
      hasTrustedUserId: true,
      modeOverride: mode,
    });
    if (mode === 'LEGACY_ONLY') assert(!p.useV2Memory, 'legacy only');
    if (mode === 'V2_SHADOW') assert(p.useV2Memory && !p.v2AffectsAnswer, 'shadow');
  }
  console.log('✓ Rollback mode ladder');

  assert(MEMORY_EVAL_CONFIG.requirePgvectorForV2Primary === true, 'pgvector gate default');
  console.log('✓ pgvector production gate default ON');

  const prisma = new PrismaClient();
  const workspace = await prisma.workspace.findFirst({
    orderBy: { installedAt: 'asc' },
  });
  assert(workspace, 'need workspace');

  try {
    const { evaluation, vector } = createMemoryV2EvaluationStack(prisma);
    await vector.detectBackend();
    const run = await evaluation.runWorkspaceEvaluation({
      prisma,
      workspaceId: workspace.id,
    });

    assert(run.modeMutation === 'NONE', 'modeMutation NONE');
    assert(run.readiness.modeMutation === 'NONE', 'readiness no mutation');

    const byId = new Map(run.results.map((r) => [r.caseId, r]));

    const field = byId.get('jira-status');
    assert(field?.status === 'PASS', `jira-status ${field?.reasons.join(';')}`);
    assert(field?.authority.memoryOverrodeJira === false, 'field no override');

    const poison = byId.get('jira-assignee');
    assert(poison?.status === 'PASS', `poison ${poison?.reasons.join(';')}`);
    assert(poison?.authority.poisonedValueAbsent !== false, 'poison absent');

    const hist = byId.get('historical-why-delayed');
    assert(hist, 'historical case');
    assert(hist.quality.expectedEvidenceFound, `historical evidence ${hist.reasons.join(';')}`);
    assert(hist.status === 'PASS', `historical ${hist.reasons.join(';')}`);

    const composite = byId.get('composite');
    assert(composite?.status === 'PASS', `composite ${composite?.reasons.join(';')}`);
    assert(composite?.authority.currentJiraCorrect !== false, 'composite jira');

    const temporal = byId.get('temporal-conflict');
    assert(temporal?.status === 'PASS', `temporal ${temporal?.reasons.join(';')}`);

    const ws = byId.get('workspace-isolation');
    assert(ws?.security.workspaceLeakage === false, 'workspace leak');
    assert(ws?.status === 'PASS', `workspace ${ws?.reasons.join(';')}`);

    const team = byId.get('team-acl');
    assert(team?.security.teamLeakage === false, 'team leak');
    assert(team?.status === 'PASS', `team ${team?.reasons.join(';')}`);

    const priv = byId.get('private-acl');
    assert(priv?.security.privateLeakage === false, 'private leak');
    assert(priv?.status === 'PASS', `private ${priv?.reasons.join(';')}`);

    const malformed = byId.get('malformed-acl');
    assert(malformed?.security.malformedPermissive === false, 'malformed');
    assert(malformed?.status === 'PASS', `malformed ${malformed?.reasons.join(';')}`);

    const citationCases = run.results.filter((r) => r.v2.evidenceCount > 0);
    assert(
      citationCases.every((r) => r.citationTraceable),
      'citations',
    );

    const failInj = byId.get('failure-injection-rollback');
    assert(failInj?.status === 'PASS', `failure injection ${failInj?.reasons.join(';')}`);

    const q = aggregateQualityMetrics(run.results);
    console.log(
      `Quality Hit@1=${q.hitAt1.toFixed(2)} Hit@3=${q.hitAt3.toFixed(2)} Hit@5=${q.hitAt5.toFixed(2)} MRR=${q.mrr.toFixed(2)} Recall@5=${q.recallAtK.toFixed(2)}`,
    );
    console.log(
      `Readiness overall=${run.readiness.overall} recommended=${run.readiness.recommendedMode} vector=${run.readiness.metrics.vector.readiness}`,
    );

    // Hard security/authority must PASS even if overall BLOCKED on pgvector
    assert(run.readiness.gates.security.status === 'PASS', 'security gate');
    assert(run.readiness.gates.jiraAuthority.status === 'PASS', 'authority gate');
    assert(run.readiness.gates.citations.status === 'PASS', 'citation gate');
    assert(run.readiness.gates.regressions.status === 'PASS', 'regression gate');

    // Local env previously BLOCKED on vector; with pgvector installed may be PASS/WARN
    if (run.readiness.metrics.vector.readiness !== 'PGVECTOR_READY') {
      assert(
        run.readiness.gates.vectorBackend.status === 'BLOCKED' ||
          run.readiness.gates.vectorBackend.status === 'WARN',
        'vector gate reflects non-pgvector',
      );
      assert(
        run.readiness.recommendedMode !== 'V2_PRIMARY_ELIGIBLE',
        'must not recommend V2_PRIMARY without pgvector',
      );
      console.log('✓ pgvector production readiness correctly BLOCKED/WARN locally');
    } else {
      assert(
        run.readiness.gates.vectorBackend.status === 'PASS',
        'vector gate PASS when PGVECTOR_READY',
      );
      console.log('✓ pgvector production readiness PASS (PGVECTOR_READY)');
    }

    // Never auto-enable
    assert(getMemoryAskMode() === before, 'mode still unchanged after eval');
    console.log('✓ Full evaluation suite + readiness gates');

    const failed = run.results.filter((r) => r.status === 'FAIL');
    if (failed.length) {
      console.error('Failed cases:', failed.map((f) => `${f.caseId}:${f.reasons.join('|')}`));
      throw new Error(`${failed.length} evaluation cases failed`);
    }

    console.log('All Phase 3C production validation tests passed.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
