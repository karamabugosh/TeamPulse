/**
 * Pulse V2 Phase 2B — worker claim / normalize / chunk / embed / rebuild tests.
 * Run: npx ts-node src/memory/memory-phase2b.spec.ts
 */
import {
  MemoryOutboxStatus,
  MemoryVisibility,
  PrismaClient,
  QuestionType,
} from '@prisma/client';
import { MemoryOutboxService } from './memory-outbox.service';
import { MemorySourceLoader, MemoryNormalizerService } from './memory-source.loader';
import { MemoryChunkerService, hashChunkContent } from './memory-chunker.service';
import { MemoryEmbeddingService } from './memory-embedding.service';
import {
  MemoryIndexWorkerService,
  isSupportedMemoryWorkerSource,
} from './memory-index.worker';
import { MEMORY_SOURCE } from './memory-source.constants';
import { MEMORY_WORKER_CONFIG } from './memory.config';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class FakeEmbeddingProvider {
  failNext = false;
  calls = 0;
  isAvailable() {
    return true;
  }
  model() {
    return 'test-embed';
  }
  async embedTexts(texts: string[]) {
    this.calls += texts.length;
    if (this.failNext) {
      this.failNext = false;
      throw new Error('simulated_openai_failure');
    }
    return texts.map(() => Array.from({ length: 8 }, (_, i) => i + 0.1));
  }
  async embedQuery(text: string) {
    const [v] = await this.embedTexts([text]);
    return v;
  }
}

