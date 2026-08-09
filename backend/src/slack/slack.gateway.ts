import { Injectable, Logger } from '@nestjs/common';
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { SlackService } from './slack.service';
import { QuestionPayloadDto } from './dto/question-payload.dto';
import { CollectionService } from '../collection/collection.service';

@Injectable()
export class SlackGateway {
  private readonly logger = new Logger(SlackGateway.name);

  constructor(
    private readonly slackService: SlackService,
    private readonly collectionService: CollectionService,
  ) {}

  /**
   * Handles incoming Slack messages and controls
   * the standup conversation flow.
   */
  async handleIncomingMessage(
    payload: IncomingMessageDto,
  ): Promise<void> {
    this.logger.log(
      `Received message from user ${payload.userId} in channel ${payload.channelId}`,
    );

    try {
      await this.syncUserDisplayName(payload.userId);

      const currentQuestion =
        await this.collectionService.getCurrentQuestion(
          payload.userId,
        );

      if (currentQuestion) {
        await this.processAnswer(payload, currentQuestion);
        return;
      }

      const normalizedMessage = payload.message
        .trim()
        .toLowerCase();

      if (
        ['start', 'hi', 'hello'].includes(normalizedMessage)
      ) {
        await this.startConversationFlow(
          payload.userId,
          payload.channelId,
        );

        return;
      }

      this.logger.debug(
        `No active conversation for user ${payload.userId}.`,
      );

      await this.slackService.sendMessage({
        channelId: payload.channelId,
        text: "You don't have an active standup right now. Daily standups start automatically every weekday at 9:00 AM.",
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      const stack =
        error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Error handling incoming message for user ${payload.userId}: ${message}`,
        stack,
      );

      await this.slackService.sendMessage({
        channelId: payload.channelId,
        text: '❌ An error occurred processing your request.',
      });
    }
  }

  /**
   * Fetches the user's Slack display name and stores it
   * in PostgreSQL.
   */
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

  /**
   * Triggers the automatic daily standup flow for a user in DM.
   */
  async triggerAutomaticStandupForUser(
    userId: string,
    channelId: string,
  ): Promise<void> {
    this.logger.log(
      `Triggering automatic daily standup for user ${userId}`,
    );

    const firstQuestion =
      await this.collectionService.startDailyStandupForUser(userId);

    if (firstQuestion) {
      // Send greeting message first
      await this.slackService.sendMessage({
        channelId,
        text: "👋 *Good morning!*\n\nIt's time for today's Daily Standup.\n\nLet's begin.",
      });

      // Send Question 1 message immediately after in DM history
      const qNum = firstQuestion.questionNumber || 1;
      await this.slackService.sendMessage({
        channelId,
        text: `*Question ${qNum}*\n${firstQuestion.text}`,
      });

      return;
    }

    await this.slackService.sendMessage({
      channelId,
      text: '✅ There are no active standup questions right now.',
    });
  }

  /**
   * Sends a single gentle reminder to a user who has not completed their standup.
   */
  async sendStandupReminder(
    userId: string,
    channelId: string,
  ): Promise<void> {
    this.logger.log(
      `Sending standup reminder to user ${userId} in channel ${channelId}`,
    );

    await this.slackService.sendMessage({
      channelId,
      text: "⏰ *Reminder:* You have an active daily standup waiting. Reply here with your updates when you get a chance!",
    });
  }

  /**
   * Starts a new standup conversation manually or via interactive triggers.
   */
  async startConversationFlow(
    userId: string,
    channelId: string,
  ): Promise<void> {
    this.logger.log(
      `Starting conversation for user ${userId}`,
    );

    const firstQuestion =
      await this.collectionService.startConversation(userId);

    if (firstQuestion) {
      const qNum = firstQuestion.questionNumber || 1;
      await this.slackService.sendMessage({
        channelId,
        text: `*Question ${qNum}*\n${firstQuestion.text}`,
      });

      return;
    }

    await this.slackService.sendMessage({
      channelId,
      text: '✅ There are no questions for you right now.',
    });
  }

  /**
   * Stores an answer and sends the next question.
   */
  private async processAnswer(
    payload: IncomingMessageDto,
    currentQuestion: QuestionPayloadDto,
  ): Promise<void> {
    this.logger.log(
      `Submitting answer for question ${currentQuestion.questionId} from user ${payload.userId}`,
    );

    try {
      await this.collectionService.submitAnswer(
        payload.userId,
        currentQuestion.questionId,
        payload.message,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      await this.slackService.sendMessage({
        channelId: payload.channelId,
        text: `❌ ${message}`,
      });

      return;
    }

    const nextQuestion =
      await this.collectionService.getNextQuestion(
        payload.userId,
      );

    if (nextQuestion) {
      const qNum = nextQuestion.questionNumber || 1;
      this.logger.log(`[Question Sent] Question ${qNum} sent to user ${payload.userId}`);
      await this.slackService.sendMessage({
        channelId: payload.channelId,
        text: `*Question ${qNum}*\n${nextQuestion.text}`,
      });

      return;
    }

    await this.collectionService.finishConversation(
      payload.userId,
    );

    await this.slackService.sendMessage({
      channelId: payload.channelId,
      text: '✅ Thank you! Your daily standup has been completed.',
    });
  }
}