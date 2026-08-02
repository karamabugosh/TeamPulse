import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SlackService } from './slack.service';
import { SlackGateway } from './slack.gateway';
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { AuthService } from '../auth/auth.service';
import { CollectionService } from '../collection/collection.service';

@Injectable()
export class SlackListener implements OnModuleInit {
  private readonly logger = new Logger(SlackListener.name);

  constructor(
    private readonly slackService: SlackService,
    private readonly slackGateway: SlackGateway,
    private readonly authService: AuthService,
    private readonly collectionService: CollectionService
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

    // --- APP HOME OPENED ---
    app.event('app_home_opened', async ({ event, client }) => {
      this.logger.log(`App home opened by user ${event.user}`);
      try {
        const userInfo = await client.users.info({ user: event.user });
        const teamId = userInfo.user?.team_id || 'unknown_team';
        await this.authService.syncSlackUser(event.user, teamId, 'TeamPulse Workspace');

        const summary = await this.collectionService.getAppHomeSummary(event.user);
        
        let statusText = 'Unknown';
        if (summary.status === 'not_started') statusText = 'Not started today. Type "hello" to begin.';
        if (summary.status === 'in_progress') statusText = 'In Progress! Check your messages.';
        if (summary.status === 'completed') statusText = `Completed at ${summary.lastCompletedAt?.toLocaleTimeString()}`;

        await client.views.publish({
          user_id: event.user,
          view: {
            type: 'home',
            blocks: [
              {
                type: 'header',
                text: { type: 'plain_text', text: '👋 Welcome to TeamPulse!' },
              },
              {
                type: 'section',
                text: { type: 'mrkdwn', text: '*Daily Standup Status:* ' + statusText },
              },
              {
                type: 'section',
                text: { type: 'mrkdwn', text: `*Active Questions:* ${summary.activeQuestionCount}` },
              },
              {
                type: 'divider',
              },
              {
                type: 'section',
                text: { type: 'mrkdwn', text: 'To manage questions, type `/manage-questions` anywhere in Slack.' },
              }
            ],
          },
        });
      } catch (error) {
        this.logger.error(`Error handling app_home_opened: ${error}`);
      }
    });

    app.event('message', async ({ event, client }) => {
      this.logger.log(`[SLACK EVENT TRIGGERED] app.event('message') hit! Raw event: ${JSON.stringify(event)}`);
      
      const msg = event as any;

      if (msg.bot_id || msg.subtype === 'bot_message' || msg.subtype === 'message_changed') {
        this.logger.debug('Ignored bot message or edit event.');
        return;
      }

      this.logger.log(`Processing incoming Slack message from user ${msg.user}`);

      try {
          const userInfo = await client.users.info({ user: msg.user });
          const teamId = userInfo.user?.team_id || 'unknown_team';
          await this.authService.syncSlackUser(msg.user, teamId, 'TeamPulse Workspace');
      } catch (err) {
          this.logger.error(`Failed to sync user ${msg.user}: ${err}`);
      }

      const payload: IncomingMessageDto = {
        userId: msg.user,
        channelId: msg.channel,
        message: msg.text || '',
        timestamp: msg.ts,
      };

      await this.slackGateway.handleIncomingMessage(payload);
    });

    app.event('app_mention', async ({ event }) => {
      this.logger.log(`[SLACK EVENT TRIGGERED] app_mention hit! Event: ${JSON.stringify(event)}`);
    });
    
    app.error(async (error: any) => {
        this.logger.error(`[SLACK ERROR] Global error handler caught: ${error.message}`, error);
    });

    this.logger.log('Slack listeners successfully registered.');
  }

}
