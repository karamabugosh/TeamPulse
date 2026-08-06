import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  StandupNonResponder,
  StandupResponse,
} from '../common/types/standup-response.type';
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
   * Resolves either a Slack user ID or an internal database User.id.
   * If a Slack user does not exist yet, it is created in the latest workspace.
   */
  private async getOrCreateUser(userIdentifier: string) {
    const userBySlackId = await this.prisma.user.findUnique({
      where: {
        slackUserId: userIdentifier,
      },
    });

    if (userBySlackId) {
      return userBySlackId;
    }

    const userByInternalId = await this.prisma.user.findUnique({
      where: {
        id: userIdentifier,
      },
    });

    if (userByInternalId) {
      return userByInternalId;
    }

    const workspace = await this.prisma.workspace.findFirst({
      orderBy: {
        installedAt: 'desc',
      },
    });

    if (!workspace) {
      throw new NotFoundException(
        'No Slack workspace exists in the database. Install the Slack app first.',
      );
    }

    this.logger.log(
      `Creating database user for Slack user ${userIdentifier}`,
    );

    return this.prisma.user.create({
      data: {
        workspaceId: workspace.id,
        slackUserId: userIdentifier,
        slackDisplayName: userIdentifier,
      },
    });
  }

  /**
   * Finds the first active team membership for a user.
   */
  private async getUserTeam(userId: string) {
    const membership = await this.prisma.teamMember.findFirst({
      where: {
        userId,
        optedOut: false,
        team: {
          schedulerEnabled: true,
        },
      },
      include: {
        team: true,
      },
      orderBy: {
        joinedAt: 'asc',
      },
    });

    if (!membership) {
      throw new NotFoundException(
        'This user is not assigned to an active team.',
      );
    }

    return membership.team;
  }

  /**
   * Creates a fresh standup run and submission.
   * Previous runs and answers are preserved.
   */
  private async createStandupSubmission(userId: string) {
    const team = await this.getUserTeam(userId);
    const now = new Date();

    const run = await this.prisma.standupRun.create({
      data: {
        teamId: team.id,
        scheduledFor: now,
        status: 'collecting',
        startedAt: now,
      },
    });

    const submission = await this.prisma.standupSubmission.create({
      data: {
        runId: run.id,
        userId,
        status: 'in_progress',
        startedAt: now,
      },
    });

    return {
      team,
      run,
      submission,
    };
  }

  /**
   * Updates the stored Slack display name.
   */
  async syncSlackUserProfile(
    slackUserId: string,
    slackDisplayName: string,
  ): Promise<void> {
    const user = await this.getOrCreateUser(slackUserId);
    const cleanDisplayName = slackDisplayName?.trim();

    if (
      !cleanDisplayName ||
      cleanDisplayName === slackUserId ||
      user.slackDisplayName === cleanDisplayName
    ) {
      return;
    }

    await this.prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        slackDisplayName: cleanDisplayName,
      },
    });

    this.logger.log(
      `Updated display name for Slack user ${slackUserId}`,
    );
  }

  async getAppHomeSummary(
    userIdentifier: string,
  ): Promise<AppHomeSummary> {
    const user = await this.getOrCreateUser(userIdentifier);

    const activeQuestionCount =
      await this.prisma.question.count({
        where: {
          isActive: true,
        },
      });

    const session =
      await this.prisma.conversationState.findUnique({
        where: {
          userId: user.id,
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
    this.logger.log(
      `Starting conversation for user ${userIdentifier}`,
    );

    const user = await this.getOrCreateUser(userIdentifier);
    const userId = user.id;

    let session =
      await this.prisma.conversationState.findUnique({
        where: {
          userId,
        },
      });

    /*
     * Resume an unfinished standup.
     */
    if (session && !session.isCompleted) {
      const currentQuestion =
        await this.getCurrentQuestion(userIdentifier);

      if (currentQuestion) {
        return currentQuestion;
      }

      return this.getNextQuestion(userIdentifier);
    }

    /*
     * Create a fresh run and submission.
     * Previous answers are preserved.
     */
    const { submission } =
      await this.createStandupSubmission(userId);

    const startedAt = new Date();

    if (session) {
      session =
        await this.prisma.conversationState.update({
          where: {
            userId,
          },
          data: {
            submissionId: submission.id,
            isCompleted: false,
            currentQuestionId: null,
            completedAt: null,
            startedAt,
          },
        });
    } else {
      session =
        await this.prisma.conversationState.create({
          data: {
            userId,
            submissionId: submission.id,
            startedAt,
          },
        });
    }

    const firstQuestion =
      await this.prisma.question.findFirst({
        where: {
          isActive: true,
        },
        orderBy: {
          order: 'asc',
        },
      });

    if (!firstQuestion) {
      this.logger.warn('No active questions were found.');

      await this.prisma.standupSubmission.update({
        where: {
          id: submission.id,
        },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
        },
      });

      return null;
    }

    await this.prisma.conversationState.update({
      where: {
        userId,
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
    this.logger.log(
      `Submitting answer for question ${questionId} from user ${userIdentifier}`,
    );

    const normalizedAnswer = answer?.trim();

    if (!normalizedAnswer) {
      throw new BadRequestException(
        'Answer cannot be empty.',
      );
    }

    const user = await this.getOrCreateUser(userIdentifier);
    const userId = user.id;

    const session =
      await this.prisma.conversationState.findUnique({
        where: {
          userId,
        },
      });

    if (
      !session ||
      session.isCompleted ||
      !session.submissionId
    ) {
      this.logger.warn(
        `User ${userIdentifier} attempted to answer without an active standup submission.`,
      );

      throw new BadRequestException(
        'No active conversation exists for this user.',
      );
    }

    if (session.currentQuestionId !== questionId) {
      this.logger.warn(
        `User ${userIdentifier} answered question ${questionId}, ` +
          `but their current question is ${session.currentQuestionId}.`,
      );
    }

    const existingAnswer =
      await this.prisma.answer.findFirst({
        where: {
          submissionId: session.submissionId,
          questionId,
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
        userId,
        questionId,
        submissionId: session.submissionId,
        text: normalizedAnswer,
      },
    });
  }

  async getNextQuestion(
    userIdentifier: string,
  ): Promise<QuestionPayloadDto | null> {
    const user = await this.getOrCreateUser(userIdentifier);
    const userId = user.id;

    const session =
      await this.prisma.conversationState.findUnique({
        where: {
          userId,
        },
      });

    if (
      !session ||
      session.isCompleted ||
      !session.submissionId
    ) {
      return null;
    }

    const answers = await this.prisma.answer.findMany({
      where: {
        submissionId: session.submissionId,
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
      where: {
        userId,
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

  async finishConversation(
    userIdentifier: string,
  ): Promise<void> {
    this.logger.log(
      `Finishing conversation for user ${userIdentifier}`,
    );

    const user = await this.getOrCreateUser(userIdentifier);
    const userId = user.id;

    const session =
      await this.prisma.conversationState.findUnique({
        where: {
          userId,
        },
        include: {
          submission: true,
        },
      });

    if (!session) {
      this.logger.warn(
        `No conversation exists for user ${userIdentifier}`,
      );

      throw new BadRequestException(
        'No conversation exists for this user.',
      );
    }

    if (session.isCompleted) {
      return;
    }

    const completedAt = new Date();

    await this.prisma.conversationState.update({
      where: {
        userId,
      },
      data: {
        isCompleted: true,
        currentQuestionId: null,
        completedAt,
      },
    });

    if (!session.submissionId || !session.submission) {
      this.logger.warn(
        `Conversation completed for ${userIdentifier}, but no StandupSubmission was attached.`,
      );

      return;
    }

    await this.prisma.standupSubmission.update({
      where: {
        id: session.submissionId,
      },
      data: {
        status: 'completed',
        completedAt,
      },
    });

    const incompleteSubmissionCount =
      await this.prisma.standupSubmission.count({
        where: {
          runId: session.submission.runId,
          status: {
            not: 'completed',
          },
        },
      });

    if (incompleteSubmissionCount === 0) {
      await this.prisma.standupRun.update({
        where: {
          id: session.submission.runId,
        },
        data: {
          status: 'completed',
          completedAt,
        },
      });
    }
  }

  async getCurrentQuestion(
    userIdentifier: string,
  ): Promise<QuestionPayloadDto | null> {
    const user = await this.getOrCreateUser(userIdentifier);
    const userId = user.id;

    const session =
      await this.prisma.conversationState.findUnique({
        where: {
          userId,
        },
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

    if (!question || !question.isActive) {
      return null;
    }

    return {
      questionId: question.id,
      text: question.question,
    };
  }

  /**
   * Returns the most recent completed submission
   * for each active team member.
   */
  async getCompletedStandupResponses(
    teamId?: string,
  ): Promise<StandupResponse[]> {
    const submissions =
      await this.prisma.standupSubmission.findMany({
        where: {
          status: 'completed',
          completedAt: {
            not: null,
          },
          run: teamId
            ? {
                teamId,
              }
            : undefined,
          user: teamId
            ? {
                teamMembers: {
                  some: {
                    teamId,
                    optedOut: false,
                  },
                },
              }
            : undefined,
        },
        include: {
          user: true,
          answers: {
            include: {
              question: true,
            },
            orderBy: {
              createdAt: 'asc',
            },
          },
        },
        orderBy: {
          completedAt: 'desc',
        },
      });

    /*
     * Only include the newest completed submission per user.
     */
    const newestSubmissionByUser = new Map<
      string,
      (typeof submissions)[number]
    >();

    for (const submission of submissions) {
      if (!newestSubmissionByUser.has(submission.userId)) {
        newestSubmissionByUser.set(
          submission.userId,
          submission,
        );
      }
    }

    const responses: StandupResponse[] = [];

    for (const submission of newestSubmissionByUser.values()) {
      if (submission.answers.length === 0) {
        continue;
      }

      const blockerAnswer = submission.answers.find(
        (answer) =>
          answer.question.question
            .toLowerCase()
            .includes('blocker'),
      );

      const updateAnswers = submission.answers.filter(
        (answer) => answer.id !== blockerAnswer?.id,
      );

      responses.push({
        userId: submission.user.slackUserId,
        name:
          submission.user.slackDisplayName ||
          submission.user.slackUserId,
        update: updateAnswers
          .map(
            (answer) =>
              `*${answer.question.question}*\n${answer.text}`,
          )
          .join('\n'),
        blocker: blockerAnswer?.text || undefined,
        submittedAt: (
          submission.completedAt ?? new Date()
        ).toISOString(),
      });
    }

    /*
     * Legacy fallback for answers created before
     * StandupSubmission history was introduced.
     */
    if (responses.length === 0) {
      return this.getLegacyCompletedResponses(teamId);
    }

    return responses;
  }

  /**
   * Supports existing data created before StandupSubmission.
   */
  private async getLegacyCompletedResponses(
    teamId?: string,
  ): Promise<StandupResponse[]> {
    const completedSessions =
      await this.prisma.conversationState.findMany({
        where: {
          isCompleted: true,
          completedAt: {
            not: null,
          },
          user: teamId
            ? {
                teamMembers: {
                  some: {
                    teamId,
                    optedOut: false,
                  },
                },
              }
            : undefined,
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
          submissionId: null,
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

  /**
   * Finds active team members who did not submit
   * a completed standup response.
   */
  async getTeamNonResponders(
    teamId: string,
    completedResponses: StandupResponse[],
  ): Promise<StandupNonResponder[]> {
    const completedUserIds = completedResponses.map(
      (response) => response.userId,
    );

    const teamMembers =
      await this.prisma.teamMember.findMany({
        where: {
          teamId,
          optedOut: false,
          user: {
            slackUserId: {
              notIn: completedUserIds,
            },
          },
        },
        include: {
          user: true,
        },
        orderBy: {
          joinedAt: 'asc',
        },
      });

    return teamMembers.map((member) => ({
      userId: member.user.slackUserId,
      name:
        member.user.slackDisplayName ||
        member.user.slackUserId,
    }));
  }

  /**
   * Starts one shared standup run for every active member of a team.
   */
  async startTeamStandup(teamId: string): Promise<
    Array<{
      userId: string;
      name: string;
      question: QuestionPayloadDto;
    }>
  > {
    const team = await this.prisma.team.findUnique({
      where: {
        id: teamId,
      },
      include: {
        teamMembers: {
          where: {
            optedOut: false,
          },
          include: {
            user: true,
          },
          orderBy: {
            joinedAt: 'asc',
          },
        },
      },
    });

    if (!team) {
      throw new NotFoundException(
        `Team ${teamId} was not found.`,
      );
    }

    if (!team.schedulerEnabled) {
      throw new BadRequestException(
        `Scheduling is disabled for team ${team.name}.`,
      );
    }

    if (team.teamMembers.length === 0) {
      this.logger.warn(
        `Team "${team.name}" has no active members.`,
      );

      return [];
    }

    const firstQuestion =
      await this.prisma.question.findFirst({
        where: {
          isActive: true,
        },
        orderBy: {
          order: 'asc',
        },
      });

    if (!firstQuestion) {
      throw new NotFoundException(
        'No active standup questions were found.',
      );
    }

    const now = new Date();

    const run = await this.prisma.standupRun.create({
      data: {
        teamId: team.id,
        scheduledFor: now,
        status: 'collecting',
        startedAt: now,
      },
    });

    const prompts: Array<{
      userId: string;
      name: string;
      question: QuestionPayloadDto;
    }> = [];

    for (const member of team.teamMembers) {
      const submission =
        await this.prisma.standupSubmission.create({
          data: {
            runId: run.id,
            userId: member.user.id,
            status: 'in_progress',
            startedAt: now,
          },
        });

      await this.prisma.conversationState.upsert({
        where: {
          userId: member.user.id,
        },
        update: {
          submissionId: submission.id,
          currentQuestionId: firstQuestion.id,
          isCompleted: false,
          startedAt: now,
          completedAt: null,
        },
        create: {
          userId: member.user.id,
          submissionId: submission.id,
          currentQuestionId: firstQuestion.id,
          isCompleted: false,
          startedAt: now,
        },
      });

      prompts.push({
        userId: member.user.slackUserId,
        name:
          member.user.slackDisplayName ||
          member.user.slackUserId,
        question: {
          questionId: firstQuestion.id,
          text: firstQuestion.question,
        },
      });
    }

    this.logger.log(
      `Started standup run ${run.id} for team "${team.name}" with ${prompts.length} member(s).`,
    );

    return prompts;
  }

  /**
   * Returns members who have not completed the latest team standup.
   */
  async getPendingTeamStandupMembers(
    teamId: string,
  ): Promise<
    Array<{
      userId: string;
      name: string;
      currentQuestion: QuestionPayloadDto | null;
    }>
  > {
    const latestRun =
      await this.prisma.standupRun.findFirst({
        where: {
          teamId,
          status: 'collecting',
        },
        orderBy: {
          startedAt: 'desc',
        },
        include: {
          submissions: {
            where: {
              status: {
                not: 'completed',
              },
            },
            include: {
              user: {
                include: {
                  conversationState: true,
                },
              },
            },
          },
        },
      });

    if (!latestRun) {
      return [];
    }

    const pendingMembers: Array<{
      userId: string;
      name: string;
      currentQuestion: QuestionPayloadDto | null;
    }> = [];

    for (const submission of latestRun.submissions) {
      const session = submission.user.conversationState;

      let currentQuestion: QuestionPayloadDto | null = null;

      if (
        session?.submissionId === submission.id &&
        session.currentQuestionId
      ) {
        const question =
          await this.prisma.question.findUnique({
            where: {
              id: session.currentQuestionId,
            },
          });

        if (question?.isActive) {
          currentQuestion = {
            questionId: question.id,
            text: question.question,
          };
        }
      }

      pendingMembers.push({
        userId: submission.user.slackUserId,
        name:
          submission.user.slackDisplayName ||
          submission.user.slackUserId,
        currentQuestion,
      });
    }

    return pendingMembers;
  }

}