/**
 * Operator CLI — Pulse V2 Phase 2C memory verification.
 *
 * Usage:
 *   npx ts-node scripts/memory-verify.ts --workspaceId=<uuid>
 *   npx ts-node scripts/memory-verify.ts --workspaceId=<uuid> --sample=10
 */
import { PrismaClient } from '@prisma/client';
import { MemoryOutboxService } from '../src/memory/memory-outbox.service';
import {
  MemoryBackfillService,
  formatVerifyReport,
} from '../src/memory/memory-backfill.service';

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const opts: Record<string, string> = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) flags.add(body);
    else opts[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return { flags, opts };
}

async function main() {
  const { flags, opts } = parseArgs(process.argv.slice(2));
  const workspaceId = opts.workspaceId?.trim();
  if (!workspaceId || flags.has('help')) {
    console.log(
      'Usage: npm run memory:verify -- --workspaceId=<uuid> [--sample=10]',
    );
    process.exit(workspaceId ? 0 : 1);
  }

  const sample = opts.sample ? Number(opts.sample) : 0;
  const prisma = new PrismaClient();
  const outbox = new MemoryOutboxService(prisma as any);
  const backfill = new MemoryBackfillService(prisma as any, outbox);

  try {
    const report = await backfill.verifyWorkspace(workspaceId);
    console.log(formatVerifyReport(report));
    if (sample > 0) {
      const rows = await backfill.sampleWorkspaceChunks(workspaceId, sample);
      console.log('\nSample chunks:');
      for (const row of rows) {
        console.log(
          `- ${row.sourceType}/${row.sourceId}#${row.chunkIndex} vis=${row.visibility} embed=${row.hasEmbedding} key=${row.linkedIssueKey ?? '-'}`,
        );
        console.log(`  preview: ${row.textPreview.replace(/\n/g, ' ').slice(0, 160)}`);
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
