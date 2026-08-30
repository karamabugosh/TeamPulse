/**
 * SAFE delete of "TeamPulse Workspace" only.
 * Preserves Pules project + Demo Workspace, including entangled Pules Answers
 * that historically pointed at TeamPulse submissions/questions.
 *
 * Usage:
 *   node scripts/safe-delete-teampulse-workspace.js           # dry-run
 *   node scripts/safe-delete-teampulse-workspace.js --execute  # delete
 */
const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();
const TARGET_NAME = 'TeamPulse Workspace';
const PRESERVE_NAMES = ['Pules project', 'Demo Workspace'];
const EXECUTE = process.argv.includes('--execute');

function emptySafe(ids) {
  return ids.length ? ids : ['__none__'];
}

async function resolveIds(db, workspaceId) {
  const userIds = (
    await db.user.findMany({ where: { workspaceId }, select: { id: true } })
  ).map((u) => u.id);
  const teamIds = (
    await db.team.findMany({ where: { workspaceId }, select: { id: true } })
  ).map((t) => t.id);
  const checkInIds = (
    await db.checkIn.findMany({
      where: { teamId: { in: emptySafe(teamIds) } },
      select: { id: true },
    })
  ).map((c) => c.id);
  const runIds = (
    await db.standupRun.findMany({
      where: { teamId: { in: emptySafe(teamIds) } },
      select: { id: true },
    })
  ).map((r) => r.id);
  const submissionIds = (
    await db.standupSubmission.findMany({
      where: { runId: { in: emptySafe(runIds) } },
      select: { id: true },
    })
  ).map((s) => s.id);
  const questionIds = (
    await db.question.findMany({
      where: { checkInId: { in: emptySafe(checkInIds) } },
      select: { id: true },
    })
  ).map((q) => q.id);
  const teamMemberIds = (
    await db.teamMember.findMany({
      where: { teamId: { in: emptySafe(teamIds) } },
      select: { id: true },
    })
  ).map((tm) => tm.id);
  const conversationIds = (
    await db.aiConversation.findMany({
      where: { workspaceId },
      select: { id: true },
    })
  ).map((c) => c.id);
  const evalRunIds = (
    await db.aiEvalRun.findMany({
      where: { workspaceId },
      select: { id: true },
    })
  ).map((r) => r.id);
  const blockerIds = (
    await db.pulseBlocker.findMany({
      where: { workspaceId },
      select: { id: true },
    })
  ).map((b) => b.id);

  return {
    userIds,
    teamIds,
    checkInIds,
    runIds,
    submissionIds,
    questionIds,
    teamMemberIds,
    conversationIds,
    evalRunIds,
    blockerIds,
  };
}

async function memoryBreakdown(db, workspaceId) {
  const rows = await db.memoryChunk.groupBy({
    by: ['sourceType'],
    where: { workspaceId },
    _count: { _all: true },
  });
  const map = Object.fromEntries(rows.map((r) => [r.sourceType, r._count._all]));
  const total = await db.memoryChunk.count({ where: { workspaceId } });
  const withJson = await db.memoryChunk.count({
    where: { workspaceId, embedding: { not: Prisma.DbNull } },
  });
  let withVec = 0;
  try {
    const r = await db.$queryRaw`
      SELECT COUNT(*)::int AS c FROM "MemoryChunk"
      WHERE "workspaceId" = ${workspaceId} AND embedding_vec IS NOT NULL
    `;
    withVec = r[0]?.c ?? 0;
  } catch {
    withVec = -1;
  }
  return {
    STANDUP_ANSWER: map.STANDUP_ANSWER || 0,
    BLOCKER: map.BLOCKER || 0,
    BLOCKER_RESOLUTION: map.BLOCKER_RESOLUTION || 0,
    REPORT: map.REPORT || 0,
    TOTAL: total,
    withJson,
    withVec,
  };
}

/**
 * Detach preserved-workspace rows from TeamPulse graph so TP delete
 * cannot cascade-destroy Pules Answers / blockers / links.
 */
