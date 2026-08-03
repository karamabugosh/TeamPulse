import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App } from '@slack/bolt';
import { OutgoingMessageDto } from './dto/outgoing-message.dto';

@Injectable()
export class SlackService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SlackService.name);
  private app: App | undefined;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.initializeSlack();
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Slack service shutting down.');

    if (this.app) {
      await this.app.stop();
    }
  }

  private initializeSlack(): void {
    const token =
      this.configService.get<string>('SLACK_BOT_TOKEN');

    const signingSecret =
      this.configService.get<string>(
        'SLACK_SIGNING_SECRET',
      );

    const appToken =
      this.configService.get<string>('SLACK_APP_TOKEN');

    if (!token || !signingSecret || !appToken) {
      this.logger.warn(
        'Slack tokens are missing. Slack App will not be initialized.',
      );
      return;
    }

    try {
      this.app = new App({
        token,
        signingSecret,
        appToken,
        socketMode: true,
      });

      void this.app
        .start()
        .then(() => {
          this.logger.log(
            'Slack Bolt app is running in Socket Mode.',
          );
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          this.logger.error(
            `Failed to start Slack Bolt app: ${message}`,
          );
        });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.error(
        `Error initializing Slack app: ${message}`,
      );
    }
  }

  public getSlackApp(): App | undefined {
    return this.app;
  }

  /**
   * Gets a readable name for a Slack user.
   * Falls back to the Slack user ID if lookup fails.
   */
  public async getUserDisplayName(
    slackUserId: string,
  ): Promise<string> {
    if (!slackUserId) {
      return 'Unknown user';
    }

    if (!this.app) {
      this.logger.warn(
        `Cannot look up Slack user ${slackUserId}: Slack app is not initialized.`,
      );

      return slackUserId;
    }

    try {
      const result =
        await this.app.client.users.info({
          user: slackUserId,
        });

      const member = result.user;

      return (
        member?.profile?.display_name?.trim() ||
        member?.profile?.real_name?.trim() ||
        member?.real_name?.trim() ||
        member?.name?.trim() ||
        slackUserId
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.warn(
        `Could not retrieve the display name for Slack user ${slackUserId}: ${message}`,
      );

      return slackUserId;
    }
  }

  /**
   * Sends a message to a Slack channel or user.
   * Returns true when Slack confirms delivery.
   * Returns false if validation or all retry attempts fail.
   */
  public async sendMessage(
    payload: OutgoingMessageDto,
  ): Promise<boolean> {
    if (!this.app) {
      this.logger.error(
        'Cannot send message: Slack app is not initialized.',
      );

      return false;
    }

    if (!payload.channelId || !payload.text) {
      this.logger.error(
        'Cannot send message: Missing channelId or text.',
      );

      return false;
    }

    let retries = 3;
    let delay = 1000;

    while (retries > 0) {
      try {
        this.logger.log(
          `Sending message to channel ${payload.channelId}. Attempts remaining: ${retries}`,
        );

        await this.app.client.chat.postMessage({
          channel: payload.channelId,
          text: payload.text,
        });

        return true;
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        retries -= 1;

        this.logger.error(
          `Failed to send Slack message to ${payload.channelId}: ${message}`,
        );

        if (retries === 0) {
          this.logger.error(
            `Exhausted retries for Slack channel ${payload.channelId}.`,
          );

          return false;
        }

        await new Promise<void>((resolve) => {
          setTimeout(resolve, delay);
        });

        delay *= 2;
      }
    }

    return false;
  }
}