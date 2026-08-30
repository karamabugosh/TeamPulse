/**
 * READ-ONLY: quantify cross-workspace entanglement risk if TeamPulse deleted.
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PULES = '0e4985cc-3955-4af5-8cba-d72f25f1a8ee';
const TP = '09999ad5-a472-466a-89c2-a4c14744e9ab';

async function main() {
  const tpTeamIds = (
    await prisma.team.findMany({
      where: { workspaceId: TP },
      select: { id: true },
    })
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
  const tpUserIds = (
    await prisma.user.findMany({
      where: { workspaceId: TP },
      select: { id: true },
    })
  ).map((u) => u.id);

  // Pules-user answers that live on TeamPulse submissions/questions
  const entangledAnswers = await prisma.answer.findMany({
    where: {
      user: { workspaceId: PULES },
      OR: [
        { submissionId: { in: tpSubIds } },
        { questionId: { in: tpQIds } },
      ],
    },
    select: { id: true },
  });
  const entangledIds = entangledAnswers.map((a) => a.id);

  const standupChunksFromEntangled = await prisma.memoryChunk.count({
    where: {
      workspaceId: PULES,
      sourceType: 'STANDUP_ANSWER',
      sourceId: { in: entangledIds.length ? entangledIds : ['__none__'] },
    },
  });

  const allPulesStandupChunks = await prisma.memoryChunk.count({
    where: { workspaceId: PULES, sourceType: 'STANDUP_ANSWER' },
  });

  const safePulesAnswers = await prisma.answer.count({
    where: {
      user: { workspaceId: PULES },
      NOT: {
        OR: [
          { submissionId: { in: tpSubIds.length ? tpSubIds : ['__x'] } },
          { questionId: { in: tpQIds.length ? tpQIds : ['__x'] } },
        ],
      },
    },
  });

  // Blockers / resolutions for Pules — are they workspace-owned cleanly?
  const pulesBlockers = await prisma.pulseBlocker.findMany({
    where: { workspaceId: PULES },
    select: {
      id: true,
      linkedIssueKey: true,
      teamId: true,
      runId: true,
      submissionId: true,
      answerId: true,
      status: true,
    },
  });

  const blockersOnTpRuns = pulesBlockers.filter(
    (b) => b.runId && tpRunIds.includes(b.runId),
  );
  const blockersOnTpSubs = pulesBlockers.filter(
    (b) => b.submissionId && tpSubIds.includes(b.submissionId),
  );
  const blockersOnEntangledAnswers = pulesBlockers.filter(
    (b) => b.answerId && entangledIds.includes(b.answerId),
  );

  // SCRUM-9 chunks source survival
  const scrum9Chunks = await prisma.memoryChunk.findMany({
    where: { workspaceId: PULES, linkedIssueKey: 'SCRUM-9' },
    select: { sourceType: true, sourceId: true },
  });

  const answerSources = scrum9Chunks
    .filter((c) => c.sourceType === 'STANDUP_ANSWER')
    .map((c) => c.sourceId);
  const entangledScrum9Answers = answerSources.filter((id) =>
    entangledIds.includes(id),
  );

  // Would TP delete also delete StandupSubmission rows for Pules users?
  const pulesSubsOnTp = await prisma.standupSubmission.count({
    where: {
      user: { workspaceId: PULES },
      runId: { in: tpRunIds },
    },
  });

  // Jira links on entangled answers
  const jiraLinksOnEntangled = await prisma.answerJiraIssueLink.count({
    where: {
      workspaceId: PULES,
      answerId: { in: entangledIds.length ? entangledIds : ['__none__'] },
    },
  });
  const jiraLinksScrum9 = await prisma.answerJiraIssueLink.count({
    where: {
      workspaceId: PULES,
      issueKey: 'SCRUM-9',
      answerId: { in: entangledIds.length ? entangledIds : ['__none__'] },
    },
  });

  // TeamPulse-exclusive data (users only in TP, no pules entanglement)
  const tpOnlyAnswers = await prisma.answer.count({
    where: { userId: { in: tpUserIds } },
  });

  console.log(
    JSON.stringify(
      {
        entangledPulesAnswerCount: entangledIds.length,
        safePulesAnswerCount: safePulesAnswers,
        standupChunksFromEntangled,
        allPulesStandupChunks,
        standupChunkLossIfAnswersDeleted: standupChunksFromEntangled,
        pulesSubsOnTpRuns: pulesSubsOnTp,
        pulesBlockersTotal: pulesBlockers.length,
        blockersOnTpRuns: blockersOnTpRuns.length,
        blockersOnTpSubs: blockersOnTpSubs.length,
        blockersOnEntangledAnswers: blockersOnEntangledAnswers.length,
        scrum9Chunks,
        entangledScrum9StandupAnswerSources: entangledScrum9Answers,
        jiraLinksOnEntangled,
        jiraLinksScrum9OnEntangled: jiraLinksScrum9,
        tpOnlyAnswers,
        impactSummary: {
          ifTpDeletedViaSubmissionQuestionCascade:
            'Would DELETE ~' +
            entangledIds.length +
            ' Pules-user Answer rows that are the source of ' +
            standupChunksFromEntangled +
            '/' +
            allPulesStandupChunks +
            ' STANDUP_ANSWER MemoryChunks',
        },
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
