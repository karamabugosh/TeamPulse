const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const CHECKIN_ID = '100ad622-479d-5133-9e08-1e9f344b5bd2';

async function main() {
  const active = await prisma.question.findMany({
    where: { checkInId: CHECKIN_ID, retiredAt: null },
    orderBy: { order: 'asc' },
  });
  console.log(`Active config (${active.length}):`);
  active.forEach((q, i) => {
    console.log(
      `${i + 1}. ${q.question} | ${q.type} | active=${q.isActive} | required=${q.isRequired} | order=${q.order} | id=${q.id}`,
    );
  });
  const retired = await prisma.question.count({
    where: { checkInId: CHECKIN_ID, retiredAt: { not: null } },
  });
  console.log(`Retired (historical, hidden from editor): ${retired}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