async function main() {
  console.log('memory-phase2b.spec.ts');
  const prisma = new PrismaClient();
  const outbox = new MemoryOutboxService(prisma as any);
  const loader = new MemorySourceLoader(prisma as any);
  const normalizer = new MemoryNormalizerService();
  const chunker = new MemoryChunkerService();
  const fakeProvider = new FakeEmbeddingProvider();
  const embeddings = new MemoryEmbeddingService(fakeProvider as any);
  const vectorSync = {
    syncNativeVector: async () => undefined,
    getBackend: () => 'unavailable' as const,
  };
  const worker = new MemoryIndexWorkerService(
    prisma as any,
    loader,
    normalizer,
    chunker,
    embeddings,
    vectorSync as any,
  );

  const workspace = await prisma.workspace.findFirst({
    orderBy: { installedAt: 'asc' },
  });
  assert(workspace, 'need a workspace');

  const otherWorkspace = await prisma.workspace.findFirst({
    where: { id: { not: workspace.id } },
  });

  const team = await prisma.team.findFirst({
    where: { workspaceId: workspace.id },
  });
  assert(team, 'need a team in workspace');

  const user = await prisma.user.findFirst({
    where: { workspaceId: workspace.id },
  });
  assert(user, 'need a user');

  const suffix = Date.now();
  const createdIds: {
    answers: string[];
    blockers: string[];
    updates: string[];
    digests: string[];
    runs: string[];
    checkIns: string[];
    questions: string[];
    events: string[];
  } = {
    answers: [],
    blockers: [],
    updates: [],
    digests: [],
    runs: [],
    checkIns: [],
    questions: [],
    events: [],
  };

  try {
    // --- Claim concurrency (atomic updateMany on one id) ---
    const e1 = await outbox.enqueueUpsert({
      workspaceId: workspace.id,
      sourceType: MEMORY_SOURCE.BLOCKER,
      sourceId: `claim-test-${suffix}`,
    });
    createdIds.events.push(e1.id);

    const now = new Date();
    const [u1, u2] = await Promise.all([
      prisma.memoryOutboxEvent.updateMany({
        where: { id: e1.id, status: MemoryOutboxStatus.PENDING },
        data: {
          status: MemoryOutboxStatus.PROCESSING,
          lockedAt: now,
          attempts: { increment: 1 },
        },
      }),
      prisma.memoryOutboxEvent.updateMany({
        where: { id: e1.id, status: MemoryOutboxStatus.PENDING },
        data: {
          status: MemoryOutboxStatus.PROCESSING,
          lockedAt: now,
          attempts: { increment: 1 },
        },
      }),
    ]);
    assert(u1.count + u2.count === 1, 'event claimed exactly once concurrently');
    console.log('✓ Concurrent claim is exclusive');

    const again = await worker.claimSpecificEvents([e1.id]);
    assert(again.length === 0, 'PROCESSING event is not claimed again');
    console.log('✓ PROCESSING not re-claimed');

    await prisma.memoryOutboxEvent.update({
      where: { id: e1.id },
      data: {
        status: MemoryOutboxStatus.PROCESSING,
        lockedAt: new Date(Date.now() - MEMORY_WORKER_CONFIG.lockTimeoutMs - 1000),
      },
    });
    const recovered = await worker.recoverStaleLocks();
    assert(recovered >= 1, 'stale lock recovered');
    const after = await prisma.memoryOutboxEvent.findUnique({
      where: { id: e1.id },
    });
    assert(after?.status === MemoryOutboxStatus.PENDING, 'back to PENDING');
    console.log('✓ Stale PROCESSING recovered');

    await prisma.memoryOutboxEvent.update({
      where: { id: e1.id },
      data: { status: MemoryOutboxStatus.COMPLETED, processedAt: new Date() },
    });

    const processOurs = async (ids: string[]) =>
      worker.processPendingBatch(20, ids);
    // --- Standup answer ---
    const checkIn = await prisma.checkIn.create({
      data: {
        team: { connect: { id: team.id } },
        name: `Mem2B CI ${suffix}`,
        collectionCron: '0 9 * * 1-5',
        timezone: 'UTC',
      },
    });
    createdIds.checkIns.push(checkIn.id);
    const question = await prisma.question.create({
      data: {
        checkInId: checkIn.id,
        question: 'What did you work on?',
        order: 0,
        type: QuestionType.FREE_TEXT,
      },
    });
    createdIds.questions.push(question.id);

    const run = await prisma.standupRun.create({
      data: {
        teamId: team.id,
        checkInId: checkIn.id,
        scheduledFor: new Date(),
        status: 'collecting',
      },
    });
    createdIds.runs.push(run.id);

    const submission = await prisma.standupSubmission.create({
      data: {
        runId: run.id,
        userId: user.id,
        status: 'completed',
        completedAt: new Date(),
      },
    });

    const answer = await prisma.answer.create({
      data: {
        userId: user.id,
        questionId: question.id,
        submissionId: submission.id,
        text: `Shipped auth middleware for SCRUM-9 (${suffix})`,
      },
    });
    createdIds.answers.push(answer.id);

    await prisma.answerJiraIssueLink.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        submissionId: submission.id,
        runId: run.id,
        questionId: question.id,
        answerId: answer.id,
        issueId: '10001',
        issueKey: 'SCRUM-9',
        summary: 'Auth middleware',
        status: 'In Progress',
      },
    });

    const ansEvent = await outbox.enqueueUpsert({
      workspaceId: workspace.id,
      sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
      sourceId: answer.id,
    });
    createdIds.events.push(ansEvent.id);

    await processOurs([ansEvent.id]);

    const ansChunks = await prisma.memoryChunk.findMany({
      where: {
        workspaceId: workspace.id,
        sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
        sourceId: answer.id,
      },
    });
    assert(ansChunks.length >= 1, 'standup chunk created');
    assert(ansChunks[0].chunkIndex === 0, 'chunkIndex 0');
    assert(ansChunks[0].linkedIssueKey === 'SCRUM-9', 'linkedIssueKey from link');
    assert(
      !/In Progress/.test(ansChunks[0].text),
      'must not copy Jira status into memory text',
    );
    assert(ansChunks[0].visibility === MemoryVisibility.TEAM, 'TEAM visibility');
    assert(ansChunks[0].teamId === team.id, 'teamId set');
    assert(ansChunks[0].contentHash.length === 64, 'sha256 hash');
    assert(ansChunks[0].embeddingModel === 'test-embed', 'embedding model');
    console.log('✓ Standup answer → MemoryChunk');

    // --- Blocker ---
    const blocker = await prisma.pulseBlocker.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        teamId: team.id,
        description: `Dashboard blocked on API contract ${suffix}`,
        title: 'Dashboard blocker',
        severity: 'high',
        category: 'dependency',
        dependency: 'backend API',
        expectedResolution: 'Contract delivery',
        linkedIssueKey: 'SCRUM-9',
        status: 'open',
        needsHelp: true,
      },
    });
    createdIds.blockers.push(blocker.id);
    const blEvent = await outbox.enqueueUpsert({
      workspaceId: workspace.id,
      sourceType: MEMORY_SOURCE.BLOCKER,
      sourceId: blocker.id,
    });
    createdIds.events.push(blEvent.id);
    await processOurs([blEvent.id]);
    const blChunks = await prisma.memoryChunk.findMany({
      where: {
        workspaceId: workspace.id,
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: blocker.id,
      },
    });
    assert(blChunks.length === 1, 'blocker one chunk');
    assert(blChunks[0].text.includes('API contract'), 'description present');
    assert(blChunks[0].text.includes('high'), 'severity present');
    assert(blChunks[0].linkedIssueKey === 'SCRUM-9', 'blocker linkedIssueKey');
    console.log('✓ Blocker → MemoryChunk');

    // --- Resolution ---
    const update = await prisma.pulseBlockerUpdate.create({
      data: {
        blockerId: blocker.id,
        userId: user.id,
        previousStatus: 'open',
        newStatus: 'resolved',
        notes: 'Backend delivered the API contract',
        resolutionType: 'fixed',
        daysOpen: 2,
        updatedFrom: 'test',
      },
    });
    createdIds.updates.push(update.id);
    await prisma.pulseBlocker.update({
      where: { id: blocker.id },
      data: {
        status: 'resolved',
        resolutionNotes: 'Backend delivered the API contract',
        resolvedAt: new Date(),
      },
    });
    const resEvent = await outbox.enqueueUpsert({
      workspaceId: workspace.id,
      sourceType: MEMORY_SOURCE.BLOCKER_RESOLUTION,
      sourceId: update.id,
    });
    createdIds.events.push(resEvent.id);
    await processOurs([resEvent.id]);
    const resChunks = await prisma.memoryChunk.findMany({
      where: {
        workspaceId: workspace.id,
        sourceType: MEMORY_SOURCE.BLOCKER_RESOLUTION,
        sourceId: update.id,
      },
    });
    assert(resChunks.length === 1, 'resolution chunk');
    assert(resChunks[0].text.includes('Problem:'), 'problem included');
    assert(
      resChunks[0].text.includes('Backend delivered'),
      'resolution notes included',
    );
    assert(resChunks[0].linkedIssueKey === 'SCRUM-9', 'resolution linkedIssueKey');
    console.log('✓ Blocker resolution → MemoryChunk');

    // --- Report multi-chunk + reuse ---
    const longSection = 'Alpha progress. '.repeat(200);
    const digest = await prisma.aiDigest.create({
      data: {
        teamId: team.id,
        runId: run.id,
        source: 'ai',
        summary: `Weekly summary ${suffix}`,
        blockers: [{ text: 'Waiting on design' }],
        themes: [{ name: 'Delivery' }],
        reportSections: {
          keyAccomplishments: [longSection],
          risks: ['Timeline slip'],
          aiInsights: ['Focus on API'],
          actionItems: ['Ship contract'],
          overallProgress: 'Steady',
        },
      },
    });
    createdIds.digests.push(digest.id);

    const repEvent = await outbox.enqueueUpsert({
      workspaceId: workspace.id,
      sourceType: MEMORY_SOURCE.REPORT,
      sourceId: digest.id,
    });
    createdIds.events.push(repEvent.id);
    const callsBefore = fakeProvider.calls;
    await processOurs([repEvent.id]);
    const repChunks1 = await prisma.memoryChunk.findMany({
      where: {
        workspaceId: workspace.id,
        sourceType: MEMORY_SOURCE.REPORT,
        sourceId: digest.id,
      },
      orderBy: { chunkIndex: 'asc' },
    });
    assert(repChunks1.length >= 2, 'report produces multiple chunks');
    assert(
      repChunks1.every((c, i) => c.chunkIndex === i),
      'deterministic contiguous indexes',
    );
    const hashes1 = repChunks1.map((c) => c.contentHash);
    const callsAfterFirst = fakeProvider.calls;

    // Reprocess identical source — reuse embeddings
    const repEvent2 = await outbox.enqueueUpsert({
      workspaceId: workspace.id,
      sourceType: MEMORY_SOURCE.REPORT,
      sourceId: digest.id,
    });
    createdIds.events.push(repEvent2.id);
    await processOurs([repEvent2.id]);
    const repChunks2 = await prisma.memoryChunk.findMany({
      where: {
        workspaceId: workspace.id,
        sourceType: MEMORY_SOURCE.REPORT,
        sourceId: digest.id,
      },
      orderBy: { chunkIndex: 'asc' },
    });
    assert(repChunks2.length === repChunks1.length, 'same chunk count');
    assert(
      repChunks2.every((c, i) => c.contentHash === hashes1[i]),
      'same content hashes',
    );
    assert(
      fakeProvider.calls === callsAfterFirst,
      'unchanged embeddings reused (no new OpenAI calls)',
    );
    console.log('✓ Report multi-chunk + embedding reuse');

    // Shorten report — obsolete chunks removed after success
    await prisma.aiDigest.update({
      where: { id: digest.id },
      data: {
        summary: `Short ${suffix}`,
        reportSections: { overallProgress: 'Done' },
        blockers: [],
        themes: [],
      },
    });
    const repEvent3 = await outbox.enqueueUpsert({
      workspaceId: workspace.id,
      sourceType: MEMORY_SOURCE.REPORT,
      sourceId: digest.id,
    });
    createdIds.events.push(repEvent3.id);
    await processOurs([repEvent3.id]);
    const repChunks3 = await prisma.memoryChunk.findMany({
      where: {
        workspaceId: workspace.id,
        sourceType: MEMORY_SOURCE.REPORT,
        sourceId: digest.id,
      },
    });
    assert(
      repChunks3.length < repChunks1.length,
      'obsolete report chunks removed',
    );
    console.log('✓ Obsolete chunks removed after successful rebuild');

    // --- Embedding failure preserves old chunks ---
    const beforeFail = await prisma.memoryChunk.findMany({
      where: {
        workspaceId: workspace.id,
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: blocker.id,
      },
    });
    fakeProvider.failNext = true;
    const failEvent = await outbox.enqueueUpsert({
      workspaceId: workspace.id,
      sourceType: MEMORY_SOURCE.BLOCKER,
      sourceId: blocker.id,
    });
    createdIds.events.push(failEvent.id);
    const failResult = await processOurs([failEvent.id]);
    assert(failResult.retried + failResult.failed >= 1, 'failure handled');
    const failRow = await prisma.memoryOutboxEvent.findUnique({
      where: { id: failEvent.id },
    });
    assert(
      failRow?.status === MemoryOutboxStatus.PENDING ||
        failRow?.status === MemoryOutboxStatus.FAILED,
      'not COMPLETED on embed failure',
    );
    assert(failRow?.lastError, 'lastError set');
    const afterFail = await prisma.memoryChunk.findMany({
      where: {
        workspaceId: workspace.id,
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: blocker.id,
      },
    });
    assert(afterFail.length === beforeFail.length, 'old chunks preserved');
    assert(
      afterFail[0].contentHash === beforeFail[0].contentHash,
      'old chunk content intact',
    );
    console.log('✓ Embedding failure preserves last good chunks');

    // --- Workspace mismatch ---
    if (otherWorkspace) {
      const badEvent = await outbox.enqueueUpsert({
        workspaceId: otherWorkspace.id,
        sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
        sourceId: answer.id,
      });
      createdIds.events.push(badEvent.id);
      await processOurs([badEvent.id]);
      const badRow = await prisma.memoryOutboxEvent.findUnique({
        where: { id: badEvent.id },
      });
      assert(
        badRow?.status === MemoryOutboxStatus.FAILED,
        'mismatch is permanent FAILED',
      );
      const leaked = await prisma.memoryChunk.count({
        where: {
          workspaceId: otherWorkspace.id,
          sourceId: answer.id,
        },
      });
      assert(leaked === 0, 'no cross-workspace chunks');
      console.log('✓ Workspace mismatch refused');
    } else {
      console.log('⚠ Only one workspace — skipped mismatch pair test');
    }

    // --- DELETE ---
    const delEvent = await outbox.enqueueDelete({
      workspaceId: workspace.id,
      sourceType: MEMORY_SOURCE.BLOCKER,
      sourceId: blocker.id,
    });
    createdIds.events.push(delEvent.id);
    await processOurs([delEvent.id]);
    const afterDel = await prisma.memoryChunk.count({
      where: {
        workspaceId: workspace.id,
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: blocker.id,
      },
    });
    assert(afterDel === 0, 'blocker chunks deleted');
    const answerStill = await prisma.memoryChunk.count({
      where: {
        workspaceId: workspace.id,
        sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
        sourceId: answer.id,
      },
    });
    assert(answerStill >= 1, 'unrelated chunks remain');
    const delEvent2 = await outbox.enqueueDelete({
      workspaceId: workspace.id,
      sourceType: MEMORY_SOURCE.BLOCKER,
      sourceId: blocker.id,
    });
    createdIds.events.push(delEvent2.id);
    await processOurs([delEvent2.id]);
    const del2 = await prisma.memoryOutboxEvent.findUnique({
      where: { id: delEvent2.id },
    });
    assert(del2?.status === MemoryOutboxStatus.COMPLETED, 'idempotent DELETE');
    console.log('✓ DELETE processing (idempotent)');

    // --- Prohibited ---
    assert(!isSupportedMemoryWorkerSource('AI_CONVERSATION'), 'no AI_CONVERSATION');
    assert(!isSupportedMemoryWorkerSource('SLACK_MESSAGE'), 'no SLACK_MESSAGE');
    assert(!isSupportedMemoryWorkerSource('JIRA_CACHE'), 'no JIRA_CACHE');
    const badType = await outbox.enqueueUpsert({
      workspaceId: workspace.id,
      sourceType: MEMORY_SOURCE.BLOCKER,
      sourceId: `noop-${suffix}`,
    });
    // manually corrupt sourceType
    await prisma.memoryOutboxEvent.update({
      where: { id: badType.id },
      data: { sourceType: 'AI_CONVERSATION' },
    });
    createdIds.events.push(badType.id);
    await processOurs([badType.id]);
    const badTypeRow = await prisma.memoryOutboxEvent.findUnique({
      where: { id: badType.id },
    });
    assert(badTypeRow?.status === MemoryOutboxStatus.FAILED, 'unsupported FAILED');
    const badChunks = await prisma.memoryChunk.count({
      where: { sourceType: 'AI_CONVERSATION' },
    });
    assert(badChunks === 0, 'no AI_CONVERSATION chunks');
    console.log('✓ Prohibited sources rejected');

    // Hash helper sanity
    assert(
      hashChunkContent('a') === hashChunkContent('a'),
      'deterministic hash',
    );

    console.log('All Phase 2B memory worker tests passed.');
  } finally {
    // Cleanup fixtures (best-effort)
    await prisma.memoryChunk.deleteMany({
      where: {
        OR: [
          { sourceId: { in: createdIds.answers } },
          { sourceId: { in: createdIds.blockers } },
          { sourceId: { in: createdIds.updates } },
          { sourceId: { in: createdIds.digests } },
        ],
      },
    });
    await prisma.memoryOutboxEvent.deleteMany({
      where: { id: { in: createdIds.events } },
    });
    if (createdIds.answers.length) {
      await prisma.answerJiraIssueLink.deleteMany({
        where: { answerId: { in: createdIds.answers } },
      });
      await prisma.answer.deleteMany({
        where: { id: { in: createdIds.answers } },
      });
    }
    if (createdIds.updates.length) {
      await prisma.pulseBlockerUpdate.deleteMany({
        where: { id: { in: createdIds.updates } },
      });
    }
    if (createdIds.blockers.length) {
      await prisma.pulseBlocker.deleteMany({
        where: { id: { in: createdIds.blockers } },
      });
    }
    if (createdIds.digests.length) {
      await prisma.aiDigest.deleteMany({
        where: { id: { in: createdIds.digests } },
      });
    }
    if (createdIds.runs.length) {
      await prisma.standupSubmission.deleteMany({
        where: { runId: { in: createdIds.runs } },
      });
      await prisma.standupRun.deleteMany({
        where: { id: { in: createdIds.runs } },
      });
    }
    if (createdIds.checkIns.length) {
      await prisma.question.deleteMany({
        where: { checkInId: { in: createdIds.checkIns } },
      });
      await prisma.checkIn.deleteMany({
        where: { id: { in: createdIds.checkIns } },
      });
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
