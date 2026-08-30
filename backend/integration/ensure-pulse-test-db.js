/**
 * Creates `pulse_test` if missing, then pushes the Prisma schema to that
 * database only. Never connects to `teampulse` (development/demo).
 */
const { spawnSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const ADMIN_URL = 'postgresql://postgres:postgres@localhost:5432/postgres';
const TEST_URL =
  'postgresql://postgres:postgres@localhost:5432/pulse_test?schema=public';
const TEST_DB = 'pulse_test';

async function ensureDatabase() {
  const admin = new PrismaClient({
    datasources: { db: { url: ADMIN_URL } },
  });

  try {
    const rows = await admin.$queryRawUnsafe(
      `SELECT 1 AS ok FROM pg_database WHERE datname = '${TEST_DB}'`,
    );
    if (rows.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE ${TEST_DB}`);
      console.log(`created ${TEST_DB}`);
    } else {
      console.log(`${TEST_DB} already exists`);
    }
  } finally {
    await admin.$disconnect();
  }
}

function pushSchema() {
  const result = spawnSync(
    'npx',
    ['prisma', 'db', 'push', '--skip-generate'],
    {
      env: { ...process.env, DATABASE_URL: TEST_URL },
      stdio: 'inherit',
      shell: true,
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

ensureDatabase()
  .then(pushSchema)
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
