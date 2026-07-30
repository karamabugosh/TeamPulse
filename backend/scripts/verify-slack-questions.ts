import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { CollectionService } from '../src/collection/collection.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const collection = app.get(CollectionService);
  const prisma = app.get(PrismaService);

  const userId = 'verify-slack-user';

  await prisma.answer.deleteMany({ where: { userId } });
  await prisma.conversationState.deleteMany({ where: { userId } });

  const uniqueText = `Verify DB question ${Date.now()}`;
  const maxOrder = await prisma.question.aggregate({ _max: { order: true } });
  const newOrder = (maxOrder._max.order ?? 0) + 1;
  const created = await prisma.question.create({
    data: { question: uniqueText, order: newOrder, isActive: true },
  });

  const q1 = await collection.startConversation(userId);
  if (!q1) {
    throw new Error('No first question returned');
  }

  const activeQuestions = await prisma.question.findMany({
    where: { isActive: true },
    orderBy: { order: 'asc' },
  });
  const texts = activeQuestions.map((q) => q.question);

  if (!texts.includes(uniqueText)) {
    throw new Error('New question not in active question list');
  }

  let current = q1;
  const seen: string[] = [current.text];
  while (true) {
    await collection.submitAnswer(userId, current.questionId, `Answer for ${current.text}`);
    const next = await collection.getNextQuestion(userId);
    if (!next) break;
    seen.push(next.text);
    current = next;
  }
  await collection.finishConversation(userId);

  if (!seen.includes(uniqueText)) {
    throw new Error(`New question never appeared in conversation. Seen: ${seen.join(' | ')}`);
  }

  console.log('OK: Slack flow uses DB questions.');
  console.log('OK: New question appeared in conversation:', uniqueText);
  console.log('Conversation order:', seen.join(' -> '));

  await prisma.answer.deleteMany({ where: { userId } });
  await prisma.conversationState.deleteMany({ where: { userId } });
  await prisma.answer.deleteMany({ where: { questionId: created.id } });
  await prisma.question.delete({ where: { id: created.id } });

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
