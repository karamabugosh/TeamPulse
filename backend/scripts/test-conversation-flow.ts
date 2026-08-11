import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CollectionService } from '../src/collection/collection.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const collection = app.get(CollectionService);
  const prisma = app.get(PrismaService);

  const slackUserId = `flow-test-${Date.now()}`;
  const workspace = await prisma.workspace.findFirst();
  if (!workspace) throw new Error('No workspace');

  const user = await prisma.user.create({
    data: {
      workspaceId: workspace.id,
      slackUserId,
      slackDisplayName: 'Flow Test User',
    },
  });

  const checkIn = await prisma.checkIn.findFirst({
    include: {
      questions: { where: { isActive: true }, orderBy: { order: 'asc' } },
      participants: { take: 1, include: { teamMember: true } },
    },
  });
  if (!checkIn || checkIn.questions.length < 3) {
    throw new Error(
      `Need a check-in with 3+ active questions, found ${checkIn?.questions.length ?? 0}`,
    );
  }

  const run = await prisma.standupRun.create({
    data: {
      teamId: checkIn.teamId,
      checkInId: checkIn.id,
      scheduledFor: new Date(),
      status: 'collecting',
      triggerSource: 'manual',
    },
  });

  const submission = await prisma.standupSubmission.create({
    data: {
      runId: run.id,
      userId: user.id,
      status: 'pending',
      slackDmChannelId: 'DTEST123',
      slackDmThreadTs: '1000.0001',
    },
  });

  await prisma.conversationState.create({
    data: {
      userId: user.id,
      submissionId: submission.id,
      currentQuestionId: checkIn.questions[0].id,
      isCompleted: false,
    },
  });

  console.log(`Testing ${checkIn.questions.length} questions for check-in "${checkIn.name}"`);

  for (let i = 0; i < checkIn.questions.length; i += 1) {
    const expected = await collection.getCurrentQuestionForSubmission(submission.id);
    const q = checkIn.questions[i];
    console.log(`Step ${i + 1}: expected=${expected?.questionId} actual=${q.id} text=${q.question.slice(0, 30)}`);

    if (!expected || expected.questionId !== q.id) {
      throw new Error(`Question mismatch at step ${i + 1}`);
    }

    const answerForType = (question: typeof q, index: number): string => {
      switch (question.type) {
        case 'YES_NO':
          return 'No';
        case 'YES_NO_MAYBE':
          return 'Maybe';
        case 'SCALE_1_5':
          return '3';
        case 'MULTIPLE_CHOICE': {
          const options = Array.isArray(question.options)
            ? question.options.filter((option): option is string => typeof option === 'string')
            : [];
          return options[0] ?? 'on track';
        }
        default:
          return `Answer ${index + 1}`;
      }
    };

    const next = await collection.submitAnswer(
      slackUserId,
      q.id,
      answerForType(q, i),
      submission.id,
    );

    console.log(`  Answer saved. Next question: ${next?.questionId ?? 'NONE (complete)'}`);

    if (i < checkIn.questions.length - 1 && !next) {
      throw new Error(`Expected another question after step ${i + 1}`);
    }
    if (i === checkIn.questions.length - 1 && next) {
      throw new Error('Expected completion after final question');
    }
  }

  const state = await prisma.conversationState.findUnique({
    where: { submissionId: submission.id },
  });
  console.log('Final state:', {
    isCompleted: state?.isCompleted,
    currentQuestionId: state?.currentQuestionId,
  });

  const answerCount = await prisma.answer.count({ where: { submissionId: submission.id } });
  console.log(`Answers saved: ${answerCount}/${checkIn.questions.length}`);
  console.log('OK: Full conversation flow passed');

  await prisma.answer.deleteMany({ where: { submissionId: submission.id } });
  await prisma.conversationState.delete({ where: { submissionId: submission.id } });
  await prisma.standupSubmission.delete({ where: { id: submission.id } });
  await prisma.standupRun.delete({ where: { id: run.id } });
  await prisma.user.delete({ where: { id: user.id } });

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
