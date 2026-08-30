/**
 * Pulse V2 Phase 3C.1 — enable/sync MemoryChunk pgvector (operator tool).
 *
 * Does NOT change MEMORY_V2_ASK_MODE / Ask Pulse routing.
 *
 * Usage:
 *   npm run memory:pgvector-enable
 *   npm run memory:pgvector-enable -- --workspaceId=<uuid>
 */
import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  parseEmbeddingJson,
} from '../src/ai/workspace/retrieval/embedding.util';
import { toVectorLiteral } from '../src/ai/workspace/retrieval/pgvector-support.service';

function parseArgs(argv: string[]) {
  const opts: Record<string, string> = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) continue;
    opts[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const workspaceId = opts.workspaceId?.trim() || null;
  const prisma = new PrismaClient();
  const dims = DEFAULT_EMBEDDING_DIMENSIONS;
  const model = DEFAULT_EMBEDDING_MODEL;

  try {
    const ext = await prisma.$queryRawUnsafe<
      Array<{ extname: string; extversion: string }>
    >(`SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'`);

    if (ext.length === 0) {
      try {
        await prisma.$executeRawUnsafe(
          'CREATE EXTENSION IF NOT EXISTS vector',
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('CREATE EXTENSION vector failed:', message);
        console.error(
          'Install pgvector system files first (see docs/PULSE_V2_PHASE3C1_PGVECTOR_ENABLEMENT.md).',
        );
        process.exit(1);
      }
    }

    const after = await prisma.$queryRawUnsafe<
      Array<{ extversion: string }>
    >(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`);
    console.log(`pgvector extension: ${after[0]?.extversion ?? 'unknown'}`);

    await prisma.$executeRawUnsafe(
      `ALTER TABLE "MemoryChunk"
       ADD COLUMN IF NOT EXISTS embedding_vec vector(${dims})`,
    );
    console.log(`MemoryChunk.embedding_vec vector(${dims}): ensured`);

    let indexName = 'none';
    try {
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "MemoryChunk_embedding_vec_hnsw_idx"
         ON "MemoryChunk"
         USING hnsw (embedding_vec vector_cosine_ops)`,
      );
      indexName = 'MemoryChunk_embedding_vec_hnsw_idx (hnsw / vector_cosine_ops)';
    } catch (hnswErr) {
      const hnswMsg =
        hnswErr instanceof Error ? hnswErr.message : String(hnswErr);
      console.warn('HNSW index skipped:', hnswMsg.split('\n')[0]);
      try {
        await prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS "MemoryChunk_embedding_vec_ivfflat_idx"
           ON "MemoryChunk"
           USING ivfflat (embedding_vec vector_cosine_ops)
           WITH (lists = 100)`,
        );
        indexName =
          'MemoryChunk_embedding_vec_ivfflat_idx (ivfflat / vector_cosine_ops)';
      } catch (ivfErr) {
        const ivfMsg = ivfErr instanceof Error ? ivfErr.message : String(ivfErr);
        console.warn('IVFFlat index skipped:', ivfMsg.split('\n')[0]);
        indexName = 'none (exact <=> search still works)';
      }
    }
    console.log(`ANN index: ${indexName}`);

    const where = workspaceId
      ? `WHERE "workspaceId" = '${workspaceId.replace(/'/g, "''")}'`
      : '';

    const totals = await prisma.$queryRawUnsafe<
      Array<{
        total: bigint;
        with_json: bigint;
        with_vec: bigint;
        compatible_json: bigint;
      }>
    >(
      `SELECT
         COUNT(*)::bigint AS total,
         COUNT(*) FILTER (WHERE embedding IS NOT NULL)::bigint AS with_json,
         COUNT(*) FILTER (WHERE embedding_vec IS NOT NULL)::bigint AS with_vec,
         COUNT(*) FILTER (
           WHERE embedding IS NOT NULL
             AND "embeddingDimensions" = ${dims}
             AND "embeddingModel" = '${model.replace(/'/g, "''")}'
         )::bigint AS compatible_json
       FROM "MemoryChunk"
       ${where}`,
    );
    console.log(
      `chunks total=${totals[0]?.total} with_json=${totals[0]?.with_json} with_vec_before=${totals[0]?.with_vec} compatible_json=${totals[0]?.compatible_json}`,
    );

    let synced = 0;
    let skipped = 0;
    let failed = 0;
    let cursor: string | undefined;
    for (;;) {
      const page = await prisma.memoryChunk.findMany({
        where: {
          ...(workspaceId ? { workspaceId } : {}),
          embedding: { not: null as any },
          embeddingDimensions: dims,
          embeddingModel: model,
        },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        take: 100,
        select: {
          id: true,
          embedding: true,
          embeddingDimensions: true,
          embeddingModel: true,
        },
      });
      if (page.length === 0) break;

      for (const row of page) {
        const vector = parseEmbeddingJson(row.embedding);
        if (!vector || vector.length !== dims) {
          skipped += 1;
          continue;
        }
        // Skip if already populated (idempotent)
        const existing = await prisma.$queryRawUnsafe<
          Array<{ has: boolean }>
        >(
          `SELECT (embedding_vec IS NOT NULL) AS has FROM "MemoryChunk" WHERE id = $1`,
          row.id,
        );
        if (existing[0]?.has) {
          skipped += 1;
          continue;
        }
        try {
          const literal = toVectorLiteral(vector);
          await prisma.$executeRawUnsafe(
            `UPDATE "MemoryChunk"
             SET embedding_vec = '${literal}'::vector
             WHERE id = $1`,
            row.id,
          );
          synced += 1;
        } catch {
          failed += 1;
        }
      }
      cursor = page[page.length - 1]?.id;
      if (page.length < 100) break;
    }

    const afterVec = await prisma.$queryRawUnsafe<
      Array<{ with_vec: bigint }>
    >(
      `SELECT COUNT(*) FILTER (WHERE embedding_vec IS NOT NULL)::bigint AS with_vec
       FROM "MemoryChunk" ${where}`,
    );

    console.log(`synced=${synced} skipped=${skipped} failed=${failed}`);
    console.log(`with_vec_after=${afterVec[0]?.with_vec}`);
    console.log('JSON embedding column preserved (not dropped).');
    console.log('Ask Pulse mode untouched.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
