/**
 * READ-ONLY supplemental checks for answer ownership anomalies.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PULES = '0e4985cc-3955-4af5-8cba-d72f25f1a8ee';
const TP = '09999ad5-a472-466a-89c2-a4c14744e9ab';
const DEMO = 'b1ba6c87-0e8e-412e-b934-7c3b981d6982';

async function main() {
  const pulesTeams = await prisma.team.findMany({
    where: { workspaceId: PULES },
    select: { id: true, name: true },
  });
  console.log('PULES owned teams', pulesTeams);

  const pulesAnsTeams = await prisma.$queryRaw`
    SELECT t.id, t.name, t."workspaceId", w."slackWorkspaceName", COUNT(*)::int AS c
    FROM "Answer" a
    JOIN "User" u ON u.id = a."userId"
    LEFT JOIN "StandupSubmission" s ON s.id = a."submissionId"
    LEFT JOIN "StandupRun" r ON r.id = s."runId"
    LEFT JOIN "Team" t ON t.id = r."teamId"
    LEFT JOIN "Workspace" w ON w.id = t."workspaceId"
    WHERE u."workspaceId" = ${PULES}
    GROUP BY t.id, t.name, t."workspaceId", w."slackWorkspaceName"
  `;
  console.log('Pules-user answers by submission team', pulesAnsTeams);

  const noSub = await prisma.answer.count({
    where: { user: { workspaceId: PULES }, submissionId: null },
  });
  console.log('Pules answers without submission', noSub);

  for (const [name, wsId] of [
    ['Pules', PULES],
    ['TeamPulse', TP],
    ['Demo', DEMO],
  ]) {
    const teamIds = (
      await prisma.team.findMany({
        where: { workspaceId: wsId },
        select: { id: true },
      })
    ).map((t) => t.id);
    const userIds = (
      await prisma.user.findMany({
        where: { workspaceId: wsId },
        select: { id: true },
      })
    ).map((u) => u.id);
    const runIds = (
      await prisma.standupRun.findMany({
        where: { teamId: { in: teamIds.length ? teamIds : ['__x'] } },
        select: { id: true },
      })
    ).map((r) => r.id);
    const subIds = (
      await prisma.standupSubmission.findMany({
        where: { runId: { in: runIds.length ? runIds : ['__x'] } },
        select: { id: true },
      })
    ).map((s) => s.id);
    const qIds = (
      await prisma.question.findMany({
        where: {
          checkIn: { teamId: { in: teamIds.length ? teamIds : ['__x'] } },
        },
        select: { id: true },
      })
    ).map((q) => q.id);

    const byUser = await prisma.answer.count({
      where: { userId: { in: userIds.length ? userIds : ['__x'] } },
    });
    const bySub = await prisma.answer.count({
      where: { submissionId: { in: subIds.length ? subIds : ['__x'] } },
    });
    const byQ = await prisma.answer.count({
      where: { questionId: { in: qIds.length ? qIds : ['__x'] } },
    });

    console.log(name, { byUser, bySub, byQ, teamIds: teamIds.length, qIds: qIds.length });
  }

  const ansOnTpQ = await prisma.$queryRaw`
    SELECT u."workspaceId" AS ws, w."slackWorkspaceName" AS name, COUNT(*)::int AS c
    FROM "Answer" a
    JOIN "User" u ON u.id = a."userId"
    JOIN "Workspace" w ON w.id = u."workspaceId"
    JOIN "Question" q ON q.id = a."questionId"
    JOIN "CheckIn" c ON c.id = q."checkInId"
    JOIN "Team" t ON t.id = c."teamId"
    WHERE t."workspaceId" = ${TP}
    GROUP BY u."workspaceId", w."slackWorkspaceName"
  `;
  console.log('Answers on TP checkIn-questions by user workspace', ansOnTpQ);

  // Questions with null checkInId that appear in TeamPulse resolveIds?
  // resolveIds only pulls questions via checkInIds, so null checkIn excluded.
  // But TeamPulse Question count was 31 with only 1 CheckIn — check orphans linked somehow.
  const tpCheckIns = await prisma.checkIn.findMany({
    where: { team: { workspaceId: TP } },
    select: { id: true, name: true, _count: { select: { questions: true } } },
  });
  console.log('TP checkIns', tpCheckIns);

  const allTpQs = await prisma.$queryRaw`
    SELECT q.id, q."checkInId", q.question, q."isActive"
    FROM "Question" q
    LEFT JOIN "CheckIn" c ON c.id = q."checkInId"
    LEFT JOIN "Team" t ON t.id = c."teamId"
    WHERE t."workspaceId" = ${TP} OR q."checkInId" IS NULL
    LIMIT 50
  `;
  // Better: count answers whose question has null checkIn and user in TP
  const nullQAnswers = await prisma.$queryRaw`
    SELECT u."workspaceId" AS ws, w."slackWorkspaceName" AS name, COUNT(*)::int AS c
    FROM "Answer" a
    JOIN "User" u ON u.id = a."userId"
    JOIN "Workspace" w ON w.id = u."workspaceId"
    JOIN "Question" q ON q.id = a."questionId"
    WHERE q."checkInId" IS NULL
    GROUP BY u."workspaceId", w."slackWorkspaceName"
  `;
  console.log('Answers on null-checkIn questions by user workspace', nullQAnswers);

  // How delete script's OR would hit Pules answers when deleting TP
  const tpUserIds = (
    await prisma.user.findMany({ where: { workspaceId: TP }, select: { id: true } })
  ).map((u) => u.id);
  const tpTeamIds = (
    await prisma.team.findMany({ where: { workspaceId: TP }, select: { id: true } })
  ).map((t) => t.id);
  const tpRunIds = (
    await prisma.standupRun.findMany({
      where: { teamId: { in: tpTeamIds } },
      select: { id: true },
    })
  ).map((r) => r.id);
  const tpSubIds = (
    await prisma.standupSubmission.findMany({
      where: { runId: { in: tpRunIds } },
      select: { id: true },
    })
  ).map((s) => s.id);
  const tpQIds = (
    await prisma.question.findMany({
      where: { checkIn: { teamId: { in: tpTeamIds } } },
      select: { id: true },
    })
  ).map((q) => q.id);

  const pulesAnswersHitByTpDelete = await prisma.answer.count({
    where: {
      user: { workspaceId: PULES },
      OR: [
        { userId: { in: tpUserIds.length ? tpUserIds : ['__x'] } },
        { submissionId: { in: tpSubIds.length ? tpSubIds : ['__x'] } },
        { questionId: { in: tpQIds.length ? tpQIds : ['__x'] } },
      ],
    },
  });
  console.log(
    'Pules-user answers that would match TeamPulse delete OR filter',
    pulesAnswersHitByTpDelete,
  );

  const pulesChunksHit = await prisma.memoryChunk.count({
    where: {
      workspaceId: PULES,
      // chunks themselves are workspace-scoped — delete uses workspaceId
    },
  });
  console.log('Pules MemoryChunks (workspace-scoped, safe from TP delete)', pulesChunksHit);

  // TeamPulse teams detail
  const tpTeams = await prisma.team.findMany({
    where: { workspaceId: TP },
    select: { id: true, name: true },
  });
  console.log('TP teams', tpTeams);

  // KnowledgeEmbedding source types for TP
  const tpKe = await prisma.knowledgeEmbedding.groupBy({
    by: ['sourceType'],
    where: { workspaceId: TP },
    _count: { _all: true },
  });
  console.log('TP KnowledgeEmbedding by sourceType', tpKe);

  const pulesKe = await prisma.knowledgeEmbedding.groupBy({
    by: ['sourceType'],
    where: { workspaceId: PULES },
    _count: { _all: true },
  });
  console.log('Pules KnowledgeEmbedding by sourceType', pulesKe);

  // AI conversation titles sample (count only already have)
  // Earliest vs active for Ask Pulse tests - AiConversation recent in each ws
  for (const [name, wsId] of [
    ['Pules', PULES],
    ['TeamPulse', TP],
    ['Demo', DEMO],
  ]) {
    const recent = await prisma.aiConversation.findMany({
      where: { workspaceId: wsId },
      orderBy: { updatedAt: 'desc' },
      take: 3,
      select: { id: true, title: true, updatedAt: true, preview: true },
    });
    console.log(`Recent AI conversations (${name})`, recent);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
