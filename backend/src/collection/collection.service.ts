import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { CollectionGateway } from '../slack/interfaces/collection.gateway';
import { QuestionPayloadDto } from '../slack/dto/question-payload.dto';
import { PrismaService } from '../prisma/prisma.service';

export type AppHomeSummary = {
  activeQuestionCount: number;
  status: 'not_started' | 'in_progress' | 'completed';
  lastCompletedAt: Date | null;
};

@Injectable()
export class CollectionService implements CollectionGateway {
  private readonly logger = new Logger(CollectionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getAppHomeSummary(userId: string): Promise<AppHomeSummary> {
    const activeQuestionCount = await this.prisma.question.count({
      where: { isActive: true },
    });
    const session = await this.prisma.conversationState.findUnique({
      where: { userId },
    });

    let status: AppHomeSummary['status'] = 'not_started';
    if (session?.isCompleted) {
      status = 'completed';
    } else if (session?.currentQuestionId) {
      status = 'in_progress';
    }

    return {
      activeQuestionCount,
      status,
      lastCompletedAt: session?.completedAt ?? null,
    };
  }

  async startConversation(userId: string): Promise<QuestionPayloadDto | null> {
    this.logger.log(`Starting conversation for user ${userId}`);

    // Check for an existing uncompleted session to resume
    let session = await this.prisma.conversationState.findUnique({
      where: { userId },
    });

    if (session && !session.isCompleted) {
      const current = await this.getCurrentQuestion(userId);
      if (current) {
        return current;
      }
      return this.getNextQuestion(userId);
    }

    if (session && session.isCompleted) {
      await this.prisma.answer.deleteMany({ where: { userId } });
      session = await this.prisma.conversationState.update({
        where: { userId },
        data: {
          isCompleted: false,
          currentQuestionId: null,
          completedAt: null,
          startedAt: new Date(),
        },
      });
    }

    if (!session) {
      session = await this.prisma.conversationState.create({
        data: { userId },
      });
    }

    const firstQuestion = await this.prisma.question.findFirst({
      where: { isActive: true },
      orderBy: { order: 'asc' },
    });

    if (!firstQuestion) {
      return null;
    }

    await this.prisma.conversationState.update({
      where: { userId },
      data: { currentQuestionId: firstQuestion.id },
    });

    return { questionId: firstQuestion.id, text: firstQuestion.question };
  }

  async submitAnswer(userId: string, questionId: string, answer: string): Promise<void> {
    this.logger.log(`Submitting answer for question ${questionId} from user ${userId}`);
    if (!answer || answer.trim() === '') {
      throw new BadRequestException('Answer cannot be empty.');
    }

    // Check session
    const session = await this.prisma.conversationState.findUnique({
      where: { userId },
    });

    if (!session || session.isCompleted) {
      this.logger.warn(`Attempted to submit answer for user ${userId} but no active session exists.`);
      return;
    }

    if (session.currentQuestionId !== questionId) {
        this.logger.warn(`User ${userId} answered question ${questionId} but current question is ${session.currentQuestionId}`);
        // Continuing anyway to handle edge case of duplicate answers. We can upsert.
    }

    const existingAnswer = await this.prisma.answer.findFirst({
        where: { userId, questionId }
    });

    if (existingAnswer) {
        await this.prisma.answer.update({
            where: { id: existingAnswer.id },
            data: { text: answer }
        });
    } else {
        await this.prisma.answer.create({
            data: {
                userId,
                questionId,
                text: answer,
            },
        });
    }
  }

  async getNextQuestion(userId: string): Promise<QuestionPayloadDto | null> {
    const session = await this.prisma.conversationState.findUnique({
      where: { userId },
    });

    if (!session || session.isCompleted) {
      return null;
    }

    // Get all answered questions
    const answers = await this.prisma.answer.findMany({
      where: {
        userId,
        createdAt: { gte: session.startedAt },
      },
      select: { questionId: true },
    });
    const answeredQuestionIds = answers.map((a) => a.questionId);

    // Find first question not answered
    const nextQuestion = await this.prisma.question.findFirst({
      where: {
        isActive: true,
        id: { notIn: answeredQuestionIds },
      },
      orderBy: { order: 'asc' },
    });

    if (nextQuestion) {
      await this.prisma.conversationState.update({
        where: { userId },
        data: { currentQuestionId: nextQuestion.id },
      });
      return { questionId: nextQuestion.id, text: nextQuestion.question };
    }

    return null;
  }

  async finishConversation(userId: string): Promise<void> {
    this.logger.log(`Finishing conversation for user ${userId}`);
    await this.prisma.conversationState.update({
      where: { userId },
      data: {
        isCompleted: true,
        currentQuestionId: null,
        completedAt: new Date(),
      },
    });
  }

  async getCurrentQuestion(userId: string): Promise<QuestionPayloadDto | null> {
    const session = await this.prisma.conversationState.findUnique({
      where: { userId },
    });

    if (session && session.currentQuestionId && !session.isCompleted) {
      const question = await this.prisma.question.findUnique({
        where: { id: session.currentQuestionId },
      });
      if (question) {
        return { questionId: question.id, text: question.question };
      }
    }
    return null;
  }
}
