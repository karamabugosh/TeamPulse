/**
 * Builds Demo Workspace rows from real Jira members (people names only).
 * Writes exclusively to T_DEMO_PULSE_WS PostgreSQL tables — never to Atlassian
 * and never to the live Slack API. Slack activity is seeded into the same
 * Standup / Answer / Conversation / SlackChannel / SlackAiChatLog tables Real uses.
 */

import { createHash } from 'crypto';
import { Prisma, PrismaClient, QuestionType } from '@prisma/client';
import type { JiraWorkspaceMember } from '../jira/jira.types';
import {
  DEMO_BOT_TOKEN,
  DEMO_CHANNEL_ID,
  DEMO_CLOUD_ID,
  DEMO_GENERAL_CHANNEL_ID,
  DEMO_MEMBER_FINGERPRINT_SOURCE,
  DEMO_PLATFORM_CHANNEL_ID,
  DEMO_PROJECT_KEY,
  DEMO_RANDOM_CHANNEL_ID,
  DEMO_SITE_URL,
  DEMO_SLACK_WORKSPACE_ID,
  DEMO_SPRINT_14,
  DEMO_TIMEZONE,
  DEMO_VACATION,
  DEMO_WORKSPACE_NAME,
} from './demo.constants';
import {
  DEMO_BLOCKER_TEMPLATES,
  DEMO_ISSUE_TEMPLATES,
  DEMO_ROLE_CYCLE,
  THREAD_DISCUSSION_SNIPPETS,
  TODAY_SNIPPETS,
  YESTERDAY_SNIPPETS,
  demoIssueLabels,
  demoIssueSprint,
  demoIssueStoryPoints,
  fillTemplate,
} from './demo-mock-templates';
import {
  DemoLiveBoard,
  bindDemoIssueAliases,
  deterministicDayOffset,
  fingerprintDemoBoard,
  rewriteDemoIssueKeys,
} from './demo-live-board';

export type DemoRosterMember = {
  key: string;
  accountId: string;
  slackUserId: string;
  name: string;
  email: string;
  role: string;
  teamRole: string;
  avatarUrl: string | null;
  username: string;
};

export type DemoBuildResult = {
  workspaceId: string;
  memberCount: number;
  fingerprint: string;
  members: Array<{ name: string; accountId: string }>;
  counts: Record<string, number>;
};

const STANDUP_DAYS = 30;
const QUESTIONS: Array<{
  key: string;
  question: string;
  order: number;
  type: QuestionType;
}> = [
  { key: 'yesterday', question: 'What did you work on yesterday?', order: 1, type: 'FREE_TEXT' },
  { key: 'today', question: 'What will you work on today?', order: 2, type: 'FREE_TEXT' },
  { key: 'blocked', question: 'Is anything blocking your progress?', order: 3, type: 'YES_NO' },
  { key: 'confidence', question: 'How confident are you about today’s plan?', order: 4, type: 'SCALE_1_5' },
];

function daysAgo(n: number, hour = 9, minute = 5): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function pick<T>(arr: T[], index: number): T {
  return arr[index % arr.length];
}

function slugify(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '.')
      .slice(0, 32) || 'member'
  );
}

function stableSlackUserId(accountId: string): string {
  const hex = createHash('sha1').update(accountId).digest('hex').slice(0, 8).toUpperCase();
  return `U0DM${hex}`;
}

export function fingerprintJiraMembers(members: JiraWorkspaceMember[]): string {
  const normalized = members
    .map((m) => `${m.accountId}|${m.displayName.trim()}`)
    .sort()
    .join('\n');
  return createHash('sha256').update(normalized).digest('hex');
}

/** @deprecated Prefer fingerprintDemoBoard — kept for status API compatibility. */
export function fingerprintDemoSource(
  members: JiraWorkspaceMember[],
  board?: DemoLiveBoard | null,
): string {
  if (board && board.issues.length > 0) {
    return fingerprintDemoBoard(members, board);
  }
  return fingerprintJiraMembers(members);
}

export function mapJiraMembersToRoster(
  jiraMembers: JiraWorkspaceMember[],
): DemoRosterMember[] {
  if (jiraMembers.length === 0) {
    throw new Error('Cannot build Demo Workspace without Jira members.');
  }

  const usedKeys = new Set<string>();
  return jiraMembers.map((member, index) => {
    let base = slugify(member.displayName) || `member${index + 1}`;
    let key = base;
    let n = 2;
    while (usedKeys.has(key)) {
      key = `${base}${n}`;
      n += 1;
    }
    usedKeys.add(key);

    const email =
      member.emailAddress?.trim() ||
      `${key.replace(/\./g, '.')}@pulsedemo.io`;

    return {
      key,
      accountId: member.accountId,
      slackUserId: stableSlackUserId(member.accountId),
      name: member.displayName.trim(),
      email,
      role: DEMO_ROLE_CYCLE[index % DEMO_ROLE_CYCLE.length],
      teamRole: index === 0 ? 'lead' : 'member',
      avatarUrl: member.avatarUrl ?? null,
      username: key,
    };
  });
}

function memberAt(
  roster: DemoRosterMember[],
  slot: number,
): DemoRosterMember {
  return roster[((slot % roster.length) + roster.length) % roster.length];
}

function issueUrl(key: string): string {
  return `${DEMO_SITE_URL}/browse/${key}`;
}

function issueIdFromKey(key: string): string {
  return `100${key.replace(/\D/g, '').padStart(2, '0')}`;
}

