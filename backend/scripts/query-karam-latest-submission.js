const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const W = '0e4985cc-3955-4af5-8cba-d72f25f1a8ee';
const karamId = 'bae237ed-e53d-4c5f-88e5-6e69945103f3';

async function main() {
  const latestSub = await p.standupSubmission.findFirst({
    where: { status: 'completed', userId: karamId, user: { workspaceId: W } },
    orderBy: { completedAt: 'desc' },
    include: {
      run: { select: { id: true, status: true, completedAt: true, checkIn: { select: { name: true } } } },
      user: { select: { slackDisplayName: true } },
    },
  });
  console.log('Latest Karam completed submission:', JSON.stringify(latestSub, null, 2));

  const oldNoBlocker = await p.memoryChunk.findMany({
    where: {
      workspaceId: W,
      ownerUserId: karamId,
      OR: [
        { text: { contains: 'on schedule', mode: 'insensitive' } },
        { text: { contains: 'None.', mode: 'insensitive' } },
        { text: { contains: 'no blocker', mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { sourceId: true, sourceType: true, metadata: true, text: true, createdAt: true },
  });
  console.log('\nOld no-blocker chunks:');
  oldNoBlocker.forEach((c) =>
    console.log(c.createdAt.toISOString(), c.sourceType, c.metadata?.runId, c.text.slice(0, 120)),
  );
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
