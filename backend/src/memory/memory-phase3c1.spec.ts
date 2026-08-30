/**
 * Pulse V2 Phase 3C.1 — prove MemoryRetrievalService uses pgvector.
 * Run: npm run test:memory-phase3c1
 */
import { MemoryVisibility, PrismaClient } from '@prisma/client';
import { MemoryAclService } from './memory-acl.service';
import { MemoryFullTextSearchService } from './memory-fulltext-search.service';
import { MemoryVectorSearchService } from './memory-vector-search.service';
import { MemoryHybridRankingService } from './memory-hybrid-ranking.service';
import { MemoryEmbeddingService } from './memory-embedding.service';
import { MemoryRetrievalService } from './memory-retrieval.service';
import { OpenAiEmbeddingProvider } from '../ai/workspace/retrieval/openai-embedding.provider';
import { MEMORY_SOURCE } from './memory-source.constants';
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
} from '../ai/workspace/retrieval/embedding.util';
import { toVectorLiteral } from '../ai/workspace/retrieval/pgvector-support.service';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Deterministic unit vector for semantic fixture. */
function unitVector(seed: number, dims = DEFAULT_EMBEDDING_DIMENSIONS): number[] {
  const v = new Array(dims).fill(0);
  v[0] = Math.cos(seed);
  v[1] = Math.sin(seed);
  const norm = Math.hypot(v[0], v[1]) || 1;
  v[0] /= norm;
  v[1] /= norm;
  return v;
}

