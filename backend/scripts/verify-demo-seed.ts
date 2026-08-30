import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const ws = await prisma.workspace.findUnique({
    where: { slackWorkspaceId: 'T_DEMO_PULSE_WS' },
  });
  if (!ws) {
    console.error('Demo Workspace MISSING');
    process.exit(1);
  }

  const teams = await prisma.team.findMany({
    where: { workspaceId: ws.id },
    select: { id: true, name: true },
  });
  const teamIds = teams.map((t) => t.id);
  const users = await prisma.user.findMany({
    where: { workspaceId: ws.id },
    select: { slackDisplayName: true, email: true },
  });
  const runs = await prisma.standupRun.count({ where: { teamId: { in: teamIds } } });
  const subs = await prisma.standupSubmission.count({
    where: { run: { teamId: { in: teamIds } } },
  });
  const blockers = await prisma.pulseBlocker.count({
    where: { user: { workspaceId: ws.id } },
  });
  const updates = await prisma.pulseBlockerUpdate.count({
    where: { user: { workspaceId: ws.id } },
  });
  const issueKeys = await prisma.jiraIssueCacheEntry.findMany({
    where: { user: { workspaceId: ws.id } },
    distinct: ['issueKey'],
    select: { issueKey: true, assigneeName: true, status: true },
  });
  const scrum8 = issueKeys.find((i) => i.issueKey === 'SCRUM-8');
  const digests = await prisma.aiDigest.count({ where: { teamId: { in: teamIds } } });
  const memory = await prisma.teamMemoryDocument.count({ where: { workspaceId: ws.id } });
  const chats = await prisma.slackAiChatLog.count({ where: { workspaceId: ws.id } });
  const other = await prisma.workspace.findMany({
    where: { NOT: { slackWorkspaceId: 'T_DEMO_PULSE_WS' } },
    select: { slackWorkspaceName: true, slackWorkspaceId: true },
  });

  const checks = {
    workspaceName: ws.slackWorkspaceName === 'Demo Workspace',
    teams2: teams.length === 2,
    members7: users.length === 7,
    issues40: issueKeys.length === 40,
    subs220: subs === 220,
    blockers30: blockers === 30,
    updates25: updates === 25,
    scrum8Sara: scrum8?.assigneeName === 'Sara Alami' && scrum8?.status === 'In Review',
    hasEngineering: teams.some((t) => t.name === 'Pulse Demo Engineering'),
    hasPlatform: teams.some((t) => t.name === 'Pulse Demo Platform'),
  };

  console.log(
    JSON.stringify(
      {
        workspace: { name: ws.slackWorkspaceName, id: ws.id },
        teams: teams.map((t) => t.name),
        users: users.map((u) => u.slackDisplayName),
        runs,
        subs,
        blockers,
        updates,
        distinctIssues: issueKeys.length,
        scrum8,
        digests,
        memory,
        chats,
        otherWorkspaces: other,
        checks,
        allPassed: Object.values(checks).every(Boolean),
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
