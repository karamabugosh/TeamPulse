import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SlackService } from './slack.service';
import { SlackGateway } from './slack.gateway';
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { CollectionService } from '../collection/collection.service';
import { buildAppHomeBlocks } from './slack-app-home.view';

@Injectable()
export class SlackListener implements OnModuleInit {
  private readonly logger = new Logger(SlackListener.name);

  constructor(
    private readonly slackService: SlackService,
    private readonly slackGateway: SlackGateway,
    private readonly collectionService: CollectionService,
  ) {}

  onModuleInit() {
    this.logger.log('SlackListener onModuleInit() is executing...');
    this.registerListeners();
  }

  private registerListeners() {
    this.logger.log('Attempting to register Slack listeners...');
    const app = this.slackService.getSlackApp();

    if (!app) {
      this.logger.error('Slack app is NOT initialized. Listeners CANNOT be registered.');
      return;
    }

    // Handle all messages using app.event('message') which is lower-level and catches everything
    app.event('message', async ({ event, say }) => {
      this.logger.log(`[SLACK EVENT TRIGGERED] app.event('message') hit! Raw event: ${JSON.stringify(event)}`);
      
      const msg = event as any;

      // Ignore bot messages or message_changed events to avoid loops
      if (msg.bot_id || msg.subtype === 'bot_message' || msg.subtype === 'message_changed') {
        this.logger.debug('Ignored bot message or edit event.');
        return;
      }

      this.logger.log(`Processing incoming Slack message from user ${msg.user}`);

      const payload: IncomingMessageDto = {
        userId: msg.user,
        channelId: msg.channel,
        message: msg.text || '',
        timestamp: msg.ts,
      };

      this.logger.log(`Payload prepared, sending to SlackGateway...`);
      await this.slackGateway.handleIncomingMessage(payload);
    });

    app.event('app_mention', async ({ event, say }) => {
      this.logger.log(`[SLACK EVENT TRIGGERED] app_mention hit! Event: ${JSON.stringify(event)}`);
    });

    app.event('app_home_opened', async ({ event, client }) => {
      try {
        const summary = await this.collectionService.getAppHomeSummary(event.user);
        await client.views.publish({
          user_id: event.user,
          view: {
            type: 'home',
            blocks: buildAppHomeBlocks(summary),
          },
        });
      } catch (error: any) {
        this.logger.error(`Failed to publish App Home: ${error.message}`, error.stack);
      }
    });

    app.action('start_standup', async ({ ack, body, client }) => {
      await ack();
      const userId = body.user.id;
      try {
        const open = await client.conversations.open({ users: userId });
        const channelId = open.channel?.id;
        if (!channelId) {
          this.logger.error('Could not open DM channel for standup start.');
          return;
        }
        await this.slackGateway.startConversationFlow(userId, channelId);
        const summary = await this.collectionService.getAppHomeSummary(userId);
        await client.views.publish({
          user_id: userId,
          view: {
            type: 'home',
            blocks: buildAppHomeBlocks(summary),
          },
        });
      } catch (error: any) {
        this.logger.error(`Start standup action failed: ${error.message}`, error.stack);
      }
    });
    
    app.error(async (error: any) => {
        this.logger.error(`[SLACK ERROR] Global error handler caught: ${error.message}`, error);
    });

    this.logger.log('Slack listeners successfully registered.');
  }
}
