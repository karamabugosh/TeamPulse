import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { CollectionService } from '../collection/collection.service';
import { ReportsService } from '../reports/reports.service';
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { SlackGateway } from './slack.gateway';
import { buildAppHomeBlocks } from './slack-app-home.view';
import { SlackService } from './slack.service';

@Injectable()
export class SlackListener implements OnModuleInit {
  private readonly logger = new Logger(SlackListener.name);
  private readonly processedMessageIds = new Set<string>();

  constructor(
    private readonly slackService: SlackService,
    private readonly slackGateway: SlackGateway,
    private readonly authService: AuthService,
    private readonly collectionService: CollectionService,
    private readonly reportsService: ReportsService,
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

    const handleIncomingSlackMessage = async (
      msg: any,
      client: any,
    ) => {
      const msgIdentifier =
        msg.client_msg_id ||
        `${msg.user}-${msg.ts}`;

      if (this.isDuplicateMessage(msgIdentifier)) {
        this.logger.debug(
          `Ignoring duplicate message event ${msgIdentifier}`,
        );
        return;
      }

      if (
        msg.bot_id ||
        msg.subtype === 'bot_message' ||
        msg.subtype === 'message_changed' ||
        msg.subtype === 'message_deleted'
      ) {
        this.logger.debug(
          'Ignored bot message or message modification event.',
        );
        return;
      }

      if (!msg.user || !msg.channel) {
        this.logger.warn(
          'Ignored Slack message without a user or channel.',
        );
        return;
      }

      this.logger.log(
        `Processing incoming Slack message from user ${msg.user} in channel ${msg.channel}: "${msg.text}"`,
      );

      try {
        await this.slackService.ensureUserRegistered(
          msg.user,
        );

        try {
          const userInfo =
            await client.users.info({
              user: msg.user,
            });

          const teamId =
            userInfo.user?.team_id ||
            'unknown_team';

          await this.authService.syncSlackUser(
            msg.user,
            teamId,
            'TeamPulse Workspace',
          );
        } catch (syncError: unknown) {
          const message =
            syncError instanceof Error
              ? syncError.message
              : String(syncError);

          this.logger.warn(
            `Could not sync Slack auth profile for ${msg.user}: ${message}`,
          );
        }

        const payload: IncomingMessageDto = {
          userId: msg.user,
          channelId: msg.channel,
          message: msg.text ?? '',
          timestamp: msg.ts ?? '',
        };

        this.logger.log(
          `Sending incoming message from user ${msg.user} to SlackGateway.`,
        );

        await this.slackGateway.handleIncomingMessage(
          payload,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        this.logger.error(
          `Failed to process Slack message for user ${msg.user}: ${message}`,
          error instanceof Error
            ? error.stack
            : undefined,
        );

        await this.slackService.sendMessage({
          channelId: msg.channel,
          text:
            '❌ An error occurred while preparing your standup. ' +
            'Please try again.',
        });
      }
    };

    app.message(
      async ({ message, client }) => {
        await handleIncomingSlackMessage(
          message,
          client,
        );
      },
    );

    app.event(
      'message',
      async ({ event, client }) => {
        await handleIncomingSlackMessage(
          event,
          client,
        );
      },
    );

    app.event(
      'app_mention',
      async ({ event }) => {
        this.logger.log(
          `[SLACK EVENT TRIGGERED] app_mention received: ${JSON.stringify(
            event,
          )}`,
        );

        try {
          await this.slackService.ensureUserRegistered(
            event.user,
          );

          const normalizedMessage = (
            event.text ?? ''
          )
            .replace(/<@[^>]+>/g, '')
            .trim();

          const payload: IncomingMessageDto = {
            userId: event.user,
            channelId: event.channel,
            message: normalizedMessage,
            timestamp: event.ts,
          };

          await this.slackGateway.handleIncomingMessage(
            payload,
          );
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          this.logger.error(
            `Failed to process app mention from user ${event.user}: ${message}`,
            error instanceof Error
              ? error.stack
              : undefined,
          );

          await this.slackService.sendMessage({
            channelId: event.channel,
            text:
              '❌ An error occurred while processing your request.',
          });
        }
      },
    );

    app.event(
      'app_home_opened',
      async ({ event, client }) => {
        try {
          await this.slackService.ensureUserRegistered(
            event.user,
          );

          try {
            const userInfo =
              await client.users.info({
                user: event.user,
              });

            const teamId =
              userInfo.user?.team_id ||
              'unknown_team';

            await this.authService.syncSlackUser(
              event.user,
              teamId,
              'TeamPulse Workspace',
            );
          } catch (syncError: unknown) {
            const message =
              syncError instanceof Error
                ? syncError.message
                : String(syncError);

            this.logger.warn(
              `Could not sync Slack auth profile on App Home open for ${event.user}: ${message}`,
            );
          }

          const summary =
            await this.collectionService.getAppHomeSummary(
              event.user,
            );

          await client.views.publish({
            user_id: event.user,
            view: {
              type: 'home',
              blocks: buildAppHomeBlocks(
                summary,
              ),
            },
          });
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          this.logger.error(
            `Failed to publish App Home: ${message}`,
            error instanceof Error
              ? error.stack
              : undefined,
          );
        }
      },
    );

    app.action(
      'start_standup',
      async ({ ack, body, client }) => {
        await ack();

        const userId = body.user.id;

        try {
          await this.slackService.ensureUserRegistered(
            userId,
          );

          const openResult =
            await client.conversations.open({
              users: userId,
            });

          const channelId =
            openResult.channel?.id;

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
            await this.collectionService.getAppHomeSummary(
              userId,
            );

          await client.views.publish({
            user_id: userId,
            view: {
              type: 'home',
              blocks: buildAppHomeBlocks(
                summary,
              ),
            },
          });
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          this.logger.error(
            `Start standup action failed: ${message}`,
            error instanceof Error
              ? error.stack
              : undefined,
          );
        }
      },
    );

    app.command(
      '/report',
      async ({
        command,
        ack,
        respond,
      }) => {
        await ack();

        try {
          await this.slackService.ensureUserRegistered(
            command.user_id,
          );

          const teamSearch =
            command.text?.trim() ||
            undefined;

          const digest =
            await this.reportsService.getLatestDigestForSlackUser(
              command.user_id,
              teamSearch,
            );

          const reportText =
            this.reportsService.formatDigestForSlack(
              digest,
            );

          const reportBlocks =
            this.reportsService.buildDigestBlocks(
              digest,
            );

          await respond({
            response_type: 'ephemeral',
            text: reportText,
            blocks: reportBlocks as any,
          });
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : 'Could not load the latest report.';

          this.logger.error(
            `/report failed for user ${command.user_id}: ${message}`,
            error instanceof Error
              ? error.stack
              : undefined,
          );

          await respond({
            response_type: 'ephemeral',
            text: `❌ ${message}`,
          });
        }
      },
    );

    app.command(
      '/history',
      async ({
        command,
        ack,
        respond,
      }) => {
        await ack();

        try {
          await this.slackService.ensureUserRegistered(
            command.user_id,
          );

          const teamSearch =
            command.text?.trim() ||
            undefined;

          const digests =
            await this.reportsService.getDigestHistoryForSlackUser(
              command.user_id,
              5,
              teamSearch,
            );

          await respond({
            response_type: 'ephemeral',
            text:
              this.reportsService.formatHistoryForSlack(
                digests,
              ),
          });
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : 'Could not load report history.';

          this.logger.error(
            `/history failed for user ${command.user_id}: ${message}`,
            error instanceof Error
              ? error.stack
              : undefined,
          );

          await respond({
            response_type: 'ephemeral',
            text: `❌ ${message}`,
          });
        }
      },
    );

    app.error(
      async (error: unknown) => {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        this.logger.error(
          `[SLACK ERROR] Global error handler caught: ${message}`,
          error instanceof Error
            ? error.stack
            : undefined,
        );
      },
    );

    this.logger.log(
      'Slack listeners successfully registered.',
    );
  }
}