import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DEMO = 'T_DEMO_PULSE_WS';

async function main() {
  const ws = await prisma.workspace.findUnique({ where: { slackWorkspaceId: DEMO } });
  if (!ws) throw new Error('Demo missing');
  const id = ws.id;
  const users = await prisma.user.findMany({ where: { workspaceId: id }, select: { id: true } });
  const uids = users.map((u) => u.id);
  const teams = await prisma.team.findMany({ where: { workspaceId: id }, select: { id: true } });
  const tids = teams.map((t) => t.id);
  const checkIns = await prisma.checkIn.findMany({ where: { teamId: { in: tids } }, select: { id: true } });
  const cids = checkIns.map((c) => c.id);
  const runs = await prisma.standupRun.findMany({ where: { teamId: { in: tids } }, select: { id: true } });
  const rids = runs.map((r) => r.id);

  const counts = {
    Workspace: 1,
    User: users.length,
    Team: teams.length,
    TeamMember: await prisma.teamMember.count({ where: { teamId: { in: tids } } }),
    CheckIn: checkIns.length,
    CheckInParticipant: await prisma.checkInParticipant.count({ where: { checkInId: { in: cids } } }),
    Question: await prisma.question.count({ where: { checkInId: { in: cids } } }),
    StandupRun: runs.length,
    StandupSubmission: await prisma.standupSubmission.count({ where: { runId: { in: rids } } }),
    Answer: await prisma.answer.count({ where: { userId: { in: uids } } }),
    ConversationState: await prisma.conversationState.count({ where: { userId: { in: uids } } }),
    AiDigest: await prisma.aiDigest.count({ where: { teamId: { in: tids } } }),
    StandupThreadUpdate: await prisma.standupThreadUpdate.count({ where: { userId: { in: uids } } }),
    InboundEvent: await prisma.inboundEvent.count({ where: { workspaceId: id } }),
    JiraConnection: await prisma.jiraConnection.count({ where: { workspaceId: id } }),
    JiraIssueCacheEntry: await prisma.jiraIssueCacheEntry.count({ where: { userId: { in: uids } } }),
    PulseBlocker: await prisma.pulseBlocker.count({ where: { userId: { in: uids } } }),
    PulseBlockerUpdate: await prisma.pulseBlockerUpdate.count({ where: { userId: { in: uids } } }),
    BlockerFollowUpSession: await prisma.blockerFollowUpSession.count({ where: { userId: { in: uids } } }),
    JiraProposedAction: await prisma.jiraProposedAction.count({ where: { userId: { in: uids } } }),
    JiraAuditLog: await prisma.jiraAuditLog.count({ where: { userId: { in: uids } } }),
    AnswerJiraIssueLink: await prisma.answerJiraIssueLink.count({ where: { userId: { in: uids } } }),
    TeamMemoryDocument: await prisma.teamMemoryDocument.count({ where: { workspaceId: id } }),
    SlackAiChatLog: await prisma.slackAiChatLog.count({ where: { workspaceId: id } }),
  };

  const others = await prisma.workspace.findMany({
    where: { NOT: { slackWorkspaceId: DEMO } },
    select: { slackWorkspaceName: true, slackWorkspaceId: true },
  });

  const mins = {
    submissions250: counts.StandupSubmission >= 250,
    issues40: counts.JiraIssueCacheEntry >= 40,
    blockers30: counts.PulseBlocker >= 30,
    updates25: counts.PulseBlockerUpdate >= 25,
    chats100: counts.SlackAiChatLog >= 100,
    digests50: counts.AiDigest >= 50,
    memory100: counts.TeamMemoryDocument >= 100,
    audits300: counts.JiraAuditLog >= 300,
    proposed: counts.JiraProposedAction > 0,
    followups: counts.BlockerFollowUpSession > 0,
    inbound: counts.InboundEvent > 0,
  };

  console.log(JSON.stringify({ counts, mins, allPassed: Object.values(mins).every(Boolean), others }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
