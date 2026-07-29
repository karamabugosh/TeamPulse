import { Injectable, Logger } from '@nestjs/common';
import { WebClient } from '@slack/web-api';

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);

  async sendMessage(
    botToken: string,
    channelId: string,
    text: string,
  ): Promise<void> {
    const client = new WebClient(botToken);

    await client.chat.postMessage({
      channel: channelId,
      text,
    });

    this.logger.log(`Message sent to Slack channel ${channelId}`);
  }
}