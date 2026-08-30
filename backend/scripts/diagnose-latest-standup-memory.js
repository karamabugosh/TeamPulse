/**
 * Inspect latest completed standup run + memory ingestion for Pules project.
 * Read-only diagnostic — does not modify data.
 *
 * Run: node scripts/diagnose-latest-standup-memory.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const PULES_WORKSPACE_ID = '0e4985cc-3955-4af5-8cba-d72f25f1a8ee';

async function findKaramUser() {
  const users = await prisma.user.findMany({
    where: {
      workspaceId: PULES_WORKSPACE_ID,
      OR: [
        { slackDisplayName: { contains: 'Karam', mode: 'insensitive' } },
        { email: { contains: 'karam', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      slackDisplayName: true,
      email: true,
      slackUserId: true,
    },
  });
  return users;
}

async function main() {
  console.log('=== PULES LATEST STANDUP MEMORY DIAGNOSTIC ===\n');

  const pules = await prisma.workspace.findUnique({
    where: { id: PULES_WORKSPACE_ID },
    select: { id: true, slackWorkspaceName: true },
  });
  console.log('Workspace:', pules);

  const karamUsers = await findKaramUser();
  console.log('\nKaram candidate users:', JSON.stringify(karamUsers, null, 2));

  const latestRun = await prisma.standupRun.findFirst({
    where: {
      checkIn: { team: { workspaceId: PULES_WORKSPACE_ID } },
      status: { in: ['completed', 'collecting'] },
      checkInId: { not: null },
    },
    orderBy: [{ completedAt: 'desc' }, { startedAt: 'desc' }, { scheduledFor: 'desc' }],
    include: {
      checkIn: { select: { id: true, name: true, teamId: true } },
      team: { select: { id: true, name: true, workspaceId: true } },
    },
  });

  if (!latestRun) {
    console.log('\nNo standup run found for Pules project');
    return;
  }

  console.log('\n--- Latest Run ---');
  console.log(
    JSON.stringify(
      {
        workspaceId: latestRun.team.workspaceId,
        checkInId: latestRun.checkInId,
        runId: latestRun.id,
        status: latestRun.status,
        startedAt: latestRun.startedAt?.toISOString?.() ?? latestRun.startedAt,
        completedAt: latestRun.completedAt?.toISOString?.() ?? latestRun.completedAt,
        scheduledFor: latestRun.scheduledFor?.toISOString?.() ?? latestRun.scheduledFor,
        teamId: latestRun.teamId,
        checkInName: latestRun.checkIn?.name,
      },
      null,
      2,
    ),
  );

  const completedRuns = await prisma.standupRun.findMany({
    where: {
      checkIn: { team: { workspaceId: PULES_WORKSPACE_ID } },
      status: 'completed',
      checkInId: { not: null },
    },
    orderBy: [{ completedAt: 'desc' }],
    take: 5,
    select: {
      id: true,
      status: true,
      completedAt: true,
      startedAt: true,
      checkIn: { select: { name: true } },
    },
  });
  console.log('\n--- Top 5 completed runs ---');
  completedRuns.forEach((r, i) => {
    console.log(
      `${i + 1}. ${r.id} | ${r.checkIn?.name} | completed=${r.completedAt?.toISOString()} | started=${r.startedAt?.toISOString()}`,
    );
  });

  const karamId = karamUsers[0]?.id;
  if (!karamId) {
    console.log('\nNo Karam user found — skipping submission lookup');
    return;
  }

  const submission = await prisma.standupSubmission.findFirst({
    where: { runId: latestRun.id, userId: karamId },
    include: {
      user: { select: { id: true, slackDisplayName: true } },
    },
  });

  console.log('\n--- Karam Submission (latest run) ---');
  if (!submission) {
    console.log('No submission found for Karam on latest run');
    const anySub = await prisma.standupSubmission.findMany({
      where: { runId: latestRun.id },
      include: { user: { select: { slackDisplayName: true, id: true } } },
    });
    console.log('Submissions on this run:', anySub.map((s) => ({ id: s.id, user: s.user.slackDisplayName, userId: s.userId, status: s.status })));
  } else {
    console.log(
      JSON.stringify(
        {
          submissionId: submission.id,
          userId: submission.userId,
          userName: submission.user.slackDisplayName,
          status: submission.status,
          startedAt: submission.startedAt?.toISOString?.(),
          completedAt: submission.completedAt?.toISOString?.(),
          submittedAt: submission.submittedAt?.toISOString?.(),
        },
        null,
        2,
      ),
    );
  }

  const subId = submission?.id;
  const answers = await prisma.answer.findMany({
    where: subId
      ? { submissionId: subId }
      : { submission: { runId: latestRun.id, userId: karamId } },
    orderBy: { createdAt: 'asc' },
    include: {
      question: { select: { id: true, question: true, type: true, order: true } },
      jiraIssueLinks: { select: { issueKey: true, summary: true } },
    },
  });

  console.log('\n--- Answers ---');
  answers.forEach((a, i) => {
    console.log(
      JSON.stringify(
        {
          idx: i + 1,
          answerId: a.id,
          questionId: a.question.id,
          questionText: a.question.question,
          questionType: a.question.type,
          questionOrder: a.question.order,
          text: a.text,
          structuredValue: a.structuredValue,
          createdAt: a.createdAt.toISOString(),
          jiraKeys: a.jiraIssueLinks.map((l) => l.issueKey),
        },
        null,
        2,
      ),
    );
  });

  const blockers = await prisma.pulseBlocker.findMany({
    where: {
      OR: [
        { submissionId: subId ?? undefined },
        { runId: latestRun.id, userId: karamId },
      ].filter((c) => Object.values(c).some((v) => v != null)),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      reason: true,
      description: true,
      runId: true,
      submissionId: true,
      userId: true,
      createdAt: true,
    },
  });

  console.log('\n--- PulseBlockers ---');
  blockers.forEach((b) => {
    console.log(JSON.stringify({ ...b, createdAt: b.createdAt.toISOString() }, null, 2));
  });

  const answerIds = answers.map((a) => a.id);
  const sourceIds = [
    ...answerIds.map((id) => `ANSWER:${id}`),
    ...blockers.map((b) => `BLOCKER:${b.id}`),
  ];

  console.log('\n--- MemoryOutboxEvents (latest run sources) ---');
  const outboxEvents = await prisma.memoryOutboxEvent.findMany({
    where: {
      workspaceId: PULES_WORKSPACE_ID,
      sourceId: { in: sourceIds.length ? sourceIds : ['__none__'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  console.log(`Found ${outboxEvents.length} outbox events for answer/blocker sources`);
  outboxEvents.slice(0, 10).forEach((e) => {
    console.log(
      JSON.stringify(
        {
          id: e.id,
          sourceType: e.sourceType,
          sourceId: e.sourceId,
          operation: e.operation,
          status: e.status,
          createdAt: e.createdAt.toISOString(),
          processedAt: e.processedAt?.toISOString?.(),
          error: e.errorMessage?.slice?.(0, 120),
        },
        null,
        2,
      ),
    );
  });

  console.log('\n--- MemoryChunks (latest run sources) ---');
  const chunks = await prisma.memoryChunk.findMany({
    where: {
      workspaceId: PULES_WORKSPACE_ID,
      sourceId: { in: sourceIds.length ? sourceIds : ['__none__'] },
    },
    orderBy: [{ sourceId: 'asc' }, { chunkIndex: 'asc' }],
  });
  console.log(`Found ${chunks.length} chunks`);
  chunks.forEach((c) => {
    console.log(
      JSON.stringify(
        {
          id: c.id,
          sourceType: c.sourceType,
          sourceId: c.sourceId,
          chunkIndex: c.chunkIndex,
          ownerUserId: c.ownerUserId,
          teamId: c.teamId,
          visibility: c.visibility,
          text: c.text?.slice(0, 200),
          metadata: c.metadata,
          createdAt: c.createdAt.toISOString(),
          indexedAt: c.indexedAt?.toISOString?.(),
          embeddingModel: c.embeddingModel,
          hasEmbedding: !!c.embedding,
          hasEmbeddingVec: !!c.embeddingVec,
        },
        null,
        2,
      ),
    );
  });

  // Broader search for blocker text
  console.log('\n--- MemoryChunks matching blocker text ---');
  const blockerChunks = await prisma.memoryChunk.findMany({
    where: {
      workspaceId: PULES_WORKSPACE_ID,
      OR: [
        { text: { contains: 'slack and jira', mode: 'insensitive' } },
        { text: { contains: 'emdings', mode: 'insensitive' } },
        { text: { contains: 'embeddings', mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      sourceType: true,
      sourceId: true,
      ownerUserId: true,
      text: true,
      metadata: true,
      createdAt: true,
      indexedAt: true,
    },
  });
  blockerChunks.forEach((c) => {
    console.log(JSON.stringify({ ...c, createdAt: c.createdAt.toISOString(), text: c.text?.slice(0, 300) }, null, 2));
  });

  // Old "no blockers" chunks for Karam
  console.log('\n--- Karam chunks with "no blocker" / "on schedule" text ---');
  const oldChunks = await prisma.memoryChunk.findMany({
    where: {
      workspaceId: PULES_WORKSPACE_ID,
      ownerUserId: karamId,
      OR: [
        { text: { contains: 'on schedule', mode: 'insensitive' } },
        { text: { contains: 'no blocker', mode: 'insensitive' } },
        { text: { contains: 'None.', mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      sourceType: true,
      sourceId: true,
      text: true,
      metadata: true,
      createdAt: true,
    },
  });
  oldChunks.forEach((c) => {
    console.log(JSON.stringify({ ...c, createdAt: c.createdAt.toISOString(), text: c.text?.slice(0, 200) }, null, 2));
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
