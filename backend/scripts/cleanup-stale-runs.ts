/**
 * One-time cleanup for stale V1 collecting runs that block V2 DMs.
 * Run: npx ts-node scripts/cleanup-stale-runs.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const staleRuns = await prisma.standupRun.findMany({
    where: {
      status: 'collecting',
      OR: [{ checkInId: null }, { startedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }],
    },
    select: { id: true, teamId: true, checkInId: true, startedAt: true },
  });

  if (staleRuns.length === 0) {
    console.log('No stale collecting runs found.');
    return;
  }

  console.log(`Closing ${staleRuns.length} stale collecting run(s)...`);

  const runIds = staleRuns.map((r) => r.id);

  await prisma.conversationState.updateMany({
    where: {
      submission: { runId: { in: runIds } },
      isCompleted: false,
    },
    data: { isCompleted: true, completedAt: new Date() },
  });

  await prisma.standupSubmission.updateMany({
    where: { runId: { in: runIds }, status: { in: ['pending', 'in_progress'] } },
    data: { status: 'completed', completedAt: new Date() },
  });

  await prisma.standupRun.updateMany({
    where: { id: { in: runIds } },
    data: { status: 'completed', completedAt: new Date(), reminderDueAt: null },
  });

  console.log('Cleanup complete.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
