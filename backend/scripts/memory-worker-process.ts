/**
 * Operator CLI — process PENDING MemoryOutboxEvent via existing Phase 2B worker.
 *
 * Usage:
 *   npm run memory:worker-process -- --limit=50
 *   npm run memory:worker-process -- --drain --maxBatches=200
 *
 * Does not change Ask Pulse mode or ingestion writers.
 */
import { PrismaClient, MemoryOutboxStatus } from '@prisma/client';
import { OpenAiEmbeddingProvider } from '../src/ai/workspace/retrieval/openai-embedding.provider';
import { MemorySourceLoader, MemoryNormalizerService } from '../src/memory/memory-source.loader';
import { MemoryChunkerService } from '../src/memory/memory-chunker.service';
import { MemoryEmbeddingService } from '../src/memory/memory-embedding.service';
import { MemoryVectorSearchService } from '../src/memory/memory-vector-search.service';
import { MemoryAclService } from '../src/memory/memory-acl.service';
import { MemoryIndexWorkerService } from '../src/memory/memory-index.worker';
import { MEMORY_WORKER_CONFIG } from '../src/memory/memory.config';

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const opts: Record<string, string> = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) flags.add(body);
    else opts[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return { flags, opts };
}

async function main() {
  const { flags, opts } = parseArgs(process.argv.slice(2));
  const limit = Number(opts.limit ?? MEMORY_WORKER_CONFIG.batchSize) || 8;
  const drain = flags.has('drain');
  const maxBatches = Number(opts.maxBatches ?? 500) || 500;
  const workspaceId = opts.workspaceId?.trim() || null;

  const prisma = new PrismaClient();
  const embeddingsProvider = new OpenAiEmbeddingProvider();
  const embeddings = new MemoryEmbeddingService(embeddingsProvider as any);
  const loader = new MemorySourceLoader(prisma as any);
  const normalizer = new MemoryNormalizerService();
  const chunker = new MemoryChunkerService();
  const acl = new MemoryAclService(prisma as any);
  const vector = new MemoryVectorSearchService(prisma as any, acl, embeddings);
  await vector.detectBackend();
  const worker = new MemoryIndexWorkerService(
    prisma as any,
    loader,
    normalizer,
    chunker,
    embeddings,
    vector,
  );

  try {
    let batches = 0;
    let totalCompleted = 0;
    let totalFailed = 0;
    let totalRetried = 0;
    let totalClaimed = 0;

    do {
      const beforePending = await prisma.memoryOutboxEvent.count({
        where: {
          status: MemoryOutboxStatus.PENDING,
          ...(workspaceId ? { workspaceId } : {}),
        },
      });
      if (beforePending === 0 && batches > 0) break;
      if (beforePending === 0 && batches === 0) {
        console.log('No PENDING outbox events.');
        break;
      }

      const result = await worker.processPendingBatch(limit);
      batches += 1;
      totalClaimed += result.claimed;
      totalCompleted += result.completed;
      totalFailed += result.failed;
      totalRetried += result.retried;
      console.log(
        `batch=${batches} claimed=${result.claimed} completed=${result.completed} failed=${result.failed} retried=${result.retried} pendingBefore=${beforePending}`,
      );

      if (!drain) break;
      if (result.claimed === 0) {
        // Maybe PROCESSING stuck — recover once more
        await worker.processPendingBatch(limit);
        const still = await prisma.memoryOutboxEvent.count({
          where: {
            status: {
              in: [MemoryOutboxStatus.PENDING, MemoryOutboxStatus.PROCESSING],
            },
            ...(workspaceId ? { workspaceId } : {}),
          },
        });
        if (still === 0) break;
        console.log(`still in-flight=${still}; continuing…`);
      }
    } while (drain && batches < maxBatches);

    const outbox = await prisma.memoryOutboxEvent.groupBy({
      by: ['status'],
      ...(workspaceId ? { where: { workspaceId } } : {}),
      _count: { _all: true },
    });
    console.log(
      `done batches=${batches} claimed=${totalClaimed} completed=${totalCompleted} failed=${totalFailed} retried=${totalRetried}`,
    );
    console.log(
      'outbox:',
      Object.fromEntries(outbox.map((r) => [r.status, r._count._all])),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
