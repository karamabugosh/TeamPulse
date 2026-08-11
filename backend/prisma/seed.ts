import { PrismaClient, QuestionType } from '@prisma/client';
import { WebClient } from '@slack/web-api';

const prisma = new PrismaClient();

/** Stable IDs so re-running seed is idempotent. */
const DEFAULT_TEAM_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_CHECKIN_ID = '00000000-0000-0000-0000-000000000010';

/** 12:40 PM Asia/Hebron, Monday–Friday (demo default — editable from Dashboard). */
const DEFAULT_COLLECTION_CRON = '40 12 * * 1-5';
const DEFAULT_REPORT_CRON = '0 13 * * 1-5';
const DEFAULT_TIMEZONE = 'Asia/Hebron';

const DEFAULT_QUESTIONS: Array<{ question: string; order: number; type: QuestionType }> = [
  { question: 'What did you work on yesterday?', order: 1, type: 'FREE_TEXT' },
  { question: 'What will you work on today?', order: 2, type: 'FREE_TEXT' },
  { question: 'Is anything blocking your progress?', order: 3, type: 'YES_NO' },
];

async function resolveWorkspace() {
  const botToken = process.env.SLACK_BOT_TOKEN;

  if (botToken) {
    try {
      const client = new WebClient(botToken);
      const auth = await client.auth.test();

      if (auth.team_id) {
        return prisma.workspace.upsert({
          where: { slackWorkspaceId: auth.team_id },
          update: {
            slackWorkspaceName: auth.team ?? 'Slack Workspace',
            botToken,
          },
          create: {
            slackWorkspaceId: auth.team_id,
            slackWorkspaceName: auth.team ?? 'Slack Workspace',
            botToken,
          },
        });
      }
    } catch (error) {
      console.warn('Could not connect to Slack during seed; using placeholder workspace.', error);
    }
  }

  return prisma.workspace.upsert({
    where: { slackWorkspaceId: 'T00000000' },
    update: { slackWorkspaceName: 'TeamPulse Workspace' },
    create: {
      slackWorkspaceId: 'T00000000',
      slackWorkspaceName: 'TeamPulse Workspace',
      botToken: process.env.SLACK_BOT_TOKEN || 'xoxb-placeholder-token',
    },
  });
}

async function syncSlackMembers(workspaceId: string, teamId: string) {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    console.log('SLACK_BOT_TOKEN not set — skipping Slack member sync.');
    return;
  }

  const client = new WebClient(botToken);
  const result = await client.users.list({});

  if (!result.members?.length) {
    console.log('No Slack members returned.');
    return;
  }

  const humanMembers = result.members.filter(
    (m) =>
      m &&
      !m.deleted &&
      !m.is_bot &&
      !m.is_app_user &&
      m.id !== 'USLACKBOT' &&
      m.name !== 'slackbot',
  );

  let synced = 0;

  for (const member of humanMembers) {
    if (!member.id) continue;

    const displayName =
      member.profile?.display_name?.trim() ||
      member.profile?.real_name?.trim() ||
      member.real_name ||
      member.name ||
      member.id;

    const user = await prisma.user.upsert({
      where: { slackUserId: member.id },
      update: {
        slackDisplayName: displayName,
        timezone: member.tz ?? undefined,
      },
      create: {
        workspaceId,
        slackUserId: member.id,
        slackDisplayName: displayName,
        email: member.profile?.email ?? null,
        timezone: member.tz ?? null,
      },
    });

    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId, userId: user.id } },
      update: {},
      create: { teamId, userId: user.id, role: 'member' },
    });

    synced += 1;
  }

  console.log(`Synced ${synced} Slack member(s) into team "${teamId}".`);
}

