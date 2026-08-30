/**
 * READ-ONLY final workspace ownership audit (pre AI testing).
 * No INSERT / UPDATE / DELETE.
 */
const { PrismaClient, Prisma, QuestionType } = require('@prisma/client');
const prisma = new PrismaClient();

const FOCUS = ['Pules project', 'TeamPulse Workspace', 'Demo Workspace'];

function emptySafe(ids) {
  return ids.length ? ids : ['__none__'];
}

async function main() {
  const all = await prisma.workspace.findMany({
    select: {
      id: true,
      slackWorkspaceName: true,
      slackWorkspaceId: true,
      installedAt: true,
    },
    orderBy: { installedAt: 'asc' },
  });

  const byName = {};
  for (const name of FOCUS) {
    byName[name] = all.filter((w) => w.slackWorkspaceName === name);
  }

  const ws = {};
  for (const name of FOCUS) {
    ws[name] = byName[name][0] || null;
  }

  const PULES = ws['Pules project']?.id;
  const TP = ws['TeamPulse Workspace']?.id;
  const DEMO = ws['Demo Workspace']?.id;

  console.log('=== WORKSPACES ===');
  for (const w of all) {
    const [members, teams] = await Promise.all([
      prisma.user.count({ where: { workspaceId: w.id } }),
      prisma.team.count({ where: { workspaceId: w.id } }),
    ]);
    console.log(
      JSON.stringify({
        workspaceId: w.id,
        name: w.slackWorkspaceName,
        slackWorkspaceId: w.slackWorkspaceId,
        createdAt: w.installedAt,
        memberCount: members,
        teamCount: teams,
      }),
    );
  }
  console.log(
    'duplicateNameChecks',
    Object.fromEntries(
      FOCUS.map((n) => [n, byName[n].length]),
    ),
  );

  // ---- Attribution audit: recent STANDUP_ANSWER chunks vs Answers ----
  console.log('\n=== ATTRIBUTION SAMPLE (Pules STANDUP_ANSWER) ===');
  const recentChunks = await prisma.memoryChunk.findMany({
    where: { workspaceId: PULES, sourceType: 'STANDUP_ANSWER' },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true,
      sourceId: true,
      ownerUserId: true,
      workspaceId: true,
      teamId: true,
      linkedIssueKey: true,
      chunkIndex: true,
      text: true,
      createdAt: true,
    },
  });

  // Dedupe by sourceId, keep up to ~12 from multiple owners
  const seen = new Set();
  const samples = [];
  for (const c of recentChunks) {
    if (seen.has(c.sourceId)) continue;
    seen.add(c.sourceId);
    samples.push(c);
    if (samples.length >= 12) break;
  }

  // Ensure multiple users represented
  const byOwner = {};
  for (const c of samples) {
    byOwner[c.ownerUserId || 'null'] =
      (byOwner[c.ownerUserId || 'null'] || 0) + 1;
  }

  const comparisons = [];
  let mismatchOwner = 0;
  let mismatchWs = 0;
  let missingAnswer = 0;
  let mismatchSource = 0;

  for (const c of samples) {
    const a = await prisma.answer.findUnique({
      where: { id: c.sourceId },
      select: {
        id: true,
        userId: true,
        text: true,
        user: {
          select: {
            id: true,
            workspaceId: true,
            slackDisplayName: true,
            slackRealName: true,
          },
        },
        submission: {
          select: {
            run: {
              select: {
                teamId: true,
                team: { select: { workspaceId: true, name: true } },
              },
            },
          },
        },
      },
    });

    if (!a) {
      missingAnswer++;
      comparisons.push({
        chunkSourceId: c.sourceId,
        status: 'MISSING_ANSWER',
      });
      continue;
    }

    const ownerOk = c.ownerUserId === a.userId;
    const wsOk = c.workspaceId === a.user.workspaceId;
    const sourceOk = c.sourceId === a.id;
    if (!ownerOk) mismatchOwner++;
    if (!wsOk) mismatchWs++;
    if (!sourceOk) mismatchSource++;

    comparisons.push({
      answerId: a.id,
      answerUserId: a.userId,
      userDisplay:
        a.user.slackRealName || a.user.slackDisplayName,
      answerOwnerWorkspaceId: a.user.workspaceId,
      submissionTeamId: a.submission?.run?.teamId ?? null,
      submissionTeamWorkspaceId:
        a.submission?.run?.team?.workspaceId ?? null,
      submissionTeamName: a.submission?.run?.team?.name ?? null,
      chunk: {
        sourceId: c.sourceId,
        ownerUserId: c.ownerUserId,
        workspaceId: c.workspaceId,
        teamId: c.teamId,
        linkedIssueKey: c.linkedIssueKey,
        chunkIndex: c.chunkIndex,
      },
      invariants: {
        sourceIdEqAnswerId: sourceOk,
        ownerUserIdEqAnswerUserId: ownerOk,
        chunkWorkspaceEqAnswerOwnerWorkspace: wsOk,
        teamIdEqSubmissionTeam:
          (c.teamId || null) ===
          (a.submission?.run?.teamId || null),
      },
      preview: (a.text || '').slice(0, 60),
    });
  }

  // Full mismatch counts for ALL Pules STANDUP_ANSWER chunks
  const allChunks = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE mc."ownerUserId" IS DISTINCT FROM a."userId")::int AS owner_mismatch,
      COUNT(*) FILTER (WHERE mc."workspaceId" IS DISTINCT FROM u."workspaceId")::int AS ws_mismatch,
      COUNT(*) FILTER (WHERE a.id IS NULL)::int AS missing_answer,
      COUNT(*) FILTER (
        WHERE mc."teamId" IS DISTINCT FROM r."teamId"
      )::int AS team_mismatch
    FROM "MemoryChunk" mc
    LEFT JOIN "Answer" a ON a.id = mc."sourceId"
    LEFT JOIN "User" u ON u.id = a."userId"
    LEFT JOIN "StandupSubmission" s ON s.id = a."submissionId"
    LEFT JOIN "StandupRun" r ON r.id = s."runId"
    WHERE mc."workspaceId" = ${PULES}
      AND mc."sourceType" = 'STANDUP_ANSWER'
  `;

  console.log(
    JSON.stringify(
      {
        sampleComparisons: comparisons,
        sampleOwnerSpread: byOwner,
        fullPulesStandupChunkInvariants: allChunks[0],
        sampleMismatchOwner: mismatchOwner,
        sampleMismatchWs: mismatchWs,
        sampleMissingAnswer: missingAnswer,
      },
      null,
      2,
    ),
  );

  // ---- SCRUM-9 detailed ----
  console.log('\n=== SCRUM-9 ===');
  for (const name of FOCUS) {
    const id = ws[name].id;
    const conn = await prisma.jiraConnection.count({
      where: { workspaceId: id },
    });
    const cache = await prisma.jiraIssueCacheEntry.findFirst({
      where: { workspaceId: id, issueKey: 'SCRUM-9' },
      select: { summary: true, status: true },
    });
    const chunks = await prisma.memoryChunk.findMany({
      where: { workspaceId: id, linkedIssueKey: 'SCRUM-9' },
      select: {
        sourceType: true,
        sourceId: true,
        ownerUserId: true,
        chunkIndex: true,
        teamId: true,
      },
    });
    const byType = {};
    for (const c of chunks) {
      byType[c.sourceType] = (byType[c.sourceType] || 0) + 1;
    }

    const standupChunks = [];
    for (const c of chunks.filter((x) => x.sourceType === 'STANDUP_ANSWER')) {
      const u = c.ownerUserId
        ? await prisma.user.findUnique({
            where: { id: c.ownerUserId },
            select: {
              slackDisplayName: true,
              slackRealName: true,
            },
          })
        : null;
      standupChunks.push({
        sourceId: c.sourceId,
        ownerUserId: c.ownerUserId,
        resolvedAuthor: u
          ? u.slackRealName || u.slackDisplayName
          : null,
        chunkIndex: c.chunkIndex,
      });
    }

    // Who actually linked SCRUM-9 via AnswerJiraIssueLink
    const links = await prisma.answerJiraIssueLink.findMany({
      where: { workspaceId: id, issueKey: 'SCRUM-9' },
      select: {
        answerId: true,
        userId: true,
        user: {
          select: { slackDisplayName: true, slackRealName: true },
        },
      },
    });

    const blockers = await prisma.pulseBlocker.findMany({
      where: { workspaceId: id, linkedIssueKey: 'SCRUM-9' },
      select: {
        id: true,
        status: true,
        teamId: true,
        userId: true,
        linkedIssueKey: true,
        title: true,
        user: {
          select: { slackDisplayName: true, slackRealName: true },
        },
      },
    });

    const blockerIds = blockers.map((b) => b.id);
    const resolutions = await prisma.pulseBlockerUpdate.findMany({
      where: {
        blockerId: { in: emptySafe(blockerIds) },
        newStatus: 'resolved',
      },
      select: {
        id: true,
        blockerId: true,
        userId: true,
        newStatus: true,
        previousStatus: true,
      },
    });

    const blockerChunks = chunks.filter((c) => c.sourceType === 'BLOCKER');
    const resChunks = chunks.filter(
      (c) => c.sourceType === 'BLOCKER_RESOLUTION',
    );

    // REPORT chunks mentioning SCRUM-9 in text (bounded)
    const reportMentions = await prisma.memoryChunk.count({
      where: {
        workspaceId: id,
        sourceType: 'REPORT',
        text: { contains: 'SCRUM-9', mode: 'insensitive' },
      },
    });

    console.log(
      JSON.stringify(
        {
          workspace: name,
          liveJiraConnection: conn > 0,
          scrum9Cache: Boolean(cache),
          cacheMeta: cache,
          memoryByType: byType,
          totalScrum9Chunks: chunks.length,
          standupChunks,
          originalLinkAuthors: links.map((l) => ({
            answerId: l.answerId,
            userId: l.userId,
            author: l.user.slackRealName || l.user.slackDisplayName,
          })),
          blockers: blockers.map((b) => ({
            sourceId: b.id,
            workspace: name,
            linkedIssueKey: b.linkedIssueKey,
            status: b.status,
            teamId: b.teamId,
            owner:
              b.user.slackRealName || b.user.slackDisplayName,
          })),
          blockerChunks: blockerChunks.length,
          resolutions: resolutions.map((r) => ({
            sourceId: r.id,
            blockerId: r.blockerId,
            status: r.newStatus,
          })),
          resolutionChunks: resChunks.length,
          reportTextMentionsScrum9: reportMentions,
        },
        null,
        2,
      ),
    );
  }

  // ---- Reports eligibility ----
  console.log('\n=== REPORTS ===');
  for (const name of FOCUS) {
    const id = ws[name].id;
    const digests = await prisma.aiDigest.findMany({
      where: { team: { workspaceId: id } },
      select: {
        id: true,
        source: true,
        summary: true,
        generationError: true,
      },
    });
    const eligible = digests.filter((d) => {
      if (d.source === 'failed') return false;
      if (d.generationError?.trim() && !d.summary?.trim()) return false;
      return Boolean(d.summary?.trim()) || d.source === 'ai' || d.source === 'rules_fallback';
    });
    const indexedSources = await prisma.memoryChunk.groupBy({
      by: ['sourceId'],
      where: { workspaceId: id, sourceType: 'REPORT' },
    });
    const reportChunks = await prisma.memoryChunk.count({
      where: { workspaceId: id, sourceType: 'REPORT' },
    });
    const reportWithScrum9 = await prisma.memoryChunk.count({
      where: {
        workspaceId: id,
        sourceType: 'REPORT',
        OR: [
          { linkedIssueKey: 'SCRUM-9' },
          { text: { contains: 'SCRUM-9', mode: 'insensitive' } },
        ],
      },
    });
    console.log(
      JSON.stringify({
        workspace: name,
        totalDigests: digests.length,
        eligibleReports: eligible.length,
        indexedReportSources: indexedSources.length,
        reportChunks,
        reportChunksMentioningScrum9: reportWithScrum9,
      }),
    );
  }

  // ---- Fallback user for Pules ----
  console.log('\n=== ACL FALLBACK USER (Pules) ===');
  const fallback = await prisma.user.findFirst({
    where: { workspaceId: PULES },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      slackDisplayName: true,
      slackRealName: true,
      createdAt: true,
      workspaceId: true,
    },
  });
  console.log(JSON.stringify(fallback));

  // ---- Memory totals by workspace ----
  console.log('\n=== MEMORY TOTALS ===');
  for (const name of FOCUS) {
    const id = ws[name].id;
    const bySource = await prisma.memoryChunk.groupBy({
      by: ['sourceType'],
      where: { workspaceId: id },
      _count: { _all: true },
    });
    const total = await prisma.memoryChunk.count({ where: { workspaceId: id } });
    const withJson = await prisma.memoryChunk.count({
      where: { workspaceId: id, embedding: { not: Prisma.DbNull } },
    });
    let withVec = 0;
    try {
      const rows = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS c FROM "MemoryChunk"
        WHERE "workspaceId" = ${id} AND embedding_vec IS NOT NULL
      `;
      withVec = rows[0].c;
    } catch (e) {
      withVec = -1;
    }
    const eligibleAnswers = await prisma.answer.count({
      where: {
        user: { workspaceId: id },
        question: { type: { not: QuestionType.ISSUE_REF } },
      },
    });
    const standupChunks = await prisma.memoryChunk.count({
      where: { workspaceId: id, sourceType: 'STANDUP_ANSWER' },
    });
    const ansMeta = await prisma.answer.aggregate({
      where: { user: { workspaceId: id } },
      _min: { createdAt: true },
      _max: { createdAt: true },
      _count: true,
    });
    const users = await prisma.answer.findMany({
      where: { user: { workspaceId: id } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const teams = await prisma.$queryRaw`
      SELECT COUNT(DISTINCT r."teamId")::int AS c
      FROM "Answer" a
      JOIN "User" u ON u.id = a."userId"
      LEFT JOIN "StandupSubmission" s ON s.id = a."submissionId"
      LEFT JOIN "StandupRun" r ON r.id = s."runId"
      WHERE u."workspaceId" = ${id}
    `;
    console.log(
      JSON.stringify({
        workspace: name,
        bySource: Object.fromEntries(
          bySource.map((r) => [r.sourceType, r._count._all]),
        ),
        total,
        withJson,
        withVec,
        eligibleAnswers,
        standupChunks,
        answerCount: ansMeta._count,
        earliest: ansMeta._min.createdAt,
        latest: ansMeta._max.createdAt,
        distinctUsers: users.length,
        distinctTeamsViaSubmission: teams[0].c,
      }),
    );
  }

  // Entanglement reminder
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
  const entangled = await prisma.answer.count({
    where: {
      user: { workspaceId: PULES },
      submissionId: { in: tpSubIds },
    },
  });
  console.log('\n=== ENTANGLEMENT ===');
  console.log(
    JSON.stringify({
      pulesAnswersOnTeamPulseSubs: entangled,
      note: 'Deleting TeamPulse via submission cascade would remove these Pules-user answers',
    }),
  );

  // Recent Ask Pulse conversations workspace
  console.log('\n=== RECENT ASK PULSE ===');
  const recentAi = await prisma.aiConversation.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 8,
    select: {
      workspaceId: true,
      title: true,
      updatedAt: true,
      workspace: { select: { slackWorkspaceName: true } },
    },
  });
  console.log(JSON.stringify(recentAi, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
