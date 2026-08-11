/**
 * Verifies concurrent CheckIn isolation:
 * - separate StandupRun thread anchors
 * - separate ConversationState rows per submission
 * - multiple incomplete sessions allowed per user
 *
 * Usage: npx ts-node scripts/verify-concurrent-checkins.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({
    where: { slackUserId: { not: '' } },
    orderBy: { createdAt: 'asc' },
  });

  if (!user) {
    throw new Error('No Slack users found in database.');
  }

  const incompleteSessions = await prisma.conversationState.findMany({
    where: {
      userId: user.id,
      isCompleted: false,
      submission: {
        status: { in: ['pending', 'in_progress'] },
        run: { status: 'collecting' },
      },
    },
    include: {
      submission: {
        include: {
          run: {
            include: { checkIn: { select: { name: true } } },
          },
        },
      },
    },
    orderBy: { updatedAt: 'asc' },
  });

  const runs = await prisma.standupRun.findMany({
    where: { status: 'collecting', checkInId: { not: null } },
    select: {
      id: true,
      checkInId: true,
      slackChannelId: true,
      slackThreadTs: true,
      checkIn: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  console.log(
    JSON.stringify(
      {
        user: {
          slackUserId: user.slackUserId,
          focusedSubmissionId: (user as { focusedSubmissionId?: string | null })
            .focusedSubmissionId,
        },
        collectingRuns: runs,
        incompleteSessions: incompleteSessions.map((session) => ({
          submissionId: session.submissionId,
          runId: session.submission.runId,
          checkInName: session.submission.run.checkIn?.name,
          threadTs: session.submission.run.slackThreadTs,
        })),
        concurrentReady: incompleteSessions.length > 1,
        distinctThreads: new Set(
          incompleteSessions
            .map((session) => session.submission.run.slackThreadTs)
            .filter(Boolean),
        ).size,
      },
      null,
      2,
    ),
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
