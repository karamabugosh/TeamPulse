/**
 * Operator CLI — Pulse V2 Phase 2C historical memory backfill.
 *
 * Usage:
 *   npx ts-node scripts/memory-backfill.ts --workspaceId=<uuid> --dry-run
 *   npx ts-node scripts/memory-backfill.ts --workspaceId=<uuid> --enqueue --limit=50
 *   npx ts-node scripts/memory-backfill.ts --workspaceId=<uuid> --enqueue --retryFailed --limit=20
 *   npx ts-node scripts/memory-backfill.ts --workspaceId=<uuid> --enqueue --repairInconsistent --limit=20
 *
 * Dry-run is read-only. Mutation requires explicit --enqueue.
 * Does not wait for the Phase 2B worker / OpenAI embeddings.
 */
import { PrismaClient } from '@prisma/client';
import { MemoryOutboxService } from '../src/memory/memory-outbox.service';
import {
  MemoryBackfillService,
  formatBackfillDryRun,
} from '../src/memory/memory-backfill.service';
import { MEMORY_SOURCE_TYPES, MemorySourceType } from '../src/memory/memory-source.constants';

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

function printHelp() {
  console.log(`Pulse V2 memory backfill

Required:
  --workspaceId=<uuid>

Mode (exactly one):
  --dry-run          Read-only analysis (default-safe)
  --enqueue          Create bounded PENDING UPSERT outbox events

Optional:
  --limit=N          Max events to enqueue (default: BACKFILL_BATCH_SIZE or 50)
  --batchSize=N      Same as limit when limit omitted
  --sourceTypes=A,B  Subset of STANDUP_ANSWER,BLOCKER,BLOCKER_RESOLUTION,REPORT
  --retryFailed      Include FAILED sources (default: skip)
  --repairInconsistent  Include COMPLETED-without-chunks (default: skip)

Examples:
  npm run memory:backfill -- --workspaceId=... --dry-run
  npm run memory:backfill -- --workspaceId=... --enqueue --limit=50
`);
}

async function main() {
  const { flags, opts } = parseArgs(process.argv.slice(2));
  if (flags.has('help') || flags.has('h') || Object.keys(opts).length + flags.size === 0) {
    printHelp();
    process.exit(flags.has('help') || flags.has('h') ? 0 : 1);
  }

  const workspaceId = opts.workspaceId?.trim();
  if (!workspaceId) {
    console.error('Error: --workspaceId is required');
    printHelp();
    process.exit(1);
  }

  const dryRun = flags.has('dry-run');
  const enqueue = flags.has('enqueue');
  if (dryRun === enqueue) {
    console.error('Error: specify exactly one of --dry-run or --enqueue');
    printHelp();
    process.exit(1);
  }

  let sourceTypes: MemorySourceType[] | undefined;
  if (opts.sourceTypes) {
    sourceTypes = opts.sourceTypes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean) as MemorySourceType[];
    for (const t of sourceTypes) {
      if (!MEMORY_SOURCE_TYPES.includes(t)) {
        console.error(`Error: unsupported sourceType ${t}`);
        process.exit(1);
      }
    }
  }

  const limit = opts.limit ? Number(opts.limit) : undefined;
  const batchSize = opts.batchSize ? Number(opts.batchSize) : undefined;
  if ((limit != null && !Number.isFinite(limit)) || (batchSize != null && !Number.isFinite(batchSize))) {
    console.error('Error: --limit / --batchSize must be numbers');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const outbox = new MemoryOutboxService(prisma as any);
  const backfill = new MemoryBackfillService(prisma as any, outbox);

  try {
    if (dryRun) {
      const report = await backfill.analyzeWorkspace(workspaceId, {
        sourceTypes,
        onlyMissing: true,
        retryFailed: flags.has('retryFailed'),
        repairInconsistent: flags.has('repairInconsistent'),
      });
      console.log(formatBackfillDryRun(report));
      console.log('\n(no database writes)');
      return;
    }

    const result = await backfill.enqueueWorkspace(workspaceId, {
      sourceTypes,
      limit: limit ?? batchSize,
      batchSize,
      onlyMissing: true,
      retryFailed: flags.has('retryFailed'),
      repairInconsistent: flags.has('repairInconsistent'),
    });
    console.log(`Workspace: ${result.workspaceName} (${result.workspaceId})`);
    console.log(`Enqueued: ${result.enqueued}`);
    console.log(`Skipped inFlight: ${result.skippedInFlight}`);
    console.log(`Skipped indexed: ${result.skippedIndexed}`);
    console.log(`Skipped failed: ${result.skippedFailed}`);
    console.log(`Skipped inconsistent: ${result.skippedInconsistent}`);
    console.log(`By type: ${JSON.stringify(result.bySourceType)}`);
    console.log(
      '\nEvents are PENDING. Run the Nest app (Phase 2B worker) or processPendingBatch separately. Use: npm run memory:verify -- --workspaceId=...',
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
