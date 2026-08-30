/**
 * FINAL delete of "TeamPulse Workspace" only.
 *
 * Requirements:
 * - Resolve workspaces by live DB identity (never trust hardcoded IDs as authority)
 * - Hard abort if any Pules-owned business source / MemoryChunk would be lost
 * - No ownership migration in this script (untangle must already be complete)
 * - Preserve "Pules project" and "Demo Workspace"
 *
 * Usage:
 *   node scripts/delete-teampulse-workspace-final.js           # dry-run + guards
 *   node scripts/delete-teampulse-workspace-final.js --execute # delete
 */
const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();
const TARGET_NAME = 'TeamPulse Workspace';
const PRESERVE_NAMES = ['Pules project', 'Demo Workspace'];
const EXECUTE = process.argv.includes('--execute');

const EXPECTED_PULES_MEMORY = {
  TOTAL: 366,
  STANDUP_ANSWER: 349,
  BLOCKER: 5,
  BLOCKER_RESOLUTION: 7,
  REPORT: 5,
};

function emptySafe(ids) {
  return ids.length ? ids : ['__none__'];
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

async function resolveTpGraph(db, workspaceId) {
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

async function attributionCheck(db, pulesId) {
  const chunks = await db.memoryChunk.findMany({
    where: { workspaceId: pulesId, sourceType: 'STANDUP_ANSWER' },
    select: { sourceId: true, ownerUserId: true },
  });
  let matching = 0;
  let mismatching = 0;
  let missing = 0;
  let crossWs = 0;

  for (const c of chunks) {
    const a = await db.answer.findUnique({
      where: { id: c.sourceId },
      select: {
        userId: true,
        user: { select: { workspaceId: true } },
        submission: {
          select: {
            run: {
              select: { team: { select: { workspaceId: true } } },
            },
          },
        },
        question: {
          select: {
            checkIn: {
              select: { team: { select: { workspaceId: true } } },
            },
          },
        },
      },
    });
    if (!a) {
      missing++;
      continue;
    }
    if (c.ownerUserId === a.userId) matching++;
    else mismatching++;

    const subWs = a.submission?.run?.team?.workspaceId;
    const qWs = a.question?.checkIn?.team?.workspaceId;
    if (subWs && subWs !== pulesId) crossWs++;
    else if (qWs && qWs !== pulesId) crossWs++;
  }

  return {
    total: chunks.length,
    matching,
    mismatching,
    missing,
    crossWorkspaceSourceRefs: crossWs,
  };
}

async function snapshot(db, workspaceId) {
  const mem = await memoryBreakdown(db, workspaceId);
  return {
    workspace: await db.workspace.count({ where: { id: workspaceId } }),
    users: await db.user.count({ where: { workspaceId } }),
    teams: await db.team.count({ where: { workspaceId } }),
    answers: await db.answer.count({ where: { user: { workspaceId } } }),
    blockers: await db.pulseBlocker.count({ where: { workspaceId } }),
    resolutions: await db.pulseBlockerUpdate.count({
      where: { blocker: { workspaceId } },
    }),
    digests: await db.aiDigest.count({ where: { team: { workspaceId } } }),
    jiraConnections: await db.jiraConnection.count({ where: { workspaceId } }),
    jiraCache: await db.jiraIssueCacheEntry.count({ where: { workspaceId } }),
    scrum9Cache: await db.jiraIssueCacheEntry.count({
      where: { workspaceId, issueKey: 'SCRUM-9' },
    }),
    scrum9Chunks: await db.memoryChunk.count({
      where: { workspaceId, linkedIssueKey: 'SCRUM-9' },
    }),
    checkIns: await db.checkIn.count({
      where: { team: { workspaceId } },
    }),
    runs: await db.standupRun.count({
      where: { team: { workspaceId } },
    }),
    memory: mem,
  };
}

async function countWouldLosePules(db, pulesId, tp) {
  const pulesAnswersOnTp = await db.answer.count({
    where: {
      user: { workspaceId: pulesId },
      OR: [
        { submissionId: { in: emptySafe(tp.submissionIds) } },
        { questionId: { in: emptySafe(tp.questionIds) } },
      ],
    },
  });
  const pulesSubsOnTp = await db.standupSubmission.count({
    where: {
      user: { workspaceId: pulesId },
      runId: { in: emptySafe(tp.runIds) },
    },
  });
  const pulesBlockersOnTp = await db.pulseBlocker.count({
    where: {
      workspaceId: pulesId,
      OR: [
        { teamId: { in: emptySafe(tp.teamIds) } },
        { runId: { in: emptySafe(tp.runIds) } },
        { submissionId: { in: emptySafe(tp.submissionIds) } },
        { checkInId: { in: emptySafe(tp.checkInIds) } },
      ],
    },
  });
  const pulesLinksOnTp = await db.answerJiraIssueLink.count({
    where: {
      workspaceId: pulesId,
      OR: [
        { submissionId: { in: emptySafe(tp.submissionIds) } },
        { questionId: { in: emptySafe(tp.questionIds) } },
        { runId: { in: emptySafe(tp.runIds) } },
      ],
    },
  });
  const pulesChunksOnTpTeam = await db.memoryChunk.count({
    where: {
      workspaceId: pulesId,
      teamId: { in: emptySafe(tp.teamIds) },
    },
  });

  return {
    pulesAnswersOnTp,
    pulesSubsOnTp,
    pulesBlockersOnTp,
    pulesLinksOnTp,
    pulesChunksOnTpTeam,
  };
}

async function deleteTeamPulseExclusive(db, workspaceId, tp) {
  const deleted = {};
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
  } = tp;

  deleted.User_focusedSubmission_cleared = (
    await db.user.updateMany({
      where: {
        OR: [
          { id: { in: emptySafe(userIds) }, focusedSubmissionId: { not: null } },
          { focusedSubmissionId: { in: emptySafe(submissionIds) } },
        ],
      },
      data: { focusedSubmissionId: null },
    })
  ).count;

  deleted.AiEvalResult = (
    await db.aiEvalResult.deleteMany({
      where: { runId: { in: emptySafe(evalRunIds) } },
    })
  ).count;
  deleted.AiEvalRun = (
    await db.aiEvalRun.deleteMany({ where: { workspaceId } })
  ).count;
  deleted.AiEvalCase = (
    await db.aiEvalCase.deleteMany({ where: { workspaceId } })
  ).count;
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
  deleted.MemoryChunk = (
    await db.memoryChunk.deleteMany({ where: { workspaceId } })
  ).count;
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
  deleted.JiraAuditLog = (
    await db.jiraAuditLog.deleteMany({ where: { workspaceId } })
  ).count;
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
  deleted.PulseBlocker = (
    await db.pulseBlocker.deleteMany({ where: { workspaceId } })
  ).count;
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
  deleted.SlackChannel = (
    await db.slackChannel.deleteMany({ where: { workspaceId } })
  ).count;
  deleted.InboundEvent = (
    await db.inboundEvent.deleteMany({ where: { workspaceId } })
  ).count;

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

  // Clear any remaining currentQuestionId pointing at TP questions
  // (e.g. Pules users whose conversation progressed on questions later cloned).
  // Avoids Restrict FK blocking Question delete. Does not delete those rows.
  deleted.ConversationState_clearedTpQuestion = (
    await db.conversationState.updateMany({
      where: { currentQuestionId: { in: emptySafe(questionIds) } },
      data: { currentQuestionId: null },
    })
  ).count;

  // Only TeamPulse-user answers
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
  deleted.Question = (
    await db.question.deleteMany({
      where: { checkInId: { in: emptySafe(checkInIds) } },
    })
  ).count;
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
    await db.checkIn.deleteMany({
      where: { teamId: { in: emptySafe(teamIds) } },
    })
  ).count;

  // Includes Pules-user memberships on TP teams + TP-user memberships anywhere
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
  deleted.Workspace = (
    await db.workspace.deleteMany({ where: { id: workspaceId } })
  ).count;

  return deleted;
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
    const preserve = {};
    for (const name of PRESERVE_NAMES) {
      const found = all.filter((w) => w.slackWorkspaceName === name);
      if (found.length === 1) preserve[name] = found[0];
    }
    if (preserve['Pules project']) {
      const mem = await memoryBreakdown(prisma, preserve['Pules project'].id);
      console.log('Pules memory after ALREADY_DELETED:', mem);
    }
    return { status: 'ALREADY_DELETED' };
  }
  if (matches.length > 1) {
    console.error('STOP: multiple TeamPulse Workspace rows');
    console.error(JSON.stringify(matches, null, 2));
    process.exit(1);
  }

  const target = matches[0];
  const preserve = {};
  for (const name of PRESERVE_NAMES) {
    const found = all.filter((w) => w.slackWorkspaceName === name);
    if (found.length !== 1) {
      console.error(`STOP: expected exactly 1 "${name}", found ${found.length}`);
      process.exit(1);
    }
    preserve[name] = found[0];
  }

  const pulesId = preserve['Pules project'].id;
  const demoId = preserve['Demo Workspace'].id;

  console.log('\nResolved IDs:', {
    TeamPulse: target.id,
    Pules: pulesId,
    Demo: demoId,
  });

  const pulesMem = await memoryBreakdown(prisma, pulesId);
  const attr = await attributionCheck(prisma, pulesId);
  const tp = await resolveTpGraph(prisma, target.id);
  const loss = await countWouldLosePules(prisma, pulesId, tp);
  const beforePules = await snapshot(prisma, pulesId);
  const beforeDemo = await snapshot(prisma, demoId);
  const pulesJira = await prisma.jiraConnection.count({
    where: { workspaceId: pulesId },
  });
  const pulesMembersOnTp = await prisma.teamMember.findMany({
    where: {
      teamId: { in: emptySafe(tp.teamIds) },
      user: { workspaceId: pulesId },
    },
    select: {
      id: true,
      userId: true,
      user: { select: { slackDisplayName: true } },
    },
  });

  console.log('\n=== PRE-DELETE PULES MEMORY ===');
  console.log(JSON.stringify(pulesMem, null, 2));
  console.log('\n=== ATTRIBUTION ===');
  console.log(JSON.stringify(attr, null, 2));
  console.log('\n=== WOULD-LOSE-PULES ===');
  console.log(JSON.stringify(loss, null, 2));
  console.log('\n=== PULES MEMBERS ON TP (will remove membership only) ===');
  console.log(JSON.stringify(pulesMembersOnTp, null, 2));

  const memoryOk =
    pulesMem.TOTAL === EXPECTED_PULES_MEMORY.TOTAL &&
    pulesMem.STANDUP_ANSWER === EXPECTED_PULES_MEMORY.STANDUP_ANSWER &&
    pulesMem.BLOCKER === EXPECTED_PULES_MEMORY.BLOCKER &&
    pulesMem.BLOCKER_RESOLUTION === EXPECTED_PULES_MEMORY.BLOCKER_RESOLUTION &&
    pulesMem.REPORT === EXPECTED_PULES_MEMORY.REPORT &&
    pulesMem.withJson === EXPECTED_PULES_MEMORY.TOTAL &&
    pulesMem.withVec === EXPECTED_PULES_MEMORY.TOTAL;

  const attrOk =
    attr.total === 349 &&
    attr.matching === 349 &&
    attr.mismatching === 0 &&
    attr.missing === 0 &&
    attr.crossWorkspaceSourceRefs === 0;

  const lossOk =
    loss.pulesAnswersOnTp === 0 &&
    loss.pulesSubsOnTp === 0 &&
    loss.pulesBlockersOnTp === 0 &&
    loss.pulesLinksOnTp === 0 &&
    loss.pulesChunksOnTpTeam === 0;

  const jiraOk = pulesJira > 0;
  const scrum9Ok =
    beforePules.scrum9Cache >= 1 && beforePules.scrum9Chunks >= 1;
  const demoExists = beforeDemo.workspace === 1;

  const safetyPass =
    memoryOk && attrOk && lossOk && jiraOk && scrum9Ok && demoExists;

  console.log('\n=== SAFETY GUARD ===');
  console.log(
    JSON.stringify(
      {
        memoryOk,
        attrOk,
        lossOk,
        jiraOk,
        scrum9Ok,
        demoExists,
        safetyPass,
      },
      null,
      2,
    ),
  );

  if (!safetyPass) {
    console.error('\nDELETE_ABORTED_SAFETY_GUARD');
    process.exit(2);
  }

  console.log('\nPre-delete safety: PASS');
  console.log('\n=== BEFORE Pules ===', JSON.stringify(beforePules, null, 2));
  console.log('\n=== BEFORE Demo ===', JSON.stringify(beforeDemo, null, 2));
  console.log('\n=== TeamPulse graph sizes ===', {
    users: tp.userIds.length,
    teams: tp.teamIds.length,
    checkIns: tp.checkInIds.length,
    runs: tp.runIds.length,
    submissions: tp.submissionIds.length,
    questions: tp.questionIds.length,
    blockers: tp.blockerIds.length,
    memoryChunks: await prisma.memoryChunk.count({
      where: { workspaceId: target.id },
    }),
  });

  if (!EXECUTE) {
    console.log('\nDRY-RUN only. Re-run with --execute to delete.');
    return { status: 'DRY_RUN_PASS', targetId: target.id };
  }

  console.log('\n=== EXECUTING FINAL DELETION ===');
  const deleted = await prisma.$transaction(
    async (tx) => deleteTeamPulseExclusive(tx, target.id, tp),
    { timeout: 300_000, maxWait: 60_000 },
  );

  console.log('\n=== DELETED COUNTS ===');
  console.log(JSON.stringify(deleted, null, 2));

  const remainingByName = await prisma.workspace.count({
    where: { slackWorkspaceName: TARGET_NAME },
  });
  const remainingById = await prisma.workspace.count({
    where: { id: target.id },
  });
  const afterAll = await prisma.workspace.findMany({
    select: { id: true, slackWorkspaceName: true },
    orderBy: { installedAt: 'asc' },
  });
  const afterPules = await snapshot(prisma, pulesId);
  const afterDemo = await snapshot(prisma, demoId);
  const afterAttr = await attributionCheck(prisma, pulesId);

  // Pules users that had TP membership must still exist
  const preservedUserIds = pulesMembersOnTp.map((m) => m.userId);
  const usersStillThere = preservedUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: preservedUserIds } },
        select: {
          id: true,
          workspaceId: true,
          slackDisplayName: true,
          teamMembers: {
            select: { team: { select: { name: true, workspaceId: true } } },
          },
        },
      })
    : [];

  // Live Jira for Pules (same filters as findLiveConnectionForWorkspace conceptually)
  const liveJira = await prisma.jiraConnection.findFirst({
    where: {
      workspaceId: pulesId,
      cloudId: { not: 'demo-cloud-id' },
      accessToken: { not: '' },
      NOT: {
        OR: [
          { accessToken: { contains: 'demo-access-token' } },
          { accessToken: { contains: 'placeholder' } },
          { cloudId: { contains: 'demo-cloud' } },
        ],
      },
    },
    orderBy: { connectedAt: 'desc' },
    select: { id: true, siteUrl: true, cloudId: true, userId: true },
  });

  const orphanChecks = {
    User: await prisma.user.count({ where: { workspaceId: target.id } }),
    Team: await prisma.team.count({ where: { workspaceId: target.id } }),
    TeamMember: await prisma.teamMember.count({
      where: { teamId: { in: emptySafe(tp.teamIds) } },
    }),
    CheckIn: await prisma.checkIn.count({
      where: { id: { in: emptySafe(tp.checkInIds) } },
    }),
    StandupRun: await prisma.standupRun.count({
      where: { id: { in: emptySafe(tp.runIds) } },
    }),
    StandupSubmission: await prisma.standupSubmission.count({
      where: { id: { in: emptySafe(tp.submissionIds) } },
    }),
    Answer: await prisma.answer.count({
      where: { userId: { in: emptySafe(tp.userIds) } },
    }),
    AiDigest: await prisma.aiDigest.count({
      where: { teamId: { in: emptySafe(tp.teamIds) } },
    }),
    PulseBlocker: await prisma.pulseBlocker.count({
      where: { workspaceId: target.id },
    }),
    JiraConnection: await prisma.jiraConnection.count({
      where: { workspaceId: target.id },
    }),
    JiraIssueCacheEntry: await prisma.jiraIssueCacheEntry.count({
      where: { workspaceId: target.id },
    }),
    MemoryChunk: await prisma.memoryChunk.count({
      where: { workspaceId: target.id },
    }),
    MemoryOutboxEvent: await prisma.memoryOutboxEvent.count({
      where: { workspaceId: target.id },
    }),
    TeamMemoryDocument: await prisma.teamMemoryDocument.count({
      where: { workspaceId: target.id },
    }),
    KnowledgeEmbedding: await prisma.knowledgeEmbedding.count({
      where: { workspaceId: target.id },
    }),
  };

  const pulesMemOk =
    afterPules.memory.TOTAL === 366 &&
    afterPules.memory.STANDUP_ANSWER === 349 &&
    afterPules.memory.BLOCKER === 5 &&
    afterPules.memory.BLOCKER_RESOLUTION === 7 &&
    afterPules.memory.REPORT === 5 &&
    afterPules.memory.withJson === 366 &&
    afterPules.memory.withVec === 366;

  const pulesOk =
    afterPules.workspace === 1 &&
    afterPules.users === beforePules.users &&
    afterPules.teams === beforePules.teams &&
    afterPules.answers === beforePules.answers &&
    afterPules.blockers === beforePules.blockers &&
    afterPules.resolutions === beforePules.resolutions &&
    afterPules.digests === beforePules.digests &&
    afterPules.jiraConnections === beforePules.jiraConnections &&
    afterPules.jiraCache === beforePules.jiraCache &&
    afterPules.scrum9Cache === beforePules.scrum9Cache &&
    afterPules.scrum9Chunks === beforePules.scrum9Chunks &&
    pulesMemOk &&
    afterAttr.matching === 349 &&
    afterAttr.mismatching === 0 &&
    afterAttr.crossWorkspaceSourceRefs === 0;

  const demoOk =
    JSON.stringify({
      workspace: afterDemo.workspace,
      users: afterDemo.users,
      teams: afterDemo.teams,
      answers: afterDemo.answers,
      blockers: afterDemo.blockers,
      digests: afterDemo.digests,
      jiraConnections: afterDemo.jiraConnections,
      jiraCache: afterDemo.jiraCache,
      checkIns: afterDemo.checkIns,
      runs: afterDemo.runs,
      memory: afterDemo.memory,
    }) ===
    JSON.stringify({
      workspace: beforeDemo.workspace,
      users: beforeDemo.users,
      teams: beforeDemo.teams,
      answers: beforeDemo.answers,
      blockers: beforeDemo.blockers,
      digests: beforeDemo.digests,
      jiraConnections: beforeDemo.jiraConnections,
      jiraCache: beforeDemo.jiraCache,
      checkIns: beforeDemo.checkIns,
      runs: beforeDemo.runs,
      memory: beforeDemo.memory,
    });

  const names = afterAll.map((w) => w.slackWorkspaceName);
  const selectorOk =
    remainingByName === 0 &&
    remainingById === 0 &&
    names.includes('Pules project') &&
    names.includes('Demo Workspace') &&
    !names.includes(TARGET_NAME);

  const orphansOk = Object.values(orphanChecks).every((n) => n === 0);
  const usersPreserved =
    preservedUserIds.length === 0 ||
    (usersStillThere.length === preservedUserIds.length &&
      usersStillThere.every((u) => u.workspaceId === pulesId));

  console.log('\n=== AFTER WORKSPACES ===', JSON.stringify(afterAll, null, 2));
  console.log('\n=== AFTER Pules ===', JSON.stringify(afterPules, null, 2));
  console.log('\n=== AFTER Demo ===', JSON.stringify(afterDemo, null, 2));
  console.log('\n=== AFTER ATTRIBUTION ===', JSON.stringify(afterAttr, null, 2));
  console.log('\n=== ORPHANS ===', JSON.stringify(orphanChecks, null, 2));
  console.log('\n=== PULES USERS AFTER TP MEMBERSHIP REMOVAL ===', JSON.stringify(usersStillThere, null, 2));
  console.log('\n=== PULES LIVE JIRA ===', JSON.stringify(liveJira, null, 2));

  const finalOk =
    remainingByName === 0 &&
    pulesOk &&
    demoOk &&
    selectorOk &&
    orphansOk &&
    usersPreserved &&
    !!liveJira;

  console.log('\n=== VERDICT ===');
  console.log(
    JSON.stringify(
      {
        remainingByName,
        remainingById,
        pulesOk,
        demoOk,
        selectorOk,
        orphansOk,
        usersPreserved,
        liveJira: !!liveJira,
        FINAL: finalOk
          ? 'TEAM_PULSE_DELETED_SUCCESSFULLY'
          : 'DELETE_FAILED',
        deleted,
      },
      null,
      2,
    ),
  );

  if (!finalOk) process.exit(1);
  return {
    status: 'TEAM_PULSE_DELETED_SUCCESSFULLY',
    deleted,
    afterPules,
    afterDemo,
    afterAttr,
  };
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
