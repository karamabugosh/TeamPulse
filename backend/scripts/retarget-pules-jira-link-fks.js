/**
 * Pre-delete FK hygiene: retarget Pules AnswerJiraIssueLink.questionId/runId
 * that still point at TeamPulse parents onto the already-cloned Pules twins.
 *
 * Does NOT move Answers/Submissions/Users. Twins must already exist from untangle.
 *
 * Usage:
 *   node scripts/retarget-pules-jira-link-fks.js           # dry-run
 *   node scripts/retarget-pules-jira-link-fks.js --apply
 */
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const UNTANGLE_NS = '7f3c9e2a-4b1d-5e68-9c0f-a1b2c3d4e5f6';

function deterministicUuid(seed) {
  const h = crypto.createHash('sha256').update(`${UNTANGLE_NS}:${seed}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = Buffer.from(h.subarray(0, 16)).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function emptySafe(ids) {
  return ids.length ? ids : ['__none__'];
}

async function main() {
  const pules = await prisma.workspace.findFirst({
    where: { slackWorkspaceName: 'Pules project' },
  });
  const tp = await prisma.workspace.findFirst({
    where: { slackWorkspaceName: 'TeamPulse Workspace' },
  });
  if (!pules || !tp) throw new Error('workspace missing');

  const tpTeamIds = (
    await prisma.team.findMany({
      where: { workspaceId: tp.id },
      select: { id: true },
    })
  ).map((t) => t.id);
  const tpCheckInIds = (
    await prisma.checkIn.findMany({
      where: { teamId: { in: tpTeamIds } },
      select: { id: true },
    })
  ).map((c) => c.id);
  const tpRunIds = (
    await prisma.standupRun.findMany({
      where: { teamId: { in: tpTeamIds } },
      select: { id: true },
    })
  ).map((r) => r.id);
  const tpQIds = new Set(
    (
      await prisma.question.findMany({
        where: { checkInId: { in: emptySafe(tpCheckInIds) } },
        select: { id: true },
      })
    ).map((q) => q.id),
  );
  const tpRunSet = new Set(tpRunIds);

  const links = await prisma.answerJiraIssueLink.findMany({
    where: {
      workspaceId: pules.id,
      OR: [
        { questionId: { in: emptySafe([...tpQIds]) } },
        { runId: { in: emptySafe(tpRunIds) } },
      ],
    },
  });

  const plan = [];
  for (const link of links) {
    const data = {};
    if (tpQIds.has(link.questionId)) {
      const twinQ = deterministicUuid(`question:${link.questionId}`);
      const exists = await prisma.question.findUnique({
        where: { id: twinQ },
        select: { id: true },
      });
      if (!exists) {
        throw new Error(
          `Missing Pules twin question for ${link.questionId} (link ${link.id})`,
        );
      }
      data.questionId = twinQ;
    }
    if (link.runId && tpRunSet.has(link.runId)) {
      const twinRun = deterministicUuid(`run:${link.runId}`);
      const exists = await prisma.standupRun.findUnique({
        where: { id: twinRun },
        select: { id: true },
      });
      if (!exists) {
        throw new Error(
          `Missing Pules twin run for ${link.runId} (link ${link.id})`,
        );
      }
      data.runId = twinRun;
    }
    if (Object.keys(data).length) {
      plan.push({ id: link.id, issueKey: link.issueKey, data });
    }
  }

  console.log({
    mode: APPLY ? 'APPLY' : 'DRY-RUN',
    linksNeedingRetarget: plan.length,
    questionRemaps: plan.filter((p) => p.data.questionId).length,
    runRemaps: plan.filter((p) => p.data.runId).length,
    scrum9: plan.filter((p) => p.issueKey === 'SCRUM-9').length,
  });

  if (!APPLY) {
    console.log('Dry-run only. Re-run with --apply.');
    await prisma.$disconnect();
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const p of plan) {
      await tx.answerJiraIssueLink.update({
        where: { id: p.id },
        data: p.data,
      });
    }
  });

  console.log('Retarget complete:', plan.length);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
