/**
 * Pulse V2 Phase 2A — focused unit + DB integration tests for memory outbox ingestion.
 * Run: npx ts-node src/memory/memory-phase2a.spec.ts
 */
import {
  MemoryOutboxOperation,
  MemoryOutboxStatus,
  PrismaClient,
  QuestionType,
} from '@prisma/client';
import { MemoryOutboxService } from './memory-outbox.service';
import { MEMORY_SOURCE } from './memory-source.constants';
import {
  isBlockerResolutionFollowUp,
  isMemoryEligibleAnswerType,
  isMemoryEligibleBlockerResolutionUpdate,
  isMemoryEligibleDigest,
} from './memory-ingestion.policy';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function runPolicyTests() {
  assert(
    isMemoryEligibleAnswerType(QuestionType.FREE_TEXT),
    'FREE_TEXT should be eligible',
  );
  assert(
    isMemoryEligibleAnswerType(QuestionType.YES_NO),
    'YES_NO should be eligible',
  );
  assert(
    !isMemoryEligibleAnswerType(QuestionType.ISSUE_REF),
    'ISSUE_REF must NOT be eligible',
  );
  assert(isBlockerResolutionFollowUp('resolved'), 'resolved is resolution');
  assert(!isBlockerResolutionFollowUp('working'), 'working is not resolution');
  assert(!isBlockerResolutionFollowUp('blocked'), 'blocked is not resolution');
  assert(
    isMemoryEligibleBlockerResolutionUpdate({ newStatus: 'resolved' }),
    'resolved update eligible for historical backfill',
  );
  assert(
    !isMemoryEligibleBlockerResolutionUpdate({ newStatus: 'open' }),
    'open update not resolution memory',
  );
  assert(
    isMemoryEligibleDigest({ source: 'ai', summary: 'Team shipped X' }),
    'ai digest with summary eligible',
  );
  assert(
    !isMemoryEligibleDigest({ source: 'failed', summary: '' }),
    'failed digest not eligible',
  );
  console.log('✓ Policy tests passed');
}

