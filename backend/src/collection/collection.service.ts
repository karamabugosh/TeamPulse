import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionGateway } from '../slack/interfaces/collection.gateway';
import { QuestionPayloadDto } from '../slack/dto/question-payload.dto';
import { StandupResponse } from '../common/types/standup-response.type';

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
   * CollectionGateway receives Slack user IDs.
   * Prisma relations require the internal User.id.
   */
  private async getOrCreateUser(slackUserId: string) {
    const existingUser = await this.prisma.user.findUnique({
      where: { slackUserId },
    });

    if (existingUser) {
      return existingUser;
    }

    const workspace = await this.prisma.workspace.findFirst({
      orderBy: {
        installedAt: 'desc',
      },
    });

    if (!workspace) {
      throw new Error(
        'No Slack workspace exists in the database. Install the Slack app first.',
      );
    }

    this.logger.log(
      `Creating database user for Slack user ${slackUserId}`,
    );

    return this.prisma.user.create({
      data: {
        workspaceId: workspace.id,
        slackUserId,
        slackDisplayName: slackUserId,
      },
    });
  }

  async getAppHomeSummary(
    slackUserId: string,
  ): Promise<AppHomeSummary> {
    const user = await this.getOrCreateUser(slackUserId);

    const activeQuestionCount =
      await this.prisma.question.count({
        where: { isActive: true },
      });

    const session =
      await this.prisma.conversationState.findUnique({
        where: { userId: user.id },
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
    slackUserId: string,
  ): Promise<QuestionPayloadDto | null> {
    this.logger.log(
      `Starting conversation for Slack user ${slackUserId}`,
    );

    const user = await this.getOrCreateUser(slackUserId);
    const userId = user.id;

    let session =
      await this.prisma.conversationState.findUnique({
        where: { userId },
      });

    if (session && !session.isCompleted) {
      const current =
        await this.getCurrentQuestion(slackUserId);

      if (current) {
        return current;
      }

      return this.getNextQuestion(slackUserId);
    }

    if (session?.isCompleted) {
      // Temporary behavior until answers are grouped by StandupRun.
      await this.prisma.answer.deleteMany({
        where: { userId },
      });

      session =
        await this.prisma.conversationState.update({
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
      session =
        await this.prisma.conversationState.create({
          data: { userId },
        });
    }

    const firstQuestion =
      await this.prisma.question.findFirst({
        where: { isActive: true },
        orderBy: { order: 'asc' },
      });

    if (!firstQuestion) {
      this.logger.warn('No active questions were found.');
      return null;
    }

    await this.prisma.conversationState.update({
      where: { userId },
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
    slackUserId: string,
    questionId: string,
    answer: string,
  ): Promise<void> {
    this.logger.log(
      `Submitting answer for question ${questionId} from Slack user ${slackUserId}`,
    );

    const trimmedAnswer = answer?.trim();

    if (!trimmedAnswer) {
      throw new BadRequestException(
        'Answer cannot be empty.',
      );
    }

    const user = await this.getOrCreateUser(slackUserId);
    const userId = user.id;

    const session =
      await this.prisma.conversationState.findUnique({
        where: { userId },
      });

    if (!session || session.isCompleted) {
      this.logger.warn(
        `User ${slackUserId} attempted to answer without an active conversation.`,
      );
      return;
    }

    if (session.currentQuestionId !== questionId) {
      this.logger.warn(
        `User ${slackUserId} answered question ${questionId}, but their current question is ${session.currentQuestionId}.`,
      );
    }

    const existingAnswer =
      await this.prisma.answer.findFirst({
        where: {
          userId,
          questionId,
          createdAt: {
            gte: session.startedAt,
          },
        },
      });

    if (existingAnswer) {
      await this.prisma.answer.update({
        where: { id: existingAnswer.id },
        data: {
          text: trimmedAnswer,
        },
      });

      return;
    }

    await this.prisma.answer.create({
      data: {
        userId,
        questionId,
        text: trimmedAnswer,
      },
    });
  }

  async getNextQuestion(
    slackUserId: string,
  ): Promise<QuestionPayloadDto | null> {
    const user = await this.getOrCreateUser(slackUserId);
    const userId = user.id;

    const session =
      await this.prisma.conversationState.findUnique({
        where: { userId },
      });

    if (!session || session.isCompleted) {
      return null;
    }

    const answers = await this.prisma.answer.findMany({
      where: {
        userId,
        createdAt: {
          gte: session.startedAt,
        },
      },
      select: {
        questionId: true,
      },
    });

    const answeredQuestionIds = answers.map(
      (answer) => answer.questionId,
    );

    const nextQuestion =
      await this.prisma.question.findFirst({
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
      where: { userId },
      data: {
        currentQuestionId: nextQuestion.id,
      },
    });

    return {
      questionId: nextQuestion.id,
      text: nextQuestion.question,
    };
  }

  async finishConversation(
    slackUserId: string,
  ): Promise<void> {
    this.logger.log(
      `Finishing conversation for Slack user ${slackUserId}`,
    );

    const user = await this.getOrCreateUser(slackUserId);
    const userId = user.id;

    const session =
      await this.prisma.conversationState.findUnique({
        where: { userId },
      });

    if (!session) {
      this.logger.warn(
        `No conversation exists for Slack user ${slackUserId}`,
      );
      return;
    }

    await this.prisma.conversationState.update({
      where: { userId },
      data: {
        isCompleted: true,
        currentQuestionId: null,
        completedAt: new Date(),
      },
    });
  }

  async getCurrentQuestion(
    slackUserId: string,
  ): Promise<QuestionPayloadDto | null> {
    const user = await this.getOrCreateUser(slackUserId);
    const userId = user.id;

    const session =
      await this.prisma.conversationState.findUnique({
        where: { userId },
      });

    if (
      !session ||
      !session.currentQuestionId ||
      session.isCompleted
    ) {
      return null;
    }

    const question =
      await this.prisma.question.findUnique({
        where: {
          id: session.currentQuestionId,
        },
      });

    if (!question) {
      return null;
    }

    return {
      questionId: question.id,
      text: question.question,
    };
  }

  async getCompletedStandupResponses(): Promise<
    StandupResponse[]
  > {
    const completedSessions =
      await this.prisma.conversationState.findMany({
        where: {
          isCompleted: true,
          completedAt: {
            not: null,
          },
        },
        include: {
          user: true,
        },
        orderBy: {
          completedAt: 'desc',
        },
      });

    const responses: StandupResponse[] = [];

    for (const session of completedSessions) {
      const answers = await this.prisma.answer.findMany({
        where: {
          userId: session.userId,
          createdAt: {
            gte: session.startedAt,
          },
        },
        include: {
          question: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      if (answers.length === 0) {
        continue;
      }

      const blockerAnswer = answers.find((answer) =>
        answer.question.question
          .toLowerCase()
          .includes('blocker'),
      );

      const updateAnswers = answers.filter(
        (answer) => answer.id !== blockerAnswer?.id,
      );

      responses.push({
        userId: session.user.slackUserId,
        name:
          session.user.slackDisplayName ||
          session.user.slackUserId,
        update: updateAnswers
          .map(
            (answer) =>
              `*${answer.question.question}*\n${answer.text}`,
          )
          .join('\n'),
        blocker: blockerAnswer?.text || undefined,
        submittedAt: (
          session.completedAt ?? new Date()
        ).toISOString(),
      });
    }

    return responses;
  }
}