import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { CollectionService } from '../collection/collection.service';
import { ReportsService } from '../reports/reports.service';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { SlackGateway } from './slack.gateway';
import { buildAppHomeBlocks } from './slack-app-home.view';
import { SlackService } from './slack.service';
import { SlackAiAssistantService } from './slack-ai-assistant.service';

@Injectable()
export class SlackListener implements OnApplicationBootstrap {
  private readonly logger = new Logger(SlackListener.name);

  constructor(
    private readonly slackService: SlackService,
    private readonly slackGateway: SlackGateway,
    private readonly authService: AuthService,
    private readonly collectionService: CollectionService,
    private readonly reportsService: ReportsService,
    private readonly prisma: PrismaService,
    private readonly slackAiAssistant: SlackAiAssistantService,
  ) {}

  onApplicationBootstrap(): void {
    this.logger.log(
      'SlackListener onApplicationBootstrap() is executing...',
    );

    this.registerListeners();
  }

  private async claimInboundEvent(
    slackUserId: string,
    idempotencyKey: string,
    eventType: string,
    externalEventId?: string,
  ): Promise<{ claimed: boolean; eventId?: string }> {
    if (!idempotencyKey) {
      return { claimed: true };
    }

    const user = await this.prisma.user.findUnique({
      where: {
        slackUserId,
      },
      select: {
        workspaceId: true,
      },
    });

    if (!user) {
      throw new Error(
        `Cannot create inbound event because Slack user ${slackUserId} is not registered.`,
      );
    }

    try {
      const event = await this.prisma.inboundEvent.create({
        data: {
          workspaceId: user.workspaceId,
          provider: 'slack',
          idempotencyKey,
          externalEventId: externalEventId || null,
          eventType,
          status: 'processing',
        },
      });

      return {
        claimed: true,
        eventId: event.id,
      };
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existingEvent =
          await this.prisma.inboundEvent.findUnique({
            where: {
              idempotencyKey,
            },
            select: {
              id: true,
              status: true,
            },
          });

        if (!existingEvent) {
          throw error;
        }

        /*
         * Failed events may be retried.
         *
         * updateMany makes the reclaim atomic so if two
         * Slack retries arrive together, only one can move
         * the row from failed -> processing.
         */
        if (existingEvent.status === 'failed') {
          const reclaimed =
            await this.prisma.inboundEvent.updateMany({
              where: {
                id: existingEvent.id,
                status: 'failed',
              },
              data: {
                status: 'processing',
                errorMessage: null,
                processedAt: null,
                receivedAt: new Date(),
                externalEventId: externalEventId || null,
              },
            });

          if (reclaimed.count === 1) {
            this.logger.log(
              `Retrying previously failed Slack event ${idempotencyKey}.`,
            );

            return {
              claimed: true,
              eventId: existingEvent.id,
            };
          }
        }

        if (existingEvent.status === 'processing') {
          const staleEvent = await this.prisma.inboundEvent.findUnique({
            where: { id: existingEvent.id },
            select: { receivedAt: true },
          });
          const ageMs = staleEvent
            ? Date.now() - staleEvent.receivedAt.getTime()
            : 0;

          if (ageMs > 120_000) {
            const reclaimed =
              await this.prisma.inboundEvent.updateMany({
                where: {
                  id: existingEvent.id,
                  status: 'processing',
                },
                data: {
                  status: 'processing',
                  errorMessage: null,
                  processedAt: null,
                  receivedAt: new Date(),
                  externalEventId: externalEventId || null,
                },
              });

            if (reclaimed.count === 1) {
              this.logger.warn(
                `Reclaimed stale processing Slack event ${idempotencyKey} (age ${Math.round(ageMs / 1000)}s).`,
              );

              return {
                claimed: true,
                eventId: existingEvent.id,
              };
            }
          }
        }

        this.logger.warn(
          `Ignoring duplicate Slack event ${idempotencyKey} with status ${existingEvent.status}.`,
        );

        return {
          claimed: false,
        };
      }

      throw error;
    }
  }

  private async markInboundEventProcessed(
    eventId?: string,
  ): Promise<void> {
    if (!eventId) {
      return;
    }

    await this.prisma.inboundEvent.update({
      where: {
        id: eventId,
      },
      data: {
        status: 'processed',
        processedAt: new Date(),
        errorMessage: null,
      },
    });
  }

  private async markInboundEventFailed(
    eventId: string | undefined,
    error: unknown,
  ): Promise<void> {
    if (!eventId) {
      return;
    }

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    await this.prisma.inboundEvent.update({
      where: {
        id: eventId,
      },
      data: {
        status: 'failed',
        errorMessage: message,
      },
    });
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
      // Slack `ts` is server-assigned and unique per message. `client_msg_id` can be
      // reused across consecutive replies in the same DM compose session, which caused
      // Q2+ answers to be silently dropped as duplicates of Q1.
      const idempotencyKey = msg.ts
        ? `slack:message:${msg.channel}:${msg.ts}`
        : msg.client_msg_id
          ? `slack:message:${msg.channel}:client:${msg.client_msg_id}`
          : null;

      this.logger.log(
        `[Slack Event] Received message user=${msg.user ?? 'unknown'} channel=${msg.channel ?? 'unknown'}` +
          ` ts=${msg.ts ?? 'none'} thread_ts=${msg.thread_ts ?? 'none'}` +
          ` client_msg_id=${msg.client_msg_id ?? 'none'} subtype=${msg.subtype ?? 'none'}`,
      );

      if (
        msg.bot_id ||
        msg.subtype === 'bot_message' ||
        msg.subtype === 'message_changed' ||
        msg.subtype === 'message_deleted'
      ) {
        this.logger.debug(
          `[Slack Event] Ignored bot/modification message ts=${msg.ts ?? 'none'}`,
        );

        return;
      }

      if (!msg.user || !msg.channel) {
        this.logger.warn(
          `[Slack Event] Ignored message without user or channel ts=${msg.ts ?? 'none'}`,
        );

        return;
      }

      if (!idempotencyKey) {
        this.logger.error(
          `[Slack Event] Cannot process message without ts or client_msg_id from user ${msg.user}`,
        );
        return;
      }

      let inboundEventId: string | undefined;

      try {
        await this.slackService.ensureUserRegistered(
          msg.user,
        );

        const claim =
          await this.claimInboundEvent(
            msg.user,
            idempotencyKey,
            'message',
            msg.ts ?? msg.client_msg_id,
          );

        if (!claim.claimed) {
          this.logger.warn(
            `[Slack Event] Dropped duplicate message event key=${idempotencyKey} user=${msg.user}`,
          );
          return;
        }

        inboundEventId = claim.eventId;

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
          threadTs: msg.thread_ts ?? undefined,
        };

        this.logger.log(
          `[Slack Event] Dispatching to SlackGateway user=${msg.user} ts=${msg.ts}`,
        );

        await this.slackGateway.handleIncomingMessage(
          payload,
        );

        await this.markInboundEventProcessed(
          inboundEventId,
        );

        this.logger.log(
          `[Slack Event] Completed processing user=${msg.user} ts=${msg.ts}`,
        );
      } catch (error: unknown) {
        await this.markInboundEventFailed(
          inboundEventId,
          error,
        );

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
      'app_mention',
      async ({ event }) => {
        /*
         * Do not log the entire Slack event because it contains
         * the user's message text and additional event metadata.
         */
        this.logger.log(
          `[SLACK EVENT TRIGGERED] app_mention received from user ${event.user} in channel ${event.channel}.`,
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

          // Channel @PulseBot mentions → Pulse AI (same AiChatService as AI Workspace).
          await this.slackAiAssistant.handleQuestion({
            slackUserId: event.user,
            channelId: event.channel,
            question: normalizedMessage,
            messageTs: event.ts,
            threadTs: event.thread_ts,
            source: 'app_mention',
          });
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

        const userId =
          body.user.id;

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