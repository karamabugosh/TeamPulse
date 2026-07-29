import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App } from '@slack/bolt';
import { OutgoingMessageDto } from './dto/outgoing-message.dto';

@Injectable()
export class SlackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlackService.name);
  private app: App;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    this.initializeSlack();
  }

  async onModuleDestroy() {
    this.logger.log('Slack service shutting down.');
  }

  private initializeSlack() {
    const token = this.configService.get<string>('SLACK_BOT_TOKEN');
    const signingSecret = this.configService.get<string>('SLACK_SIGNING_SECRET');
    const appToken = this.configService.get<string>('SLACK_APP_TOKEN');

    if (!token || !signingSecret || !appToken) {
      this.logger.warn('Slack tokens are missing from environment variables. Slack App will not be initialized.');
      return;
    }

    try {
      this.app = new App({
        token,
        signingSecret,
        appToken,
        socketMode: true, // Best practice for backend services connecting outward
      });

      this.app.start().then(() => {
         this.logger.log('⚡️ Slack Bolt app is running in Socket Mode!');
      }).catch(err => {
         this.logger.error('Failed to start Slack Bolt app', err);
      });
    } catch (error: any) {
      this.logger.error(`Error initializing Slack app: ${error.message}`, error.stack);
    }
  }

  public getSlackApp(): App {
    return this.app;
  }

  /**
   * Sends a message to a specific Slack channel or user.
   * Validates input, sends the message, and handles errors safely.
   */
  public async sendMessage(payload: OutgoingMessageDto): Promise<void> {
    if (!this.app) {
      this.logger.error('Cannot send message: Slack app is not initialized.');
      return;
    }

    if (!payload.channelId || !payload.text) {
      this.logger.error('Cannot send message: Missing channelId or text.');
      return;
    }

    let retries = 3;
    let delay = 1000;
    while (retries > 0) {
      try {
        this.logger.log(`Sending message to channel: ${payload.channelId} (Retries left: ${retries - 1})`);
        await this.app.client.chat.postMessage({
          channel: payload.channelId,
          text: payload.text,
        });
        return; // Success
      } catch (error: any) {
        this.logger.error(`Failed to send Slack message to ${payload.channelId}: ${error.message}`);
        retries--;
        if (retries === 0) {
            this.logger.error(`Exhausted retries for sending message to ${payload.channelId}.`);
        } else {
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // Exponential backoff
        }
      }
    }
  }
}
