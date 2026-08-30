/**
 * READ-ONLY post-state verification after TeamPulse removal.
 */
const { PrismaClient, Prisma } = require('@prisma/client');
const prisma = new PrismaClient();

async function mem(db, workspaceId) {
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
    other: Object.fromEntries(
      Object.entries(map).filter(
        ([k]) =>
          !['STANDUP_ANSWER', 'BLOCKER', 'BLOCKER_RESOLUTION', 'REPORT'].includes(
            k,
          ),
      ),
    ),
  };
}

async function main() {
  const all = await prisma.workspace.findMany({
    select: {
      id: true,
      slackWorkspaceName: true,
      slackWorkspaceId: true,
      installedAt: true,
      _count: { select: { users: true, teams: true } },
    },
    orderBy: { installedAt: 'asc' },
  });

  const tpRemaining = all.filter(
    (w) => w.slackWorkspaceName === 'TeamPulse Workspace',
  );
  const pules = all.find((w) => w.slackWorkspaceName === 'Pules project');
  const demo = all.find((w) => w.slackWorkspaceName === 'Demo Workspace');

  console.log('=== WORKSPACES ===');
  console.log(JSON.stringify(all, null, 2));
  console.log('TeamPulse remaining:', tpRemaining.length);

  // Look for orphaned TeamPulse slack id
  const t000 = await prisma.workspace.findFirst({
    where: { slackWorkspaceId: 'T00000000' },
  });
  console.log('T00000000 workspace:', t000);

  if (pules) {
    const snap = {
      users: await prisma.user.count({ where: { workspaceId: pules.id } }),
      teams: await prisma.team.count({ where: { workspaceId: pules.id } }),
      answers: await prisma.answer.count({
        where: { user: { workspaceId: pules.id } },
      }),
      blockers: await prisma.pulseBlocker.count({
        where: { workspaceId: pules.id },
      }),
      resolutions: await prisma.pulseBlockerUpdate.count({
        where: { blocker: { workspaceId: pules.id }, newStatus: 'resolved' },
      }),
      digests: await prisma.aiDigest.count({
        where: { team: { workspaceId: pules.id } },
      }),
      jiraConnections: await prisma.jiraConnection.count({
        where: { workspaceId: pules.id },
      }),
      jiraCache: await prisma.jiraIssueCacheEntry.count({
        where: { workspaceId: pules.id },
      }),
      scrum9Cache: await prisma.jiraIssueCacheEntry.count({
        where: { workspaceId: pules.id, issueKey: 'SCRUM-9' },
      }),
      scrum9Chunks: await prisma.memoryChunk.count({
        where: { workspaceId: pules.id, linkedIssueKey: 'SCRUM-9' },
      }),
      memory: await mem(prisma, pules.id),
    };
    console.log('\n=== PULES ===');
    console.log(JSON.stringify(snap, null, 2));
  }

  if (demo) {
    const snap = {
      users: await prisma.user.count({ where: { workspaceId: demo.id } }),
      teams: await prisma.team.count({ where: { workspaceId: demo.id } }),
      answers: await prisma.answer.count({
        where: { user: { workspaceId: demo.id } },
      }),
      jiraConnections: await prisma.jiraConnection.count({
        where: { workspaceId: demo.id },
      }),
      jiraCache: await prisma.jiraIssueCacheEntry.count({
        where: { workspaceId: demo.id },
      }),
      memory: await mem(prisma, demo.id),
    };
    console.log('\n=== DEMO ===');
    console.log(JSON.stringify(snap, null, 2));
  }

  // Check dangling refs to known old TeamPulse id
  const OLD_TP = '09999ad5-a472-466a-89c2-a4c14744e9ab';
  const dangling = {
    User: await prisma.user.count({ where: { workspaceId: OLD_TP } }),
    Team: await prisma.team.count({ where: { workspaceId: OLD_TP } }),
    MemoryChunk: await prisma.memoryChunk.count({
      where: { workspaceId: OLD_TP },
    }),
    JiraConnection: await prisma.jiraConnection.count({
      where: { workspaceId: OLD_TP },
    }),
    teamIdRefGeneral: await prisma.pulseBlocker.count({
      where: { teamId: '00000000-0000-0000-0000-000000000001' },
    }),
    memoryTeamGeneral: await prisma.memoryChunk.count({
      where: { teamId: '00000000-0000-0000-0000-000000000001' },
    }),
  };
  console.log('\n=== Dangling / old TP id ===');
  console.log(JSON.stringify(dangling, null, 2));

  // Simulate listWorkspaces API shape
  const apiList = all.map((w) => ({
    id: w.id,
    name: w.slackWorkspaceName,
    userCount: w._count.users,
    teamCount: w._count.teams,
  }));
  console.log('\n=== API workspace list ===');
  console.log(JSON.stringify(apiList, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
