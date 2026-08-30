/**
 * READ-ONLY pre-deletion workspace ownership audit.
 * No DELETE / UPDATE / INSERT. Safe to run any number of times.
 *
 * Usage: node scripts/pre-deletion-workspace-ownership-audit.js
 */
const { PrismaClient, Prisma, QuestionType } = require('@prisma/client');

const prisma = new PrismaClient();

const FOCUS_NAMES = ['Pules project', 'TeamPulse Workspace', 'Demo Workspace'];

function emptySafe(ids) {
  return ids.length ? ids : ['__none__'];
}

function isEligibleAnswerType(type) {
  return type !== QuestionType.ISSUE_REF;
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

async function countByWorkspace(db, workspaceId) {
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

  const answerWhere = {
    OR: [
      { userId: { in: emptySafe(userIds) } },
      { submissionId: { in: emptySafe(submissionIds) } },
      { questionId: { in: emptySafe(questionIds) } },
    ],
  };

  const resolutionWhere = {
    blockerId: { in: emptySafe(blockerIds) },
    newStatus: 'resolved',
  };

  return {
    Workspace: await db.workspace.count({ where: { id: workspaceId } }),
    User: userIds.length,
    Team: teamIds.length,
    TeamMember: teamMemberIds.length,
    CheckIn: checkInIds.length,
    CheckInParticipant: await db.checkInParticipant.count({
      where: {
        OR: [
          { checkInId: { in: emptySafe(checkInIds) } },
          { teamMemberId: { in: emptySafe(teamMemberIds) } },
        ],
      },
    }),
    Question: questionIds.length,
    StandupRun: runIds.length,
    StandupSubmission: submissionIds.length,
    Answer: await db.answer.count({ where: answerWhere }),
    ConversationState: await db.conversationState.count({
      where: {
        OR: [
          { userId: { in: emptySafe(userIds) } },
          { submissionId: { in: emptySafe(submissionIds) } },
        ],
      },
    }),
    AiDigest: await db.aiDigest.count({
      where: {
        OR: [
          { teamId: { in: emptySafe(teamIds) } },
          { runId: { in: emptySafe(runIds) } },
        ],
      },
    }),
    StandupThreadUpdate: await db.standupThreadUpdate.count({
      where: {
        OR: [
          { runId: { in: emptySafe(runIds) } },
          { submissionId: { in: emptySafe(submissionIds) } },
          { userId: { in: emptySafe(userIds) } },
        ],
      },
    }),
    InboundEvent: await db.inboundEvent.count({ where: { workspaceId } }),
    SlackChannel: await db.slackChannel.count({ where: { workspaceId } }),
    SlackMemberCache: await db.slackMemberCache.count({ where: { workspaceId } }),
    JiraMemberCache: await db.jiraMemberCache.count({ where: { workspaceId } }),
    JiraConnection: await db.jiraConnection.count({ where: { workspaceId } }),
    JiraIssueCacheEntry: await db.jiraIssueCacheEntry.count({
      where: { workspaceId },
    }),
    PulseBlocker: blockerIds.length,
    PulseBlockerUpdate: await db.pulseBlockerUpdate.count({
      where: {
        OR: [
          { blockerId: { in: emptySafe(blockerIds) } },
          { userId: { in: emptySafe(userIds) } },
        ],
      },
    }),
    BlockerResolutionUpdates: await db.pulseBlockerUpdate.count({
      where: resolutionWhere,
    }),
    BlockerFollowUpSession: await db.blockerFollowUpSession.count({
      where: {
        OR: [
          { userId: { in: emptySafe(userIds) } },
          { submissionId: { in: emptySafe(submissionIds) } },
        ],
      },
    }),
    JiraProposedAction: await db.jiraProposedAction.count({
      where: {
        OR: [
          { userId: { in: emptySafe(userIds) } },
          { blockerId: { in: emptySafe(blockerIds) } },
        ],
      },
    }),
    JiraAuditLog: await db.jiraAuditLog.count({ where: { workspaceId } }),
    AnswerJiraIssueLink: await db.answerJiraIssueLink.count({
      where: { workspaceId },
    }),
    TeamMemoryDocument: await db.teamMemoryDocument.count({
      where: { workspaceId },
    }),
    SlackAiChatLog: await db.slackAiChatLog.count({ where: { workspaceId } }),
    KnowledgeEmbedding: await db.knowledgeEmbedding.count({
      where: { workspaceId },
    }),
    MemoryChunk: await db.memoryChunk.count({ where: { workspaceId } }),
    MemoryOutboxEvent: await db.memoryOutboxEvent.count({
      where: { workspaceId },
    }),
    AiConversation: conversationIds.length,
    AiConversationMessage: await db.aiConversationMessage.count({
      where: { conversationId: { in: emptySafe(conversationIds) } },
    }),
    AiSlackExportLog: await db.aiSlackExportLog.count({ where: { workspaceId } }),
    AiEvalCase: await db.aiEvalCase.count({ where: { workspaceId } }),
    AiEvalRun: evalRunIds.length,
    AiEvalResult: await db.aiEvalResult.count({
      where: { runId: { in: emptySafe(evalRunIds) } },
    }),
  };
}

async function memoryAudit(db, workspaceId) {
  const bySource = await db.memoryChunk.groupBy({
    by: ['sourceType'],
    where: { workspaceId },
    _count: { _all: true },
  });
  const sourceMap = Object.fromEntries(
    bySource.map((r) => [r.sourceType, r._count._all]),
  );

  const total = await db.memoryChunk.count({ where: { workspaceId } });
  const withJsonEmbedding = await db.memoryChunk.count({
    where: { workspaceId, embedding: { not: Prisma.DbNull } },
  });

  let withVec = null;
  try {
    const rows = await db.$queryRaw`
      SELECT COUNT(*)::int AS c
      FROM "MemoryChunk"
      WHERE "workspaceId" = ${workspaceId}
        AND embedding_vec IS NOT NULL
    `;
    withVec = rows[0]?.c ?? 0;
  } catch (e) {
    withVec = `ERROR: ${e.message}`;
  }

  const outbox = await db.memoryOutboxEvent.groupBy({
    by: ['status'],
    where: { workspaceId },
    _count: { _all: true },
  });
  const outboxMap = Object.fromEntries(
    outbox.map((r) => [r.status, r._count._all]),
  );

  return {
    bySource: sourceMap,
    total,
    withJsonEmbedding,
    withEmbeddingVec: withVec,
    outbox: {
      PENDING: outboxMap.PENDING || 0,
      PROCESSING: outboxMap.PROCESSING || 0,
      COMPLETED: outboxMap.COMPLETED || 0,
      FAILED: outboxMap.FAILED || 0,
    },
  };
}

async function standupAnswerAudit(db, workspaceId) {
  const answers = await db.answer.findMany({
    where: { user: { workspaceId } },
    select: {
      id: true,
      userId: true,
      createdAt: true,
      question: { select: { type: true } },
      submission: {
        select: {
          run: { select: { teamId: true } },
        },
      },
    },
  });

  const eligible = answers.filter((a) =>
    isEligibleAnswerType(a.question.type),
  );
  const standupChunks = await db.memoryChunk.count({
    where: { workspaceId, sourceType: 'STANDUP_ANSWER' },
  });

  const userIds = new Set(eligible.map((a) => a.userId));
  const teamIds = new Set(
    eligible
      .map((a) => a.submission?.run?.teamId)
      .filter(Boolean),
  );
  const dates = eligible.map((a) => a.createdAt).sort((a, b) => a - b);

  return {
    totalAnswers: answers.length,
    eligibleAnswerCount: eligible.length,
    standupAnswerChunkCount: standupChunks,
    distinctUsers: userIds.size,
    distinctTeams: teamIds.size,
    earliestAnswerDate: dates[0] ? dates[0].toISOString() : null,
    latestAnswerDate: dates.length
      ? dates[dates.length - 1].toISOString()
      : null,
  };
}

async function jiraAudit(db, workspaceId) {
  const connections = await db.jiraConnection.findMany({
    where: { workspaceId },
    select: {
      id: true,
      cloudId: true,
      siteName: true,
      siteUrl: true,
      atlassianDisplayName: true,
      connectedAt: true,
      lastSyncAt: true,
    },
  });
  const issueCount = await db.jiraIssueCacheEntry.count({
    where: { workspaceId },
  });
  const memberCount = await db.jiraMemberCache.count({
    where: { workspaceId },
  });
  const scrum9Cache = await db.jiraIssueCacheEntry.findFirst({
    where: { workspaceId, issueKey: 'SCRUM-9' },
    select: {
      id: true,
      issueKey: true,
      summary: true,
      status: true,
      refreshedAt: true,
    },
  });

  const linkedStandup = await db.answerJiraIssueLink.count({
    where: { workspaceId, issueKey: 'SCRUM-9' },
  });
  const linkedBlockers = await db.pulseBlocker.count({
    where: { workspaceId, linkedIssueKey: 'SCRUM-9' },
  });
  const linkedResolutions = await db.pulseBlockerUpdate.count({
    where: {
      blocker: { workspaceId, linkedIssueKey: 'SCRUM-9' },
      newStatus: 'resolved',
    },
  });

  return {
    connectionCount: connections.length,
    connections: connections.map((c) => ({
      id: c.id,
      cloudId: c.cloudId,
      siteName: c.siteName,
      siteUrl: c.siteUrl,
      atlassianDisplayName: c.atlassianDisplayName,
      connectedAt: c.connectedAt,
      lastSyncAt: c.lastSyncAt,
    })),
    cachedIssueCount: issueCount,
    cachedMemberCount: memberCount,
    scrum9: {
      cacheExists: Boolean(scrum9Cache),
      cacheMeta: scrum9Cache,
      linkedStandupAnswerLinks: linkedStandup,
      linkedBlockers,
      linkedResolutions,
    },
  };
}

async function scrum9MemoryAudit(db, workspaceId) {
  const chunks = await db.memoryChunk.findMany({
    where: { workspaceId, linkedIssueKey: 'SCRUM-9' },
    select: {
      id: true,
      sourceType: true,
      sourceId: true,
      ownerUserId: true,
      teamId: true,
      chunkIndex: true,
    },
  });

  const bySource = {};
  for (const c of chunks) {
    bySource[c.sourceType] = (bySource[c.sourceType] || 0) + 1;
  }

  return {
    total: chunks.length,
    bySource,
    distinctSourceIds: [...new Set(chunks.map((c) => c.sourceId))],
    distinctOwners: [
      ...new Set(chunks.map((c) => c.ownerUserId).filter(Boolean)),
    ],
    distinctTeams: [...new Set(chunks.map((c) => c.teamId).filter(Boolean))],
  };
}

async function sharedDataRisks(db, workspaces) {
  const byName = Object.fromEntries(
    workspaces.map((w) => [w.slackWorkspaceName, w.id]),
  );
  const pulesId = byName['Pules project'];
  const teamPulseId = byName['TeamPulse Workspace'];
  const demoId = byName['Demo Workspace'];

  // Global uniqueness risks: slackUserId is @unique on User
  const allUsers = await db.user.findMany({
    select: {
      id: true,
      workspaceId: true,
      slackUserId: true,
      email: true,
      slackDisplayName: true,
    },
  });

  const slackIdCounts = new Map();
  for (const u of allUsers) {
    const list = slackIdCounts.get(u.slackUserId) || [];
    list.push(u);
    slackIdCounts.set(u.slackUserId, list);
  }
  const duplicateSlackUserIds = [...slackIdCounts.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([slackUserId, list]) => ({
      slackUserId,
      workspaces: list.map((u) => u.workspaceId),
    }));

  // Emails that appear in multiple workspaces (not unique in schema, but identity overlap)
  const emailMap = new Map();
  for (const u of allUsers) {
    if (!u.email) continue;
    const list = emailMap.get(u.email.toLowerCase()) || [];
    list.push(u);
    emailMap.set(u.email.toLowerCase(), list);
  }
  const crossWorkspaceEmails = [...emailMap.entries()]
    .filter(([, list]) => {
      const ws = new Set(list.map((u) => u.workspaceId));
      return ws.size > 1;
    })
    .map(([email, list]) => ({
      email,
      workspaces: [...new Set(list.map((u) => u.workspaceId))],
      count: list.length,
    }));

  // Atlassian account IDs across workspaces
  const jiraConns = await db.jiraConnection.findMany({
    select: {
      workspaceId: true,
      cloudId: true,
      atlassianAccountId: true,
      siteUrl: true,
    },
  });
  const atlassianMap = new Map();
  for (const c of jiraConns) {
    const key = `${c.cloudId}::${c.atlassianAccountId}`;
    const list = atlassianMap.get(key) || [];
    list.push(c);
    atlassianMap.set(key, list);
  }
  const crossWsAtlassian = [...atlassianMap.entries()]
    .filter(([, list]) => new Set(list.map((c) => c.workspaceId)).size > 1)
    .map(([key, list]) => ({
      key,
      workspaces: [...new Set(list.map((c) => c.workspaceId))],
    }));

  // Same Jira cloudId used by multiple workspaces
  const cloudMap = new Map();
  for (const c of jiraConns) {
    const list = cloudMap.get(c.cloudId) || [];
    list.push(c.workspaceId);
    cloudMap.set(c.cloudId, list);
  }
  const sharedCloudIds = [...cloudMap.entries()]
    .map(([cloudId, wsIds]) => ({
      cloudId,
      workspaces: [...new Set(wsIds)],
    }))
    .filter((x) => x.workspaces.length > 1);

  // Same issueKey cached in multiple workspaces
  const scrum9All = await db.jiraIssueCacheEntry.findMany({
    where: { issueKey: 'SCRUM-9' },
    select: { workspaceId: true, id: true },
  });

  return {
    note: 'User.slackUserId is globally @unique; JiraConnection.userId is @unique. Deleting a workspace deletes its Users — which frees those Slack IDs for reinstall, but does not touch other workspaces.',
    duplicateSlackUserIds,
    crossWorkspaceEmails,
    crossWorkspaceAtlassianIdentities: crossWsAtlassian,
    sharedJiraCloudIds: sharedCloudIds,
    scrum9CacheAcrossWorkspaces: scrum9All,
    focusIds: { pulesId, teamPulseId, demoId },
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

  console.log('=== 1. ALL WORKSPACES (from DB) ===');
  const workspaceSummaries = [];
  for (const w of all) {
    const [users, teams] = await Promise.all([
      prisma.user.count({ where: { workspaceId: w.id } }),
      prisma.team.count({ where: { workspaceId: w.id } }),
    ]);
    const row = {
      id: w.id,
      name: w.slackWorkspaceName,
      slackWorkspaceId: w.slackWorkspaceId,
      installedAt: w.installedAt,
      memberCount: users,
      teamCount: teams,
    };
    workspaceSummaries.push(row);
    console.log(JSON.stringify(row));
  }

  const focus = {};
  for (const name of FOCUS_NAMES) {
    const matches = all.filter((w) => w.slackWorkspaceName === name);
    if (matches.length !== 1) {
      console.error(
        `WARN: expected exactly 1 workspace named "${name}", found ${matches.length}`,
      );
    }
    if (matches[0]) focus[name] = matches[0];
  }

  console.log('\n=== 2. DATA OWNERSHIP MATRIX ===');
  const matrix = {};
  for (const name of FOCUS_NAMES) {
    const ws = focus[name];
    if (!ws) {
      matrix[name] = null;
      continue;
    }
    matrix[name] = await countByWorkspace(prisma, ws.id);
  }
  console.log(JSON.stringify(matrix, null, 2));

  console.log('\n=== 3. V2 TEAM MEMORY AUDIT ===');
  const memory = {};
  for (const name of FOCUS_NAMES) {
    const ws = focus[name];
    if (!ws) continue;
    memory[name] = await memoryAudit(prisma, ws.id);
  }
  console.log(JSON.stringify(memory, null, 2));

  console.log('\n=== 4. 366 CHUNKS OWNERSHIP ===');
  const chunkTotals = await prisma.memoryChunk.groupBy({
    by: ['workspaceId'],
    _count: { _all: true },
  });
  const chunkOwnership = [];
  for (const row of chunkTotals) {
    const ws = all.find((w) => w.id === row.workspaceId);
    const bySource = await prisma.memoryChunk.groupBy({
      by: ['sourceType'],
      where: { workspaceId: row.workspaceId },
      _count: { _all: true },
    });
    chunkOwnership.push({
      workspaceName: ws?.slackWorkspaceName ?? '(unknown)',
      workspaceId: row.workspaceId,
      chunkCount: row._count._all,
      sourceBreakdown: Object.fromEntries(
        bySource.map((s) => [s.sourceType, s._count._all]),
      ),
    });
  }
  const globalTotal = chunkOwnership.reduce((s, r) => s + r.chunkCount, 0);
  console.log(
    JSON.stringify({ globalTotal, byWorkspace: chunkOwnership }, null, 2),
  );

  console.log('\n=== 5. STANDUP ANSWER AUDIT ===');
  const standup = {};
  for (const name of FOCUS_NAMES) {
    const ws = focus[name];
    if (!ws) continue;
    standup[name] = await standupAnswerAudit(prisma, ws.id);
  }
  console.log(JSON.stringify(standup, null, 2));

  console.log('\n=== 6. JIRA AUDIT ===');
  const jira = {};
  for (const name of FOCUS_NAMES) {
    const ws = focus[name];
    if (!ws) continue;
    jira[name] = await jiraAudit(prisma, ws.id);
  }
  console.log(JSON.stringify(jira, null, 2));

  console.log('\n=== 7. SCRUM-9 MEMORY ===');
  const scrum9Mem = {};
  for (const name of FOCUS_NAMES) {
    const ws = focus[name];
    if (!ws) continue;
    scrum9Mem[name] = await scrum9MemoryAudit(prisma, ws.id);
  }
  console.log(JSON.stringify(scrum9Mem, null, 2));

  console.log('\n=== 9. SHARED / GLOBAL DATA RISKS ===');
  const risks = await sharedDataRisks(prisma, all);
  console.log(JSON.stringify(risks, null, 2));

  // Default backend fallback workspace (earliest installed)
  const earliest = all[0];
  console.log('\n=== FRONTEND / BACKEND WORKSPACE DEFAULTS ===');
  console.log(
    JSON.stringify(
      {
        earliestInstalledWorkspace: earliest
          ? {
              id: earliest.id,
              name: earliest.slackWorkspaceName,
              installedAt: earliest.installedAt,
            }
          : null,
        note: 'Frontend uses localStorage pulse.activeWorkspaceId; apiFetch sends X-Workspace-Id. Backend resolveActiveWorkspaceId prefers header, else earliest installed.',
      },
      null,
      2,
    ),
  );

  console.log('\n=== AUDIT COMPLETE (READ-ONLY) ===');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