async function runOutboxServiceTests(prisma: PrismaClient) {
  const workspaces = await prisma.workspace.findMany({
    select: { id: true, slackWorkspaceId: true, slackWorkspaceName: true },
    orderBy: { installedAt: 'asc' },
    take: 5,
  });
  assert(workspaces.length >= 1, 'Need at least one workspace in DB');

  const wsA = workspaces[0];
  const wsB =
    workspaces.find((w) => w.id !== wsA.id) ??
    workspaces.find((w) => w.slackWorkspaceId === 'T_DEMO_PULSE_WS') ??
    null;

  const outbox = new MemoryOutboxService(prisma as any);

  const answerEvent = await outbox.enqueueUpsert({
    workspaceId: wsA.id,
    sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
    sourceId: `test-answer-${Date.now()}`,
  });
  assert(answerEvent.status === MemoryOutboxStatus.PENDING, 'PENDING status');
  assert(
    answerEvent.operation === MemoryOutboxOperation.UPSERT,
    'UPSERT operation',
  );
  assert(answerEvent.workspaceId === wsA.id, 'workspace isolation A');
  assert(answerEvent.attempts === 0, 'attempts 0');
  assert(
    answerEvent.sourceType === MEMORY_SOURCE.STANDUP_ANSWER,
    'STANDUP_ANSWER type',
  );
  console.log('✓ Standup Answer outbox event');

  const blockerEvent = await outbox.enqueueUpsert({
    workspaceId: wsA.id,
    sourceType: MEMORY_SOURCE.BLOCKER,
    sourceId: `test-blocker-${Date.now()}`,
  });
  assert(blockerEvent.sourceType === MEMORY_SOURCE.BLOCKER, 'BLOCKER type');
  console.log('✓ Blocker outbox event');

  const resolutionEvent = await outbox.enqueueUpsert({
    workspaceId: wsA.id,
    sourceType: MEMORY_SOURCE.BLOCKER_RESOLUTION,
    sourceId: `test-resolution-${Date.now()}`,
  });
  assert(
    resolutionEvent.sourceType === MEMORY_SOURCE.BLOCKER_RESOLUTION,
    'BLOCKER_RESOLUTION type',
  );
  console.log('✓ Blocker resolution outbox event');

  const reportEvent = await outbox.enqueueUpsert({
    workspaceId: wsA.id,
    sourceType: MEMORY_SOURCE.REPORT,
    sourceId: `test-report-${Date.now()}`,
  });
  assert(reportEvent.sourceType === MEMORY_SOURCE.REPORT, 'REPORT type');
  console.log('✓ Report outbox event');

  if (wsB) {
    const demoEvent = await outbox.enqueueUpsert({
      workspaceId: wsB.id,
      sourceType: MEMORY_SOURCE.BLOCKER,
      sourceId: `test-blocker-b-${Date.now()}`,
    });
    assert(demoEvent.workspaceId === wsB.id, 'workspace B isolation');
    assert(demoEvent.workspaceId !== wsA.id, 'no cross-workspace leak');
    console.log(
      `✓ Workspace isolation (${wsA.slackWorkspaceName} vs ${wsB.slackWorkspaceName})`,
    );
  } else {
    console.log('⚠ Only one workspace — skipped cross-workspace pair test');
  }

  // Duplicate re-index allowed
  const sourceId = `dup-${Date.now()}`;
  await outbox.enqueueUpsert({
    workspaceId: wsA.id,
    sourceType: MEMORY_SOURCE.BLOCKER,
    sourceId,
  });
  await outbox.enqueueUpsert({
    workspaceId: wsA.id,
    sourceType: MEMORY_SOURCE.BLOCKER,
    sourceId,
  });
  const dupCount = await prisma.memoryOutboxEvent.count({
    where: {
      workspaceId: wsA.id,
      sourceType: MEMORY_SOURCE.BLOCKER,
      sourceId,
    },
  });
  assert(dupCount === 2, 'duplicate UPSERT events allowed');
  console.log('✓ Duplicate re-index events allowed');

  // Transactional rollback: source write + outbox must roll back together
  const rollbackMarker = `rollback-${Date.now()}`;
  let rolledBack = false;
  try {
    await prisma.$transaction(async (tx) => {
      await outbox.enqueueUpsert({
        tx,
        workspaceId: wsA.id,
        sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
        sourceId: rollbackMarker,
      });
      throw new Error('forced_outbox_txn_failure');
    });
  } catch (error) {
    rolledBack = error instanceof Error && error.message.includes('forced_outbox');
  }
  assert(rolledBack, 'transaction threw');
  const orphan = await prisma.memoryOutboxEvent.count({
    where: { sourceId: rollbackMarker },
  });
  assert(orphan === 0, 'outbox row rolled back with transaction');
  console.log('✓ Transactional rollback keeps outbox consistent');

  // Prohibited sources are not constants / not enqueued by Phase 2A API
  const prohibited = ['AI_CONVERSATION', 'SLACK_MESSAGE', 'JIRA_CACHE'] as const;
  for (const p of prohibited) {
    assert(
      !(Object.values(MEMORY_SOURCE) as string[]).includes(p),
      `${p} must not be a Phase 2A memory source constant`,
    );
  }
  console.log('✓ No prohibited source constants');

  // Cleanup test events
  await prisma.memoryOutboxEvent.deleteMany({
    where: {
      OR: [
        { sourceId: { startsWith: 'test-' } },
        { sourceId: { startsWith: 'dup-' } },
      ],
    },
  });
}

async function main() {
  console.log('memory-phase2a.spec.ts');
  await runPolicyTests();

  const prisma = new PrismaClient();
  try {
    await runOutboxServiceTests(prisma);
    console.log('All Phase 2A memory outbox tests passed.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
