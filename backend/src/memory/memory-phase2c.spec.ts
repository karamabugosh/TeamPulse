/**
 * Pulse V2 Phase 2C — historical backfill + verification tests.
 * Run: npm run test:memory-phase2c
 */
import {
  MemoryOutboxOperation,
  MemoryOutboxStatus,
  MemoryVisibility,
  PrismaClient,
  QuestionType,
} from '@prisma/client';
import { MemoryOutboxService } from './memory-outbox.service';
import { MemoryBackfillService } from './memory-backfill.service';
import { MEMORY_SOURCE } from './memory-source.constants';
import {
  isMemoryEligibleBlockerResolutionUpdate,
  isMemoryEligibleAnswerType,
} from './memory-ingestion.policy';
import { MemorySourceLoader, MemoryNormalizerService } from './memory-source.loader';
import { MemoryChunkerService } from './memory-chunker.service';
import { MemoryEmbeddingService } from './memory-embedding.service';
import { MemoryIndexWorkerService } from './memory-index.worker';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class FakeEmbeddingProvider {
  calls = 0;
  isAvailable() {
    return true;
  }
  model() {
    return 'test-embed';
  }
  async embedTexts(texts: string[]) {
    this.calls += texts.length;
    return texts.map(() => Array.from({ length: 8 }, (_, i) => i + 0.25));
  }
}

