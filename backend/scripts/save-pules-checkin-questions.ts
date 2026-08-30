/**
 * Persist target question configuration via CheckInService (same path as PATCH /api/check-ins/:id).
 *
 * Run: npx ts-node scripts/save-pules-checkin-questions.ts
 */
import { QuestionType } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CheckInService } from '../src/check-in/check-in.service';
import { runWithWorkspaceId } from '../src/common/workspace-context';

const PULES_WORKSPACE_ID = '0e4985cc-3955-4af5-8cba-d72f25f1a8ee';
const CHECKIN_ID = '100ad622-479d-5133-9e08-1e9f344b5bd2';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const checkInService = app.get(CheckInService);

  await runWithWorkspaceId(PULES_WORKSPACE_ID, async () => {
    const existing = await checkInService.findOne(CHECKIN_ID);
    console.log('Loaded config questions (non-retired):', existing.questions.length);

    const byOrder = [...existing.questions].sort((a, b) => a.order - b.order);
    const [q1, q2, q3, q4] = byOrder;

    const updated = await checkInService.update(CHECKIN_ID, {
      questions: [
        {
          id: q1?.id,
          question: 'What did you complete since your last update?',
          type: QuestionType.FREE_TEXT,
          isRequired: true,
          isActive: true,
          order: 1,
        },
        {
          id: q2?.id,
          question: 'What are you working on now?',
          type: QuestionType.FREE_TEXT,
          isRequired: true,
          isActive: true,
          order: 2,
        },
        {
          id: q3?.id,
          question: 'Is anything blocking your progress?',
          type: QuestionType.BLOCKER,
          isRequired: true,
          isActive: true,
          order: 3,
        },
        {
          id: q4?.id,
          question: 'What are you planning to work on next?',
          type: QuestionType.FREE_TEXT,
          isRequired: true,
          isActive: true,
          order: 4,
        },
        {
          question: 'Is there anything the team should know or help you with?',
          type: QuestionType.FREE_TEXT,
          isRequired: false,
          isActive: true,
          order: 5,
        },
      ],
    });

    console.log('\nSaved questions:');
    updated!.questions.forEach((q, i) => {
      console.log(
        `${i + 1}. [${q.id}] ${q.question} | ${q.type} | active=${q.isActive} | required=${q.isRequired} | order=${q.order}`,
      );
    });

    const reloaded = await checkInService.findOne(CHECKIN_ID);
    console.log('\nReloaded config question count:', reloaded.questions.length);
  });

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
