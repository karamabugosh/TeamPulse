/**
 * Stage 2 residual: move empty Pules submissions still on TeamPulse runs
 * onto the reconstructed Pules check-in/run graph.
 *
 * Default: dry-run. Apply with --apply.
 */
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const UNTANGLE_NS = '7f3c9e2a-4b1d-5e68-9c0f-a1b2c3d4e5f6';
const CHECKIN_MARKER_NAME = 'Daily Standup (Pules untangle)';

function deterministicUuid(seed) {
  const h = crypto.createHash('sha256').update(`${UNTANGLE_NS}:${seed}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = Buffer.from(h.subarray(0, 16)).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function main() {
  const pules = await prisma.workspace.findFirst({
    where: { slackWorkspaceName: 'Pules project' },
  });
  const tp = await prisma.workspace.findFirst({
    where: { slackWorkspaceName: 'TeamPulse Workspace' },
  });
  const demo = await prisma.workspace.findFirst({
    where: { slackWorkspaceName: 'Demo Workspace' },
  });
  if (!pules || !tp || !demo) throw new Error('workspace missing');

  const pulesTeam = await prisma.team.findFirst({
    where: { workspaceId: pules.id },
  });
  const checkIn = await prisma.checkIn.findFirst({
    where: { teamId: pulesTeam.id, name: CHECKIN_MARKER_NAME },
  });
  if (!checkIn) throw new Error('Pules untangle check-in missing — run main untangle first');

  const tpTeamIds = (
    await prisma.team.findMany({
      where: { workspaceId: tp.id },
      select: { id: true },
    })
  ).map((t) => t.id);

  const residual = await prisma.standupSubmission.findMany({
    where: {
      user: { workspaceId: pules.id },
      run: { teamId: { in: tpTeamIds } },
    },
    include: {
      run: true,
      _count: { select: { answers: true } },
      user: { select: { slackDisplayName: true } },
    },
  });

  const withAnswers = residual.filter((s) => s._count.answers > 0);
  const empty = residual.filter((s) => s._count.answers === 0);

  console.log({
    mode: APPLY ? 'APPLY' : 'DRY-RUN',
    residualTotal: residual.length,
    withAnswers: withAnswers.length,
    emptyToMove: empty.length,
  });

  if (withAnswers.length > 0) {
    console.error('STOP: residual submissions still have answers — run main untangle');
    process.exit(2);
  }

  if (!APPLY) {
    console.log('Dry-run only. Re-run with --apply to move empty submissions.');
    await prisma.$disconnect();
    return;
  }

  const stats = { runsCreated: 0, subsMoved: 0, threadsUpdated: 0 };

  await prisma.$transaction(
    async (tx) => {
      const runCache = new Map(); // oldRunId -> newRunId

      for (const sub of empty) {
        const oldRun = sub.run;
        let newRunId = runCache.get(oldRun.id);
        if (!newRunId) {
          newRunId = deterministicUuid(`run:${oldRun.id}`);
          let run = await tx.standupRun.findUnique({ where: { id: newRunId } });
          if (!run) {
            let scheduledFor = oldRun.scheduledFor;
            const clash = await tx.standupRun.findFirst({
              where: { checkInId: checkIn.id, scheduledFor },
            });
            if (clash && clash.id !== newRunId) {
              scheduledFor = new Date(scheduledFor.getTime() + 1);
            }
            run = await tx.standupRun.create({
              data: {
                id: newRunId,
                teamId: pulesTeam.id,
                checkInId: checkIn.id,
                scheduledFor,
                status: oldRun.status,
                triggerSource: oldRun.triggerSource,
                startedAt: oldRun.startedAt,
                completedAt: oldRun.completedAt,
                reminderDueAt: oldRun.reminderDueAt,
                reminderSentAt: oldRun.reminderSentAt,
                reminderCount: oldRun.reminderCount,
                lastReminderAt: oldRun.lastReminderAt,
                slackChannelId: oldRun.slackChannelId,
                slackThreadTs: oldRun.slackThreadTs,
                slackRootMessageTs: oldRun.slackRootMessageTs,
                slackThreadUrl: oldRun.slackThreadUrl,
                threadReplyCount: oldRun.threadReplyCount,
                reportDueAt: oldRun.reportDueAt,
                reportGeneratedAt: oldRun.reportGeneratedAt,
                reportStatus: oldRun.reportStatus,
                createdAt: oldRun.createdAt,
                updatedAt: oldRun.updatedAt,
              },
            });
            stats.runsCreated++;
          }
          runCache.set(oldRun.id, newRunId);
        }

        if (sub.runId !== newRunId) {
          await tx.standupSubmission.update({
            where: { id: sub.id },
            data: { runId: newRunId },
          });
          stats.subsMoved++;
        }

        const threads = await tx.standupThreadUpdate.findMany({
          where: { submissionId: sub.id },
        });
        for (const t of threads) {
          if (t.runId !== newRunId) {
            await tx.standupThreadUpdate.update({
              where: { id: t.id },
              data: { runId: newRunId },
            });
            stats.threadsUpdated++;
          }
        }
      }
    },
    { timeout: 120_000 },
  );

  const remaining = await prisma.standupSubmission.count({
    where: {
      user: { workspaceId: pules.id },
      run: { teamId: { in: tpTeamIds } },
    },
  });

  console.log({ stats, remainingPulesSubsOnTp: remaining });
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
