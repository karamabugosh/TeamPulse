import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { QuestionType } from '@prisma/client';

import { CollectionService } from '../collection/collection.service';
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { QuestionPayloadDto } from './dto/question-payload.dto';
import { SlackService } from './slack.service';

@Injectable()
export class SlackGateway {
  private readonly logger =
    new Logger(SlackGateway.name);

  constructor(
    private readonly slackService: SlackService,
    private readonly collectionService: CollectionService,
  ) {}

  // =========================================================
  // INCOMING MESSAGE FLOW
  // =========================================================

  /**
   * Handles normal Slack messages and controls the
   * V2 CheckIn conversation flow.
   */
  async handleIncomingMessage(
    payload: IncomingMessageDto,
  ): Promise<void> {
    this.logger.log(
      `Received message from user ${payload.userId} in channel ${payload.channelId}.`,
    );

    try {
      await this.syncUserDisplayName(
        payload.userId,
      );

      const currentQuestion =
        await this.collectionService.getCurrentQuestion(
          payload.userId,
        );

      /*
       * If the user already has an active question,
       * the incoming Slack message is its answer.
       */
      if (currentQuestion) {
        await this.processAnswer(
          payload,
          currentQuestion,
        );

        return;
      }

      const normalizedMessage =
        payload.message
          .trim()
          .toLowerCase();

      /*
       * "start", "hi", and "hello" may resume an already
       * prepared V2 CheckIn conversation.
       *
       * They must NOT silently create a legacy V1 run.
       */
      if (
        [
          'start',
          'hi',
          'hello',
        ].includes(
          normalizedMessage,
        )
      ) {
        await this.startConversationFlow(
          payload.userId,
          payload.channelId,
        );

        return;
      }

      this.logger.debug(
        `No active CheckIn conversation for user ${payload.userId}.`,
      );

      await this.slackService.sendMessage({
        channelId:
          payload.channelId,

        text:
          "You don't have an active check-in right now.",
      });
    } catch (
      error: unknown
    ) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      const stack =
        error instanceof Error
          ? error.stack
          : undefined;

      this.logger.error(
        `Error handling incoming message for user ${payload.userId}: ${message}`,
        stack,
      );

      await this.slackService.sendMessage({
        channelId:
          payload.channelId,

        text:
          '❌ An error occurred processing your request.',
      });
    }
  }

  // =========================================================
  // PROFILE SYNC
  // =========================================================

  private async syncUserDisplayName(
    slackUserId: string,
  ): Promise<void> {
    const displayName =
      await this.slackService.getUserDisplayName(
        slackUserId,
      );

    await this.collectionService.syncSlackUserProfile(
      slackUserId,
      displayName,
    );
  }

  // =========================================================
  // LEGACY AUTOMATIC STANDUP
  // =========================================================

  /**
   * Legacy compatibility entry point.
   *
   * V2 scheduling normally creates StandupRun +
   * StandupSubmission + ConversationState through the
   * CheckIn run layer.
   *
   * This method is retained because older scheduler paths
   * may still call it, but normal Slack "hello/start"
   * handling no longer creates a V1 run.
   */
  async triggerAutomaticStandupForUser(
    userId: string,
    channelId: string,
  ): Promise<void> {
    this.logger.log(
      `Triggering legacy automatic standup for user ${userId}.`,
    );

    const firstQuestion =
      await this.collectionService.startDailyStandupForUser(
        userId,
      );

    if (firstQuestion) {
      await this.slackService.sendMessage({
        channelId,

        text:
          "👋 *Good morning!*\n\nIt's time for today's Daily Standup.\n\nLet's begin.",
      });

      await this.sendQuestion(
        channelId,
        firstQuestion,
      );

      return;
    }

    await this.slackService.sendMessage({
      channelId,

      text:
        '✅ There are no active standup questions right now.',
    });
  }

  // =========================================================
  // REMINDER
  // =========================================================

  async sendStandupReminder(
    userId: string,
    channelId: string,
  ): Promise<void> {
    this.logger.log(
      `Sending standup reminder to user ${userId} in channel ${channelId}.`,
    );

    const currentQuestion =
      await this.collectionService.getCurrentQuestion(
        userId,
      );

    if (!currentQuestion) {
      this.logger.debug(
        `Reminder skipped because user ${userId} has no active question.`,
      );

      return;
    }

    await this.slackService.sendMessage({
      channelId,

      text:
        '⏰ *Reminder:* You still have an active check-in waiting.',
    });

    await this.sendQuestion(
      channelId,
      currentQuestion,
      true,
    );
  }

  // =========================================================
  // APP HOME / MANUAL RESUME
  // =========================================================

  /**
   * Resumes an already-created CheckIn conversation.
   *
   * IMPORTANT:
   *
   * This no longer falls back to startConversation().
   *
   * V2 CheckIns should be created by CheckInRunService /
   * SchedulerService. Otherwise clicking "Start standup"
   * could accidentally create a separate legacy run.
   */
  async startConversationFlow(
    userId: string,
    channelId: string,
  ): Promise<void> {
    this.logger.log(
      `Attempting to resume active CheckIn for user ${userId}.`,
    );

    const activeQuestion =
      await this.collectionService.getCurrentQuestion(
        userId,
      );

    if (activeQuestion) {
      await this.sendQuestion(
        channelId,
        activeQuestion,
      );

      return;
    }

    this.logger.debug(
      `No prepared CheckIn conversation exists for user ${userId}.`,
    );

    await this.slackService.sendMessage({
      channelId,

      text:
        '✅ You do not have an active check-in right now.',
    });
  }

  // =========================================================
  // TEXT ANSWER PROCESSING
  // =========================================================

  private async processAnswer(
    payload: IncomingMessageDto,
    currentQuestion: QuestionPayloadDto,
  ): Promise<void> {
    this.logger.log(
      `Submitting answer for question ${currentQuestion.questionId} from user ${payload.userId}.`,
    );

    try {
      await this.collectionService.submitAnswer(
        payload.userId,
        currentQuestion.questionId,
        payload.message,
      );
    } catch (
      error: unknown
    ) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      await this.slackService.sendMessage({
        channelId:
          payload.channelId,

        text:
          `⚠️ ${message}`,
      });

      /*
       * Re-render the active question after invalid input.
       */
      await this.sendQuestion(
        payload.channelId,
        currentQuestion,
      );

      return;
    }

    await this.continueConversation(
      payload.userId,
      payload.channelId,
    );
  }

  // =========================================================
  // INTERACTIVE ANSWER PROCESSING
  // =========================================================

  /**
   * Entry point used by SlackListener for Block Kit buttons
   * and select menus.
   */
  async handleInteractiveAnswer(
    userId: string,
    channelId: string,
    questionId: string,
    answer: string,
  ): Promise<void> {
    this.logger.log(
      `Submitting interactive answer for question ${questionId} from user ${userId}.`,
    );

    const currentQuestion =
      await this.collectionService.getCurrentQuestion(
        userId,
      );

    if (!currentQuestion) {
      await this.slackService.sendMessage({
        channelId,

        text:
          '⚠️ This check-in is no longer active.',
      });

      return;
    }

    /*
     * An old Slack button must never answer a later question.
     */
    if (
      currentQuestion.questionId !==
      questionId
    ) {
      this.logger.warn(
        `Ignored stale interactive answer from user ${userId}. Expected question ${currentQuestion.questionId}, received ${questionId}.`,
      );

      await this.slackService.sendMessage({
        channelId,

        text:
          '⚠️ That question is no longer active. Please answer the current question below.',
      });

      await this.sendQuestion(
        channelId,
        currentQuestion,
      );

      return;
    }

    try {
      await this.collectionService.submitAnswer(
        userId,
        questionId,
        answer,
      );
    } catch (
      error: unknown
    ) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      await this.slackService.sendMessage({
        channelId,

        text:
          `⚠️ ${message}`,
      });

      await this.sendQuestion(
        channelId,
        currentQuestion,
      );

      return;
    }

    await this.continueConversation(
      userId,
      channelId,
    );
  }

  // =========================================================
  // CONVERSATION ADVANCEMENT
  // =========================================================

  /**
   * Advances the exact current CheckIn submission.
   *
   * CollectionService.getNextQuestion() owns lifecycle
   * completion.
   *
   * When there is no next eligible question it already:
   *
   * - completes ConversationState
   * - completes StandupSubmission
   * - completes StandupRun when all submissions are done
   *
   * Therefore this gateway MUST NOT call finishConversation()
   * again. Doing so could accidentally select another old
   * unfinished conversation for the same Slack user.
   */
  private async continueConversation(
    userId: string,
    channelId: string,
  ): Promise<void> {
    const nextQuestion =
      await this.collectionService.getNextQuestion(
        userId,
      );

    if (nextQuestion) {
      const qNum =
        nextQuestion.questionNumber ??
        1;

      this.logger.log(
        `[Question Sent] Question ${qNum} sent to user ${userId}.`,
      );

      await this.sendQuestion(
        channelId,
        nextQuestion,
      );

      return;
    }

    /*
     * No next eligible question means CollectionService has
     * already completed the exact current submission.
     */
    this.logger.log(
      `CheckIn conversation completed for user ${userId}.`,
    );

    await this.slackService.sendMessage({
      channelId,

      text:
        '✅ *Check-in complete.* Thank you for your update.',
    });
  }

  // =========================================================
  // QUESTION RENDERING
  // =========================================================

  private async sendQuestion(
    channelId: string,
    question: QuestionPayloadDto,
    isReminder = false,
  ): Promise<void> {
    const questionNumber =
      question.questionNumber ??
      1;

    const totalQuestions =
      question.totalQuestions;

    const progressText =
      totalQuestions
        ? `Question ${questionNumber} of ${totalQuestions}`
        : `Question ${questionNumber}`;

    const heading =
      isReminder
        ? `*⏰ ${progressText}*`
        : `*${progressText}*`;

    const fallbackText =
      `${heading}\n${question.text}`;

    const blocks =
      this.buildQuestionBlocks(
        question,
        heading,
      );

    await this.slackService.sendMessage({
      channelId,

      text:
        fallbackText,

      ...(blocks
        ? {
            blocks,
          }
        : {}),
    });
  }

  private buildQuestionBlocks(
    question: QuestionPayloadDto,
    heading: string,
  ): any[] | undefined {
    const type =
      question.type ??
      QuestionType.FREE_TEXT;

    const baseBlocks: any[] = [
      {
        type:
          'section',

        text: {
          type:
            'mrkdwn',

          text:
            `${heading}\n${question.text}`,
        },
      },
    ];

    switch (type) {
      case QuestionType.FREE_TEXT:
        baseBlocks.push({
          type:
            'context',

          elements: [
            {
              type:
                'mrkdwn',

              text:
                '_Reply to this message with your answer._',
            },
          ],
        });

        return baseBlocks;

      case QuestionType.YES_NO:
        baseBlocks.push({
          type:
            'actions',

          block_id:
            this.buildBlockId(
              question.questionId,
            ),

          elements: [
            this.buildAnswerButton(
              'Yes',
              'yes',
              question.questionId,
              'pulse_answer_yes',
              'primary',
            ),

            this.buildAnswerButton(
              'No',
              'no',
              question.questionId,
              'pulse_answer_no',
            ),
          ],
        });

        return baseBlocks;

      case QuestionType.YES_NO_MAYBE:
        baseBlocks.push({
          type:
            'actions',

          block_id:
            this.buildBlockId(
              question.questionId,
            ),

          elements: [
            this.buildAnswerButton(
              'Yes',
              'yes',
              question.questionId,
              'pulse_answer_yes',
              'primary',
            ),

            this.buildAnswerButton(
              'No',
              'no',
              question.questionId,
              'pulse_answer_no',
            ),

            this.buildAnswerButton(
              'Maybe',
              'maybe',
              question.questionId,
              'pulse_answer_maybe',
            ),
          ],
        });

        return baseBlocks;

      case QuestionType.SCALE_1_5:
        baseBlocks.push({
          type:
            'actions',

          block_id:
            this.buildBlockId(
              question.questionId,
            ),

          elements: [
            1,
            2,
            3,
            4,
            5,
          ].map(
            (value) =>
              this.buildAnswerButton(
                String(value),
                String(value),
                question.questionId,
                `pulse_answer_scale_${value}`,
              ),
          ),
        });

        return baseBlocks;

      case QuestionType.MULTIPLE_CHOICE:
        return this.buildMultipleChoiceBlocks(
          baseBlocks,
          question,
        );

      default:
        baseBlocks.push({
          type:
            'context',

          elements: [
            {
              type:
                'mrkdwn',

              text:
                '_Reply to this message with your answer._',
            },
          ],
        });

        return baseBlocks;
    }
  }

  // =========================================================
  // MULTIPLE CHOICE
  // =========================================================

  private buildMultipleChoiceBlocks(
    baseBlocks: any[],
    question: QuestionPayloadDto,
  ): any[] {
    const options =
      question.options ?? [];

    if (
      options.length ===
      0
    ) {
      baseBlocks.push({
        type:
          'context',

        elements: [
          {
            type:
              'mrkdwn',

            text:
              '_Reply to this message with your answer._',
          },
        ],
      });

      return baseBlocks;
    }

    /*
     * Keep small option sets as direct buttons.
     */
    if (
      options.length <=
      5
    ) {
      baseBlocks.push({
        type:
          'actions',

        block_id:
          this.buildBlockId(
            question.questionId,
          ),

        elements:
          options.map(
            (
              option,
              index,
            ) =>
              this.buildAnswerButton(
                option,
                option,
                question.questionId,
                `pulse_answer_choice_${index}`,
              ),
          ),
      });

      return baseBlocks;
    }

    /*
     * Larger option sets use a static Slack select.
     */
    baseBlocks.push({
      type:
        'actions',

      block_id:
        this.buildBlockId(
          question.questionId,
        ),

      elements: [
        {
          type:
            'static_select',

          action_id:
            'pulse_answer_select',

          placeholder: {
            type:
              'plain_text',

            text:
              'Choose an option',

            emoji:
              true,
          },

          options:
            options
              .slice(
                0,
                100,
              )
              .map(
                (
                  option,
                  index,
                ) => ({
                  text: {
                    type:
                      'plain_text',

                    text:
                      this.truncatePlainText(
                        option,
                        75,
                      ),

                    emoji:
                      true,
                  },

                  value:
                    this.encodeInteractiveAnswer(
                      question.questionId,
                      option,
                      index,
                    ),
                }),
              ),
        },
      ],
    });

    return baseBlocks;
  }

  // =========================================================
  // BLOCK KIT HELPERS
  // =========================================================

  private buildAnswerButton(
    label: string,
    answer: string,
    questionId: string,
    actionId: string,
    style?:
      | 'primary'
      | 'danger',
  ) {
    return {
      type:
        'button',

      text: {
        type:
          'plain_text',

        text:
          this.truncatePlainText(
            label,
            75,
          ),

        emoji:
          true,
      },

      action_id:
        actionId,

      value:
        this.encodeInteractiveAnswer(
          questionId,
          answer,
        ),

      ...(style
        ? {
            style,
          }
        : {}),
    };
  }

  private encodeInteractiveAnswer(
    questionId: string,
    answer: string,
    optionIndex?: number,
  ): string {
    return JSON.stringify({
      questionId,
      answer,

      ...(optionIndex !==
      undefined
        ? {
            optionIndex,
          }
        : {}),
    });
  }

  private buildBlockId(
    questionId: string,
  ): string {
    return `pulse-question-${questionId}`;
  }

  private truncatePlainText(
    value: string,
    maxLength: number,
  ): string {
    const clean =
      value.trim();

    if (
      clean.length <=
      maxLength
    ) {
      return clean;
    }

    return (
      clean.slice(
        0,
        Math.max(
          0,
          maxLength - 1,
        ),
      ) + '…'
    );
  }
}