async function deleteDemoWorkspaceOnly(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.workspace.findUnique({
    where: { slackWorkspaceId: DEMO_SLACK_WORKSPACE_ID },
    select: { id: true },
  });
  if (!existing) return;

  const workspaceId = existing.id;
  const users = await prisma.user.findMany({
    where: { workspaceId },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  const teams = await prisma.team.findMany({
    where: { workspaceId },
    select: { id: true },
  });
  const teamIds = teams.map((t) => t.id);
  const checkIns = await prisma.checkIn.findMany({
    where: { teamId: { in: teamIds } },
    select: { id: true },
  });
  const checkInIds = checkIns.map((c) => c.id);
  const runs = await prisma.standupRun.findMany({
    where: { teamId: { in: teamIds } },
    select: { id: true },
  });
  const runIds = runs.map((r) => r.id);
  const submissions = await prisma.standupSubmission.findMany({
    where: { runId: { in: runIds } },
    select: { id: true },
  });
  const submissionIds = submissions.map((s) => s.id);

  if (userIds.length) {
    await prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { focusedSubmissionId: null },
    });
  }

  await prisma.slackAiChatLog.deleteMany({ where: { workspaceId } });
  await prisma.teamMemoryDocument.deleteMany({ where: { workspaceId } });
  await prisma.inboundEvent.deleteMany({ where: { workspaceId } });
  await prisma.knowledgeEmbedding.deleteMany({ where: { workspaceId } });
  await prisma.aiSlackExportLog.deleteMany({ where: { workspaceId } });
  await prisma.aiEvalResult.deleteMany({ where: { run: { workspaceId } } });
  await prisma.aiEvalRun.deleteMany({ where: { workspaceId } });
  await prisma.aiEvalCase.deleteMany({ where: { workspaceId } });
  await prisma.aiConversation.deleteMany({ where: { workspaceId } });
  await prisma.slackChannel.deleteMany({ where: { workspaceId } });
  await prisma.slackMemberCache.deleteMany({ where: { workspaceId } });
  await prisma.jiraMemberCache.deleteMany({ where: { workspaceId } });
  await prisma.jiraIssueCacheEntry.deleteMany({ where: { workspaceId } });
  await prisma.pulseBlocker.deleteMany({ where: { workspaceId } });
  await prisma.jiraAuditLog.deleteMany({ where: { workspaceId } });
  await prisma.answerJiraIssueLink.deleteMany({ where: { workspaceId } });

  if (userIds.length) {
    await prisma.jiraProposedAction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.pulseBlockerUpdate.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.jiraConnection.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.blockerFollowUpSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.standupThreadUpdate.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.conversationState.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.answer.deleteMany({ where: { userId: { in: userIds } } });
  }

  if (submissionIds.length) {
    await prisma.standupSubmission.deleteMany({ where: { id: { in: submissionIds } } });
  }
  if (runIds.length) {
    await prisma.aiDigest.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.standupRun.deleteMany({ where: { id: { in: runIds } } });
  }
  if (checkInIds.length) {
    await prisma.question.deleteMany({ where: { checkInId: { in: checkInIds } } });
    await prisma.checkInParticipant.deleteMany({ where: { checkInId: { in: checkInIds } } });
    await prisma.checkIn.deleteMany({ where: { id: { in: checkInIds } } });
  }
  if (teamIds.length) {
    await prisma.teamMember.deleteMany({ where: { teamId: { in: teamIds } } });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
  }
  if (userIds.length) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  await prisma.workspace.delete({ where: { id: workspaceId } });
}

export async function readDemoMemberFingerprint(
  prisma: PrismaClient,
): Promise<string | null> {
  const demo = await prisma.workspace.findUnique({
    where: { slackWorkspaceId: DEMO_SLACK_WORKSPACE_ID },
    select: { id: true },
  });
  if (!demo) return null;
  const doc = await prisma.teamMemoryDocument.findFirst({
    where: {
      workspaceId: demo.id,
      sourceId: DEMO_MEMBER_FINGERPRINT_SOURCE,
    },
    select: { content: true },
  });
  return doc?.content?.trim() || null;
}

/**
 * Regenerate Demo Workspace from Live Jira members + issues.
 * Issue keys/summaries/assignees come from Live Jira when provided.
 * Slack / Memory / Reports / Blockers narrative remain synthetic but rewrite
 * legacy SCRUM-* placeholders onto real keys.
 */
