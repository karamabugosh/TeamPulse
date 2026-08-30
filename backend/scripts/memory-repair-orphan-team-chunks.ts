/**
 * Repair MemoryChunk rows whose TEAM teamId does not belong to the chunk workspace.
 * Remaps onto a valid workspace team when available; else WORKSPACE.
 * Does not weaken ACL — only fixes cross-workspace / orphan team references.
 *
 * Usage: npx ts-node scripts/memory-repair-orphan-team-chunks.ts [--workspace <id>]
 */
import { PrismaClient, MemoryVisibility } from '@prisma/client';

async function main() {
  const args = process.argv.slice(2);
  const wsIdx = args.indexOf('--workspace');
  const workspaceFilter =
    wsIdx >= 0 ? args[wsIdx + 1]?.trim() : process.env.PULSE_TEST_WORKSPACE_ID?.trim();

  const prisma = new PrismaClient();
  const candidates = await prisma.$queryRawUnsafe<
    Array<{ id: string; workspaceId: string; teamId: string | null }>
  >(
    `SELECT mc.id, mc."workspaceId", mc."teamId"
     FROM "MemoryChunk" mc
     LEFT JOIN "Team" t ON t.id = mc."teamId"
     WHERE mc."visibility" = 'TEAM'
       AND (
         mc."teamId" IS NULL
         OR t.id IS NULL
         OR t."workspaceId" <> mc."workspaceId"
       )
       ${workspaceFilter ? 'AND mc."workspaceId" = $1' : ''}`,
    ...(workspaceFilter ? [workspaceFilter] : []),
  );

  console.log(
    `orphan TEAM chunks to repair: ${candidates.length}${
      workspaceFilter ? ` (workspace=${workspaceFilter})` : ''
    }`,
  );

  const byWs = new Map<string, string[]>();
  for (const c of candidates) {
    const list = byWs.get(c.workspaceId) ?? [];
    list.push(c.id);
    byWs.set(c.workspaceId, list);
  }

  let repaired = 0;
  for (const [workspaceId, ids] of byWs) {
    const team = await prisma.team.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    if (team) {
      const r = await prisma.memoryChunk.updateMany({
        where: { id: { in: ids } },
        data: { teamId: team.id, visibility: MemoryVisibility.TEAM },
      });
      repaired += r.count;
      console.log(
        `workspace=${workspaceId} → TEAM ${team.name} (${team.id}) count=${r.count}`,
      );
    } else {
      const r = await prisma.memoryChunk.updateMany({
        where: { id: { in: ids } },
        data: { teamId: null, visibility: MemoryVisibility.WORKSPACE },
      });
      repaired += r.count;
      console.log(`workspace=${workspaceId} → WORKSPACE count=${r.count}`);
    }
  }

  console.log(`repaired: ${repaired}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
