import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CollectionService } from '../collection/collection.service';
import { ReportsService } from '../reports/reports.service';
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { SlackGateway } from './slack.gateway';
import { buildAppHomeBlocks } from './slack-app-home.view';
import { SlackService } from './slack.service';

@Injectable()
export class SlackListener implements OnModuleInit {
  private readonly logger = new Logger(SlackListener.name);

  constructor(
    private readonly slackService: SlackService,
    private readonly slackGateway: SlackGateway,
    private readonly collectionService: CollectionService,
    private readonly reportsService: ReportsService,
  ) {}

  onModuleInit(): void {
    this.logger.log('SlackListener onModuleInit() is executing...');
    this.registerListeners();
  }

  private registerListeners(): void {
    this.logger.log('Attempting to register Slack listeners...');

    const app = this.slackService.getSlackApp();

    if (!app) {
      this.logger.error(
        'Slack app is NOT initialized. Listeners CANNOT be registered.',
      );
      return;
    }

    app.event('message', async ({ event }) => {
      const msg = event as {
        user?: string;
        channel?: string;
        text?: string;
        ts?: string;
        bot_id?: string;
        subtype?: string;
      };

      this.logger.log(
        `[SLACK EVENT TRIGGERED] message event received: ${JSON.stringify(event)}`,
      );

      if (
        msg.bot_id ||
        msg.subtype === 'bot_message' ||
        msg.subtype === 'message_changed'
      ) {
        this.logger.debug(
          'Ignored bot message or edited message event.',
        );
        return;
      }

      if (!msg.user || !msg.channel) {
        this.logger.warn(
          'Ignored Slack message because user or channel was missing.',
        );
        return;
      }

      try {
        await this.slackService.ensureUserRegistered(msg.user);

        const payload: IncomingMessageDto = {
          userId: msg.user,
          channelId: msg.channel,
          message: msg.text ?? '',
          timestamp: msg.ts ?? '',
        };

        this.logger.log(
          `Sending incoming message from user ${msg.user} to SlackGateway.`,
        );

        await this.slackGateway.handleIncomingMessage(payload);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';

        this.logger.error(
          `Failed to process Slack message for user ${msg.user}: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );

        await this.slackService.sendMessage({
          channelId: msg.channel,
          text: '❌ An error occurred while preparing your standup. Please try again.',
        });
      }
    });

    app.event('app_mention', async ({ event }) => {
      this.logger.log(
        `[SLACK EVENT TRIGGERED] app_mention received: ${JSON.stringify(event)}`,
      );
    });

    app.event('app_home_opened', async ({ event, client }) => {
      try {
        await this.slackService.ensureUserRegistered(event.user);

        const summary =
          await this.collectionService.getAppHomeSummary(event.user);

        await client.views.publish({
          user_id: event.user,
          view: {
            type: 'home',
            blocks: buildAppHomeBlocks(summary),
          },
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';

        this.logger.error(
          `Failed to publish App Home: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    });

    app.action('start_standup', async ({ ack, body, client }) => {
      await ack();

      const userId = body.user.id;

      try {
        await this.slackService.ensureUserRegistered(userId);

        const openResult = await client.conversations.open({
          users: userId,
        });

        const channelId = openResult.channel?.id;

        if (!channelId) {
          this.logger.error(
            'Could not open a DM channel for the standup.',
          );
          return;
        }

        await this.slackGateway.startConversationFlow(
          userId,
          channelId,
        );

        const summary =
          await this.collectionService.getAppHomeSummary(userId);

        await client.views.publish({
          user_id: userId,
          view: {
            type: 'home',
            blocks: buildAppHomeBlocks(summary),
          },
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';

        this.logger.error(
          `Start standup action failed: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    });

    app.command('/report', async ({ command, ack, respond }) => {
      await ack();

      try {
        await this.slackService.ensureUserRegistered(command.user_id);

        const teamSearch = command.text?.trim() || undefined;

        const digest =
          await this.reportsService.getLatestDigestForSlackUser(
            command.user_id,
            teamSearch,
          );

        await respond({
          response_type: 'ephemeral',
          text: this.reportsService.formatDigestForSlack(digest),
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : 'Could not load the latest report.';

        this.logger.error(
          `/report failed for user ${command.user_id}: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );

        await respond({
          response_type: 'ephemeral',
          text: `❌ ${message}`,
        });
      }
    });

    app.command('/history', async ({ command, ack, respond }) => {
      await ack();

      try {
        await this.slackService.ensureUserRegistered(command.user_id);

        const teamSearch = command.text?.trim() || undefined;

        const digests =
          await this.reportsService.getDigestHistoryForSlackUser(
            command.user_id,
            5,
            teamSearch,
          );

        await respond({
          response_type: 'ephemeral',
          text: this.reportsService.formatHistoryForSlack(digests),
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : 'Could not load report history.';

        this.logger.error(
          `/history failed for user ${command.user_id}: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );

        await respond({
          response_type: 'ephemeral',
          text: `❌ ${message}`,
        });
      }
    });

    app.error(async (error: Error) => {
      this.logger.error(
        `[SLACK ERROR] Global error handler caught: ${error.message}`,
        error.stack,
      );
    });

    this.logger.log('Slack listeners successfully registered.');
  }
}