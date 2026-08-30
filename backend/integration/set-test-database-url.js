/**
 * Pin Prisma to pulse_test BEFORE any test file imports PrismaClient.
 * Refuses to run against teampulse or any other database name.
 */
const TEST_URL =
  process.env.DATABASE_URL_TEST ||
  'postgresql://postgres:postgres@localhost:5432/pulse_test?schema=public';

function databaseName(url) {
  const parsed = new URL(url);
  return decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0]);
}

const name = databaseName(TEST_URL);
if (name !== 'pulse_test') {
  throw new Error(
    `Refusing to run integration tests against database "${name}". Expected pulse_test.`,
  );
}

process.env.DATABASE_URL = TEST_URL;
process.env.DATABASE_URL_TEST = TEST_URL;
