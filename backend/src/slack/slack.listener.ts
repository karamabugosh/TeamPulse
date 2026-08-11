import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuthService } from '../auth/auth.service';
import { CollectionService } from '../collection/collection.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { SlackGateway } from './slack.gateway';
import { buildAppHomeBlocks } from './slack-app-home.view';
import { SlackService } from './slack.service';

type InteractiveAnswerValue = {
  questionId: string;
  answer: string;
  optionIndex?: number;
};

@Injectable()
export class SlackListener implements OnModuleInit {
  private readonly logger =
    new Logger(SlackListener.name);

  constructor(
    private readonly slackService: SlackService,
    private readonly slackGateway: SlackGateway,
    private readonly authService: AuthService,
    private readonly collectionService: CollectionService,
    private readonly reportsService: ReportsService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    this.logger.log(
      'SlackListener onModuleInit() is executing...',
    );

    this.registerListeners();
  }

  // =========================================================
  // INBOUND EVENT IDEMPOTENCY
  // =========================================================

  private async claimInboundEvent(
    slackUserId: string,
    idempotencyKey: string,
    eventType: string,
    externalEventId?: string,
  ): Promise<{
    claimed: boolean;
    eventId?: string;
  }> {
    if (!idempotencyKey) {
      return {
        claimed: true,
      };
    }

    const user =
      await this.prisma.user.findUnique({
        where: {
          slackUserId,
        },

        select: {
          workspaceId:
            true,
        },
      });

    if (!user) {
      throw new Error(
        `Cannot create inbound event because Slack user ${slackUserId} is not registered.`,
      );
    }

    try {
      const event =
        await this.prisma.inboundEvent.create({
          data: {
            workspaceId:
              user.workspaceId,

            provider:
              'slack',

            idempotencyKey,

            externalEventId:
              externalEventId ||
              null,

            eventType,

            status:
              'processing',
          },
        });

      return {
        claimed:
          true,

        eventId:
          event.id,
      };
    } catch (
      error: unknown
    ) {
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code ===
          'P2002'
      ) {
        const existingEvent =
          await this.prisma.inboundEvent.findUnique({
            where: {
              idempotencyKey,
            },

            select: {
              id: true,
              status: true,
              receivedAt:
                true,
            },
          });

        if (!existingEvent) {
          throw error;
        }

        /*
         * Failed events may be retried immediately.
         *
         * The conditional update makes reclaim atomic.
         */
        if (
          existingEvent.status ===
          'failed'
        ) {
          const reclaimed =
            await this.prisma.inboundEvent.updateMany({
              where: {
                id:
                  existingEvent.id,

                status:
                  'failed',
              },

              data: {
                status:
                  'processing',

                errorMessage:
                  null,

                processedAt:
                  null,

                receivedAt:
                  new Date(),

                externalEventId:
                  externalEventId ||
                  null,
              },
            });

          if (
            reclaimed.count ===
            1
          ) {
            this.logger.log(
              `Retrying previously failed Slack event ${idempotencyKey}.`,
            );

            return {
              claimed:
                true,

              eventId:
                existingEvent.id,
            };
          }
        }

        /*
         * Recover events abandoned because the backend died
         * after claiming them.
         *
         * A processing event behaves like a lease rather than
         * a permanent lock.
         */
        if (
          existingEvent.status ===
          'processing'
        ) {
          const configuredMinutes =
            Number(
              process.env
                .INBOUND_EVENT_PROCESSING_STALE_MINUTES ??
                '5',
            );

          const staleMinutes =
            Number.isFinite(
              configuredMinutes,
            ) &&
            configuredMinutes > 0
              ? configuredMinutes
              : 5;

          const staleBefore =
            new Date(
              Date.now() -
                staleMinutes *
                  60 *
                  1000,
            );

          if (
            existingEvent.receivedAt <=
            staleBefore
          ) {
            const reclaimed =
              await this.prisma.inboundEvent.updateMany({
                where: {
                  id:
                    existingEvent.id,

                  status:
                    'processing',

                  receivedAt: {
                    lte:
                      staleBefore,
                  },
                },

                data: {
                  status:
                    'processing',

                  errorMessage:
                    null,

                  processedAt:
                    null,

                  receivedAt:
                    new Date(),

                  externalEventId:
                    externalEventId ||
                    null,
                },
              });

            if (
              reclaimed.count ===
              1
            ) {
              this.logger.warn(
                `Reclaimed stale Slack event ${idempotencyKey} after ${staleMinutes} minute(s) in processing state.`,
              );

              return {
                claimed:
                  true,

                eventId:
                  existingEvent.id,
              };
            }
          }
        }

        this.logger.debug(
          `Ignoring duplicate Slack event ${idempotencyKey} with status ${existingEvent.status}.`,
        );

        return {
          claimed:
            false,
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
        id:
          eventId,
      },

      data: {
        status:
          'processed',

        processedAt:
          new Date(),

        errorMessage:
          null,
      },
    });
  }

  private async markInboundEventFailed(
    eventId:
      | string
      | undefined,
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
        id:
          eventId,
      },

      data: {
        status:
          'failed',

        errorMessage:
          message,
      },
    });
  }

  // =========================================================
  // INTERACTIVE ANSWER HELPERS
  // =========================================================

  private decodeInteractiveAnswer(
    rawValue: unknown,
  ): InteractiveAnswerValue {
    if (
      typeof rawValue !==
        'string' ||
      !rawValue.trim()
    ) {
      throw new Error(
        'Slack interaction did not contain an answer value.',
      );
    }

    let parsed:
      unknown;

    try {
      parsed =
        JSON.parse(
          rawValue,
        );
    } catch {
      throw new Error(
        'Slack interaction contained an invalid answer payload.',
      );
    }

    if (
      typeof parsed !==
        'object' ||
      parsed === null
    ) {
      throw new Error(
        'Slack interaction contained an invalid answer payload.',
      );
    }

    const candidate =
      parsed as Partial<InteractiveAnswerValue>;

    if (
      typeof candidate.questionId !==
        'string' ||
      !candidate.questionId.trim()
    ) {
      throw new Error(
        'Slack interaction is missing questionId.',
      );
    }

    if (
      typeof candidate.answer !==
        'string' ||
      !candidate.answer.trim()
    ) {
      throw new Error(
        'Slack interaction is missing an answer.',
      );
    }

    return {
      questionId:
        candidate.questionId.trim(),

      answer:
        candidate.answer.trim(),

      ...(typeof candidate.optionIndex ===
      'number'
        ? {
            optionIndex:
              candidate.optionIndex,
          }
        : {}),
    };
  }

  private getInteractiveChannelId(
    body: any,
  ): string | undefined {
    return (
      body?.channel?.id ||
      body?.container?.channel_id ||
      undefined
    );
  }

  /**
   * Gives Slack retries for the same interaction the same
   * persistent idempotency key.
   */
  private buildInteractiveIdempotencyKey(
    body: any,
    action: any,
  ): string {
    const userId =
      body?.user?.id ||
      'unknown-user';

    const actionId =
      action?.action_id ||
      'unknown-action';

    const actionTimestamp =
      action?.action_ts ||
      body?.action_ts ||
      body?.trigger_id ||
      body?.container?.message_ts ||
      body?.message?.ts ||
      'unknown-ts';

    return [
      'slack',
      'interaction',
      userId,
      actionId,
      actionTimestamp,
    ].join(
      ':',
    );
  }

  private async processInteractiveAnswer(
    body: any,
    action: any,
  ): Promise<void> {
    const userId =
      body?.user?.id;

    if (!userId) {
      throw new Error(
        'Slack interaction did not contain a user.',
      );
    }

    await this.slackService.ensureUserRegistered(
      userId,
    );

    const rawValue =
      action?.selected_option
        ?.value ??
      action?.value;

    const decoded =
      this.decodeInteractiveAnswer(
        rawValue,
      );

    const idempotencyKey =
      this.buildInteractiveIdempotencyKey(
        body,
        action,
      );

    const externalEventId =
      action?.action_ts ||
      body?.trigger_id ||
      undefined;

    let inboundEventId:
      | string
      | undefined;

    const claim =
      await this.claimInboundEvent(
        userId,
        idempotencyKey,
        'block_action',
        externalEventId,
      );

    if (!claim.claimed) {
      return;
    }

    inboundEventId =
      claim.eventId;

    try {
      let channelId =
        this.getInteractiveChannelId(
          body,
        );

      /*
       * Most question interactions happen in a DM and contain
       * channel information. If Slack omits it, recover the
       * user's DM through conversations.open.
       */
      if (!channelId) {
        channelId =
          (
            await this.slackService.openDirectMessage(
              userId,
            )
          ) ??
          undefined;
      }

      if (!channelId) {
        throw new Error(
          'Could not determine the Slack channel for this answer.',
        );
      }

      await this.slackGateway.handleInteractiveAnswer(
        userId,
        channelId,
        decoded.questionId,
        decoded.answer,
      );

      await this.markInboundEventProcessed(
        inboundEventId,
      );
    } catch (
      error: unknown
    ) {
      await this.markInboundEventFailed(
        inboundEventId,
        error,
      );

      throw error;
    }
  }

  // =========================================================
  // LISTENER REGISTRATION
  // =========================================================

  private registerListeners(): void {
    this.logger.log(
      'Attempting to register Slack listeners...',
    );

    const app =
      this.slackService.getSlackApp();

    if (!app) {
      this.logger.error(
        'Slack app is NOT initialized. Listeners CANNOT be registered.',
      );

      return;
    }

    // =======================================================
    // NORMAL MESSAGES
    // =======================================================

    const handleIncomingSlackMessage =
      async (
        msg: any,
        client: any,
      ) => {
        const msgIdentifier =
          msg.client_msg_id ||
          `${msg.user}-${msg.ts}`;

        if (
          msg.bot_id ||
          msg.subtype ===
            'bot_message' ||
          msg.subtype ===
            'message_changed' ||
          msg.subtype ===
            'message_deleted'
        ) {
          this.logger.debug(
            'Ignored bot message or message modification event.',
          );

          return;
        }

        if (
          !msg.user ||
          !msg.channel
        ) {
          this.logger.warn(
            'Ignored Slack message without a user or channel.',
          );

          return;
        }

        /*
         * Never log msg.text.
         * CheckIn answers may contain private information.
         */
        this.logger.log(
          `Processing incoming Slack message from user ${msg.user} in channel ${msg.channel}.`,
        );

        let inboundEventId:
          | string
          | undefined;

        try {
          await this.slackService.ensureUserRegistered(
            msg.user,
          );

          const claim =
            await this.claimInboundEvent(
              msg.user,

              `slack:message:${msgIdentifier}`,

              'message',

              msg.client_msg_id ||
                msg.ts,
            );

          if (!claim.claimed) {
            return;
          }

          inboundEventId =
            claim.eventId;

          try {
            const userInfo =
              await client.users.info({
                user:
                  msg.user,
              });

            const teamId =
              userInfo.user
                ?.team_id ||
              'unknown_team';

            await this.authService.syncSlackUser(
              msg.user,
              teamId,
              'TeamPulse Workspace',
            );
          } catch (
            syncError: unknown
          ) {
            const message =
              syncError instanceof Error
                ? syncError.message
                : String(
                    syncError,
                  );

            this.logger.warn(
              `Could not sync Slack auth profile for ${msg.user}: ${message}`,
            );
          }

          const payload:
            IncomingMessageDto = {
            userId:
              msg.user,

            channelId:
              msg.channel,

            message:
              msg.text ?? '',

            timestamp:
              msg.ts ?? '',
          };

          this.logger.log(
            `Sending incoming message from user ${msg.user} to SlackGateway.`,
          );

          await this.slackGateway.handleIncomingMessage(
            payload,
          );

          await this.markInboundEventProcessed(
            inboundEventId,
          );
        } catch (
          error: unknown
        ) {
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
            channelId:
              msg.channel,

            text:
              '❌ An error occurred while preparing your check-in. Please try again.',
          });
        }
      };

    app.message(
      async ({
        message,
        client,
      }) => {
        await handleIncomingSlackMessage(
          message,
          client,
        );
      },
    );

    app.event(
      'message',
      async ({
        event,
        client,
      }) => {
        await handleIncomingSlackMessage(
          event,
          client,
        );
      },
    );

    // =======================================================
    // V2 STRUCTURED QUESTION ACTIONS
    // =======================================================

    /**
     * Handles:
     *
     * pulse_answer_yes
     * pulse_answer_no
     * pulse_answer_maybe
     * pulse_answer_scale_1..5
     * pulse_answer_choice_*
     *
     * The encoded action value carries questionId + answer.
     */
    app.action(
      /^pulse_answer_(?!select$).+/,
      async ({
        ack,
        body,
        action,
      }: any) => {
        /*
         * Slack requires interactions to be acknowledged
         * quickly. Business processing happens afterward.
         */
        await ack();

        try {
          await this.processInteractiveAnswer(
            body,
            action,
          );
        } catch (
          error: unknown
        ) {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          const userId =
            body?.user?.id ??
            'unknown';

          this.logger.error(
            `Structured Slack answer failed for user ${userId}: ${message}`,
            error instanceof Error
              ? error.stack
              : undefined,
          );

          let channelId =
            this.getInteractiveChannelId(
              body,
            );

          if (
            !channelId &&
            body?.user?.id
          ) {
            channelId =
              (
                await this.slackService.openDirectMessage(
                  body.user.id,
                )
              ) ??
              undefined;
          }

          if (channelId) {
            await this.slackService.sendMessage({
              channelId,

              text:
                '❌ That answer could not be processed. Please try the current question again.',
            });
          }
        }
      },
    );

    /**
     * Handles MULTIPLE_CHOICE static_select interactions.
     */
    app.action(
      'pulse_answer_select',
      async ({
        ack,
        body,
        action,
      }: any) => {
        await ack();

        try {
          await this.processInteractiveAnswer(
            body,
            action,
          );
        } catch (
          error: unknown
        ) {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          const userId =
            body?.user?.id ??
            'unknown';

          this.logger.error(
            `Slack select answer failed for user ${userId}: ${message}`,
            error instanceof Error
              ? error.stack
              : undefined,
          );

          let channelId =
            this.getInteractiveChannelId(
              body,
            );

          if (
            !channelId &&
            body?.user?.id
          ) {
            channelId =
              (
                await this.slackService.openDirectMessage(
                  body.user.id,
                )
              ) ??
              undefined;
          }

          if (channelId) {
            await this.slackService.sendMessage({
              channelId,

              text:
                '❌ That selection could not be processed. Please try the current question again.',
            });
          }
        }
      },
    );

    // =======================================================
    // APP MENTION
    // =======================================================

    app.event(
      'app_mention',
      async ({
        event,
      }) => {
        /*
         * Do not log the entire event because it contains
         * user message content and additional metadata.
         */
        this.logger.log(
          `[SLACK EVENT TRIGGERED] app_mention received from user ${event.user} in channel ${event.channel}.`,
        );

        try {
          await this.slackService.ensureUserRegistered(
            event.user,
          );

          const normalizedMessage =
            (
              event.text ??
              ''
            )
              .replace(
                /<@[^>]+>/g,
                '',
              )
              .trim();

          const payload:
            IncomingMessageDto = {
            userId:
              event.user,

            channelId:
              event.channel,

            message:
              normalizedMessage,

            timestamp:
              event.ts,
          };

          await this.slackGateway.handleIncomingMessage(
            payload,
          );
        } catch (
          error: unknown
        ) {
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
            channelId:
              event.channel,

            text:
              '❌ An error occurred while processing your request.',
          });
        }
      },
    );

    // =======================================================
    // APP HOME
    // =======================================================

    app.event(
      'app_home_opened',
      async ({
        event,
        client,
      }) => {
        try {
          await this.slackService.ensureUserRegistered(
            event.user,
          );

          try {
            const userInfo =
              await client.users.info({
                user:
                  event.user,
              });

            const teamId =
              userInfo.user
                ?.team_id ||
              'unknown_team';

            await this.authService.syncSlackUser(
              event.user,
              teamId,
              'TeamPulse Workspace',
            );
          } catch (
            syncError: unknown
          ) {
            const message =
              syncError instanceof Error
                ? syncError.message
                : String(
                    syncError,
                  );

            this.logger.warn(
              `Could not sync Slack auth profile on App Home open for ${event.user}: ${message}`,
            );
          }

          const summary =
            await this.collectionService.getAppHomeSummary(
              event.user,
            );

          await client.views.publish({
            user_id:
              event.user,

            view: {
              type:
                'home',

              blocks:
                buildAppHomeBlocks(
                  summary,
                ),
            },
          });
        } catch (
          error: unknown
        ) {
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

    // =======================================================
    // LEGACY START ACTION
    // =======================================================

    app.action(
      'start_standup',
      async ({
        ack,
        body,
        client,
      }) => {
        await ack();

        const userId =
          body.user.id;

        try {
          await this.slackService.ensureUserRegistered(
            userId,
          );

          const openResult =
            await client.conversations.open({
              users:
                userId,
            });

          const channelId =
            openResult.channel
              ?.id;

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
            user_id:
              userId,

            view: {
              type:
                'home',

              blocks:
                buildAppHomeBlocks(
                  summary,
                ),
            },
          });
        } catch (
          error: unknown
        ) {
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

    // =======================================================
    // REPORT COMMAND
    // =======================================================

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
            command.text
              ?.trim() ||
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
            response_type:
              'ephemeral',

            text:
              reportText,

            blocks:
              reportBlocks as any,
          });
        } catch (
          error: unknown
        ) {
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
            response_type:
              'ephemeral',

            text:
              `❌ ${message}`,
          });
        }
      },
    );

    // =======================================================
    // HISTORY COMMAND
    // =======================================================

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
            command.text
              ?.trim() ||
            undefined;

          const digests =
            await this.reportsService.getDigestHistoryForSlackUser(
              command.user_id,
              5,
              teamSearch,
            );

          await respond({
            response_type:
              'ephemeral',

            text:
              this.reportsService.formatHistoryForSlack(
                digests,
              ),
          });
        } catch (
          error: unknown
        ) {
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
            response_type:
              'ephemeral',

            text:
              `❌ ${message}`,
          });
        }
      },
    );

    // =======================================================
    // GLOBAL ERROR HANDLER
    // =======================================================

    app.error(
      async (
        error: unknown,
      ) => {
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