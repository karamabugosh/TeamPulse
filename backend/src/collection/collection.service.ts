import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionPayloadDto } from '../slack/dto/question-payload.dto';
import { CollectionGateway } from '../slack/interfaces/collection.gateway';

export type AppHomeSummary = {
  activeQuestionCount: number;
  status: 'not_started' | 'in_progress' | 'completed';
  lastCompletedAt: Date | null;
};

@Injectable()
export class CollectionService implements CollectionGateway {
  private readonly logger = new Logger(CollectionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Slack sends slackUserId, while ConversationState and Answer
   * reference the internal User.id.
   *
   * This helper resolves either identifier to the internal database ID.
   */
  private async resolveInternalUserId(userIdentifier: string): Promise<string> {
    const userBySlackId = await this.prisma.user.findUnique({
      where: {
        slackUserId: userIdentifier,
      },
      select: {
        id: true,
      },
    });

    if (userBySlackId) {
      return userBySlackId.id;
    }

    // Also support calls that already provide the internal database ID.
    const userByInternalId = await this.prisma.user.findUnique({
      where: {
        id: userIdentifier,
      },
      select: {
        id: true,
      },
    });

    if (userByInternalId) {
      return userByInternalId.id;
    }

    throw new NotFoundException(
      `User with identifier "${userIdentifier}" was not found in the database.`,
    );
  }

  async getAppHomeSummary(
    userIdentifier: string,
  ): Promise<AppHomeSummary> {
    const internalUserId =
      await this.resolveInternalUserId(userIdentifier);

    const activeQuestionCount = await this.prisma.question.count({
      where: {
        isActive: true,
      },
    });

    const session = await this.prisma.conversationState.findUnique({
      where: {
        userId: internalUserId,
      },
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

  async startConversation(
    userIdentifier: string,
  ): Promise<QuestionPayloadDto | null> {
    const internalUserId =
      await this.resolveInternalUserId(userIdentifier);

    this.logger.log(
      `Starting conversation for user ${userIdentifier} ` +
        `(internal ID: ${internalUserId})`,
    );

    let session = await this.prisma.conversationState.findUnique({
      where: {
        userId: internalUserId,
      },
    });

    // Resume an existing unfinished conversation.
    if (session && !session.isCompleted) {
      const currentQuestion =
        await this.getCurrentQuestion(userIdentifier);

      if (currentQuestion) {
        return currentQuestion;
      }

      return this.getNextQuestion(userIdentifier);
    }

    // Reset an already completed conversation.
    if (session?.isCompleted) {
      /*
       * Current schema has no StandupRun relation, so the existing
       * implementation removes previous answers before starting again.
       * This should later be replaced with run-based answer history.
       */
      await this.prisma.answer.deleteMany({
        where: {
          userId: internalUserId,
        },
      });

      session = await this.prisma.conversationState.update({
        where: {
          userId: internalUserId,
        },
        data: {
          isCompleted: false,
          currentQuestionId: null,
          completedAt: null,
          startedAt: new Date(),
        },
      });
    }

    // Create the user's first conversation state.
    if (!session) {
      session = await this.prisma.conversationState.create({
        data: {
          userId: internalUserId,
        },
      });
    }

    const firstQuestion = await this.prisma.question.findFirst({
      where: {
        isActive: true,
      },
      orderBy: {
        order: 'asc',
      },
    });

    if (!firstQuestion) {
      this.logger.warn('No active questions were found.');
      return null;
    }

    await this.prisma.conversationState.update({
      where: {
        userId: internalUserId,
      },
      data: {
        currentQuestionId: firstQuestion.id,
      },
    });

    return {
      questionId: firstQuestion.id,
      text: firstQuestion.question,
    };
  }

  async submitAnswer(
    userIdentifier: string,
    questionId: string,
    answer: string,
  ): Promise<void> {
    const internalUserId =
      await this.resolveInternalUserId(userIdentifier);

    this.logger.log(
      `Submitting answer for question ${questionId} ` +
        `from user ${userIdentifier}`,
    );

    const normalizedAnswer = answer?.trim();

    if (!normalizedAnswer) {
      throw new BadRequestException('Answer cannot be empty.');
    }

    const session = await this.prisma.conversationState.findUnique({
      where: {
        userId: internalUserId,
      },
    });

    if (!session || session.isCompleted) {
      this.logger.warn(
        `User ${userIdentifier} attempted to submit an answer ` +
          'without an active conversation.',
      );

      throw new BadRequestException(
        'No active conversation exists for this user.',
      );
    }

    if (session.currentQuestionId !== questionId) {
      this.logger.warn(
        `User ${userIdentifier} answered question ${questionId}, ` +
          `but the current question is ${session.currentQuestionId}.`,
      );
    }

    const existingAnswer = await this.prisma.answer.findFirst({
      where: {
        userId: internalUserId,
        questionId,
        createdAt: {
          gte: session.startedAt,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (existingAnswer) {
      await this.prisma.answer.update({
        where: {
          id: existingAnswer.id,
        },
        data: {
          text: normalizedAnswer,
        },
      });

      return;
    }

    await this.prisma.answer.create({
      data: {
        userId: internalUserId,
        questionId,
        text: normalizedAnswer,
      },
    });
  }

  async getNextQuestion(
    userIdentifier: string,
  ): Promise<QuestionPayloadDto | null> {
    const internalUserId =
      await this.resolveInternalUserId(userIdentifier);

    const session = await this.prisma.conversationState.findUnique({
      where: {
        userId: internalUserId,
      },
    });

    if (!session || session.isCompleted) {
      return null;
    }

    const answers = await this.prisma.answer.findMany({
      where: {
        userId: internalUserId,
        createdAt: {
          gte: session.startedAt,
        },
      },
      select: {
        questionId: true,
      },
    });

    const answeredQuestionIds = answers.map(
      (answerItem) => answerItem.questionId,
    );

    const nextQuestion = await this.prisma.question.findFirst({
      where: {
        isActive: true,
        id: {
          notIn: answeredQuestionIds,
        },
      },
      orderBy: {
        order: 'asc',
      },
    });

    if (!nextQuestion) {
      return null;
    }

    await this.prisma.conversationState.update({
      where: {
        userId: internalUserId,
      },
      data: {
        currentQuestionId: nextQuestion.id,
      },
    });

    return {
      questionId: nextQuestion.id,
      text: nextQuestion.question,
    };
  }

  async finishConversation(userIdentifier: string): Promise<void> {
    const internalUserId =
      await this.resolveInternalUserId(userIdentifier);

    this.logger.log(
      `Finishing conversation for user ${userIdentifier}`,
    );

    const session = await this.prisma.conversationState.findUnique({
      where: {
        userId: internalUserId,
      },
    });

    if (!session) {
      throw new BadRequestException(
        'No conversation exists for this user.',
      );
    }

    if (session.isCompleted) {
      return;
    }

    await this.prisma.conversationState.update({
      where: {
        userId: internalUserId,
      },
      data: {
        isCompleted: true,
        currentQuestionId: null,
        completedAt: new Date(),
      },
    });
  }

  async getCurrentQuestion(
    userIdentifier: string,
  ): Promise<QuestionPayloadDto | null> {
    const internalUserId =
      await this.resolveInternalUserId(userIdentifier);

    const session = await this.prisma.conversationState.findUnique({
      where: {
        userId: internalUserId,
      },
    });

    if (
      !session ||
      session.isCompleted ||
      !session.currentQuestionId
    ) {
      return null;
    }

    const question = await this.prisma.question.findUnique({
      where: {
        id: session.currentQuestionId,
      },
    });

    if (!question || !question.isActive) {
      return null;
    }

    return {
      questionId: question.id,
      text: question.question,
    };
  }
}