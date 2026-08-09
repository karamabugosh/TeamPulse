import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding TeamPulse database...');

  // 1. Create or get default workspace
  const workspace = await prisma.workspace.upsert({
    where: { slackWorkspaceId: 'T00000000' },
    update: { slackWorkspaceName: 'TeamPulse Workspace' },
    create: {
      slackWorkspaceId: 'T00000000',
      slackWorkspaceName: 'TeamPulse Workspace',
      botToken: process.env.SLACK_BOT_TOKEN || 'xoxb-placeholder-token',
    },
  });

  console.log(`Workspace ready: ${workspace.slackWorkspaceName} (${workspace.id})`);

  // 2. Create or get default team
  const team = await prisma.team.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: { name: 'General' },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      workspaceId: workspace.id,
      name: 'General',
      scheduleCron: '0 0 9 * * 0-4',
      timezone: 'Asia/Riyadh',
      schedulerEnabled: true,
    },
  });

  console.log(`Default Team ready: ${team.name} (${team.id})`);

  // 3. Seed default questions if table is empty
  const questionCount = await prisma.question.count();
  if (questionCount === 0) {
    const defaultQuestions = [
      { question: 'What did you accomplish yesterday?', order: 1, isActive: true },
      { question: 'What will you work on today?', order: 2, isActive: true },
      { question: 'Are there any blockers in your way?', order: 3, isActive: true },
    ];

    for (const q of defaultQuestions) {
      await prisma.question.create({ data: q });
    }

    console.log(`Seeded ${defaultQuestions.length} default standup questions.`);
  }

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
