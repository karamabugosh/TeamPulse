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
        text: "I'm not sure what you mean. Type `hello` to start a standup.",
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
   * Starts a new standup conversation.
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
      await this.slackService.sendMessage({
        channelId,
        text: firstQuestion.text,
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
      await this.slackService.sendMessage({
        channelId: payload.channelId,
        text: nextQuestion.text,
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