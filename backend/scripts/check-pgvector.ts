import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ extname: string }>>(
      `SELECT extname FROM pg_extension WHERE extname = 'vector'`,
    );
    console.log('pgvector_installed', rows.length > 0, rows);

    try {
      await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
      console.log('create_extension_ok');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log('create_extension_failed', message);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
