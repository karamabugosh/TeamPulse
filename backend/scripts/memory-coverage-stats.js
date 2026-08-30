const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const WS = '0e4985cc-3955-4af5-8cba-d72f25f1a8ee';

async function main() {
  const total = await prisma.memoryChunk.count({ where: { workspaceId: WS } });
  const indexed = await prisma.memoryChunk.count({
    where: { workspaceId: WS, indexedAt: { not: null } },
  });
  const withEmb = await prisma.memoryChunk.count({
    where: { workspaceId: WS, embedding: { not: null } },
  });
  const vecRows = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS c FROM "MemoryChunk"
    WHERE "workspaceId" = ${WS} AND embedding_vec IS NOT NULL
  `;
  const failed = await prisma.memoryOutboxEvent.count({
    where: { workspaceId: WS, status: 'FAILED' },
  });
  const blocker = await prisma.memoryChunk.findFirst({
    where: { sourceId: 'e5cd3560-2dc2-4fcc-ab6f-72598d585864' },
    select: {
      metadata: true,
      sourceType: true,
      indexedAt: true,
      embeddingModel: true,
      sourceId: true,
    },
  });
  console.log(
    JSON.stringify(
      {
        total,
        indexed,
        withEmb,
        withVec: vecRows[0]?.c ?? 0,
        failed,
        blockerChunk: blocker,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
