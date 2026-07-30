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
export class SlackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlackService.name);
  private app?: App;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.initializeSlack();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.app) {
      await this.app.stop();
    }

    this.logger.log('Slack service shut down.');
  }

  private async initializeSlack(): Promise<void> {
    const socketModeEnabled =
      this.configService.get<string>('SLACK_SOCKET_MODE_ENABLED') ===
      'true';

    if (!socketModeEnabled) {
      this.logger.warn(
        'Slack Socket Mode is disabled. Skipping Slack connection.',
      );
      return;
    }

    const token =
      this.configService.get<string>('SLACK_BOT_TOKEN');
    const signingSecret =
      this.configService.get<string>('SLACK_SIGNING_SECRET');
    const appToken =
      this.configService.get<string>('SLACK_APP_TOKEN');

    if (!token || !signingSecret || !appToken) {
      this.logger.warn(
        'Slack credentials are missing. Slack App will not be initialized.',
      );
      return;
    }

    this.app = new App({
      token,
      signingSecret,
      appToken,
      socketMode: true,
    });

    try {
      await this.app.start();
      this.logger.log('Slack Bolt app is running in Socket Mode');
    } catch (error) {
      this.app = undefined;

      const message =
        error instanceof Error ? error.message : String(error);

      this.logger.error(
        `Failed to start Slack Bolt app: ${message}`,
      );
    }
  }

  public getSlackApp(): App | undefined {
    return this.app;
  }

  public async sendMessage(
    payload: OutgoingMessageDto,
  ): Promise<void> {
    if (!this.app) {
      throw new Error(
        'Slack app is not initialized. Enable SLACK_SOCKET_MODE_ENABLED and provide valid Slack credentials.',
      );
    }

    if (!payload.channelId || !payload.text) {
      throw new Error('Missing Slack channelId or text');
    }

    let retries = 3;
    let delay = 1000;

    while (retries > 0) {
      try {
        await this.app.client.chat.postMessage({
          channel: payload.channelId,
          text: payload.text,
        });

        this.logger.log(
          `Message sent to Slack channel ${payload.channelId}`,
        );

        return;
      } catch (error) {
        retries--;

        const message =
          error instanceof Error ? error.message : String(error);

        this.logger.error(
          `Failed to send Slack message to ${payload.channelId}: ${message}`,
        );

        if (retries === 0) {
          throw error;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, delay),
        );

        delay *= 2;
      }
    }
  }
}