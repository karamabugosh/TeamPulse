import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { SlackService } from './slack.service';
import { SlackGateway } from './slack.gateway';
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { AuthService } from '../auth/auth.service';
import { CollectionService } from '../collection/collection.service';
import { buildAppHomeBlocks } from './slack-app-home.view';

@Injectable()
export class SlackListener implements OnModuleInit {
  private readonly logger = new Logger(SlackListener.name);
  private readonly processedMessageIds = new Set<string>();

  constructor(
    private readonly slackService: SlackService,
    private readonly slackGateway: SlackGateway,
    private readonly authService: AuthService,
    private readonly collectionService: CollectionService,
  ) {}

  onModuleInit(): void {
    this.logger.log(
      'SlackListener onModuleInit() is executing...',
    );

    this.registerListeners();
  }

  private isDuplicateMessage(msgId: string): boolean {
    if (!msgId) return false;
    if (this.processedMessageIds.has(msgId)) {
      return true;
    }
    this.processedMessageIds.add(msgId);
    setTimeout(() => {
      this.processedMessageIds.delete(msgId);
    }, 10000);
    return false;
  }

  private registerListeners(): void {
    this.logger.log(
      'Attempting to register Slack listeners...',
    );

    const app = this.slackService.getSlackApp();

    if (!app) {
      this.logger.error(
        'Slack app is NOT initialized. Listeners CANNOT be registered.',
      );
      return;
    }

    const handleIncomingSlackMessage = async (msg: any, client: any) => {
      const msgIdentifier = msg.client_msg_id || `${msg.user}-${msg.ts}`;

      if (this.isDuplicateMessage(msgIdentifier)) {
        this.logger.debug(`Ignoring duplicate message event ${msgIdentifier}`);
        return;
      }

      if (
        msg.bot_id ||
        msg.subtype === 'bot_message' ||
        msg.subtype === 'message_changed' ||
        msg.subtype === 'message_deleted'
      ) {
        this.logger.debug('Ignored bot message or message modification event.');
        return;
      }

      if (!msg.user || !msg.channel) {
        this.logger.warn('Ignored Slack message without a user or channel.');
        return;
      }

      this.logger.log(
        `Processing incoming Slack message from user ${msg.user} in channel ${msg.channel}: "${msg.text}"`,
      );

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
    };

    // Standard Bolt message listener for DMs and Channels
    app.message(async ({ message, client }) => {
      await handleIncomingSlackMessage(message, client);
    });

    // Generic Event listener as fallback
    app.event('message', async ({ event, client }) => {
      await handleIncomingSlackMessage(event, client);
    });

    app.event('app_mention', async ({ event }) => {
      this.logger.log(
        `[SLACK EVENT TRIGGERED] app_mention hit! Event: ${JSON.stringify(
          event,
        )}`,
      );

      const normalizedMessage = (event.text || '')
        .replace(/<@[^>]+>/g, '')
        .trim();

      const payload: IncomingMessageDto = {
        userId: event.user,
        channelId: event.channel,
        message: normalizedMessage,
        timestamp: event.ts,
      };

      await this.slackGateway.handleIncomingMessage(payload);
    });

    app.event('app_home_opened', async ({ event, client }) => {
      this.logger.log(`App home opened by user ${event.user}`);
      try {
        try {
          const userInfo = await client.users.info({ user: event.user });
          const teamId = userInfo.user?.team_id || 'unknown_team';
          await this.authService.syncSlackUser(event.user, teamId, 'TeamPulse Workspace');
        } catch (syncErr) {
          this.logger.error(`Failed to sync user on home open ${event.user}: ${syncErr}`);
        }

        const summary = await this.collectionService.getAppHomeSummary(
          event.user,
        );

        await client.views.publish({
          user_id: event.user,
          view: {
            type: 'home',
            blocks: buildAppHomeBlocks(summary),
          },
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        const stack =
          error instanceof Error
            ? error.stack
            : undefined;

        this.logger.error(
          `Failed to publish App Home: ${message}`,
          stack,
        );
      }
    });

    app.action(
      'start_standup',
      async ({ ack, body, client }) => {
        await ack();

        const userId = body.user.id;

        try {
          const open =
            await client.conversations.open({
              users: userId,
            });

          const channelId = open.channel?.id;

          if (!channelId) {
            this.logger.error(
              'Could not open DM channel for standup start.',
            );
            return;
          }

          await this.slackGateway.startConversationFlow(
            userId,
            channelId,
          );

          const summary =
            await this.collectionService.getAppHomeSummary(
              userId,
            );

          await client.views.publish({
            user_id: userId,
            view: {
              type: 'home',
              blocks: buildAppHomeBlocks(summary),
            },
          });
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          const stack =
            error instanceof Error
              ? error.stack
              : undefined;

          this.logger.error(
            `Start standup action failed: ${message}`,
            stack,
          );
        }
      },
    );

    app.error(async (error) => {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.error(
        `[SLACK ERROR] Global error handler caught: ${message}`,
        error,
      );
    });

    this.logger.log(
      'Slack listeners successfully registered.',
    );
  }
}