async function detachPreservedFromTeamPulse(db, tpIds, preserveWorkspaceIds) {
  const stats = {};
  const { teamIds, runIds, submissionIds, questionIds } = tpIds;

  // Clear focusedSubmission pointing at TP submissions (any user)
  stats.focusedSubmissionCleared = (
    await db.user.updateMany({
      where: { focusedSubmissionId: { in: emptySafe(submissionIds) } },
      data: { focusedSubmissionId: null },
    })
  ).count;

  // Conversation states on TP submissions (incl. Pules users)
  stats.conversationStateOnTpSubs = (
    await db.conversationState.deleteMany({
      where: { submissionId: { in: emptySafe(submissionIds) } },
    })
  ).count;

  // Follow-up sessions tied to TP submissions
  stats.blockerFollowUpOnTpSubs = (
    await db.blockerFollowUpSession.deleteMany({
      where: { submissionId: { in: emptySafe(submissionIds) } },
    })
  ).count;

  // Pules/Demo AnswerJiraIssueLinks that point at TP submissions/questions/runs
  // (required FKs would cascade-delete or block; remove links, keep Answers)
  stats.preservedAnswerJiraLinksRemoved = (
    await db.answerJiraIssueLink.deleteMany({
      where: {
        workspaceId: { in: preserveWorkspaceIds },
        OR: [
          { submissionId: { in: emptySafe(submissionIds) } },
          { questionId: { in: emptySafe(questionIds) } },
          { runId: { in: emptySafe(runIds) } },
        ],
      },
    })
  ).count;

  // Rehome preserved Answers off TP questions/submissions onto a Pules question
  const pulesWs = preserveWorkspaceIds[0];
  const pulesTeam = await db.team.findFirst({
    where: { workspaceId: pulesWs },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  let rehomeQuestionId = null;
  if (pulesTeam) {
    const checkIn = await db.checkIn.findFirst({
      where: { teamId: pulesTeam.id },
      select: { id: true },
    });
    if (checkIn) {
      const q = await db.question.findFirst({
        where: { checkInId: checkIn.id, isActive: true },
        orderBy: { order: 'asc' },
        select: { id: true },
      });
      rehomeQuestionId = q?.id ?? null;
    }
  }
  if (!rehomeQuestionId) {
    throw new Error(
      'STOP: cannot rehome preserved Answers — no Pules question available',
    );
  }

  // Answers owned by preserved workspaces but tied to TP questions/subs
  const entangledAnswers = await db.answer.findMany({
    where: {
      user: { workspaceId: { in: preserveWorkspaceIds } },
      OR: [
        { submissionId: { in: emptySafe(submissionIds) } },
        { questionId: { in: emptySafe(questionIds) } },
      ],
    },
    select: { id: true, questionId: true, submissionId: true },
  });

  stats.entangledAnswersRehomed = 0;
  for (const a of entangledAnswers) {
    await db.answer.update({
      where: { id: a.id },
      data: {
        questionId: rehomeQuestionId,
        submissionId: null,
      },
    });
    stats.entangledAnswersRehomed += 1;
  }
  stats.rehomeQuestionId = rehomeQuestionId;

  // Detach preserved PulseBlockers from TP team/run/submission refs (no FK, but clean)
  stats.blockersDetached = (
    await db.pulseBlocker.updateMany({
      where: {
        workspaceId: { in: preserveWorkspaceIds },
        OR: [
          { teamId: { in: emptySafe(teamIds) } },
          { runId: { in: emptySafe(runIds) } },
          { submissionId: { in: emptySafe(submissionIds) } },
        ],
      },
      data: {
        teamId: pulesTeam?.id ?? null,
        runId: null,
        submissionId: null,
      },
    })
  ).count;

  // Thread updates by preserved users on TP runs — delete (TP-owned timeline)
  stats.threadUpdatesPreservedUsersOnTp = (
    await db.standupThreadUpdate.deleteMany({
      where: {
        runId: { in: emptySafe(runIds) },
        user: { workspaceId: { in: preserveWorkspaceIds } },
      },
    })
  ).count;

  // StandupSubmissions for preserved users on TP runs — delete after answers detached
  stats.preservedUserSubsOnTpDeleted = (
    await db.standupSubmission.deleteMany({
      where: {
        runId: { in: emptySafe(runIds) },
        user: { workspaceId: { in: preserveWorkspaceIds } },
      },
    })
  ).count;

  // TeamMembership of preserved users on TP teams
  stats.preservedUserTeamMembersOnTp = (
    await db.teamMember.deleteMany({
      where: {
        teamId: { in: emptySafe(teamIds) },
        user: { workspaceId: { in: preserveWorkspaceIds } },
      },
    })
  ).count;

  return stats;
}

async function deleteTeamPulseExclusive(db, workspaceId) {
  const deleted = {};
  const ids = await resolveIds(db, workspaceId);
  const {
    userIds,
    teamIds,
    checkInIds,
    runIds,
    submissionIds,
    questionIds,
    teamMemberIds,
    conversationIds,
    evalRunIds,
    blockerIds,
  } = ids;

  if (userIds.length) {
    deleted.User_focusedSubmission_cleared = (
      await db.user.updateMany({
        where: { id: { in: userIds }, focusedSubmissionId: { not: null } },
        data: { focusedSubmissionId: null },
      })
    ).count;
  } else {
    deleted.User_focusedSubmission_cleared = 0;
  }

  deleted.AiEvalResult = (
    await db.aiEvalResult.deleteMany({
      where: { runId: { in: emptySafe(evalRunIds) } },
    })
  ).count;
  deleted.AiEvalRun = (await db.aiEvalRun.deleteMany({ where: { workspaceId } })).count;
  deleted.AiEvalCase = (await db.aiEvalCase.deleteMany({ where: { workspaceId } })).count;
  deleted.AiConversationMessage = (
    await db.aiConversationMessage.deleteMany({
      where: { conversationId: { in: emptySafe(conversationIds) } },
    })
  ).count;
  deleted.AiSlackExportLog = (
    await db.aiSlackExportLog.deleteMany({ where: { workspaceId } })
  ).count;
  deleted.AiConversation = (
    await db.aiConversation.deleteMany({ where: { workspaceId } })
  ).count;

  deleted.MemoryOutboxEvent = (
    await db.memoryOutboxEvent.deleteMany({ where: { workspaceId } })
  ).count;
  deleted.MemoryChunk = (await db.memoryChunk.deleteMany({ where: { workspaceId } })).count;
  deleted.KnowledgeEmbedding = (
    await db.knowledgeEmbedding.deleteMany({ where: { workspaceId } })
  ).count;
  deleted.TeamMemoryDocument = (
    await db.teamMemoryDocument.deleteMany({ where: { workspaceId } })
  ).count;
  deleted.SlackAiChatLog = (
    await db.slackAiChatLog.deleteMany({ where: { workspaceId } })
  ).count;

  deleted.AnswerJiraIssueLink = (
    await db.answerJiraIssueLink.deleteMany({ where: { workspaceId } })
  ).count;
  deleted.JiraAuditLog = (await db.jiraAuditLog.deleteMany({ where: { workspaceId } })).count;
  deleted.JiraProposedAction = (
    await db.jiraProposedAction.deleteMany({
      where: {
        OR: [
          { userId: { in: emptySafe(userIds) } },
          { blockerId: { in: emptySafe(blockerIds) } },
        ],
      },
    })
  ).count;
  deleted.PulseBlockerUpdate = (
    await db.pulseBlockerUpdate.deleteMany({
      where: {
        OR: [
          { blockerId: { in: emptySafe(blockerIds) } },
          { userId: { in: emptySafe(userIds) } },
        ],
      },
    })
  ).count;
  deleted.PulseBlocker = (await db.pulseBlocker.deleteMany({ where: { workspaceId } })).count;
  deleted.BlockerFollowUpSession = (
    await db.blockerFollowUpSession.deleteMany({
      where: {
        OR: [
          { userId: { in: emptySafe(userIds) } },
          { submissionId: { in: emptySafe(submissionIds) } },
        ],
      },
    })
  ).count;

  deleted.JiraIssueCacheEntry = (
    await db.jiraIssueCacheEntry.deleteMany({ where: { workspaceId } })
  ).count;
  deleted.JiraConnection = (
    await db.jiraConnection.deleteMany({ where: { workspaceId } })
  ).count;
  deleted.JiraMemberCache = (
    await db.jiraMemberCache.deleteMany({ where: { workspaceId } })
  ).count;
  deleted.SlackMemberCache = (
    await db.slackMemberCache.deleteMany({ where: { workspaceId } })
  ).count;
  deleted.SlackChannel = (await db.slackChannel.deleteMany({ where: { workspaceId } })).count;
  deleted.InboundEvent = (await db.inboundEvent.deleteMany({ where: { workspaceId } })).count;

  deleted.StandupThreadUpdate = (
    await db.standupThreadUpdate.deleteMany({
      where: {
        OR: [
          { runId: { in: emptySafe(runIds) } },
          { submissionId: { in: emptySafe(submissionIds) } },
          { userId: { in: emptySafe(userIds) } },
        ],
      },
    })
  ).count;
  deleted.AiDigest = (
    await db.aiDigest.deleteMany({
      where: {
        OR: [
          { teamId: { in: emptySafe(teamIds) } },
          { runId: { in: emptySafe(runIds) } },
        ],
      },
    })
  ).count;
  deleted.ConversationState = (
    await db.conversationState.deleteMany({
      where: {
        OR: [
          { userId: { in: emptySafe(userIds) } },
          { submissionId: { in: emptySafe(submissionIds) } },
        ],
      },
    })
  ).count;

  // CRITICAL: only answers owned by TeamPulse users — never by TP submission/question OR
  deleted.Answer = (
    await db.answer.deleteMany({
      where: { userId: { in: emptySafe(userIds) } },
    })
  ).count;

  deleted.StandupSubmission = (
    await db.standupSubmission.deleteMany({
      where: {
        OR: [
          { runId: { in: emptySafe(runIds) } },
          { userId: { in: emptySafe(userIds) } },
        ],
      },
    })
  ).count;
  deleted.StandupRun = (
    await db.standupRun.deleteMany({
      where: {
        OR: [
          { teamId: { in: emptySafe(teamIds) } },
          { checkInId: { in: emptySafe(checkInIds) } },
        ],
      },
    })
  ).count;

  // Null-checkIn questions answered only by TP users may remain; delete TP check-in questions
  deleted.Question = (
    await db.question.deleteMany({
      where: { checkInId: { in: emptySafe(checkInIds) } },
    })
  ).count;

  // Orphan questions with null checkIn that only TP users answered — delete answers already done;
  // leave null-checkIn questions if still referenced by preserved answers (shouldn't after rehome)
  deleted.CheckInParticipant = (
    await db.checkInParticipant.deleteMany({
      where: {
        OR: [
          { checkInId: { in: emptySafe(checkInIds) } },
          { teamMemberId: { in: emptySafe(teamMemberIds) } },
        ],
      },
    })
  ).count;
  deleted.CheckIn = (
    await db.checkIn.deleteMany({ where: { teamId: { in: emptySafe(teamIds) } } })
  ).count;
  deleted.TeamMember = (
    await db.teamMember.deleteMany({
      where: {
        OR: [
          { teamId: { in: emptySafe(teamIds) } },
          { userId: { in: emptySafe(userIds) } },
        ],
      },
    })
  ).count;
  deleted.Team = (await db.team.deleteMany({ where: { workspaceId } })).count;
  deleted.User = (await db.user.deleteMany({ where: { workspaceId } })).count;
  deleted.Workspace = (await db.workspace.deleteMany({ where: { id: workspaceId } })).count;

  return deleted;
}

async function snapshotPreserve(db, workspaceId) {
  const mem = await memoryBreakdown(db, workspaceId);
  return {
    workspace: await db.workspace.count({ where: { id: workspaceId } }),
    users: await db.user.count({ where: { workspaceId } }),
    teams: await db.team.count({ where: { workspaceId } }),
    answers: await db.answer.count({ where: { user: { workspaceId } } }),
    blockers: await db.pulseBlocker.count({ where: { workspaceId } }),
    resolutions: await db.pulseBlockerUpdate.count({
      where: { blocker: { workspaceId }, newStatus: 'resolved' },
    }),
    digests: await db.aiDigest.count({ where: { team: { workspaceId } } }),
    jiraConnections: await db.jiraConnection.count({ where: { workspaceId } }),
    jiraCache: await db.jiraIssueCacheEntry.count({ where: { workspaceId } }),
    memory: mem,
  };
}

async function main() {
  const all = await prisma.workspace.findMany({
    select: {
      id: true,
      slackWorkspaceId: true,
      slackWorkspaceName: true,
      installedAt: true,
    },
    orderBy: { installedAt: 'asc' },
  });

  console.log('=== ALL WORKSPACES ===');
  console.log(JSON.stringify(all, null, 2));

  const matches = all.filter((w) => w.slackWorkspaceName === TARGET_NAME);
  if (matches.length === 0) {
    console.log('ALREADY_DELETED');
    return;
  }
  if (matches.length > 1) {
    console.error('STOP: duplicate TeamPulse Workspace rows');
    console.error(JSON.stringify(matches, null, 2));
    process.exit(1);
  }

  const target = matches[0];
  const preserve = {};
  for (const name of PRESERVE_NAMES) {
    const found = all.filter((w) => w.slackWorkspaceName === name);
    if (found.length !== 1) {
      console.error(`STOP: expected 1 "${name}", found ${found.length}`);
      process.exit(1);
    }
    preserve[name] = found[0];
  }

  const pulesId = preserve['Pules project'].id;
  const demoId = preserve['Demo Workspace'].id;

  // ---- SAFETY CHECK: primary V2 dataset must NOT be on TeamPulse ----
  const tpMem = await memoryBreakdown(prisma, target.id);
  const pulesMem = await memoryBreakdown(prisma, pulesId);

  console.log('\n=== SAFETY: TeamPulse MemoryChunks ===');
  console.log(JSON.stringify(tpMem, null, 2));
  console.log('\n=== SAFETY: Pules MemoryChunks ===');
  console.log(JSON.stringify(pulesMem, null, 2));

  const tpLooksLikePrimary366 =
    tpMem.TOTAL >= 300 &&
    tpMem.STANDUP_ANSWER >= 300 &&
    pulesMem.TOTAL < tpMem.TOTAL;

  if (tpLooksLikePrimary366) {
    console.error('\nNEEDS_DATA_MIGRATION_FIRST');
    console.error('Primary 366-chunk V2 dataset appears to live on TeamPulse — aborting.');
    process.exit(2);
  }

  if (
    pulesMem.TOTAL !== 366 ||
    pulesMem.STANDUP_ANSWER !== 349 ||
    pulesMem.BLOCKER !== 5 ||
    pulesMem.BLOCKER_RESOLUTION !== 7
  ) {
    console.warn(
      'WARN: Pules memory counts differ from expected 366/349/5/7 — continuing because primary is still on Pules, not TeamPulse.',
    );
    console.warn(JSON.stringify(pulesMem));
  }

  console.log('\nSafety check: PASS (primary V2 dataset owned by Pules project)');

  const beforePules = await snapshotPreserve(prisma, pulesId);
  const beforeDemo = await snapshotPreserve(prisma, demoId);
  console.log('\n=== BEFORE Pules ===');
  console.log(JSON.stringify(beforePules, null, 2));
  console.log('\n=== BEFORE Demo ===');
  console.log(JSON.stringify(beforeDemo, null, 2));

  const tpIds = await resolveIds(prisma, target.id);
  console.log('\n=== TeamPulse id counts ===');
  console.log(
    JSON.stringify(
      {
        users: tpIds.userIds.length,
        teams: tpIds.teamIds.length,
        runs: tpIds.runIds.length,
        submissions: tpIds.submissionIds.length,
        questions: tpIds.questionIds.length,
        blockers: tpIds.blockerIds.length,
      },
      null,
      2,
    ),
  );

  if (!EXECUTE) {
    console.log('\nDRY-RUN only. Re-run with --execute to delete.');
    return;
  }

  console.log('\n=== EXECUTING SAFE DELETION ===');
  const result = await prisma.$transaction(
    async (tx) => {
      const detach = await detachPreservedFromTeamPulse(tx, tpIds, [
        pulesId,
        demoId,
      ]);
      const deleted = await deleteTeamPulseExclusive(tx, target.id);
      return { detach, deleted };
    },
    { timeout: 300000, maxWait: 60000 },
  );

  console.log('\n=== DETACH STATS ===');
  console.log(JSON.stringify(result.detach, null, 2));
  console.log('\n=== DELETED COUNTS ===');
  console.log(JSON.stringify(result.deleted, null, 2));

  // ---- VERIFY ----
  const remainingTp = await prisma.workspace.count({
    where: { slackWorkspaceName: TARGET_NAME },
  });
  const remainingById = await prisma.workspace.count({ where: { id: target.id } });
  const afterAll = await prisma.workspace.findMany({
    select: { id: true, slackWorkspaceName: true, installedAt: true },
    orderBy: { installedAt: 'asc' },
  });
  const afterPules = await snapshotPreserve(prisma, pulesId);
  const afterDemo = await snapshotPreserve(prisma, demoId);

  // Orphan check: residual rows still pointing at deleted workspace id
  const orphanChecks = {
    User: await prisma.user.count({ where: { workspaceId: target.id } }),
    Team: await prisma.team.count({ where: { workspaceId: target.id } }),
    MemoryChunk: await prisma.memoryChunk.count({
      where: { workspaceId: target.id },
    }),
    MemoryOutboxEvent: await prisma.memoryOutboxEvent.count({
      where: { workspaceId: target.id },
    }),
    JiraConnection: await prisma.jiraConnection.count({
      where: { workspaceId: target.id },
    }),
  };

  console.log('\n=== AFTER WORKSPACES ===');
  console.log(JSON.stringify(afterAll, null, 2));
  console.log('\n=== AFTER Pules ===');
  console.log(JSON.stringify(afterPules, null, 2));
  console.log('\n=== AFTER Demo ===');
  console.log(JSON.stringify(afterDemo, null, 2));
  console.log('\n=== ORPHANS for deleted id ===');
  console.log(JSON.stringify(orphanChecks, null, 2));

  const pulesOk =
    afterPules.workspace === 1 &&
    afterPules.users === beforePules.users &&
    afterPules.teams === beforePules.teams &&
    afterPules.answers === beforePules.answers &&
    afterPules.blockers === beforePules.blockers &&
    afterPules.resolutions === beforePules.resolutions &&
    afterPules.jiraConnections === beforePules.jiraConnections &&
    afterPules.jiraCache === beforePules.jiraCache &&
    afterPules.memory.TOTAL === beforePules.memory.TOTAL &&
    afterPules.memory.STANDUP_ANSWER === beforePules.memory.STANDUP_ANSWER &&
    afterPules.memory.withJson === beforePules.memory.withJson &&
    afterPules.memory.withVec === beforePules.memory.withVec;

  const demoOk =
    afterDemo.workspace === 1 &&
    afterDemo.users === beforeDemo.users &&
    afterDemo.teams === beforeDemo.teams &&
    afterDemo.answers === beforeDemo.answers &&
    afterDemo.memory.TOTAL === beforeDemo.memory.TOTAL &&
    afterDemo.jiraConnections === beforeDemo.jiraConnections;

  const names = afterAll.map((w) => w.slackWorkspaceName).sort();
  const selectorOk =
    remainingTp === 0 &&
    remainingById === 0 &&
    names.includes('Pules project') &&
    names.includes('Demo Workspace') &&
    !names.includes(TARGET_NAME);

  console.log('\n=== VERDICT ===');
  console.log(
    JSON.stringify(
      {
        remainingTp,
        remainingById,
        pulesOk,
        demoOk,
        selectorOk,
        orphanNonZero: Object.entries(orphanChecks).filter(([, n]) => n > 0),
        FINAL:
          remainingTp === 0 && pulesOk && demoOk && selectorOk
            ? 'DELETION_SUCCESSFUL'
            : 'FAILED',
      },
      null,
      2,
    ),
  );

  if (!(remainingTp === 0 && pulesOk && demoOk && selectorOk)) {
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
