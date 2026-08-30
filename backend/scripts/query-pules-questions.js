const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const pules = await prisma.workspace.findFirst({
    where: { slackWorkspaceName: 'Pules project' },
  });
  if (!pules) {
    console.log('No Pules workspace');
    return;
  }
  console.log('Workspace:', pules.id, pules.slackWorkspaceName);
  const teams = await prisma.team.findMany({ where: { workspaceId: pules.id } });
  console.log('Teams:', JSON.stringify(teams.map((t) => ({ id: t.id, name: t.name }))));
  for (const team of teams) {
    const checkIns = await prisma.checkIn.findMany({
      where: { teamId: team.id },
      select: { id: true, name: true },
    });
    for (const ci of checkIns) {
      const questions = await prisma.question.findMany({
        where: { checkInId: ci.id },
        orderBy: { order: 'asc' },
        select: {
          id: true,
          checkInId: true,
          question: true,
          type: true,
          isActive: true,
          isRequired: true,
          order: true,
          retiredAt: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { answers: true } },
        },
      });
      console.log('\n=== CheckIn:', ci.name, '(' + ci.id + ') ===');
      questions.forEach((q, i) => {
        console.log(
          JSON.stringify({
            idx: i + 1,
            id: q.id,
            checkInId: q.checkInId,
            question: q.question,
            type: q.type,
            isActive: q.isActive,
            isRequired: q.isRequired,
            order: q.order,
            retiredAt: q.retiredAt ? q.retiredAt.toISOString() : null,
            answerCount: q._count.answers,
            createdAt: q.createdAt.toISOString(),
            updatedAt: q.updatedAt.toISOString(),
          }),
        );
      });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