export async function buildDemoWorkspaceFromJiraMembers(
  prisma: PrismaClient,
  jiraMembers: JiraWorkspaceMember[],
  liveBoard?: DemoLiveBoard | null,
): Promise<DemoBuildResult> {
  const roster = mapJiraMembersToRoster(jiraMembers);
  const board: DemoLiveBoard = liveBoard ?? {
    siteUrl: DEMO_SITE_URL,
    projects: [{ key: DEMO_PROJECT_KEY, name: 'Pulse Demo' }],
    issues: [],
  };
  const fingerprint = fingerprintDemoSource(jiraMembers, board);
  const aliases = bindDemoIssueAliases(board.issues);
  const rewrite = aliases?.rewrite ?? {};

  // Prefer Live Jira issues; fall back to templates only if Live returned none.
  type SeedIssue = {
    key: string;
    summary: string;
    status: string;
    issueType: string;
    priority: string;
    assigneeKey: string;
    issueId: string;
    projectKey: string;
    projectName: string;
    issueUrl: string | null;
    assigneeAccountId: string | null;
    assigneeName: string | null;
    jiraUpdatedAt: Date;
  };

  const accountToRosterKey = new Map(
    roster.map((m) => [m.accountId, m.key] as const),
  );

  let issues: SeedIssue[];
  if (board.issues.length > 0) {
    issues = board.issues.map((live, index) => {
      const rosterKey =
        (live.assigneeAccountId
          ? accountToRosterKey.get(live.assigneeAccountId)
          : undefined) ?? memberAt(roster, index).key;
      const assigneeMember =
        roster.find((m) => m.key === rosterKey) ?? memberAt(roster, index);
      return {
        key: live.key,
        summary: live.summary,
        status: live.status ?? 'To Do',
        issueType: live.issueType ?? 'Task',
        priority: live.priority ?? 'Medium',
        assigneeKey: rosterKey,
        issueId: live.id,
        projectKey: live.projectKey ?? DEMO_PROJECT_KEY,
        projectName: live.projectName ?? 'Pulse Demo',
        issueUrl: live.issueUrl,
        assigneeAccountId: live.assigneeAccountId ?? assigneeMember.accountId,
        assigneeName: live.assignee ?? assigneeMember.name,
        jiraUpdatedAt: live.updatedAt
          ? new Date(live.updatedAt)
          : daysAgo(deterministicDayOffset(live.key, 20)),
      };
    });
  } else {
    issues = DEMO_ISSUE_TEMPLATES.map((tpl) => ({
      ...tpl,
      assigneeKey: memberAt(roster, tpl.assigneeSlot).key,
      issueId: issueIdFromKey(tpl.key),
      projectKey: DEMO_PROJECT_KEY,
      projectName: 'Pulse Demo',
      issueUrl: issueUrl(tpl.key),
      assigneeAccountId: null,
      assigneeName: null,
      jiraUpdatedAt: daysAgo(deterministicDayOffset(tpl.key, 20)),
    }));
  }
  const issueByKey = new Map(issues.map((i) => [i.key, i]));

  const rw = (text: string) => rewriteDemoIssueKeys(text, rewrite);
  const liveKey = (legacy: string) => rewrite[legacy] ?? legacy;

  await deleteDemoWorkspaceOnly(prisma);

  // Keep Demo out of default workspace selection (future installedAt)
  const installedAt = new Date();
  installedAt.setFullYear(installedAt.getFullYear() + 50);

  const workspace = await prisma.workspace.create({
    data: {
      slackWorkspaceId: DEMO_SLACK_WORKSPACE_ID,
      slackWorkspaceName: DEMO_WORKSPACE_NAME,
      botToken: DEMO_BOT_TOKEN,
      installedAt,
    },
  });

  const userByKey = new Map<
    string,
    { id: string; name: string; slackUserId: string; accountId: string }
  >();

  for (const member of roster) {
    const user = await prisma.user.create({
      data: {
        workspaceId: workspace.id,
        slackUserId: member.slackUserId,
        slackDisplayName: member.name,
        email: member.email,
        timezone: DEMO_TIMEZONE,
      },
    });
    await prisma.$executeRaw`
      UPDATE "User"
      SET "slackRealName" = ${member.name},
          "slackAvatarUrl" = ${member.avatarUrl}
      WHERE id = ${user.id}
    `;
    userByKey.set(member.key, {
      id: user.id,
      name: member.name,
      slackUserId: member.slackUserId,
      accountId: member.accountId,
    });

    await prisma.slackMemberCache.upsert({
      where: {
        workspaceId_slackUserId: {
          workspaceId: workspace.id,
          slackUserId: member.slackUserId,
        },
      },
      create: {
        workspaceId: workspace.id,
        slackUserId: member.slackUserId,
        displayName: member.name,
        realName: member.name,
        email: member.email,
        isBot: false,
        deleted: false,
      },
      update: {
        displayName: member.name,
        realName: member.name,
        email: member.email,
        isBot: false,
        deleted: false,
      },
    });

    await prisma.jiraMemberCache.upsert({
      where: {
        workspaceId_accountId: {
          workspaceId: workspace.id,
          accountId: member.accountId,
        },
      },
      create: {
        workspaceId: workspace.id,
        accountId: member.accountId,
        displayName: member.name,
        email: member.email,
        avatarUrl: member.avatarUrl,
        accountType: 'atlassian',
        active: true,
      },
      update: {
        displayName: member.name,
        email: member.email,
        avatarUrl: member.avatarUrl,
        accountType: 'atlassian',
        active: true,
      },
    });
  }

  const engTeam = await prisma.team.create({
    data: {
      workspaceId: workspace.id,
      name: 'Pulse Demo Engineering',
      slackChannelId: DEMO_CHANNEL_ID,
      scheduleCron: '5 9 * * *',
      timezone: DEMO_TIMEZONE,
      // Demo never calls live Slack — disable schedulers that would post via Web API.
      schedulerEnabled: false,
    },
  });

  // Slack channels live in the same SlackChannel table Real can use (no fake Slack API).
  await prisma.slackChannel.createMany({
    data: [
      {
        workspaceId: workspace.id,
        slackChannelId: DEMO_GENERAL_CHANNEL_ID,
        name: 'general',
        topic: 'Company-wide announcements',
        purpose: 'Default open channel for the Demo Workspace',
        memberCount: roster.length,
      },
      {
        workspaceId: workspace.id,
        slackChannelId: DEMO_CHANNEL_ID,
        name: 'eng-standup',
        topic: 'Daily engineering standup thread',
        purpose: 'Standup runs, blockers, and sprint chatter',
        memberCount: roster.length,
      },
      {
        workspaceId: workspace.id,
        slackChannelId: DEMO_PLATFORM_CHANNEL_ID,
        name: 'platform-sync',
        topic: 'Cross-team platform sync',
        purpose: 'Platform and infrastructure updates',
        memberCount: Math.min(5, roster.length),
      },
      {
        workspaceId: workspace.id,
        slackChannelId: DEMO_RANDOM_CHANNEL_ID,
        name: 'random',
        topic: 'Watercooler',
        purpose: 'Non-work chat',
        memberCount: roster.length,
      },
    ],
  });

  const engMemberIds = new Map<string, string>();
  for (const member of roster) {
    const tm = await prisma.teamMember.create({
      data: {
        teamId: engTeam.id,
        userId: userByKey.get(member.key)!.id,
        role: member.teamRole,
      },
    });
    engMemberIds.set(member.key, tm.id);
  }

  const engCheckIn = await prisma.checkIn.create({
    data: {
      teamId: engTeam.id,
      name: 'Daily Standup',
      description: 'Demo Engineering daily standup — members from connected Jira',
      introMessage: 'Daily standup — share yesterday, today, and blockers.',
      outroMessage: 'Thanks — standup complete.',
      enabled: true,
      timezone: DEMO_TIMEZONE,
      collectionCron: '5 9 * * *',
      updatesChannelId: DEMO_CHANNEL_ID,
      reportCron: '30 9 * * *',
      reportTriggerMode: 'scheduled',
      publishStatus: 'published',
      scheduleEnabled: true,
    },
  });

  const questionByKey = new Map<string, string>();
  for (const q of QUESTIONS) {
    const created = await prisma.question.create({
      data: {
        checkInId: engCheckIn.id,
        question: q.question,
        order: q.order,
        type: q.type,
        isRequired: true,
        isActive: true,
      },
    });
    questionByKey.set(q.key, created.id);
  }

  for (const member of roster) {
    await prisma.checkInParticipant.create({
      data: {
        checkInId: engCheckIn.id,
        teamMemberId: engMemberIds.get(member.key)!,
        isActive: true,
      },
    });
  }

  // Platform team = first min(5, N) members
  const platformRoster = roster.slice(0, Math.min(5, roster.length));
  const platTeam = await prisma.team.create({
    data: {
      workspaceId: workspace.id,
      name: 'Pulse Demo Platform',
      slackChannelId: DEMO_PLATFORM_CHANNEL_ID,
      scheduleCron: '0 10 * * 1,4',
      timezone: DEMO_TIMEZONE,
      schedulerEnabled: false,
    },
  });
  const platMemberIds = new Map<string, string>();
  for (const member of platformRoster) {
    const tm = await prisma.teamMember.create({
      data: {
        teamId: platTeam.id,
        userId: userByKey.get(member.key)!.id,
        role: member.teamRole,
      },
    });
    platMemberIds.set(member.key, tm.id);
  }
  const platCheckIn = await prisma.checkIn.create({
    data: {
      teamId: platTeam.id,
      name: 'Platform Sync',
      description: 'Cross-cutting platform standup',
      introMessage: 'Platform sync — share cross-team blockers.',
      outroMessage: 'Thanks — sync complete.',
      enabled: true,
      timezone: DEMO_TIMEZONE,
      collectionCron: '0 10 * * 1,4',
      updatesChannelId: DEMO_PLATFORM_CHANNEL_ID,
      reportCron: '15 10 * * 1,4',
      reportTriggerMode: 'scheduled',
      publishStatus: 'published',
      scheduleEnabled: true,
    },
  });
  const platQuestions = new Map<string, string>();
  for (const q of QUESTIONS) {
    const created = await prisma.question.create({
      data: {
        checkInId: platCheckIn.id,
        question: q.question,
        order: q.order,
        type: q.type,
        isRequired: true,
        isActive: true,
      },
    });
    platQuestions.set(q.key, created.id);
  }
  for (const member of platformRoster) {
    await prisma.checkInParticipant.create({
      data: {
        checkInId: platCheckIn.id,
        teamMemberId: platMemberIds.get(member.key)!,
        isActive: true,
      },
    });
  }

  // Fake Demo-only Jira connections (no real tokens) for first 3 roster members
  for (const member of roster.slice(0, Math.min(3, roster.length))) {
    const u = userByKey.get(member.key)!;
    await prisma.jiraConnection.create({
      data: {
        userId: u.id,
        workspaceId: workspace.id,
        cloudId: DEMO_CLOUD_ID,
        siteName: 'Pulse Demo',
        siteUrl: DEMO_SITE_URL,
        atlassianAccountId: member.accountId,
        atlassianDisplayName: member.name,
        accessToken: `demo-access-token-${member.key}`,
        refreshToken: `demo-refresh-token-${member.key}`,
        scopes: 'read:jira-work,write:jira-work,read:jira-user,offline_access',
        lastSyncAt: daysAgo(0, 8, 0),
      },
    });
  }

  // Issue cache: one row per Live (or template) issue for the Demo workspace.
  const cacheRows: Prisma.JiraIssueCacheEntryCreateManyInput[] = [];
  for (const issue of issues) {
    const assignee = userByKey.get(issue.assigneeKey)!;
    cacheRows.push({
      workspaceId: workspace.id,
      userId: assignee.id,
      issueKey: issue.key,
      issueId: issue.issueId,
      summary: issue.summary,
      status: issue.status,
      projectKey: issue.projectKey,
      projectName: issue.projectName,
      issueType: issue.issueType,
      priority: issue.priority,
      issueUrl: issue.issueUrl ?? `${board.siteUrl.replace(/\/$/, '')}/browse/${issue.key}`,
      assigneeAccountId: issue.assigneeAccountId ?? assignee.accountId,
      assigneeName: issue.assigneeName ?? assignee.name,
      jiraUpdatedAt: issue.jiraUpdatedAt,
    });
  }
  await prisma.jiraIssueCacheEntry.createMany({ data: cacheRows });

  const lead = roster[0];
  const frontend = memberAt(roster, 1);
  const backend = memberAt(roster, 2);
  const heroKey = liveKey('SCRUM-8');
  const depKey = liveKey('SCRUM-12');

  // Status history narrative bound to Live hero/dependency keys
  const narrative = [
    { issueKey: heroKey, from: 'To Do', to: 'In Progress', dayOffset: 20, actor: frontend, note: rw(`${frontend.name} started work on ${heroKey}.`) },
    { issueKey: heroKey, from: 'In Progress', to: 'Blocked', dayOffset: 16, actor: frontend, note: rw(`${frontend.name} blocked waiting on ${depKey}.`) },
    { issueKey: heroKey, from: 'Blocked', to: 'In Progress', dayOffset: 9, actor: backend, note: rw(`${backend.name} unblocked ${depKey}; ${frontend.name} resumed ${heroKey}.`) },
    { issueKey: heroKey, from: 'In Progress', to: 'In Review', dayOffset: 7, actor: frontend, note: rw(`${frontend.name} moved ${heroKey} to Review.`) },
    { issueKey: depKey, from: 'In Progress', to: 'Blocked', dayOffset: 15, actor: backend, note: rw(`${depKey} blocked ${frontend.name} on ${heroKey}.`) },
  ];

  let auditCount = 0;
  for (const step of narrative) {
    await prisma.jiraAuditLog.create({
      data: {
        workspaceId: workspace.id,
        userId: userByKey.get(step.actor.key)!.id,
        actionType: 'status_change',
        jiraIssueKey: step.issueKey,
        status: 'recorded',
        metadata: {
          from: step.from,
          to: step.to,
          note: step.note,
          projectKey: DEMO_PROJECT_KEY,
        },
        createdAt: daysAgo(step.dayOffset, 11, 0),
      },
    });
    auditCount += 1;
  }

  // Extra audit noise
  for (let i = 0; i < 80; i++) {
    const issue = pick(issues, i);
    const actor = pick(roster, i + 3);
    await prisma.jiraAuditLog.create({
      data: {
        workspaceId: workspace.id,
        userId: userByKey.get(actor.key)!.id,
        actionType: i % 4 === 0 ? 'comment' : 'status_change',
        jiraIssueKey: issue.key,
        status: 'recorded',
        metadata: {
          summary: issue.summary,
          status: issue.status,
          actor: actor.name,
        },
        createdAt: daysAgo(i % 28, 10 + (i % 6), i % 50),
      },
    });
    auditCount += 1;
  }

  const vacationMember = memberAt(roster, DEMO_VACATION.memberSlot);
  let submissionCount = 0;
  let answerCount = 0;
  let threadUpdateCount = 0;
  let jiraLinkCount = 0;
  let digestCount = 0;
  const engRunIds: string[] = [];

  const seedStandupDay = async (opts: {
    teamId: string;
    checkInId: string;
    channelId: string;
    dayOffset: number;
    members: DemoRosterMember[];
    questions: Map<string, string>;
    includeDigest: boolean;
  }) => {
    const { teamId, checkInId, channelId, dayOffset, members, questions, includeDigest } = opts;
    const scheduledFor = daysAgo(dayOffset, 9, 5);
    const threadTs = `${Math.floor(scheduledFor.getTime() / 1000)}.${channelId.slice(-4)}${String(dayOffset).padStart(4, '0')}`;
    const isFriday = scheduledFor.getDay() === 5;
    const isMonday = scheduledFor.getDay() === 1;

    const run = await prisma.standupRun.create({
      data: {
        teamId,
        checkInId,
        scheduledFor,
        status: 'completed',
        triggerSource: 'scheduler',
        startedAt: scheduledFor,
        completedAt: daysAgo(dayOffset, 9, 45),
        slackChannelId: channelId,
        slackThreadTs: threadTs,
        slackRootMessageTs: threadTs,
        slackThreadUrl: `https://pulsedemo.slack.com/archives/${channelId}/p${threadTs.replace('.', '')}`,
        threadReplyCount: 4 + (dayOffset % 4),
        reportDueAt: daysAgo(dayOffset, 9, 30),
        reportGeneratedAt: daysAgo(dayOffset, 9, 32),
        reportStatus: 'posted',
        reminderCount: dayOffset % 4 === 0 ? 1 : 0,
      },
    });
    engRunIds.push(run.id);

    for (const [memberIndex, member] of members.entries()) {
      const user = userByKey.get(member.key)!;
      const onPto =
        member.key === vacationMember.key &&
        dayOffset <= DEMO_VACATION.fromDayOffset &&
        dayOffset >= DEMO_VACATION.toDayOffset;
      const assigned = issues.filter((i) => i.assigneeKey === member.key);
      const focus = assigned[memberIndex % Math.max(assigned.length, 1)] ?? pick(issues, memberIndex + dayOffset);

      const submission = await prisma.standupSubmission.create({
        data: {
          runId: run.id,
          userId: user.id,
          status: 'completed',
          slackDmChannelId: `D_DEMO_${member.slackUserId.replace(/^U0DM/, '').slice(0, 8)}`,
          startedAt: daysAgo(dayOffset, 9, 8 + memberIndex),
          completedAt: daysAgo(dayOffset, 9, 15 + memberIndex),
          createdAt: daysAgo(dayOffset, 9, 8 + memberIndex),
        },
      });
      submissionCount += 1;

      await prisma.conversationState.create({
        data: {
          userId: user.id,
          submissionId: submission.id,
          isCompleted: true,
          startedAt: daysAgo(dayOffset, 9, 8 + memberIndex),
          completedAt: daysAgo(dayOffset, 9, 15 + memberIndex),
          currentQuestionId: null,
        },
      });

      const yesterdayText = onPto
        ? 'Out of office / PTO'
        : fillTemplate(pick(YESTERDAY_SNIPPETS, dayOffset + memberIndex), {
            issue: focus.key,
            summary: focus.summary,
          });
      const todayText = onPto
        ? 'Continuing PTO'
        : fillTemplate(pick(TODAY_SNIPPETS, dayOffset + memberIndex + 1), {
            issue: focus.key,
            status: focus.status,
          });
      const isBlocked =
        !onPto &&
        (focus.status === 'Blocked' ||
          (focus.key === heroKey && dayOffset <= 16 && dayOffset >= 9));

      const answers: Array<{ q: string; value: string }> = [
        { q: 'yesterday', value: yesterdayText },
        { q: 'today', value: todayText },
        { q: 'blocked', value: isBlocked ? 'yes' : 'no' },
        {
          q: 'confidence',
          value: String(3 + ((dayOffset + memberIndex) % 3)),
        },
      ];

      for (const a of answers) {
        const answer = await prisma.answer.create({
          data: {
            submissionId: submission.id,
            questionId: questions.get(a.q)!,
            userId: user.id,
            text: a.value,
            structuredValue: { value: a.value },
            createdAt: daysAgo(dayOffset, 9, 10 + memberIndex),
          },
        });
        answerCount += 1;

        if (a.q === 'yesterday' || a.q === 'today') {
          await prisma.answerJiraIssueLink.create({
            data: {
              workspaceId: workspace.id,
              userId: user.id,
              submissionId: submission.id,
              runId: run.id,
              questionId: questions.get(a.q)!,
              answerId: answer.id,
              issueId: issueIdFromKey(focus.key),
              issueKey: focus.key,
              summary: focus.summary,
              status: focus.status,
              assigneeName: userByKey.get(focus.assigneeKey)!.name,
              projectKey: DEMO_PROJECT_KEY,
              issueUrl: issueUrl(focus.key),
              cloudId: DEMO_CLOUD_ID,
              capturedAt: daysAgo(dayOffset, 9, 10 + memberIndex),
            },
          });
          jiraLinkCount += 1;
        }
      }

      await prisma.standupThreadUpdate.create({
        data: {
          runId: run.id,
          userId: user.id,
          type: 'submission',
          slackMessageTs: `${Math.floor(scheduledFor.getTime() / 1000)}.${100 + memberIndex}`,
          content: `${member.name}: ${yesterdayText} / ${todayText}${isBlocked ? ' (blocked)' : ''}`,
          createdAt: daysAgo(dayOffset, 9, 16 + memberIndex),
        },
      });
      threadUpdateCount += 1;
    }

    for (let i = 0; i < 3 + (dayOffset % 3); i++) {
      const speaker = pick(members, dayOffset + i);
      await prisma.standupThreadUpdate.create({
        data: {
          runId: run.id,
          userId: userByKey.get(speaker.key)!.id,
          type: 'discussion',
          slackMessageTs: `${Math.floor(scheduledFor.getTime() / 1000)}.${200 + i}`,
          content: pick(THREAD_DISCUSSION_SNIPPETS, dayOffset * 10 + i),
          createdAt: daysAgo(dayOffset, 9, 20 + i),
        },
      });
      threadUpdateCount += 1;
    }

    if (includeDigest) {
      const openIssues = issues.filter((i) => i.status === 'Blocked' || i.status === 'In Progress');
      const reportKind =
        dayOffset === 1
          ? 'executive'
          : isFriday
            ? 'sprint'
            : isMonday
              ? 'weekly'
              : 'daily';
      const summary =
        reportKind === 'executive'
          ? rw(`Executive brief: delivery on track except path (${heroKey} ${frontend.name} / ${depKey} ${backend.name}).`)
          : reportKind === 'sprint'
            ? rw(`${DEMO_SPRINT_14.name} checkpoint: ${issues.filter((i) => i.status === 'Done').length} Done. ${heroKey} owned by ${frontend.name}; dependency work by ${backend.name}.`)
            : reportKind === 'weekly'
              ? `Weekly digest: ${members.length} participants. Focus issues: ${openIssues.slice(0, 3).map((i) => i.key).join(', ')}.`
              : `Daily standup complete — ${members.length}/${members.length} responded.`;

      await prisma.aiDigest.create({
        data: {
          teamId,
          runId: run.id,
          generatedAt: daysAgo(dayOffset, 9, 32),
          source: 'ai',
          summary,
          blockers: openIssues.slice(0, 5).map((i) => ({
            memberName: userByKey.get(i.assigneeKey)!.name,
            description: i.summary,
            severity: i.priority,
            issueKey: i.key,
          })),
          themes: [
            { theme: 'Jira OAuth stability', count: 3 },
            { theme: `report_kind:${reportKind}`, count: 1 },
          ],
          reportSections: [
            { id: 'summary', title: `${reportKind} summary`, body: summary },
            {
              id: 'people',
              title: 'People',
              body: members.map((m) => `- ${m.name} (${m.role})`).join('\n'),
            },
          ],
          slackReportText: `*${reportKind} report*\n${summary}`,
        },
      });
      digestCount += 1;
    }
  };

  for (let dayOffset = STANDUP_DAYS - 1; dayOffset >= 0; dayOffset -= 1) {
    await seedStandupDay({
      teamId: engTeam.id,
      checkInId: engCheckIn.id,
      channelId: DEMO_CHANNEL_ID,
      dayOffset,
      members: roster,
      questions: questionByKey,
      includeDigest: true,
    });
  }

  const platformOffsets = [1, 3, 5, 8, 10, 12, 15, 17, 19, 22, 24, 26, 28];
  for (const dayOffset of platformOffsets.slice(0, 12)) {
    await seedStandupDay({
      teamId: platTeam.id,
      checkInId: platCheckIn.id,
      channelId: DEMO_PLATFORM_CHANNEL_ID,
      dayOffset,
      members: platformRoster,
      questions: platQuestions,
      includeDigest: dayOffset % 2 === 0,
    });
  }

  // Blockers — synthetic narrative, but linked to Live issue keys
  let blockerCount = 0;
  let blockerUpdateCount = 0;
  for (const tpl of DEMO_BLOCKER_TEMPLATES) {
    const owner = memberAt(roster, tpl.ownerSlot);
    const resolver =
      tpl.resolvedBySlot !== undefined
        ? memberAt(roster, tpl.resolvedBySlot)
        : null;
    const linkedKey = liveKey(tpl.linkedIssueKey);
    const description = rw(
      fillTemplate(tpl.descriptionTemplate, {
        owner: owner.name,
        resolver: resolver?.name ?? '',
      }),
    );
    const blocker = await prisma.pulseBlocker.create({
      data: {
        workspaceId: workspace.id,
        userId: userByKey.get(owner.key)!.id,
        teamId: engTeam.id,
        checkInId: engCheckIn.id,
        title: rw(tpl.title),
        description,
        category: tpl.category,
        severity: tpl.severity,
        preventingAllWork: tpl.severity === 'critical',
        ownerLabel: owner.name,
        status: tpl.status === 'monitoring' ? 'open' : tpl.status,
        linkedIssueKey: linkedKey,
        linkedIssueId:
          issueByKey.get(linkedKey)?.issueId ?? issueIdFromKey(linkedKey),
        linkedIssueUrl:
          issueByKey.get(linkedKey)?.issueUrl ??
          `${board.siteUrl.replace(/\/$/, '')}/browse/${linkedKey}`,
        resolutionNotes:
          tpl.status === 'resolved'
            ? `Resolved by ${resolver?.name ?? owner.name}`
            : undefined,
        resolutionType: tpl.status === 'resolved' ? 'fixed' : undefined,
        needsHelp: tpl.severity === 'critical' || tpl.severity === 'high',
        createdAt: daysAgo(tpl.dayOffset, 10, 0),
        resolvedAt:
          tpl.resolveDayOffset !== undefined
            ? daysAgo(tpl.resolveDayOffset, 15, 0)
            : null,
      },
    });
    blockerCount += 1;

    if (tpl.withUpdate) {
      await prisma.pulseBlockerUpdate.create({
        data: {
          blockerId: blocker.id,
          userId: userByKey.get((resolver ?? owner).key)!.id,
          previousStatus: 'open',
          newStatus: tpl.status === 'resolved' ? 'resolved' : 'open',
          notes:
            tpl.status === 'resolved'
              ? `Resolved by ${resolver?.name ?? owner.name}.`
              : rw(
                  `Update from ${owner.name}: still tracking ${tpl.linkedIssueKey}.`,
                ),
          resolutionType: tpl.status === 'resolved' ? 'fixed' : undefined,
          updatedFrom: 'Slack Follow-up',
          daysOpen:
            tpl.resolveDayOffset !== undefined
              ? tpl.dayOffset - tpl.resolveDayOffset
              : tpl.dayOffset,
          createdAt: daysAgo(
            tpl.resolveDayOffset ?? Math.max(tpl.dayOffset - 2, 0),
            14,
            0,
          ),
        },
      });
      blockerUpdateCount += 1;
    }
  }

  // Team memory
  const memoryDocs: Prisma.TeamMemoryDocumentCreateManyInput[] = [
    {
      workspaceId: workspace.id,
      sourceType: 'ai_summary',
      sourceId: DEMO_MEMBER_FINGERPRINT_SOURCE,
      title: 'Jira member fingerprint',
      content: fingerprint,
      metadata: {
        memberCount: roster.length,
        members: roster.map((m) => ({
          name: m.name,
          accountId: m.accountId,
        })),
      },
    },
  ];

  for (const issue of issues) {
    const assignee = userByKey.get(issue.assigneeKey)!;
    const reporter = userByKey.get(lead.key)!;
    memoryDocs.push({
      workspaceId: workspace.id,
      userId: assignee.id,
      sourceType: 'jira_link',
      sourceId: `demo-jira-${issue.key}`,
      title: `${issue.key}: ${issue.summary}`,
      content: `Jira ${issue.key} (${issue.status}, ${issue.priority}). Assignee: ${assignee.name}. Reporter: ${reporter.name}. Story points: ${demoIssueStoryPoints(issue.key)}. Sprint: ${demoIssueSprint(issue.status, issue.key)}. Labels: ${demoIssueLabels(issue.status).join(', ')}.`,
      issueKey: issue.key,
      metadata: {
        assignee: assignee.name,
        accountId: assignee.accountId,
        storyPoints: demoIssueStoryPoints(issue.key),
        sprint: demoIssueSprint(issue.status, issue.key),
      },
    });
  }

  memoryDocs.push(
    {
      workspaceId: workspace.id,
      userId: userByKey.get(frontend.key)!.id,
      sourceType: 'ai_summary',
      sourceId: 'demo-scrum-8-delay-reason',
      title: rw('Why SCRUM-8 was delayed'),
      content: rw(
        `SCRUM-8 is owned by ${frontend.name}. It was delayed because ${frontend.name} was blocked waiting for the OAuth callback owned by ${backend.name} (SCRUM-12). ${lead.name} tracked marketplace/legal review on SCRUM-33.`,
      ),
      issueKey: heroKey,
      metadata: { assignee: frontend.name },
    },
    {
      workspaceId: workspace.id,
      sourceType: 'ai_summary',
      sourceId: 'demo-oauth-owners',
      title: 'Who worked on key issues',
      content: rw(
        `Owners: ${frontend.name} (SCRUM-8), ${backend.name} (SCRUM-12), ${lead.name} (SCRUM-33).`,
      ),
      issueKey: heroKey,
      metadata: { topic: 'delivery' },
    },
    {
      workspaceId: workspace.id,
      sourceType: 'report',
      sourceId: 'demo-sprint-14-summary',
      title: `${DEMO_SPRINT_14.name} — summary`,
      content: rw(
        `${DEMO_SPRINT_14.name} focused on delivery (${frontend.name}/${backend.name}). SCRUM-8 delayed then moved to Review. ${vacationMember.name} was on PTO mid-sprint.`,
      ),
      metadata: { sprint: DEMO_SPRINT_14.name },
    },
  );

  for (const member of roster) {
    const load = issues.filter((i) => i.assigneeKey === member.key);
    memoryDocs.push({
      workspaceId: workspace.id,
      userId: userByKey.get(member.key)!.id,
      sourceType: 'standup_answer',
      sourceId: `demo-standup-profile-${member.key}`,
      title: `${member.name} — role & workload`,
      content: `${member.name} is ${member.role}. Assigned mock issues: ${load.map((i) => i.key).join(', ') || 'none'}.`,
      metadata: {
        role: member.role,
        accountId: member.accountId,
        issues: load.map((i) => i.key),
      },
    });
  }

  await prisma.teamMemoryDocument.createMany({ data: memoryDocs });

  // AI conversations with real roster names (web AI history — same table as Real)
  const conversations = [
    {
      title: 'Why is SCRUM-8 delayed?',
      userKey: lead.key,
      turns: [
        {
          role: 'user' as const,
          content: 'Why is SCRUM-8 delayed?',
        },
        {
          role: 'assistant' as const,
          content: `SCRUM-8 is owned by ${frontend.name}. It slipped because ${frontend.name} was blocked on the OAuth callback owned by ${backend.name} (SCRUM-12), plus marketplace/legal review tracked by ${lead.name} on SCRUM-33.`,
        },
        {
          role: 'user' as const,
          content: `Is ${backend.name} unblocked now?`,
        },
        {
          role: 'assistant' as const,
          content: `${backend.name} moved SCRUM-12 forward; ${frontend.name} resumed SCRUM-8 and it is now In Review.`,
        },
      ],
    },
    {
      title: 'Who owns SCRUM-8?',
      userKey: backend.key,
      turns: [
        {
          role: 'user' as const,
          content: 'Who owns SCRUM-8?',
        },
        {
          role: 'assistant' as const,
          content: `SCRUM-8 is assigned to ${frontend.name}. Status: In Review. Summary: Ship Atlassian OAuth consent + marketplace copy.`,
        },
      ],
    },
    {
      title: 'Which blockers are still open?',
      userKey: frontend.key,
      turns: [
        {
          role: 'user' as const,
          content: 'Which blockers are still open?',
        },
        {
          role: 'assistant' as const,
          content: `Open high/critical blockers include work owned by ${backend.name} (SCRUM-12), ${memberAt(roster, 5).name} (SCRUM-20/32), ${memberAt(roster, 4).name} (SCRUM-31), and ${lead.name} (SCRUM-33).`,
        },
      ],
    },
    {
      title: 'Summarize Sprint 14',
      userKey: lead.key,
      turns: [
        {
          role: 'user' as const,
          content: 'Summarize Sprint 14.',
        },
        {
          role: 'assistant' as const,
          content: `Sprint 14 centered on OAuth (${frontend.name} / ${backend.name}). Several Done tickets landed; SCRUM-8 moved to In Review after the callback fix. ${vacationMember.name} was on PTO mid-sprint.`,
        },
        {
          role: 'user' as const,
          content: `What did ${vacationMember.name} miss?`,
        },
        {
          role: 'assistant' as const,
          content: `${vacationMember.name} was on PTO mid-sprint. Catch-up items: OAuth callback landing on SCRUM-12 and the SCRUM-8 review handoff.`,
        },
      ],
    },
    {
      title: 'Standup summary for engineering',
      userKey: lead.key,
      turns: [
        {
          role: 'user' as const,
          content: 'Summarize yesterday’s engineering standup.',
        },
        {
          role: 'assistant' as const,
          content: `Engineering standup covered ${frontend.name} on SCRUM-8, ${backend.name} on SCRUM-12, and open blockers for ${memberAt(roster, 4).name}. Thread updates are in #eng-standup.`,
        },
      ],
    },
  ];

  let conversationCount = 0;
  for (const [idx, conv] of conversations.entries()) {
    const createdAt = daysAgo(idx + 1, 15, 10);
    await prisma.aiConversation.create({
      data: {
        workspaceId: workspace.id,
        userId: userByKey.get(conv.userKey)!.id,
        title: conv.title,
        preview: conv.turns.find((t) => t.role === 'assistant')?.content.slice(0, 120) ?? conv.title,
        createdAt,
        updatedAt: createdAt,
        messages: {
          create: conv.turns.map((turn, turnIdx) => ({
            role: turn.role,
            content: turn.content,
            intent: turn.role === 'assistant' ? 'WORKSPACE_QA' : null,
            confidence: turn.role === 'assistant' ? 'High' : null,
            createdAt: new Date(createdAt.getTime() + turnIdx * 45_000),
          })),
        },
      },
    });
    conversationCount += 1;
  }

  // Slack AI chat samples — realistic channel Q&A with roster names (same SlackAiChatLog as Real)
  const slackChatScripts = [
    {
      asker: lead,
      channelId: DEMO_CHANNEL_ID,
      question: `Hey team — who can take a look at SCRUM-8 with ${frontend.name}?`,
      answer: `SCRUM-8 is assigned to ${frontend.name} (In Review). ${backend.name} unblocked the OAuth callback on SCRUM-12 earlier this sprint.`,
    },
    {
      asker: frontend,
      channelId: DEMO_CHANNEL_ID,
      question: `Any update from ${backend.name} on SCRUM-12?`,
      answer: `${backend.name} has SCRUM-12 in progress. It was the blocker for ${frontend.name}'s OAuth consent work.`,
    },
    {
      asker: backend,
      channelId: DEMO_PLATFORM_CHANNEL_ID,
      question: 'What blockers are still open for platform?',
      answer: `Open blockers include items owned by ${backend.name} and ${lead.name}. Check Pulse blockers for linked SCRUM keys.`,
    },
    {
      asker: lead,
      channelId: DEMO_GENERAL_CHANNEL_ID,
      question: `Is ${vacationMember.name} back from PTO?`,
      answer: `${vacationMember.name} was on PTO mid-sprint. Catch-up standup answers are in the Demo Workspace history.`,
    },
  ];

  let chatCount = 0;
  for (const [i, script] of slackChatScripts.entries()) {
    await prisma.slackAiChatLog.create({
      data: {
        workspaceId: workspace.id,
        userId: userByKey.get(script.asker.key)!.id,
        slackUserId: script.asker.slackUserId,
        channelId: script.channelId,
        threadTs: `${Math.floor(daysAgo(i + 2).getTime() / 1000)}.ask${i}`,
        question: script.question,
        answer: script.answer,
        sources: [{ type: 'standup' }, { type: 'jira' }],
        confidence: 'High',
        intent: 'workspace_qa',
        conversationId: `demo-slack-thread-${i}`,
        responseTimeMs: 420 + i * 40,
        createdAt: daysAgo(i + 2, 14, 20),
      },
    });
    chatCount += 1;
  }

  for (let i = 0; i < Math.min(24, roster.length * 4); i++) {
    const member = pick(roster, i);
    const issue = pick(issues, i);
    const channelId =
      i % 3 === 0
        ? DEMO_PLATFORM_CHANNEL_ID
        : i % 3 === 1
          ? DEMO_GENERAL_CHANNEL_ID
          : DEMO_CHANNEL_ID;
    await prisma.slackAiChatLog.create({
      data: {
        workspaceId: workspace.id,
        userId: userByKey.get(member.key)!.id,
        slackUserId: member.slackUserId,
        channelId,
        threadTs: `${Math.floor(daysAgo(i % 20).getTime() / 1000)}.chat${i}`,
        question: `${member.name}: what is the status of ${issue.key}?`,
        answer: `${issue.key} (“${issue.summary}”) is assigned to ${userByKey.get(issue.assigneeKey)!.name} with status ${issue.status}.`,
        sources: [{ type: 'jira', key: issue.key }],
        confidence: 'High',
        intent: 'workspace_qa',
        conversationId: `demo-conv-${Math.floor(i / 4)}`,
        responseTimeMs: 500,
        createdAt: daysAgo(i % 20, 14, i % 40),
      },
    });
    chatCount += 1;
  }

  // Inbound timeline events (stored Slack/Jira event log — Demo never receives live Socket Mode)
  let inboundCount = 0;
  for (let i = 0; i < 60; i++) {
    await prisma.inboundEvent.create({
      data: {
        workspaceId: workspace.id,
        provider: i % 3 === 0 ? 'jira' : 'slack',
        idempotencyKey: `demo-inbound-${DEMO_SLACK_WORKSPACE_ID}-${i}`,
        externalEventId: `evt_demo_${i}`,
        eventType: i % 3 === 0 ? 'jira:issue_updated' : 'message.channels',
        payloadHash: `hash_demo_${i}`,
        status: 'processed',
        receivedAt: daysAgo(i % 25, 8, i % 50),
        processedAt: daysAgo(i % 25, 8, (i % 50) + 1),
      },
    });
    inboundCount += 1;
  }

  return {
    workspaceId: workspace.id,
    memberCount: roster.length,
    fingerprint,
    members: roster.map((m) => ({ name: m.name, accountId: m.accountId })),
    counts: {
      users: roster.length,
      slackChannels: 4,
      issues: issues.length,
      issueCacheRows: cacheRows.length,
      submissions: submissionCount,
      answers: answerCount,
      digests: digestCount,
      blockers: blockerCount,
      blockerUpdates: blockerUpdateCount,
      memoryDocs: memoryDocs.length,
      conversations: conversationCount,
      chatLogs: chatCount,
      audits: auditCount,
      threads: threadUpdateCount,
      jiraLinks: jiraLinkCount,
      inboundEvents: inboundCount,
    },
  };
}

export { deleteDemoWorkspaceOnly };
