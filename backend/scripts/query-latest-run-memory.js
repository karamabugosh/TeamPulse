const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const W = '0e4985cc-3955-4af5-8cba-d72f25f1a8ee';
const runId = 'f272e32d-e0a0-4fcc-aa64-325a880aa5bf';
const answerIds = [
  '43266a04-002e-48ff-803e-b170415ab1cb',
  '0af1b4df-15bd-4714-ae12-830b30b3cd66',
  '83e8cbf9-384b-4c57-80fe-be93f19a0892',
  '8d956063-ccde-4658-a881-132e5e623226',
  'f7e8dcbf-d62b-46e5-9149-99f85c88952a',
];

async function main() {
  const blockers = await p.pulseBlocker.findMany({
    where: {
      OR: [
        { submissionId: '9d4736c4-5e94-465e-a3eb-9af878aa6410' },
        { runId, userId: 'bae237ed-e53d-4c5f-88e5-6e69945103f3' },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });
  console.log('Blockers:', JSON.stringify(blockers, null, 2));

  const sourceIds = answerIds.map((id) => `ANSWER:${id}`).concat(blockers.map((b) => `BLOCKER:${b.id}`));
  const outbox = await p.memoryOutboxEvent.findMany({
    where: { workspaceId: W, sourceId: { in: sourceIds } },
    orderBy: { createdAt: 'desc' },
  });
  console.log('\nOutbox count', outbox.length);
  outbox.forEach((e) =>
    console.log(e.sourceType, e.sourceId, e.status, e.operation, e.errorMessage || ''),
  );

  const chunks = await p.memoryChunk.findMany({
    where: { workspaceId: W, sourceId: { in: sourceIds } },
    orderBy: [{ sourceId: 'asc' }, { chunkIndex: 'asc' }],
  });
  console.log('\nChunks', chunks.length);
  chunks.forEach((c) =>
    console.log(
      JSON.stringify(
        {
          sourceId: c.sourceId,
          sourceType: c.sourceType,
          ownerUserId: c.ownerUserId,
          text: c.text.slice(0, 150),
          metadata: c.metadata,
          indexedAt: c.indexedAt,
          embeddingModel: c.embeddingModel,
          hasVec: !!c.embeddingVec,
        },
        null,
        2,
      ),
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