async function seedDefaultCheckIn(teamId: string) {
  const checkIn = await prisma.checkIn.upsert({
    where: { id: DEFAULT_CHECKIN_ID },
    update: {
      name: 'Daily Standup',
      description:
        'Default demo check-in — scheduled at 12:40 PM Asia/Hebron. Edit time, timezone, and days from the Dashboard.',
      introMessage:
        "👋 Good morning!\n\nIt's time for your Daily Standup.\n\nLet's get started.",
      outroMessage: 'Perfect! Your responses have been recorded successfully. ✅',
      timezone: DEFAULT_TIMEZONE,
      collectionCron: DEFAULT_COLLECTION_CRON,
      enabled: true,
      publishStatus: 'published',
      scheduleEnabled: true,
      reminderEnabled: true,
      reminderMinutesAfter: 30,
      reminderOnlyNonResponders: true,
      reportCron: DEFAULT_REPORT_CRON,
      reportTriggerMode: 'scheduled',
      updatesChannelId: process.env.SLACK_DIGEST_CHANNEL_ID || process.env.SLACK_UPDATES_CHANNEL_ID || null,
    },
    create: {
      id: DEFAULT_CHECKIN_ID,
      teamId,
      name: 'Daily Standup',
      description:
        'Default demo check-in — scheduled at 12:40 PM Asia/Hebron. Edit time, timezone, and days from the Dashboard.',
      introMessage:
        "👋 Good morning!\n\nIt's time for your Daily Standup.\n\nLet's get started.",
      outroMessage: 'Perfect! Your responses have been recorded successfully. ✅',
      timezone: DEFAULT_TIMEZONE,
      collectionCron: DEFAULT_COLLECTION_CRON,
      enabled: true,
      publishStatus: 'published',
      scheduleEnabled: true,
      reminderEnabled: true,
      reminderMinutesAfter: 30,
      reminderOnlyNonResponders: true,
      reportCron: DEFAULT_REPORT_CRON,
      reportTriggerMode: 'scheduled',
      updatesChannelId: process.env.SLACK_DIGEST_CHANNEL_ID || process.env.SLACK_UPDATES_CHANNEL_ID || null,
    },
  });

  const existingQuestionCount = await prisma.question.count({
    where: { checkInId: checkIn.id },
  });

  if (existingQuestionCount === 0) {
    for (const q of DEFAULT_QUESTIONS) {
      await prisma.question.create({
        data: {
          checkInId: checkIn.id,
          question: q.question,
          order: q.order,
          type: q.type,
          isRequired: true,
          isActive: true,
        },
      });
    }
    console.log(`Created ${DEFAULT_QUESTIONS.length} default questions for "${checkIn.name}".`);
  } else {
    console.log(`Questions already exist for "${checkIn.name}" — skipping question seed.`);
  }

  const teamMembers = await prisma.teamMember.findMany({
    where: { teamId, optedOut: false },
  });

  for (const member of teamMembers) {
    await prisma.checkInParticipant.upsert({
      where: {
        checkInId_teamMemberId: {
          checkInId: checkIn.id,
          teamMemberId: member.id,
        },
      },
      update: { isActive: true },
      create: {
        checkInId: checkIn.id,
        teamMemberId: member.id,
        isActive: true,
      },
    });
  }

  console.log(
    `Default CheckIn "${checkIn.name}" ready — ${teamMembers.length} participant(s), cron "${DEFAULT_COLLECTION_CRON}" (${DEFAULT_TIMEZONE}).`,
  );
  console.log(
    'Schedule is stored in PostgreSQL and can be changed from the Dashboard without restarting the app.',
  );

  return checkIn;
}

async function main() {
  console.log('Seeding Pulse V2 database...');

  const workspace = await resolveWorkspace();
  console.log(`Workspace: ${workspace.slackWorkspaceName} (${workspace.id})`);

  const team = await prisma.team.upsert({
    where: { id: DEFAULT_TEAM_ID },
    update: {
      name: 'General',
      timezone: DEFAULT_TIMEZONE,
      schedulerEnabled: true,
    },
    create: {
      id: DEFAULT_TEAM_ID,
      workspaceId: workspace.id,
      name: 'General',
      scheduleCron: DEFAULT_COLLECTION_CRON,
      timezone: DEFAULT_TIMEZONE,
      schedulerEnabled: true,
    },
  });

  console.log(`Team: ${team.name} (${team.id})`);

  await syncSlackMembers(workspace.id, team.id);
  await seedDefaultCheckIn(team.id);

  console.log('Database seeding complete.');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