async function main() {
  console.log('memory-phase3c1.spec.ts');
  const prisma = new PrismaClient();
  const workspace = await prisma.workspace.findFirst({
    orderBy: { installedAt: 'asc' },
  });
  assert(workspace, 'need workspace');
  const user = await prisma.user.findFirst({
    where: { workspaceId: workspace.id },
  });
  assert(user, 'need user');

  const ext = await prisma.$queryRawUnsafe<Array<{ extversion: string }>>(
    `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
  );
  assert(ext.length > 0, 'pgvector extension must be installed');
  console.log(`✓ extension vector=${ext[0].extversion}`);

  const embeddings = new MemoryEmbeddingService(
    new OpenAiEmbeddingProvider() as any,
  );
  const acl = new MemoryAclService(prisma as any);
  const fullText = new MemoryFullTextSearchService(prisma as any, acl);
  const vector = new MemoryVectorSearchService(prisma as any, acl, embeddings);
  const backend = await vector.detectBackend();
  assert(backend === 'pgvector', `expected pgvector backend, got ${backend}`);
  console.log(`✓ MemoryVectorSearchService backend=${backend}`);

  const col = await prisma.$queryRawUnsafe<Array<{ udt: string }>>(
    `SELECT udt_name AS udt
     FROM information_schema.columns
     WHERE table_name = 'MemoryChunk' AND column_name = 'embedding_vec'`,
  );
  assert(col[0]?.udt === 'vector', 'embedding_vec column missing');
  console.log('✓ MemoryChunk.embedding_vec present');

  const idx = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes
     WHERE tablename = 'MemoryChunk'
       AND (indexname LIKE '%embedding_vec%')`,
  );
  console.log(
    `✓ ANN indexes: ${idx.map((i) => i.indexname).join(', ') || '(none — exact search OK)'}`,
  );

  const marker = `PGV3C1_${Date.now()}`;
  const queryVec = unitVector(0.42);
  const matchVec = unitVector(0.42); // identical → similarity 1
  const distractorVec = unitVector(2.1);

  const chunkIds: string[] = [];
  try {
    const match = await prisma.memoryChunk.create({
      data: {
        workspaceId: workspace.id,
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: `pgv-match-${marker}`,
        chunkIndex: 0,
        text: `${marker} semantic match about dashboard API dependency`,
        contentHash: `h-match-${marker}`,
        visibility: MemoryVisibility.WORKSPACE,
        embedding: matchVec,
        embeddingModel: DEFAULT_EMBEDDING_MODEL,
        embeddingDimensions: DEFAULT_EMBEDDING_DIMENSIONS,
      },
    });
    chunkIds.push(match.id);
    await prisma.$executeRawUnsafe(
      `UPDATE "MemoryChunk" SET embedding_vec = '${toVectorLiteral(matchVec)}'::vector WHERE id = $1`,
      match.id,
    );

    const distractor = await prisma.memoryChunk.create({
      data: {
        workspaceId: workspace.id,
        sourceType: MEMORY_SOURCE.REPORT,
        sourceId: `pgv-dist-${marker}`,
        chunkIndex: 0,
        text: `${marker} unrelated report filler text`,
        contentHash: `h-dist-${marker}`,
        visibility: MemoryVisibility.WORKSPACE,
        embedding: distractorVec,
        embeddingModel: DEFAULT_EMBEDDING_MODEL,
        embeddingDimensions: DEFAULT_EMBEDDING_DIMENSIONS,
      },
    });
    chunkIds.push(distractor.id);
    await prisma.$executeRawUnsafe(
      `UPDATE "MemoryChunk" SET embedding_vec = '${toVectorLiteral(distractorVec)}'::vector WHERE id = $1`,
      distractor.id,
    );

    // Unauthorized TEAM chunk with perfect vector — must never appear
    const team = await prisma.team.create({
      data: {
        workspaceId: workspace.id,
        name: `PGV Beta ${marker}`,
        slackChannelId: `C_PGV_${marker.slice(-8)}`,
      },
    });
    const secret = await prisma.memoryChunk.create({
      data: {
        workspaceId: workspace.id,
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: `pgv-secret-${marker}`,
        chunkIndex: 0,
        text: `${marker} BETA_SECRET perfect vector match`,
        contentHash: `h-sec-${marker}`,
        visibility: MemoryVisibility.TEAM,
        teamId: team.id,
        embedding: matchVec,
        embeddingModel: DEFAULT_EMBEDDING_MODEL,
        embeddingDimensions: DEFAULT_EMBEDDING_DIMENSIONS,
      },
    });
    chunkIds.push(secret.id);
    await prisma.$executeRawUnsafe(
      `UPDATE "MemoryChunk" SET embedding_vec = '${toVectorLiteral(matchVec)}'::vector WHERE id = $1`,
      secret.id,
    );

    const retrieval = new MemoryRetrievalService(
      acl,
      fullText,
      vector,
      new MemoryHybridRankingService(),
    );

    const result = await retrieval.retrieve({
      workspaceId: workspace.id,
      userId: user.id,
      query: `${marker} dashboard API dependency`,
      queryEmbeddingOverride: queryVec,
      queryEmbeddingModelOverride: DEFAULT_EMBEDDING_MODEL,
      debug: true,
      limit: 10,
    });

    assert(
      result.diagnostics?.vectorBackend === 'pgvector',
      `diagnostics backend=${result.diagnostics?.vectorBackend}`,
    );
    assert(
      result.evidence.some((e) => e.chunkId === match.id),
      'semantic match chunk missing',
    );
    assert(
      !result.evidence.some((e) => e.text.includes('BETA_SECRET')),
      'ACL leak via vector path',
    );
    assert(
      !result.evidence.some((e) => e.chunkId === secret.id),
      'unauthorized team chunk in results',
    );
    console.log(
      `✓ retrieval backend=pgvector evidence=${result.evidence.length} vectorCandidates=${result.diagnostics?.vectorCandidateCount}`,
    );
    console.log('✓ ACL applied on pgvector path');

    await prisma.teamMember.deleteMany({ where: { teamId: team.id } }).catch(() => undefined);
    await prisma.memoryChunk.deleteMany({ where: { id: { in: chunkIds } } });
    await prisma.team.delete({ where: { id: team.id } }).catch(() => undefined);
  } finally {
    if (chunkIds.length) {
      await prisma.memoryChunk.deleteMany({ where: { id: { in: chunkIds } } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }

  console.log('All Phase 3C.1 pgvector enablement tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