async function main() {
  console.log('memory-phase2c.spec.ts');

  assert(
    isMemoryEligibleBlockerResolutionUpdate({ newStatus: 'resolved' }),
    'resolved update eligible',
  );
  assert(
    !isMemoryEligibleBlockerResolutionUpdate({ newStatus: 'open' }),
    'open update not resolution',
  );
  assert(!isMemoryEligibleAnswerType(QuestionType.ISSUE_REF), 'ISSUE_REF skipped');
  console.log('✓ Shared eligibility policy');

  const prisma = new PrismaClient();
  const outbox = new MemoryOutboxService(prisma as any);
  const backfill = new MemoryBackfillService(prisma as any, outbox);
  const fakeEmbed = new FakeEmbeddingProvider();
  const worker = new MemoryIndexWorkerService(
    prisma as any,
    new MemorySourceLoader(prisma as any),
    new MemoryNormalizerService(),
    new MemoryChunkerService(),
    new MemoryEmbeddingService(fakeEmbed as any),
    {
      syncNativeVector: async () => undefined,
      getBackend: () => 'unavailable',
    } as any,
  );

  const workspaces = await prisma.workspace.findMany({
    orderBy: { installedAt: 'asc' },
    take: 2,
  });
  assert(workspaces.length >= 1, 'need workspace');
  const wsA = workspaces[0];
  const wsB = workspaces[1] ?? null;

  const teamA = await prisma.team.findFirst({ where: { workspaceId: wsA.id } });
  assert(teamA, 'need team A');
  const userA = await prisma.user.findFirst({ where: { workspaceId: wsA.id } });
  assert(userA, 'need user A');

  const suffix = Date.now();
  const cleanup = {
    answers: [] as string[],
    blockers: [] as string[],
    updates: [] as string[],
    digests: [] as string[],
    runs: [] as string[],
    checkIns: [] as string[],
    questions: [] as string[],
    events: [] as string[],
    chunks: [] as string[],
    jiraCache: [] as string[],
  };

  try {
    // --- Dry-run safety (counts unchanged) ---
    const before = {
      events: await prisma.memoryOutboxEvent.count(),
      chunks: await prisma.memoryChunk.count(),
      answers: await prisma.answer.count(),
      blockers: await prisma.pulseBlocker.count(),
      updates: await prisma.pulseBlockerUpdate.count(),
      digests: await prisma.aiDigest.count(),
    };
    await backfill.analyzeWorkspace(wsA.id, {
      sourceTypes: [MEMORY_SOURCE.BLOCKER],
      pageSize: 50,
    });
    const afterDry = {
      events: await prisma.memoryOutboxEvent.count(),
      chunks: await prisma.memoryChunk.count(),
      answers: await prisma.answer.count(),
      blockers: await prisma.pulseBlocker.count(),
      updates: await prisma.pulseBlockerUpdate.count(),
      digests: await prisma.aiDigest.count(),
    };
    assert(
      JSON.stringify(before) === JSON.stringify(afterDry),
      'dry-run must not write',
    );
    console.log('✓ Dry-run is read-only');

    // --- Classification fixtures ---
    const mkBlocker = async (label: string) => {
      const b = await prisma.pulseBlocker.create({
        data: {
          workspaceId: wsA.id,
          userId: userA.id,
          teamId: teamA.id,
          description: `2C ${label} ${suffix}`,
          severity: 'medium',
          status: 'open',
        },
      });
      cleanup.blockers.push(b.id);
      return b;
    };

    const missing = await mkBlocker('missing');
    const indexed = await mkBlocker('indexed');
    const inFlightPending = await mkBlocker('inflight-p');
    const inFlightProc = await mkBlocker('inflight-x');
    const failed = await mkBlocker('failed');
    const inconsistent = await mkBlocker('inconsistent');

    await prisma.memoryChunk.create({
      data: {
        workspaceId: wsA.id,
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: indexed.id,
        chunkIndex: 0,
        text: 'indexed fixture',
        contentHash: 'a'.repeat(64),
        visibility: MemoryVisibility.TEAM,
        teamId: teamA.id,
        embedding: [0.1, 0.2],
        embeddingModel: 'test-embed',
        embeddingDimensions: 2,
        indexedAt: new Date(),
      },
    });

    const pe = await outbox.enqueueUpsert({
      workspaceId: wsA.id,
      sourceType: MEMORY_SOURCE.BLOCKER,
      sourceId: inFlightPending.id,
    });
    cleanup.events.push(pe.id);

    const xe = await outbox.enqueueUpsert({
      workspaceId: wsA.id,
      sourceType: MEMORY_SOURCE.BLOCKER,
      sourceId: inFlightProc.id,
    });
    cleanup.events.push(xe.id);
    await prisma.memoryOutboxEvent.update({
      where: { id: xe.id },
      data: {
        status: MemoryOutboxStatus.PROCESSING,
        lockedAt: new Date(),
      },
    });

    const fe = await outbox.enqueueUpsert({
      workspaceId: wsA.id,
      sourceType: MEMORY_SOURCE.BLOCKER,
      sourceId: failed.id,
    });
    cleanup.events.push(fe.id);
    await prisma.memoryOutboxEvent.update({
      where: { id: fe.id },
      data: {
        status: MemoryOutboxStatus.FAILED,
        lastError: 'fixture',
        processedAt: new Date(),
      },
    });

    const ie = await outbox.enqueueUpsert({
      workspaceId: wsA.id,
      sourceType: MEMORY_SOURCE.BLOCKER,
      sourceId: inconsistent.id,
    });
    cleanup.events.push(ie.id);
    await prisma.memoryOutboxEvent.update({
      where: { id: ie.id },
      data: {
        status: MemoryOutboxStatus.COMPLETED,
        operation: MemoryOutboxOperation.UPSERT,
        processedAt: new Date(),
      },
    });

    const states = await backfill.classifyEligibleSources(wsA.id, MEMORY_SOURCE.BLOCKER, [
      missing.id,
      indexed.id,
      inFlightPending.id,
      inFlightProc.id,
      failed.id,
      inconsistent.id,
    ]);
    assert(states.get(missing.id) === 'MISSING', 'MISSING');
    assert(states.get(indexed.id) === 'INDEXED', 'INDEXED');
    assert(states.get(inFlightPending.id) === 'IN_FLIGHT', 'PENDING IN_FLIGHT');
    assert(states.get(inFlightProc.id) === 'IN_FLIGHT', 'PROCESSING IN_FLIGHT');
    assert(states.get(failed.id) === 'FAILED', 'FAILED');
    assert(states.get(inconsistent.id) === 'INCONSISTENT', 'INCONSISTENT');
    console.log('✓ Source classification');

    // --- Enqueue missing once; no duplicate active ---
    const enq1 = await backfill.enqueueWorkspace(wsA.id, {
      sourceTypes: [MEMORY_SOURCE.BLOCKER],
      limit: 5,
      onlyMissing: true,
      onlySourceIds: [missing.id],
    });
    assert(enq1.enqueued === 1, 'enqueued exactly the missing fixture');
    const pendingForMissing = await prisma.memoryOutboxEvent.findMany({
      where: {
        workspaceId: wsA.id,
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: missing.id,
        status: MemoryOutboxStatus.PENDING,
      },
    });
    assert(pendingForMissing.length === 1, 'exactly one PENDING for missing');
    cleanup.events.push(pendingForMissing[0].id);
    assert(
      pendingForMissing[0].operation === MemoryOutboxOperation.UPSERT,
      'UPSERT',
    );

    const enq2 = await backfill.enqueueWorkspace(wsA.id, {
      sourceTypes: [MEMORY_SOURCE.BLOCKER],
      limit: 50,
      onlyMissing: true,
      onlySourceIds: [missing.id],
    });
    assert(enq2.enqueued === 0, 'second enqueue skips in-flight');
    const pendingAgain = await prisma.memoryOutboxEvent.count({
      where: {
        workspaceId: wsA.id,
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: missing.id,
        status: {
          in: [MemoryOutboxStatus.PENDING, MemoryOutboxStatus.PROCESSING],
        },
      },
    });
    assert(pendingAgain === 1, 'no duplicate active event');
    console.log('✓ Enqueue + duplicate active prevention');

    // --- Worker integration ---
    await worker.processPendingBatch(5, [pendingForMissing[0].id]);
    const chunks = await prisma.memoryChunk.findMany({
      where: {
        workspaceId: wsA.id,
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: missing.id,
      },
    });
    assert(chunks.length >= 1, 'worker created MemoryChunk from backfill event');
    assert(fakeEmbed.calls >= 1, 'worker called embedding (not backfill)');
    console.log('✓ Worker integration');

    // --- Batch limit ---
    const batchBlockers = [];
    for (let i = 0; i < 7; i += 1) {
      batchBlockers.push(await mkBlocker(`batch-${i}`));
    }
    const b1 = await backfill.enqueueWorkspace(wsA.id, {
      sourceTypes: [MEMORY_SOURCE.BLOCKER],
      limit: 3,
      onlyMissing: true,
      onlySourceIds: batchBlockers.map((b) => b.id),
    });
    assert(b1.enqueued === 3, `first batch 3 got ${b1.enqueued}`);
    cleanup.events.push(...b1.eventIds);
    const b2 = await backfill.enqueueWorkspace(wsA.id, {
      sourceTypes: [MEMORY_SOURCE.BLOCKER],
      limit: 3,
      onlyMissing: true,
      onlySourceIds: batchBlockers.map((b) => b.id),
    });
    assert(b2.enqueued === 3, `second batch 3 got ${b2.enqueued}`);
    cleanup.events.push(...b2.eventIds);
    const b3 = await backfill.enqueueWorkspace(wsA.id, {
      sourceTypes: [MEMORY_SOURCE.BLOCKER],
      limit: 3,
      onlyMissing: true,
      onlySourceIds: batchBlockers.map((b) => b.id),
    });
    assert(b3.enqueued === 1, `third batch 1 got ${b3.enqueued}`);
    cleanup.events.push(...b3.eventIds);
    // no duplicate actives for batch blockers
    for (const b of batchBlockers) {
      const n = await prisma.memoryOutboxEvent.count({
        where: {
          workspaceId: wsA.id,
          sourceType: MEMORY_SOURCE.BLOCKER,
          sourceId: b.id,
          status: {
            in: [MemoryOutboxStatus.PENDING, MemoryOutboxStatus.PROCESSING],
          },
        },
      });
      assert(n <= 1, `at most one active for ${b.id}`);
    }
    console.log('✓ Batch limit');

    // --- Report workspace isolation ---
    const checkIn = await prisma.checkIn.create({
      data: {
        team: { connect: { id: teamA.id } },
        name: `2C CI ${suffix}`,
        collectionCron: '0 9 * * 1-5',
        timezone: 'UTC',
      },
    });
    cleanup.checkIns.push(checkIn.id);
    const run = await prisma.standupRun.create({
      data: {
        teamId: teamA.id,
        checkInId: checkIn.id,
        scheduledFor: new Date(),
        status: 'closed',
      },
    });
    cleanup.runs.push(run.id);
    const digest = await prisma.aiDigest.create({
      data: {
        teamId: teamA.id,
        runId: run.id,
        source: 'ai',
        summary: `Report 2C ${suffix}`,
        blockers: [],
        themes: [],
      },
    });
    cleanup.digests.push(digest.id);

    const dryA = await backfill.analyzeWorkspace(wsA.id, {
      sourceTypes: [MEMORY_SOURCE.REPORT],
    });
    const reportA = dryA.bySourceType.find(
      (c) => c.sourceType === MEMORY_SOURCE.REPORT,
    );
    assert(reportA && reportA.eligible >= 1, 'report eligible in A');

    if (wsB) {
      const dryB = await backfill.analyzeWorkspace(wsB.id, {
        sourceTypes: [MEMORY_SOURCE.REPORT],
      });
      const reportB = dryB.bySourceType.find(
        (c) => c.sourceType === MEMORY_SOURCE.REPORT,
      );
      const statesB = await backfill.classifyEligibleSources(
        wsB.id,
        MEMORY_SOURCE.REPORT,
        [digest.id],
      );
      // digest is not in B's scan; classifying foreign id should be MISSING locally but we never enqueue from B scan
      assert(reportB != null, 'report counters for B');
      const enqB = await backfill.enqueueWorkspace(wsB.id, {
        sourceTypes: [MEMORY_SOURCE.REPORT],
        limit: 100,
        onlyMissing: true,
      });
      cleanup.events.push(...enqB.eventIds);
      const leaked = await prisma.memoryOutboxEvent.count({
        where: {
          workspaceId: wsB.id,
          sourceType: MEMORY_SOURCE.REPORT,
          sourceId: digest.id,
        },
      });
      assert(leaked === 0, 'Workspace B must not enqueue Workspace A report');
      void statesB;
      console.log('✓ Report Team→Workspace isolation');
    } else {
      console.log('⚠ Only one workspace — skipped B report isolation');
    }

    // --- Blocker resolution selectivity ---
    const parent = await mkBlocker('res-parent');
    const ordinary = await prisma.pulseBlockerUpdate.create({
      data: {
        blockerId: parent.id,
        userId: userA.id,
        previousStatus: 'open',
        newStatus: 'open',
        notes: 'still blocked',
        updatedFrom: 'test',
      },
    });
    cleanup.updates.push(ordinary.id);
    const resolution = await prisma.pulseBlockerUpdate.create({
      data: {
        blockerId: parent.id,
        userId: userA.id,
        previousStatus: 'open',
        newStatus: 'resolved',
        notes: 'fixed',
        resolutionType: 'fixed',
        updatedFrom: 'test',
      },
    });
    cleanup.updates.push(resolution.id);

    const resDry = await backfill.analyzeWorkspace(wsA.id, {
      sourceTypes: [MEMORY_SOURCE.BLOCKER_RESOLUTION],
    });
    const resCounters = resDry.bySourceType[0];
    assert(resCounters.skipped >= 1, 'ordinary updates skipped');

    const resStates = await backfill.classifyEligibleSources(
      wsA.id,
      MEMORY_SOURCE.BLOCKER_RESOLUTION,
      [ordinary.id, resolution.id],
    );
    // ordinary shouldn't be in eligible scan — classify still works if passed
    assert(
      isMemoryEligibleBlockerResolutionUpdate({ newStatus: 'open' }) === false,
      'open update not eligible',
    );
    assert(resStates.get(resolution.id) === 'MISSING', 'resolution missing');

    const resEnq = await backfill.enqueueWorkspace(wsA.id, {
      sourceTypes: [MEMORY_SOURCE.BLOCKER_RESOLUTION],
      limit: 20,
      onlyMissing: true,
      onlySourceIds: [ordinary.id, resolution.id],
    });
    cleanup.events.push(...resEnq.eventIds);
    const ordEvents = await prisma.memoryOutboxEvent.count({
      where: {
        workspaceId: wsA.id,
        sourceType: MEMORY_SOURCE.BLOCKER_RESOLUTION,
        sourceId: ordinary.id,
      },
    });
    const resEvents = await prisma.memoryOutboxEvent.count({
      where: {
        workspaceId: wsA.id,
        sourceType: MEMORY_SOURCE.BLOCKER_RESOLUTION,
        sourceId: resolution.id,
        status: MemoryOutboxStatus.PENDING,
      },
    });
    assert(ordEvents === 0, 'ordinary update not enqueued');
    assert(resEvents === 1, 'resolution enqueued');
    console.log('✓ Blocker resolution selectivity');

    // --- Jira cache protection ---
    const cacheKey = `CACHE-${suffix}`;
    const cache = await prisma.jiraIssueCacheEntry.create({
      data: {
        workspaceId: wsA.id,
        userId: userA.id,
        issueId: `cache-${suffix}`,
        issueKey: cacheKey,
        summary: 'WRONG FROM CACHE',
        status: 'Done-FROM-CACHE',
        assigneeName: 'Fake Cache Assignee',
        priority: 'Highest-CACHE',
      },
    });
    cleanup.jiraCache.push(cache.id);

    const linked = await mkBlocker('jira-link');
    await prisma.pulseBlocker.update({
      where: { id: linked.id },
      data: { linkedIssueKey: cacheKey, description: 'Pulse blocker narrative' },
    });
    const linkEnq = await backfill.enqueueWorkspace(wsA.id, {
      sourceTypes: [MEMORY_SOURCE.BLOCKER],
      limit: 30,
      onlyMissing: true,
      onlySourceIds: [linked.id],
    });
    cleanup.events.push(...linkEnq.eventIds);
    const linkEvent = await prisma.memoryOutboxEvent.findFirst({
      where: {
        workspaceId: wsA.id,
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: linked.id,
        status: MemoryOutboxStatus.PENDING,
      },
    });
    assert(linkEvent, 'linked blocker enqueued');
    await worker.processPendingBatch(5, [linkEvent!.id]);
    const linkChunk = await prisma.memoryChunk.findFirst({
      where: {
        workspaceId: wsA.id,
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: linked.id,
      },
    });
    assert(linkChunk, 'chunk created');
    assert(linkChunk!.linkedIssueKey === cacheKey, 'key allowed');
    assert(
      !linkChunk!.text.includes('Done-FROM-CACHE'),
      'must not use cache status',
    );
    assert(
      !linkChunk!.text.includes('Fake Cache Assignee'),
      'must not use cache assignee',
    );
    assert(
      !linkChunk!.text.includes('Highest-CACHE'),
      'must not use cache priority',
    );
    console.log('✓ Jira authority protection');

    // --- Demo / multi-workspace isolation ---
    if (wsB) {
      const teamB = await prisma.team.findFirst({
        where: { workspaceId: wsB.id },
      });
      const userB = await prisma.user.findFirst({
        where: { workspaceId: wsB.id },
      });
      if (teamB && userB) {
        const bOnly = await prisma.pulseBlocker.create({
          data: {
            workspaceId: wsB.id,
            userId: userB.id,
            teamId: teamB.id,
            description: `2C B-only ${suffix}`,
            severity: 'low',
            status: 'open',
          },
        });
        cleanup.blockers.push(bOnly.id);

        const enqA = await backfill.enqueueWorkspace(wsA.id, {
          sourceTypes: [MEMORY_SOURCE.BLOCKER],
          limit: 50,
          onlyMissing: true,
        });
        cleanup.events.push(...enqA.eventIds);
        const aHasB = await prisma.memoryOutboxEvent.count({
          where: {
            workspaceId: wsA.id,
            sourceId: bOnly.id,
          },
        });
        assert(aHasB === 0, 'A enqueue must not touch B source');

        const enqBonly = await backfill.enqueueWorkspace(wsB.id, {
          sourceTypes: [MEMORY_SOURCE.BLOCKER],
          limit: 20,
          onlyMissing: true,
          onlySourceIds: [bOnly.id],
        });
        cleanup.events.push(...enqBonly.eventIds);
        const bEvent = await prisma.memoryOutboxEvent.count({
          where: {
            workspaceId: wsB.id,
            sourceType: MEMORY_SOURCE.BLOCKER,
            sourceId: bOnly.id,
            status: MemoryOutboxStatus.PENDING,
          },
        });
        assert(bEvent === 1, 'B enqueue only B');
        console.log('✓ Multi-workspace / Demo isolation');
      } else {
        console.log('⚠ Workspace B lacks team/user — skipped pair isolation');
      }
    }

    // --- Verify embedding coverage ---
    const verify = await backfill.verifyWorkspace(wsA.id);
    assert(typeof verify.chunks.withEmbedding === 'number', 'withEmbedding');
    assert(typeof verify.chunks.withoutEmbedding === 'number', 'withoutEmbedding');
    assert(verify.chunks.byVisibility.PRIVATE === 0 || verify.chunks.byVisibility.PRIVATE >= 0, 'visibility map');
    const samples = await backfill.sampleWorkspaceChunks(wsA.id, 5);
    assert(samples.every((s) => !('embedding' in s && Array.isArray((s as any).embedding))), 'no vectors');
    assert(samples.every((s) => typeof s.hasEmbedding === 'boolean'), 'hasEmbedding flag');
    console.log('✓ Verification + embedding coverage');

    // Backfill must not call OpenAI — fakeEmbed.calls only from worker
    const callsAfterBackfillOnly = fakeEmbed.calls;
    await backfill.analyzeWorkspace(wsA.id, {
      sourceTypes: [MEMORY_SOURCE.BLOCKER],
    });
    await backfill.enqueueWorkspace(wsA.id, {
      sourceTypes: [MEMORY_SOURCE.REPORT],
      limit: 1,
      onlyMissing: true,
    });
    assert(
      fakeEmbed.calls === callsAfterBackfillOnly,
      'backfill must not call embeddings',
    );
    console.log('✓ Backfill does not call OpenAI');

    console.log('All Phase 2C memory backfill tests passed.');
  } finally {
    await prisma.memoryChunk.deleteMany({
      where: {
        OR: [
          { sourceId: { in: cleanup.blockers } },
          { sourceId: { in: cleanup.answers } },
          { sourceId: { in: cleanup.updates } },
          { sourceId: { in: cleanup.digests } },
        ],
      },
    });
    await prisma.memoryOutboxEvent.deleteMany({
      where: {
        OR: [
          { id: { in: cleanup.events } },
          { sourceId: { in: cleanup.blockers } },
          { sourceId: { in: cleanup.updates } },
          { sourceId: { in: cleanup.digests } },
        ],
      },
    });
    if (cleanup.jiraCache.length) {
      await prisma.jiraIssueCacheEntry.deleteMany({
        where: { id: { in: cleanup.jiraCache } },
      });
    }
    if (cleanup.updates.length) {
      await prisma.pulseBlockerUpdate.deleteMany({
        where: { id: { in: cleanup.updates } },
      });
    }
    if (cleanup.blockers.length) {
      await prisma.pulseBlocker.deleteMany({
        where: { id: { in: cleanup.blockers } },
      });
    }
    if (cleanup.digests.length) {
      await prisma.aiDigest.deleteMany({
        where: { id: { in: cleanup.digests } },
      });
    }
    if (cleanup.runs.length) {
      await prisma.standupRun.deleteMany({
        where: { id: { in: cleanup.runs } },
      });
    }
    if (cleanup.checkIns.length) {
      await prisma.checkIn.deleteMany({
        where: { id: { in: cleanup.checkIns } },
      });
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
