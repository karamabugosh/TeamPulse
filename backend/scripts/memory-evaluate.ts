/**
 * Operator CLI — Pulse V2 Phase 3C evaluation (read-only vs Ask mode).
 * Does NOT mutate MEMORY_V2_ASK_MODE.
 *
 * Usage:
 *   npm run memory:evaluate -- --workspaceId=<uuid>
 *   npm run memory:evaluate -- --workspaceId=<uuid> --userId=<uuid>
 */
import { PrismaClient } from '@prisma/client';
import {
  createMemoryV2EvaluationStack,
} from '../src/memory/memory-v2-evaluation.service';
import { formatEvaluationReport } from '../src/memory/memory-v2-readiness.service';

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
      'Usage: npm run memory:evaluate -- --workspaceId=<uuid> [--userId=<uuid>]',
    );
    console.log('Does NOT change MEMORY_V2_ASK_MODE.');
    process.exit(workspaceId ? 0 : 1);
  }

  const prisma = new PrismaClient();
  try {
    const { evaluation, vector } = createMemoryV2EvaluationStack(prisma);
    await vector.detectBackend();
    const report = await evaluation.runWorkspaceEvaluation({
      prisma,
      workspaceId,
      userId: opts.userId?.trim(),
    });
    console.log(formatEvaluationReport(report));
    if (report.readiness.overall === 'BLOCKED') process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
