import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  QuestionType,
} from '@prisma/client';
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
  activeCheckIns: ActiveCheckInOption[];
  focusedCheckInName: string | null;
};

export type ActiveCheckInOption = {
  index: number;
  submissionId: string;
  runId: string;
  checkInName: string;
  questionNumber: number;
  totalQuestions: number;
  currentQuestionText: string;
};

export type DmThreadContext = {
  submissionId: string;
  runId: string;
  threadTs: string;
  channelId: string;
  checkInName: string;
};

type ValidatedAnswer = {
  text: string;
  structuredValue:
    | Prisma.InputJsonValue
    | typeof Prisma.JsonNull;
};

@Injectable()
export class CollectionService
  implements CollectionGateway
{
  private readonly logger =
    new Logger(CollectionService.name);

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private async getOrCreateUser(
    userIdentifier: string,
  ) {
    const userBySlackId =
      await this.prisma.user.findUnique({
        where: {
          slackUserId:
            userIdentifier,
        },
      });

    if (userBySlackId) {
      return userBySlackId;
    }

    const userByInternalId =
      await this.prisma.user.findUnique({
        where: {
          id: userIdentifier,
        },
      });

    if (userByInternalId) {
      return userByInternalId;
    }

    const workspace =
      await this.prisma.workspace.findFirst({
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
        workspaceId:
          workspace.id,
        slackUserId:
          userIdentifier,
        slackDisplayName:
          userIdentifier,
      },
    });
  }

  private async getInternalUserId(
    slackUserId: string,
  ): Promise<string> {
    const user =
      await this.getOrCreateUser(
        slackUserId,
      );

    return user.id;
  }

  private incompleteSessionInclude = {
    submission: {
      include: {
        run: {
          include: {
            checkIn: {
              select: {
                id: true,
                name: true,
                introMessage: true,
                outroMessage: true,
              },
            },
          },
        },
      },
    },
  } as const;

  private async getIncompleteConversationStates(userId: string) {
    return this.prisma.conversationState.findMany({
      where: {
        userId,
        isCompleted: false,
        submission: {
          status: { in: ['pending', 'in_progress'] },
          run: { status: 'collecting' },
        },
      },
      orderBy: { updatedAt: 'asc' },
      include: this.incompleteSessionInclude,
    });
  }

  async setFocusedSubmission(
    userIdentifier: string,
    submissionId: string,
  ): Promise<void> {
    const user = await this.getOrCreateUser(userIdentifier);

    const session = await this.prisma.conversationState.findFirst({
      where: {
        userId: user.id,
        submissionId,
        isCompleted: false,
      },
    });

    if (!session) {
      throw new BadRequestException(
        'That CheckIn is not active for you anymore.',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { focusedSubmissionId: submissionId },
    });

    await this.prisma.conversationState.update({
      where: { id: session.id },
      data: { updatedAt: new Date() },
    });
  }

  async clearFocusedSubmission(userId: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: { focusedSubmissionId: null },
    });
  }

  parseNumericCheckInSelection(
    message: string,
    optionCount: number,
  ): number | null {
    const trimmed = message.trim();
    if (!/^[1-9]\d*$/.test(trimmed)) {
      return null;
    }

    const selected = Number.parseInt(trimmed, 10);
    if (selected < 1 || selected > optionCount) {
      return null;
    }

    return selected - 1;
  }

  async getActiveCheckInOptions(
    userIdentifier: string,
  ): Promise<ActiveCheckInOption[]> {
    const user = await this.getOrCreateUser(userIdentifier);
    const sessions = await this.getIncompleteConversationStates(user.id);

    const options: ActiveCheckInOption[] = [];

    for (const [index, session] of sessions.entries()) {
      if (!session.submission?.run.checkIn) {
        continue;
      }

      const checkInId = session.submission.run.checkInId;
      const activeQuestions = await this.getQuestionsForConversation(checkInId);
      if (activeQuestions.length === 0) {
        continue;
      }

      const answers = await this.prisma.answer.findMany({
        where: { submissionId: session.submissionId },
        select: { questionId: true },
      });
      const answeredIds = new Set(answers.map((answer) => answer.questionId));
      const nextIndex = activeQuestions.findIndex(
        (question) => !answeredIds.has(question.id),
      );
      const questionIndex = nextIndex === -1 ? activeQuestions.length - 1 : nextIndex;
      const currentQuestion = activeQuestions[questionIndex];

      options.push({
        index: index + 1,
        submissionId: session.submissionId,
        runId: session.submission.runId,
        checkInName: session.submission.run.checkIn.name,
        questionNumber: questionIndex + 1,
        totalQuestions: activeQuestions.length,
        currentQuestionText: currentQuestion.question,
      });
    }

    return options;
  }

  private async getActiveConversationState(
    userId: string,
    questionId?: string,
    autoFocus = true,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { focusedSubmissionId: true },
    });

    const sessions = await this.getIncompleteConversationStates(userId);

    if (sessions.length === 0) {
      if (user?.focusedSubmissionId) {
        await this.clearFocusedSubmission(userId);
      }
      return null;
    }

    let focusedSession =
      user?.focusedSubmissionId
        ? sessions.find(
            (session) =>
              session.submissionId === user.focusedSubmissionId,
          ) ?? null
        : null;

    if (!focusedSession && autoFocus && sessions.length === 1) {
      focusedSession = sessions[0];
      await this.prisma.user.update({
        where: { id: userId },
        data: { focusedSubmissionId: focusedSession.submissionId },
      });
    }

    if (!focusedSession) {
      return null;
    }

    if (
      questionId &&
      focusedSession.currentQuestionId !== questionId
    ) {
      return null;
    }

    return focusedSession;
  }

  private async getQuestionsForConversation(
    checkInId: string | null,
  ) {
    return this.prisma.question.findMany({
      where: {
        isActive: true,
        checkInId,
      },

      orderBy: {
        order: 'asc',
      },
    });
  }

  private async getUserTeam(
    userId: string,
  ) {
    const membership =
      await this.prisma.teamMember.findFirst({
        where: {
          userId,
          optedOut: false,

          team: {
            schedulerEnabled:
              true,
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

  private async createStandupSubmission(
    userId: string,
  ) {
    const team =
      await this.getUserTeam(
        userId,
      );

    const now =
      new Date();

    const run =
      await this.prisma.standupRun.create({
        data: {
          teamId: team.id,
          scheduledFor: now,
          status:
            'collecting',
          startedAt: now,
        },
      });

    const submission =
      await this.prisma.standupSubmission.create({
        data: {
          runId: run.id,
          userId,
          status:
            'in_progress',
          startedAt: now,
        },
      });

    return {
      team,
      run,
      submission,
    };
  }

  private parseQuestionOptions(
    options: Prisma.JsonValue | null,
  ): string[] | undefined {
    if (
      !options ||
      !Array.isArray(options)
    ) {
      return undefined;
    }

    const parsed =
      options.filter(
        (
          option,
        ): option is string =>
          typeof option ===
          'string',
      );

    return parsed.length > 0
      ? parsed
      : undefined;
  }

  private toQuestionPayload(
    question: {
      id: string;
      question: string;
      type: QuestionType;
      options: Prisma.JsonValue | null;
    },
    questionNumber?: number,
    totalQuestions?: number,
  ): QuestionPayloadDto {
    return {
      questionId:
        question.id,

      text:
        question.question,

      type:
        question.type,

      options:
        this.parseQuestionOptions(
          question.options,
        ),

      ...(questionNumber !==
      undefined
        ? {
            questionNumber,
          }
        : {}),

      ...(totalQuestions !==
      undefined
        ? {
            totalQuestions,
          }
        : {}),
    };
  }

  private validateAnswerForQuestion(
    question: {
      type: QuestionType;
      options: Prisma.JsonValue | null;
    },
    rawAnswer: string,
  ): ValidatedAnswer {
    const trimmed =
      rawAnswer.trim();

    if (!trimmed) {
      throw new BadRequestException(
        'Answer cannot be empty.',
      );
    }

    const normalized =
      trimmed.toLowerCase();

    switch (question.type) {
      case QuestionType.FREE_TEXT:
        return {
          text: trimmed,
          structuredValue:
            Prisma.JsonNull,
        };

      case QuestionType.YES_NO: {
        const yesValues =
          new Set([
            'yes',
            'y',
          ]);

        const noValues =
          new Set([
            'no',
            'n',
          ]);

        if (
          yesValues.has(
            normalized,
          )
        ) {
          return {
            text: 'Yes',
            structuredValue: {
              value: true,
            },
          };
        }

        if (
          noValues.has(
            normalized,
          )
        ) {
          return {
            text: 'No',
            structuredValue: {
              value: false,
            },
          };
        }

        throw new BadRequestException(
          'Please answer Yes or No.',
        );
      }

      case QuestionType.YES_NO_MAYBE: {
        if (
          ['yes', 'y'].includes(
            normalized,
          )
        ) {
          return {
            text: 'Yes',
            structuredValue: {
              value: 'yes',
            },
          };
        }

        if (
          ['no', 'n'].includes(
            normalized,
          )
        ) {
          return {
            text: 'No',
            structuredValue: {
              value: 'no',
            },
          };
        }

        if (
          [
            'maybe',
            'm',
            'unsure',
            'not sure',
          ].includes(
            normalized,
          )
        ) {
          return {
            text: 'Maybe',
            structuredValue: {
              value: 'maybe',
            },
          };
        }

        throw new BadRequestException(
          'Please answer Yes, No, or Maybe.',
        );
      }

      case QuestionType.MULTIPLE_CHOICE: {
        const options =
          this.parseQuestionOptions(
            question.options,
          );

        if (
          !options ||
          options.length === 0
        ) {
          throw new BadRequestException(
            'This multiple-choice question has no configured options.',
          );
        }

        const matchingOption =
          options.find(
            (option) =>
              option
                .trim()
                .toLowerCase() ===
              normalized,
          );

        if (
          matchingOption
        ) {
          return {
            text:
              matchingOption,
            structuredValue: {
              value:
                matchingOption,
            },
          };
        }

        const numericChoice =
          Number(trimmed);

        if (
          Number.isInteger(
            numericChoice,
          ) &&
          numericChoice >= 1 &&
          numericChoice <=
            options.length
        ) {
          const selected =
            options[
              numericChoice - 1
            ];

          return {
            text: selected,
            structuredValue: {
              value:
                selected,
              optionIndex:
                numericChoice -
                1,
            },
          };
        }

        throw new BadRequestException(
          `Please choose one of: ${options.join(
            ', ',
          )}.`,
        );
      }

      case QuestionType.SCALE_1_5: {
        const numberValue =
          Number(trimmed);

        if (
          !Number.isInteger(
            numberValue,
          ) ||
          numberValue < 1 ||
          numberValue > 5
        ) {
          throw new BadRequestException(
            'Please answer with a whole number from 1 to 5.',
          );
        }

        return {
          text:
            String(numberValue),

          structuredValue: {
            value:
              numberValue,
          },
        };
      }

      case QuestionType.NUMERICAL: {
        const numberValue = Number(trimmed);

        if (Number.isNaN(numberValue)) {
          throw new BadRequestException(
            'Please answer with a valid number.',
          );
        }

        return {
          text: trimmed,
          structuredValue: { value: numberValue },
        };
      }

      default:
        throw new BadRequestException(
          'Unsupported question type.',
        );
    }
  }

  async syncSlackUserProfile(
    slackUserId: string,
    slackDisplayName: string,
  ): Promise<void> {
    const user =
      await this.getOrCreateUser(
        slackUserId,
      );

    const cleanDisplayName =
      slackDisplayName?.trim();

    if (
      !cleanDisplayName ||
      cleanDisplayName ===
        slackUserId ||
      user.slackDisplayName ===
        cleanDisplayName
    ) {
      return;
    }

    await this.prisma.user.update({
      where: {
        id: user.id,
      },

      data: {
        slackDisplayName:
          cleanDisplayName,
      },
    });

    this.logger.log(
      `Updated display name for Slack user ${slackUserId}`,
    );
  }

  async getAppHomeSummary(
    userIdentifier: string,
  ): Promise<AppHomeSummary> {
    const user =
      await this.getOrCreateUser(
        userIdentifier,
      );

    const activeCheckIns =
      await this.getActiveCheckInOptions(userIdentifier);

    const activeQuestionCount =
      activeCheckIns.reduce(
        (total, option) => total + option.totalQuestions,
        0,
      );

    const session =
      await this.prisma.conversationState.findFirst({
        where: {
          userId:
            user.id,
        },

        orderBy: {
          updatedAt: 'desc',
        },
      });

    let status:
      AppHomeSummary['status'] =
      'not_started';

    if (activeCheckIns.length > 0) {
      status = 'in_progress';
    } else if (
      session?.isCompleted
    ) {
      status = 'completed';
    }

    const focusedCheckInName =
      user.focusedSubmissionId
        ? activeCheckIns.find(
            (option) =>
              option.submissionId ===
              user.focusedSubmissionId,
          )?.checkInName ?? null
        : null;

    return {
      activeQuestionCount,
      status,
      lastCompletedAt:
        session?.completedAt ??
        null,
      activeCheckIns,
      focusedCheckInName,
    };
  }

  async startConversation(
    userIdentifier: string,
  ): Promise<QuestionPayloadDto | null> {
    const user =
      await this.getOrCreateUser(
        userIdentifier,
      );

    const userId =
      user.id;

    this.logger.log(
      `Starting conversation for user ${userId} (identifier: ${userIdentifier})`,
    );

    const existingSession =
      await this.prisma.conversationState.findFirst({
        where: {
          userId,
          isCompleted: false,
        },

        orderBy: {
          updatedAt: 'desc',
        },
      });

    if (
      existingSession
    ) {
      const currentQuestion =
        await this.getCurrentQuestion(
          userIdentifier,
        );

      if (
        currentQuestion
      ) {
        return currentQuestion;
      }

      return this.getNextQuestion(
        userIdentifier,
      );
    }

    const {
      submission,
    } =
      await this.createStandupSubmission(
        userId,
      );

    const startedAt =
      new Date();

    const session =
      await this.prisma.conversationState.create({
        data: {
          userId,
          submissionId:
            submission.id,
          startedAt,
          isCompleted: false,
        },
      });

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
      this.logger.warn(
        'No active questions were found.',
      );

      const cancelledAt =
        new Date();

      await this.prisma.standupSubmission.update({
        where: {
          id:
            submission.id,
        },

        data: {
          status:
            'cancelled',

          completedAt:
            cancelledAt,
        },
      });

      await this.prisma.conversationState.update({
        where: {
          id:
            session.id,
        },

        data: {
          isCompleted:
            true,

          completedAt:
            cancelledAt,
        },
      });

      return null;
    }

    await this.prisma.conversationState.update({
      where: {
        id: session.id,
      },

      data: {
        currentQuestionId:
          firstQuestion.id,
      },
    });

    return this.toQuestionPayload(
      firstQuestion,
    );
  }

  private async getUnansweredQuestionState(
    submissionId: string,
    checkInId: string | null,
  ): Promise<{
    question: {
      id: string;
      question: string;
      type: QuestionType;
      options: Prisma.JsonValue | null;
    };
    questionNumber: number;
    totalQuestions: number;
  } | null> {
    const activeQuestions =
      await this.getQuestionsForConversation(checkInId);

    if (activeQuestions.length === 0) {
      return null;
    }

    const answers = await this.prisma.answer.findMany({
      where: { submissionId },
      select: { questionId: true },
    });

    const answeredIds = new Set(
      answers.map((answer) => answer.questionId),
    );

    const nextIndex = activeQuestions.findIndex(
      (question) => !answeredIds.has(question.id),
    );

    if (nextIndex === -1) {
      return null;
    }

    return {
      question: activeQuestions[nextIndex],
      questionNumber: nextIndex + 1,
      totalQuestions: activeQuestions.length,
    };
  }

  private async syncCurrentQuestionPointer(
    conversationStateId: string,
    submissionId: string,
    checkInId: string | null,
  ): Promise<QuestionPayloadDto | null> {
    const next = await this.getUnansweredQuestionState(
      submissionId,
      checkInId,
    );

    await this.prisma.conversationState.update({
      where: { id: conversationStateId },
      data: {
        currentQuestionId: next?.question.id ?? null,
      },
    });

    if (!next) {
      return null;
    }

    return this.toQuestionPayload(
      next.question,
      next.questionNumber,
      next.totalQuestions,
    );
  }

  async submitAnswer(
    userIdentifier: string,
    questionId: string,
    answer: string,
    submissionId?: string,
  ): Promise<QuestionPayloadDto | null> {
    const normalizedAnswer =
      answer?.trim();

    if (
      !normalizedAnswer
    ) {
      throw new BadRequestException(
        'Answer cannot be empty.',
      );
    }

    const user =
      await this.getOrCreateUser(
        userIdentifier,
      );

    const userId =
      user.id;

    this.logger.log(
      `Submitting answer for question ${questionId} from user ${userId} (identifier: ${userIdentifier})`,
    );

    const session = submissionId
      ? await this.getConversationStateForSubmission(
          userId,
          submissionId,
        )
      : await this.getActiveConversationState(
          userId,
        );

    if (
      !session ||
      !session.submissionId ||
      !session.submission
    ) {
      this.logger.warn(
        `User ${userIdentifier} attempted to answer question ${questionId}, but no matching active CheckIn conversation was found.`,
      );

      throw new BadRequestException(
        'This reply does not match the user\'s active check-in question.',
      );
    }

    const checkInId =
      session.submission.run
        .checkInId;

    const expectedQuestion =
      await this.getUnansweredQuestionState(
        session.submissionId,
        checkInId,
      );

    if (
      !expectedQuestion ||
      expectedQuestion.question.id !== questionId
    ) {
      this.logger.warn(
        `[Conversation] Answer rejected for submission ${session.submissionId}: expected question ${expectedQuestion?.question.id ?? 'none'}, received ${questionId}`,
      );
      throw new BadRequestException(
        'This reply does not match the user\'s active check-in question.',
      );
    }

    this.logger.log(
      `[Conversation] Answering question #${expectedQuestion.questionNumber}/${expectedQuestion.totalQuestions} (${questionId}) for submission ${session.submissionId}`,
    );

    const question =
      await this.prisma.question.findFirst({
        where: {
          id:
            questionId,

          isActive:
            true,

          ...(checkInId
            ? {
                checkInId,
              }
            : {
                checkInId:
                  null,
              }),
        },

        select: {
          id: true,
          type: true,
          options: true,
        },
      });

    if (!question) {
      throw new BadRequestException(
        checkInId
          ? 'This question does not belong to the active check-in.'
          : 'This standup question is no longer active.',
      );
    }

    const validatedAnswer =
      this.validateAnswerForQuestion(
        question,
        normalizedAnswer,
      );

    const nextQuestion = await this.prisma.$transaction(async (tx) => {
      await tx.answer.upsert({
        where: {
          submissionId_questionId: {
            submissionId: session.submissionId,
            questionId,
          },
        },
        update: {
          text: validatedAnswer.text,
          structuredValue: validatedAnswer.structuredValue,
        },
        create: {
          userId,
          questionId,
          submissionId: session.submissionId,
          text: validatedAnswer.text,
          structuredValue: validatedAnswer.structuredValue,
        },
      });

      if (session.submission.status === 'pending') {
        await tx.standupSubmission.update({
          where: { id: session.submission.id },
          data: {
            status: 'in_progress',
            startedAt: session.submission.startedAt ?? new Date(),
          },
        });
      }

      const answers = await tx.answer.findMany({
        where: { submissionId: session.submissionId },
        select: { questionId: true },
      });
      const answeredIds = new Set(answers.map((answer) => answer.questionId));
      const activeQuestions = await tx.question.findMany({
        where: { isActive: true, checkInId },
        orderBy: { order: 'asc' },
      });
      const nextIndex = activeQuestions.findIndex(
        (activeQuestion) => !answeredIds.has(activeQuestion.id),
      );

      const nextQuestionId =
        nextIndex === -1 ? null : activeQuestions[nextIndex].id;

      await tx.conversationState.update({
        where: { id: session.id },
        data: { currentQuestionId: nextQuestionId },
      });

      if (nextIndex === -1) {
        return null;
      }

      const next = activeQuestions[nextIndex];
      this.logger.log(
        `[Pipeline] nextQuestion queried submission=${session.submissionId} answered=${answeredIds.size}/${activeQuestions.length} next=#${nextIndex + 1} id=${next.id}`,
      );
      return this.toQuestionPayload(
        next,
        nextIndex + 1,
        activeQuestions.length,
      );
    });

    this.logger.log(
      `[Answer Saved] Answer saved for question ${questionId} by user ${userId} in submission ${session.submissionId}.`,
    );

    if (nextQuestion) {
      this.logger.log(
        `[Conversation] Advanced submission ${session.submissionId} to question #${nextQuestion.questionNumber}/${nextQuestion.totalQuestions} (${nextQuestion.questionId})`,
      );
    } else {
      this.logger.log(
        `[Conversation] Submission ${session.submissionId} has no more questions after ${questionId}`,
      );
    }

    return nextQuestion;
  }

  async getNextQuestion(
    userIdentifier: string,
    submissionId?: string,
  ): Promise<QuestionPayloadDto | null> {
    const user =
      await this.getOrCreateUser(
        userIdentifier,
      );

    const userId =
      user.id;

    const session = submissionId
      ? await this.getConversationStateForSubmission(userId, submissionId)
      : await this.getActiveConversationState(userId);

    if (
      !session ||
      !session.submissionId ||
      !session.submission
    ) {
      return null;
    }

    return this.syncCurrentQuestionPointer(
      session.id,
      session.submissionId,
      session.submission.run.checkInId,
    );
  }

  async finishConversation(
    userIdentifier: string,
  ): Promise<string | null> {
    const result =
      await this.completeConversation(
        userIdentifier,
      );

    return result?.submissionId ?? null;
  }

  async completeConversation(
    userIdentifier: string,
    submissionId?: string,
  ): Promise<{
    submissionId: string;
    checkInName: string | null;
  } | null> {
    const user =
      await this.getOrCreateUser(
        userIdentifier,
      );

    const session = submissionId
      ? await this.getConversationStateForSubmission(user.id, submissionId)
      : await this.getActiveConversationState(user.id);

    if (!session) {
      return null;
    }

    let checkInName: string | null = null;
    const checkInId =
      session.submission.run.checkInId;

    if (checkInId) {
      const checkIn =
        await this.prisma.checkIn.findUnique({
          where: { id: checkInId },
          select: { name: true },
        });

      checkInName = checkIn?.name ?? null;
    }

    const completedSubmissionId = session.submissionId;

    await this.finishConversationState(
      session.id,
    );

    return {
      submissionId: completedSubmissionId,
      checkInName,
    };
  }

  async activateNextQueuedSubmission(
    userIdentifier: string,
  ): Promise<{
    submissionId: string;
    slackUserId: string;
    displayName: string;
    checkInName: string;
    firstQuestionText: string;
    totalQuestions: number;
  } | null> {
    const user =
      await this.getOrCreateUser(
        userIdentifier,
      );

    const activeSession =
      await this.getActiveConversationState(
        user.id,
      );

    if (activeSession) {
      return null;
    }

    const queuedSubmission =
      await this.prisma.standupSubmission.findFirst({
        where: {
          userId: user.id,
          status: 'queued',
          run: {
            status: 'collecting',
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
        include: {
          user: true,
          run: {
            include: {
              checkIn: {
                include: {
                  questions: {
                    where: { isActive: true },
                    orderBy: { order: 'asc' },
                  },
                },
              },
            },
          },
        },
      });

    if (
      !queuedSubmission?.run.checkIn ||
      queuedSubmission.run.checkIn.questions.length === 0
    ) {
      return null;
    }

    const firstQuestion =
      queuedSubmission.run.checkIn.questions[0];

    await this.prisma.$transaction(
      async (tx) => {
        await tx.standupSubmission.update({
          where: {
            id: queuedSubmission.id,
          },
          data: {
            status: 'pending',
          },
        });

        await tx.conversationState.create({
          data: {
            userId: user.id,
            submissionId: queuedSubmission.id,
            currentQuestionId: firstQuestion.id,
            isCompleted: false,
          },
        });
      },
    );

    this.logger.log(
      `Activated queued CheckIn "${queuedSubmission.run.checkIn.name}" for user ${user.slackUserId}.`,
    );

    return {
      submissionId: queuedSubmission.id,
      slackUserId: user.slackUserId,
      displayName:
        user.slackDisplayName ||
        user.slackUserId,
      checkInName:
        queuedSubmission.run.checkIn.name,
      firstQuestionText:
        firstQuestion.question,
      totalQuestions:
        queuedSubmission.run.checkIn.questions.length,
    };
  }

  private async finishConversationState(
    conversationStateId: string,
  ): Promise<void> {
    const session =
      await this.prisma.conversationState.findUnique({
        where: {
          id:
            conversationStateId,
        },

        include: {
          submission: true,
        },
      });

    if (
      !session ||
      session.isCompleted
    ) {
      return;
    }

    const completedAt =
      new Date();

    await this.prisma.$transaction(
      async (tx) => {
        await tx.conversationState.update({
          where: {
            id:
              session.id,
          },

          data: {
            isCompleted:
              true,

            currentQuestionId:
              null,

            completedAt,
          },
        });

        await tx.standupSubmission.update({
          where: {
            id:
              session.submissionId,
          },

          data: {
            status:
              'completed',

            completedAt,
          },
        });

        await tx.user.updateMany({
          where: {
            id: session.userId,
            focusedSubmissionId: session.submissionId,
          },
          data: {
            focusedSubmissionId: null,
          },
        });
      },
    );

    const incompleteSubmissionCount =
      await this.prisma.standupSubmission.count({
        where: {
          runId:
            session.submission
              .runId,

          status: {
            not:
              'completed',
          },
        },
      });

    if (
      incompleteSubmissionCount ===
      0
    ) {
      const runId = session.submission.runId;

      await this.prisma.standupRun.update({
        where: {
          id: runId,
        },

        data: {
          status:
            'completed',

          completedAt,
        },
      });
    }
  }

  async getCurrentQuestionForThread(
    slackUserId: string,
    threadTs: string,
  ): Promise<QuestionPayloadDto | null> {
    const user = await this.getOrCreateUser(slackUserId);

    const run = await this.prisma.standupRun.findFirst({
      where: {
        slackThreadTs: threadTs,
        status: { not: 'completed' },
      },
    });

    if (!run) {
      return null;
    }

    const session = await this.prisma.conversationState.findFirst({
      where: {
        userId: user.id,
        isCompleted: false,
        submission: { runId: run.id },
      },
      include: {
        submission: { include: { run: true } },
      },
    });

    if (!session?.submission) {
      return null;
    }

    if (!session.currentQuestionId) {
      return this.getNextQuestion(slackUserId);
    }

    const activeQuestions = await this.getQuestionsForConversation(run.checkInId);
    const questionIndex = activeQuestions.findIndex(
      (q) => q.id === session.currentQuestionId,
    );

    if (questionIndex === -1) {
      return this.getNextQuestion(slackUserId);
    }

    return this.toQuestionPayload(
      activeQuestions[questionIndex],
      questionIndex + 1,
      activeQuestions.length,
    );
  }

  async getCurrentQuestion(
    userIdentifier: string,
  ): Promise<QuestionPayloadDto | null> {
    const user =
      await this.getOrCreateUser(
        userIdentifier,
      );

    const session =
      await this.getActiveConversationState(
        user.id,
      );

    if (
      !session ||
      !session.currentQuestionId ||
      !session.submission
    ) {
      return null;
    }

    const activeQuestions =
      await this.getQuestionsForConversation(
        session.submission
          .run.checkInId,
      );

    const questionIndex =
      activeQuestions.findIndex(
        (question) =>
          question.id ===
          session.currentQuestionId,
      );

    if (
      questionIndex === -1
    ) {
      return this.getNextQuestion(
        userIdentifier,
      );
    }

    const question =
      activeQuestions[
        questionIndex
      ];

    return this.toQuestionPayload(
      question,
      questionIndex + 1,
      activeQuestions.length,
    );
  }

  async getCompletedStandupResponses(
    teamId?: string,
  ): Promise<StandupResponse[]> {
    const submissions =
      await this.prisma.standupSubmission.findMany({
        where: {
          status:
            'completed',

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
                    optedOut:
                      false,
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
              createdAt:
                'asc',
            },
          },
        },

        orderBy: {
          completedAt:
            'desc',
        },
      });

    const newestSubmissionByUser =
      new Map<
        string,
        (typeof submissions)[number]
      >();

    for (
      const submission
      of submissions
    ) {
      if (
        !newestSubmissionByUser.has(
          submission.userId,
        )
      ) {
        newestSubmissionByUser.set(
          submission.userId,
          submission,
        );
      }
    }

    const responses:
      StandupResponse[] = [];

    for (
      const submission
      of newestSubmissionByUser.values()
    ) {
      if (
        submission.answers
          .length === 0
      ) {
        continue;
      }

      const blockerAnswer =
        submission.answers.find(
          (answer) =>
            answer.question.question
              .toLowerCase()
              .includes(
                'blocker',
              ),
        );

      const updateAnswers =
        submission.answers.filter(
          (answer) =>
            answer.id !==
            blockerAnswer?.id,
        );

      responses.push({
        userId:
          submission.user
            .slackUserId,

        name:
          submission.user
            .slackDisplayName ||
          submission.user
            .slackUserId,

        update:
          updateAnswers
            .map(
              (answer) =>
                `*${answer.question.question}*\n${answer.text}`,
            )
            .join('\n'),

        blocker:
          blockerAnswer?.text ||
          undefined,

        submittedAt: (
          submission.completedAt ??
          new Date()
        ).toISOString(),
      });
    }

    if (
      responses.length ===
      0
    ) {
      return this.getLegacyCompletedResponses(
        teamId,
      );
    }

    return responses;
  }

  private async getLegacyCompletedResponses(
    teamId?: string,
  ): Promise<StandupResponse[]> {
    const completedSessions =
      await this.prisma.conversationState.findMany({
        where: {
          isCompleted:
            true,

          completedAt: {
            not: null,
          },

          user: teamId
            ? {
                teamMembers: {
                  some: {
                    teamId,
                    optedOut:
                      false,
                  },
                },
              }
            : undefined,
        },

        include: {
          user: true,
        },

        orderBy: {
          completedAt:
            'desc',
        },
      });

    const responses:
      StandupResponse[] = [];

    for (
      const session
      of completedSessions
    ) {
      const answers =
        await this.prisma.answer.findMany({
          where: {
            userId:
              session.userId,

            submissionId:
              null,

            createdAt: {
              gte:
                session.startedAt,
            },
          },

          include: {
            question: true,
          },

          orderBy: {
            createdAt:
              'asc',
          },
        });

      if (
        answers.length ===
        0
      ) {
        continue;
      }

      const blockerAnswer =
        answers.find(
          (answer) =>
            answer.question.question
              .toLowerCase()
              .includes(
                'blocker',
              ),
        );

      const updateAnswers =
        answers.filter(
          (answer) =>
            answer.id !==
            blockerAnswer?.id,
        );

      responses.push({
        userId:
          session.user
            .slackUserId,

        name:
          session.user
            .slackDisplayName ||
          session.user
            .slackUserId,

        update:
          updateAnswers
            .map(
              (answer) =>
                `*${answer.question.question}*\n${answer.text}`,
            )
            .join('\n'),

        blocker:
          blockerAnswer?.text ||
          undefined,

        submittedAt: (
          session.completedAt ??
          new Date()
        ).toISOString(),
      });
    }

    return responses;
  }

  async getTeamNonResponders(
    teamId: string,
    completedResponses:
      StandupResponse[],
  ): Promise<
    StandupNonResponder[]
  > {
    const completedUserIds =
      completedResponses.map(
        (response) =>
          response.userId,
      );

    const teamMembers =
      await this.prisma.teamMember.findMany({
        where: {
          teamId,
          optedOut: false,

          user: {
            slackUserId: {
              notIn:
                completedUserIds,
            },
          },
        },

        include: {
          user: true,
        },

        orderBy: {
          joinedAt:
            'asc',
        },
      });

    return teamMembers.map(
      (member) => ({
        userId:
          member.user
            .slackUserId,

        name:
          member.user
            .slackDisplayName ||
          member.user
            .slackUserId,
      }),
    );
  }

  async startTeamStandup(
    teamId: string,
  ): Promise<
    Array<{
      userId: string;
      name: string;
      question:
        QuestionPayloadDto;
    }>
  > {
    const team =
      await this.prisma.team.findUnique({
        where: {
          id:
            teamId,
        },

        include: {
          teamMembers: {
            where: {
              optedOut:
                false,
            },

            include: {
              user: true,
            },

            orderBy: {
              joinedAt:
                'asc',
            },
          },
        },
      });

    if (!team) {
      throw new NotFoundException(
        `Team ${teamId} was not found.`,
      );
    }

    if (
      !team.schedulerEnabled
    ) {
      throw new BadRequestException(
        `Scheduling is disabled for team ${team.name}.`,
      );
    }

    if (
      team.teamMembers
        .length === 0
    ) {
      return [];
    }

    const firstQuestion =
      await this.prisma.question.findFirst({
        where: {
          isActive:
            true,
        },

        orderBy: {
          order:
            'asc',
        },
      });

    if (!firstQuestion) {
      throw new NotFoundException(
        'No active standup questions were found.',
      );
    }

    const now =
      new Date();

    const run =
      await this.prisma.standupRun.create({
        data: {
          teamId:
            team.id,

          scheduledFor:
            now,

          status:
            'collecting',

          startedAt:
            now,
        },
      });

    const prompts:
      Array<{
        userId: string;
        name: string;
        question:
          QuestionPayloadDto;
      }> = [];

    for (
      const member
      of team.teamMembers
    ) {
      const submission =
        await this.prisma.standupSubmission.create({
          data: {
            runId:
              run.id,

            userId:
              member.user.id,

            status:
              'in_progress',

            startedAt:
              now,
          },
        });

      await this.prisma.conversationState.create({
        data: {
          userId:
            member.user.id,

          submissionId:
            submission.id,

          currentQuestionId:
            firstQuestion.id,

          isCompleted:
            false,

          startedAt:
            now,
        },
      });

      prompts.push({
        userId:
          member.user
            .slackUserId,

        name:
          member.user
            .slackDisplayName ||
          member.user
            .slackUserId,

        question:
          this.toQuestionPayload(
            firstQuestion,
          ),
      });
    }

    return prompts;
  }

  async getPendingTeamStandupMembers(
    teamId: string,
  ): Promise<
    Array<{
      userId: string;
      name: string;
      currentQuestion:
        QuestionPayloadDto | null;
    }>
  > {
    const latestRun =
      await this.prisma.standupRun.findFirst({
        where: {
          teamId,
          status:
            'collecting',
        },

        orderBy: {
          startedAt:
            'desc',
        },

        include: {
          submissions: {
            where: {
              status: {
                not:
                  'completed',
              },
            },

            include: {
              user: true,
              conversationState:
                true,
            },
          },
        },
      });

    if (!latestRun) {
      return [];
    }

    const pendingMembers:
      Array<{
        userId: string;
        name: string;
        currentQuestion:
          QuestionPayloadDto | null;
      }> = [];

    for (
      const submission
      of latestRun.submissions
    ) {
      const session =
        submission.conversationState;

      let currentQuestion:
        QuestionPayloadDto | null =
        null;

      if (
        session?.submissionId ===
          submission.id &&
        session.currentQuestionId
      ) {
        const question =
          await this.prisma.question.findUnique({
            where: {
              id:
                session.currentQuestionId,
            },
          });

        if (
          question?.isActive
        ) {
          currentQuestion =
            this.toQuestionPayload(
              question,
            );
        }
      }

      pendingMembers.push({
        userId:
          submission.user
            .slackUserId,

        name:
          submission.user
            .slackDisplayName ||
          submission.user
            .slackUserId,

        currentQuestion,
      });
    }

    return pendingMembers;
  }

  async getRunResponses(
    runId: string,
  ): Promise<
    StandupResponse[]
  > {
    const submissions =
      await this.prisma.standupSubmission.findMany({
        where: {
          runId,
          status:
            'completed',
        },

        include: {
          user: true,

          answers: {
            include: {
              question: true,
            },

            orderBy: {
              createdAt:
                'asc',
            },
          },
        },

        orderBy: {
          completedAt:
            'asc',
        },
      });

    return submissions
      .filter(
        (submission) =>
          submission.answers
            .length > 0,
      )
      .map(
        (submission) => {
          const blockerAnswer =
            submission.answers.find(
              (answer) =>
                answer.question.question
                  .toLowerCase()
                  .includes(
                    'blocker',
                  ),
            );

          const updateAnswers =
            submission.answers.filter(
              (answer) =>
                answer.id !==
                blockerAnswer?.id,
            );

          return {
            userId:
              submission.user
                .slackUserId,

            name:
              submission.user
                .slackDisplayName ||
              submission.user
                .slackUserId,

            update:
              updateAnswers
                .map(
                  (answer) =>
                    `*${answer.question.question}*\n${answer.text}`,
                )
                .join(
                  '\n',
                ),

            blocker:
              blockerAnswer?.text ||
              undefined,

            submittedAt: (
              submission.completedAt ??
              new Date()
            ).toISOString(),
          };
        },
      );
  }

  private async getConversationStateForSubmission(
    userId: string,
    submissionId: string,
    questionId?: string,
  ) {
    const session = await this.prisma.conversationState.findFirst({
      where: {
        submissionId,
        isCompleted: false,
        ...(questionId ? { currentQuestionId: questionId } : {}),
      },
      include: {
        submission: {
          include: {
            run: true,
          },
        },
      },
    });

    if (!session || session.submission.userId !== userId) {
      return null;
    }

    return session;
  }

  async resolveDmThreadContext(
    slackUserId: string,
    threadTs: string,
    channelId?: string,
  ): Promise<DmThreadContext | null> {
    return this.resolveActiveDmSubmissionContext(
      slackUserId,
      channelId,
      threadTs,
    );
  }

  /**
   * Resolves the active CheckIn DM submission for a user.
   * Matches by thread anchor first, then falls back to the DM channel so
   * replies without thread_ts (common after the 2nd+ in-thread message) still route correctly.
   */
  async resolveActiveDmSubmissionContext(
    slackUserId: string,
    channelId?: string,
    threadTs?: string,
  ): Promise<DmThreadContext | null> {
    const user = await this.getOrCreateUser(slackUserId);

    const submissionInclude = {
      run: {
        include: {
          checkIn: {
            select: { name: true },
          },
        },
      },
    } as const;

    const activeStatuses = ['pending', 'in_progress'];

    if (threadTs?.trim()) {
      const byThread = await this.prisma.standupSubmission.findFirst({
        where: {
          userId: user.id,
          slackDmThreadTs: threadTs.trim(),
          status: { in: activeStatuses },
          run: { status: 'collecting' },
        },
        include: submissionInclude,
      });

      if (byThread?.slackDmChannelId && byThread.slackDmThreadTs) {
        this.logger.log(
          `[DM Context] Matched submission ${byThread.id} by thread ${byThread.slackDmThreadTs}`,
        );
        return {
          submissionId: byThread.id,
          runId: byThread.runId,
          threadTs: byThread.slackDmThreadTs,
          channelId: byThread.slackDmChannelId,
          checkInName: byThread.run.checkIn?.name ?? 'CheckIn',
        };
      }
    }

    if (channelId?.trim()) {
      const byChannel = await this.prisma.standupSubmission.findFirst({
        where: {
          userId: user.id,
          slackDmChannelId: channelId.trim(),
          status: { in: activeStatuses },
          run: { status: 'collecting' },
        },
        orderBy: { createdAt: 'desc' },
        include: submissionInclude,
      });

      if (byChannel?.slackDmChannelId && byChannel.slackDmThreadTs) {
        this.logger.log(
          `[DM Context] Matched submission ${byChannel.id} by channel ${byChannel.slackDmChannelId}` +
            (threadTs ? ` (reply thread_ts ${threadTs} did not match anchor ${byChannel.slackDmThreadTs})` : ' (no thread_ts on reply)'),
        );
        return {
          submissionId: byChannel.id,
          runId: byChannel.runId,
          threadTs: byChannel.slackDmThreadTs,
          channelId: byChannel.slackDmChannelId,
          checkInName: byChannel.run.checkIn?.name ?? 'CheckIn',
        };
      }
    }

    this.logger.warn(
      `[DM Context] No active submission for user ${slackUserId}` +
        (channelId ? ` in channel ${channelId}` : '') +
        (threadTs ? ` thread ${threadTs}` : ''),
    );

    return null;
  }

  async getCurrentQuestionForSubmission(
    submissionId: string,
  ): Promise<QuestionPayloadDto | null> {
    const session = await this.prisma.conversationState.findFirst({
      where: {
        submissionId,
        isCompleted: false,
      },
      include: {
        submission: {
          include: { run: true },
        },
      },
    });

    if (!session?.submission) {
      this.logger.warn(
        `[Conversation] No active ConversationState for submission ${submissionId}`,
      );
      return null;
    }

    const next = await this.getUnansweredQuestionState(
      submissionId,
      session.submission.run.checkInId,
    );

    if (!next) {
      this.logger.log(
        `[Conversation] Submission ${submissionId} has no remaining questions`,
      );
      return null;
    }

    this.logger.log(
      `[Conversation] Current question for submission ${submissionId}: #${next.questionNumber}/${next.totalQuestions} (${next.question.id})`,
    );

    return this.toQuestionPayload(
      next.question,
      next.questionNumber,
      next.totalQuestions,
    );
  }

  async getCheckInConfigForSubmission(submissionId: string) {
    const submission = await this.prisma.standupSubmission.findUnique({
      where: { id: submissionId },
      select: {
        run: {
          select: {
            checkIn: {
              select: {
                id: true,
                name: true,
                introMessage: true,
                outroMessage: true,
              },
            },
          },
        },
      },
    });

    return submission?.run.checkIn ?? null;
  }

  async setSubmissionDmAnchor(
    submissionId: string,
    dmChannelId: string,
    threadTs: string,
  ): Promise<void> {
    await this.prisma.standupSubmission.update({
      where: { id: submissionId },
      data: {
        slackDmChannelId: dmChannelId,
        slackDmThreadTs: threadTs,
      },
    });

    const submission = await this.prisma.standupSubmission.findUnique({
      where: { id: submissionId },
      select: { userId: true },
    });

    if (submission) {
      await this.prisma.user.update({
        where: { id: submission.userId },
        data: { focusedSubmissionId: submissionId },
      });
    }
  }

  async setSubmissionDmChannel(submissionId: string, dmChannelId: string): Promise<void> {
    await this.prisma.standupSubmission.update({
      where: { id: submissionId },
      data: { slackDmChannelId: dmChannelId },
    });
  }

  async getActiveCheckInConfigForUser(slackUserId: string) {
    const user = await this.getOrCreateUser(slackUserId);
    const session = await this.getActiveConversationState(user.id);
    const checkInId = session?.submission?.run?.checkInId;
    if (!checkInId) return null;

    return this.prisma.checkIn.findUnique({
      where: { id: checkInId },
      select: {
        id: true,
        name: true,
        introMessage: true,
        outroMessage: true,
      },
    });
  }

  async getActiveSubmissionDmChannel(slackUserId: string): Promise<string | null> {
    const user = await this.getOrCreateUser(slackUserId);

    const submission = await this.prisma.standupSubmission.findFirst({
      where: {
        userId: user.id,
        status: { in: ['pending', 'in_progress'] },
        slackDmChannelId: { not: null },
        run: { status: 'collecting' },
      },
      orderBy: { updatedAt: 'desc' },
      select: { slackDmChannelId: true },
    });

    return submission?.slackDmChannelId ?? null;
  }

  async countOtherActiveCheckIns(
    userIdentifier: string,
    excludeSubmissionId?: string,
  ): Promise<number> {
    const user = await this.getOrCreateUser(userIdentifier);
    const sessions = await this.getIncompleteConversationStates(user.id);

    return sessions.filter(
      (session) => session.submissionId !== excludeSubmissionId,
    ).length;
  }

  async selectCheckInByIndex(
    userIdentifier: string,
    selectedIndex: number,
  ): Promise<{
    option: ActiveCheckInOption;
    currentQuestion: QuestionPayloadDto;
  } | null> {
    const options = await this.getActiveCheckInOptions(userIdentifier);
    const option = options[selectedIndex];

    if (!option) {
      return null;
    }

    await this.setFocusedSubmission(
      userIdentifier,
      option.submissionId,
    );

    const currentQuestion = await this.getCurrentQuestion(userIdentifier);
    if (!currentQuestion) {
      return null;
    }

    return { option, currentQuestion };
  }

  async getPendingRunMembers(
    runId: string,
  ): Promise<
    Array<{
      userId: string;
      name: string;
      dmChannelId: string | null;
      currentQuestion:
        QuestionPayloadDto | null;
    }>
  > {
    const run =
      await this.prisma.standupRun.findUnique({
        where: {
          id:
            runId,
        },

        include: {
          submissions: {
            where: {
              status: {
                in: ['pending', 'in_progress'],
              },
            },

            include: {
              user: true,

              conversationState: {
                include: {
                  currentQuestion:
                    true,
                },
              },
            },
          },
        },
      });

    if (!run) {
      throw new NotFoundException(
        `StandupRun ${runId} was not found.`,
      );
    }

    return run.submissions.map(
      (submission) => {
        const question =
          submission
            .conversationState
            ?.currentQuestion;

        return {
          userId: submission.user.slackUserId,
          name: submission.user.slackDisplayName || submission.user.slackUserId,
          dmChannelId: submission.slackDmChannelId,
          currentQuestion:
            question && question.isActive
              ? this.toQuestionPayload(question)
              : null,
        };
      },
    );
  }

  async getRunNonResponders(
    runId: string,
  ): Promise<
    StandupNonResponder[]
  > {
    const pending =
      await this.getPendingRunMembers(
        runId,
      );

    return pending.map(
      (member) => ({
        userId:
          member.userId,

        name:
          member.name,
      }),
    );
  }

  async isStandupCompletedToday(
    slackUserId: string,
  ): Promise<boolean> {
    const user =
      await this.prisma.user.findUnique({
        where: {
          slackUserId,
        },
      });

    if (!user) {
      return false;
    }

    const session =
      await this.prisma.conversationState.findFirst({
        where: {
          userId:
            user.id,

          isCompleted:
            true,

          completedAt: {
            not: null,
          },
        },

        orderBy: {
          completedAt:
            'desc',
        },
      });

    if (
      !session ||
      !session.isCompleted ||
      !session.completedAt
    ) {
      return false;
    }

    const startOfToday =
      new Date();

    startOfToday.setHours(
      0,
      0,
      0,
      0,
    );

    return (
      session.completedAt >=
      startOfToday
    );
  }

  async startDailyStandupForUser(
    slackUserId: string,
  ): Promise<QuestionPayloadDto | null> {
    return this.startConversation(
      slackUserId,
    );
  }

  async getDailyDigestData(
    workspaceMembers: {
      id: string;
      name: string;
    }[],
  ): Promise<{
    completedResponses:
      StandupResponse[];
    noUpdateUsers:
      string[];
  }> {
    const completedResponses =
      await this.getCompletedStandupResponses();

    const completedSlackUserIds =
      new Set(
        completedResponses.map(
          (response) =>
            response.userId,
        ),
      );

    const noUpdateUsers =
      workspaceMembers
        .filter(
          (member) =>
            !completedSlackUserIds.has(
              member.id,
            ),
        )
        .map(
          (member) =>
            member.name,
        );

    return {
      completedResponses,
      noUpdateUsers,
    };
  }
}