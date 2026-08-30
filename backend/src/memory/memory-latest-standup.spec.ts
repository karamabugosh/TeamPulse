/**
 * Latest standup resolver + scoped retrieval integration (Pules workspace).
 * Run: npx ts-node src/memory/memory-latest-standup.spec.ts
 */
import { PrismaClient } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { LatestStandupResolverService } from '../ai/workspace/retrieval/latest-standup-resolver.service';
import { MemoryRetrievalService } from './memory-retrieval.service';
import { runWithWorkspaceId } from '../common/workspace-context';
import { detectTemporalRetrievalScope } from '../ai/workspace/retrieval/temporal-retrieval.util';

const PULES = '0e4985cc-3955-4af5-8cba-d72f25f1a8ee';
const KARAM = 'bae237ed-e53d-4c5f-88e5-6e69945103f3';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function main() {
  const prisma = new PrismaClient();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    await runWithWorkspaceId(PULES, async () => {
      const resolver = app.get(LatestStandupResolverService);
      const memory = app.get(MemoryRetrievalService);

      const q1 = 'What blocker did Karam report in the latest standup?';
      assert(detectTemporalRetrievalScope(q1) === 'LATEST_STANDUP', 'temporal intent');

      const scope = await resolver.resolve({
        workspaceId: PULES,
        temporalScope: 'LATEST_STANDUP',
        subjectUserId: KARAM,
      });
      assert(scope, 'scope resolved');
      assert(scope!.runId === 'f272e32d-e0a0-4fcc-aa64-325a880aa5bf', 'latest Karam run');
      assert(scope!.submissionId === '9d4736c4-5e94-465e-a3eb-9af878aa6410', 'submission');
      assert(scope!.scopedSourceIds.length >= 5, 'answers + blocker sources');

      const blocker = await prisma.pulseBlocker.findFirst({
        where: { id: 'e5cd3560-2dc2-4fcc-ab6f-72598d585864' },
      });
      assert(blocker?.title?.includes('slack and jira'), 'blocker title in DB');
      assert(
        blocker?.description?.toLowerCase().includes('emdings'),
        'blocker reason in DB',
      );

      const scoped = await memory.retrieve({
        workspaceId: PULES,
        userId: KARAM,
        query: q1,
        runId: scope!.runId,
        ownerUserId: KARAM,
        scopedSourceIds: scope!.scopedSourceIds,
        limit: 20,
        debug: true,
      });

      assert(scoped.evidence.length > 0, 'scoped V2 evidence returned');
      const texts = scoped.evidence.map((e) => e.text.toLowerCase()).join('\n');
      assert(texts.includes('slack and jira'), 'blocker text in scoped evidence');
      assert(!texts.includes('everything is on schedule'), 'old no-blocker text excluded');

      const unscoped = await memory.retrieve({
        workspaceId: PULES,
        userId: KARAM,
        query: q1,
        limit: 20,
      });
      const unscopedTexts = unscoped.evidence.map((e) => e.text.toLowerCase()).join('\n');
      assert(
        unscopedTexts.includes('everything is on schedule') ||
          unscoped.evidence.length > scoped.evidence.length,
        'unscoped retrieval can include older semantic matches (control)',
      );
    });

    console.log('✓ memory-latest-standup.spec.ts passed');
  } finally {
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
