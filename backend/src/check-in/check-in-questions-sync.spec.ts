/**
 * CheckIn question configuration persistence — regression tests.
 *
 * Run: npx ts-node src/check-in/check-in-questions-sync.spec.ts
 */
import { PrismaClient, QuestionType } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CheckInService } from './check-in.service';
import { runWithWorkspaceId } from '../common/workspace-context';

const PULES_WORKSPACE_ID = '0e4985cc-3955-4af5-8cba-d72f25f1a8ee';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function main() {
  console.log('check-in-questions-sync.spec.ts');

  const prisma = new PrismaClient();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const checkInService = app.get(CheckInService);

  const team = await prisma.team.findFirst({
    where: { workspaceId: PULES_WORKSPACE_ID },
  });
  assert(team, 'Pules team must exist');

  let createdCheckInId: string | null = null;
  let historicalQuestionId: string | null = null;

  try {
    await runWithWorkspaceId(PULES_WORKSPACE_ID, async () => {
      const created = await checkInService.create({
        teamId: team.id,
        name: `Question Sync Test ${Date.now()}`,
        timezone: 'UTC',
        collectionCron: '0 9 * * 1-5',
        questions: [
          {
            question: 'Original Q1',
            order: 1,
            type: QuestionType.FREE_TEXT,
            isRequired: true,
            isActive: true,
          },
          {
            question: 'Original Q2',
            order: 2,
            type: QuestionType.FREE_TEXT,
            isRequired: true,
            isActive: true,
          },
        ],
      });

      createdCheckInId = created!.id;
      const q1Id = created!.questions[0].id;
      const q2Id = created!.questions[1].id;
      historicalQuestionId = q1Id;

      await prisma.answer.create({
        data: {
          questionId: q1Id,
          userId: (
            await prisma.user.findFirst({ where: { workspaceId: PULES_WORKSPACE_ID } })
          )!.id,
          text: 'historical answer',
        },
      });

      const updated = await checkInService.update(createdCheckInId, {
        questions: [
          {
            id: q1Id,
            question: 'Edited Q1 text',
            order: 1,
            type: QuestionType.BLOCKER,
            isRequired: false,
            isActive: true,
          },
          {
            question: 'Brand new Q3',
            order: 2,
            type: QuestionType.FREE_TEXT,
            isRequired: true,
            isActive: false,
          },
        ],
      });

      assert(updated, 'update must return check-in');
      assert(updated!.questions.length === 2, 'config exposes two non-retired questions');
      assert(
        updated!.questions.some((q) => q.id === q1Id && q.question === 'Edited Q1 text'),
        'edited question keeps stable id and text',
      );
      assert(
        updated!.questions.find((q) => q.id === q1Id)?.type === QuestionType.BLOCKER,
        'type change persists',
      );
      assert(
        updated!.questions.find((q) => q.id === q1Id)?.isRequired === false,
        'required toggle persists',
      );
      assert(
        updated!.questions.some((q) => q.question === 'Brand new Q3' && q.isActive === false),
        'disabled new question stays in config',
      );

      const q2After = await prisma.question.findUnique({ where: { id: q2Id } });
      assert(q2After === null, 'removed question without answers should be hard deleted');

      const historical = await prisma.question.findUnique({
        where: { id: q1Id },
        include: { _count: { select: { answers: true } } },
      });
      assert(historical?._count.answers === 1, 'historical answers preserved');

      const reloaded = await checkInService.findOne(createdCheckInId);
      assert(
        !reloaded.questions.some((q) => q.id === q2Id),
        'retired/deleted questions must not appear in edit API',
      );

      const reordered = await checkInService.update(createdCheckInId, {
        questions: [
          {
            id: updated!.questions.find((q) => q.question === 'Brand new Q3')!.id,
            question: 'Brand new Q3',
            order: 1,
            type: QuestionType.FREE_TEXT,
            isRequired: true,
            isActive: true,
          },
          {
            id: q1Id,
            question: 'Edited Q1 text',
            order: 2,
            type: QuestionType.BLOCKER,
            isRequired: false,
            isActive: true,
          },
        ],
      });
      assert(reordered!.questions[0].order === 1, 'reorder persists for first question');
      assert(reordered!.questions[1].order === 2, 'reorder persists for second question');

      const otherCheckIn = await checkInService.create({
        teamId: team.id,
        name: `Unrelated CheckIn ${Date.now()}`,
        timezone: 'UTC',
        collectionCron: '0 9 * * 1-5',
        questions: [
          {
            question: 'Unrelated question',
            order: 1,
            type: QuestionType.FREE_TEXT,
            isRequired: true,
            isActive: true,
          },
        ],
      });

      await checkInService.update(createdCheckInId, {
        questions: reordered!.questions.map((q) => ({
          id: q.id,
          question: q.question,
          order: q.order,
          type: q.type,
          isRequired: q.isRequired,
          isActive: q.isActive,
        })),
      });

      const unrelatedReload = await checkInService.findOne(otherCheckIn!.id);
      assert(
        unrelatedReload.questions.length === 1 &&
          unrelatedReload.questions[0].question === 'Unrelated question',
        'unrelated check-in unchanged',
      );

      await checkInService.remove(otherCheckIn!.id);
    });

    console.log('✓ All check-in question sync regression tests passed');
  } finally {
    if (createdCheckInId) {
      await runWithWorkspaceId(PULES_WORKSPACE_ID, async () => {
        try {
          await checkInService.remove(createdCheckInId!);
        } catch {
          // best-effort cleanup
        }
      });
    }
    await app.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
