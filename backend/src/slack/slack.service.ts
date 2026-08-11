import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { PrismaService } from '../prisma/prisma.service';
import { OutgoingMessageDto } from './dto/outgoing-message.dto';

@Injectable()
export class SlackService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    SlackService.name,
  );

  private app?: App;
  private webClient?: WebClient;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initializeSlack();
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Slack service shutting down.');

    if (this.app) {
      try {
        await this.app.stop();
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        this.logger.warn(
          `Slack app shutdown warning: ${message}`,
        );
      }
    }
  }

  private async initializeSlack(): Promise<void> {
    const token =
      this.configService.get<string>(
        'SLACK_BOT_TOKEN',
      );

    const signingSecret =
      this.configService.get<string>(
        'SLACK_SIGNING_SECRET',
      );

    const appToken =
      this.configService.get<string>(
        'SLACK_APP_TOKEN',
      );

    if (!token) {
      this.logger.warn(
        'SLACK_BOT_TOKEN is missing. Slack messaging is disabled.',
      );

      return;
    }

    /*
     * WebClient handles outbound messages even when
     * Socket Mode is disabled.
     */
    this.webClient = new WebClient(token);

    const socketModeEnabled =
      this.configService.get<string>(
        'SLACK_SOCKET_MODE_ENABLED',
      ) === 'true';

    if (!socketModeEnabled) {
      this.logger.warn(
        'Slack Socket Mode is disabled. Outbound Slack messaging remains available.',
      );

      return;
    }

    if (!signingSecret || !appToken) {
      this.logger.warn(
        'Slack signing secret or app token is missing. Socket Mode will not start.',
      );

      return;
    }

    try {
      this.app = new App({
        token,
        signingSecret,
        appToken,
        socketMode: true,
      });

      await this.app.start();

      this.logger.log(
        'Slack Bolt app is running in Socket Mode.',
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      /*
       * Do not crash the backend when Socket Mode fails.
       * Outbound Web API messaging can still work.
       */
      this.logger.error(
        `Could not start Slack Socket Mode: ${message}`,
      );

      this.app = undefined;
    }
  }

  public getSlackApp(): App | undefined {
    return this.app;
  }

  public async ensureUserRegistered(
    slackUserId: string,
  ): Promise<string> {
    if (!this.webClient) {
      throw new Error(
        'Slack Web API is not initialized.',
      );
    }

    const botToken =
      this.configService.get<string>(
        'SLACK_BOT_TOKEN',
      );

    if (!botToken) {
      throw new Error(
        'SLACK_BOT_TOKEN is not configured.',
      );
    }

    const authResult =
      await this.webClient.auth.test();

    const slackWorkspaceId = authResult.team_id;
    const slackWorkspaceName = authResult.team;

    if (!slackWorkspaceId) {
      throw new Error(
        'Slack API did not return a workspace ID.',
      );
    }

    const workspace =
      await this.prisma.workspace.upsert({
        where: {
          slackWorkspaceId,
        },
        update: {
          slackWorkspaceName:
            slackWorkspaceName ??
            'Slack Workspace',
          botToken,
        },
        create: {
          slackWorkspaceId,
          slackWorkspaceName:
            slackWorkspaceName ??
            'Slack Workspace',
          botToken,
        },
      });

    const userResult =
      await this.webClient.users.info({
        user: slackUserId,
      });

    const slackUser = userResult.user;

    if (!slackUser?.id) {
      throw new Error(
        `Slack user ${slackUserId} could not be loaded.`,
      );
    }

    const displayName =
      slackUser.profile?.display_name?.trim() ||
      slackUser.profile?.real_name?.trim() ||
      slackUser.real_name?.trim() ||
      slackUser.name?.trim() ||
      slackUser.id;

    const user =
      await this.prisma.user.upsert({
        where: {
          slackUserId: slackUser.id,
        },
        update: {
          workspaceId: workspace.id,
          slackDisplayName: displayName,
          email:
            slackUser.profile?.email ?? null,
          timezone: slackUser.tz ?? null,
        },
        create: {
          workspaceId: workspace.id,
          slackUserId: slackUser.id,
          slackDisplayName: displayName,
          email:
            slackUser.profile?.email ?? null,
          timezone: slackUser.tz ?? null,
        },
      });

    const existingMembership =
      await this.prisma.teamMember.findFirst({
        where: {
          userId: user.id,
        },
      });

    if (!existingMembership) {
      let team =
        await this.prisma.team.findFirst({
          where: {
            workspaceId: workspace.id,
          },
          orderBy: {
            createdAt: 'asc',
          },
        });

      if (!team) {
        team = await this.prisma.team.create({
          data: {
            workspaceId: workspace.id,
            name: 'General',
            scheduleCron: '0 0 9 * * 0-4',
            timezone: 'Asia/Riyadh',
            schedulerEnabled: true,
          },
        });

        this.logger.log(
          `Created default team '${team.name}' for workspace ${workspace.id}`,
        );
      }

      await this.prisma.teamMember.upsert({
        where: {
          teamId_userId: {
            teamId: team.id,
            userId: user.id,
          },
        },
        update: {
          optedOut: false,
        },
        create: {
          teamId: team.id,
          userId: user.id,
          role: 'member',
          optedOut: false,
        },
      });

      this.logger.log(
        `Assigned user ${user.id} to team ${team.id} (${team.name})`,
      );
    }

    this.logger.log(
      `Slack user ${slackUserId} registered as database user ${user.id}`,
    );

    return user.id;
  }

  public async getUserDisplayName(
    slackUserId: string,
  ): Promise<string> {
    if (!slackUserId) {
      return 'Unknown user';
    }

    if (!this.webClient) {
      return slackUserId;
    }

    try {
      const result =
        await this.webClient.users.info({
          user: slackUserId,
        });

      const member = result.user;

      return (
        member?.profile?.display_name?.trim() ||
        member?.profile?.real_name?.trim() ||
        member?.real_name?.trim() ||
        member?.name?.trim() ||
        slackUserId
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.warn(
        `Could not retrieve Slack user ${slackUserId}: ${message}`,
      );

      return slackUserId;
    }
  }

  /**
   * Retrieves all active human members in the Slack workspace.
   */
  public async getWorkspaceMembers(): Promise<
    {
      id: string;
      name: string;
      realName: string;
      tz?: string;
    }[]
  > {
    if (!this.webClient) {
      this.logger.error(
        'Cannot get workspace members: Slack Web API is not initialized.',
      );

      return [];
    }

    try {
      const result =
        await this.webClient.users.list({});

      if (!result.members) {
        return [];
      }

      const humanMembers = result.members
        .filter((member) => {
          if (!member || member.deleted) {
            return false;
          }

          if (
            member.is_bot ||
            member.is_app_user
          ) {
            return false;
          }

          if (
            member.id === 'USLACKBOT' ||
            member.name === 'slackbot'
          ) {
            return false;
          }

          return true;
        })
        .map((member) => ({
          id: member.id!,
          name:
            member.profile?.display_name?.trim() ||
            member.profile?.real_name?.trim() ||
            member.name ||
            member.id!,
          realName:
            member.profile?.real_name?.trim() ||
            member.real_name ||
            member.name ||
            member.id!,
          tz: member.tz,
        }));

      this.logger.log(
        `Retrieved ${humanMembers.length} human member(s) from Slack workspace.`,
      );

      return humanMembers;
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.error(
        `Failed to retrieve workspace members from Slack API: ${message}`,
      );

      return [];
    }
  }

  /**
   * Opens a direct-message channel with a Slack user.
   */
  public async openDirectMessage(
    slackUserId: string,
  ): Promise<string | null> {
    if (!this.webClient) {
      this.logger.error(
        'Cannot open DM: Slack Web API is not initialized. Check SLACK_BOT_TOKEN.',
      );

      return null;
    }

    this.logger.log(
      `Opening DM with Slack user ${slackUserId}...`,
    );

    try {
      const result =
        await this.webClient.conversations.open({
          users: slackUserId,
        });

      const channelId = result.channel?.id || null;

      if (channelId) {
        this.logger.log(
          `DM channel opened: ${channelId} for user ${slackUserId}`,
        );
      } else {
        this.logger.error(
          `conversations.open returned no channel for user ${slackUserId}`,
        );
      }

      return channelId;
    } catch (error: unknown) {
      this.logSlackError(
        `Failed to open DM channel for user ${slackUserId}`,
        error,
      );

      return null;
    }
  }

  /**
   * Sends a message to a Slack channel or user.
   * Supports optional Slack Block Kit blocks.
   * Text remains required as fallback/accessibility text.
   *
   * Returns true when Slack confirms delivery.
   * Returns false if validation or all retry attempts fail.
   */
  public async sendMessage(
    payload: OutgoingMessageDto,
  ): Promise<boolean> {
    if (!this.webClient) {
      this.logger.error(
        'Cannot send message: Slack Web API is not initialized.',
      );

      return false;
    }

    const channelId =
      payload.channelId?.trim();

    const text =
      payload.text?.trim();

    if (!channelId || !text) {
      this.logger.error(
        'Cannot send message: channelId and text are required.',
      );

      return false;
    }

    const maxAttempts = 3;
    let delay = 1000;

    for (
      let attempt = 1;
      attempt <= maxAttempts;
      attempt += 1
    ) {
      try {
        await this.webClient.chat.postMessage({
          channel: channelId,
          text,
          ...(payload.threadTs
            ? { thread_ts: payload.threadTs }
            : {}),
          ...(payload.blocks
            ? {
                blocks: payload.blocks as any,
              }
            : {}),
        });

        this.logger.log(
          `Slack message delivered to ${channelId}: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`,
        );

        return true;
      } catch (error: unknown) {
        this.logSlackError(
          `Slack message attempt ${attempt}/${maxAttempts} to ${channelId}`,
          error,
        );

        if (attempt === maxAttempts) {
          return false;
        }

        await new Promise<void>((resolve) => {
          setTimeout(resolve, delay);
        });

        delay *= 2;
      }
    }

    return false;
  }

  /**
   * Posts a message and returns the Slack message timestamp (thread anchor).
   */
  public async postMessage(
    payload: OutgoingMessageDto,
  ): Promise<{ ok: boolean; ts?: string }> {
    if (!this.webClient) {
      return { ok: false };
    }

    const channelId = payload.channelId?.trim();
    const text = payload.text?.trim();

    if (!channelId || !text) {
      return { ok: false };
    }

    try {
      const result = await this.webClient.chat.postMessage({
        channel: channelId,
        text,
        ...(payload.threadTs ? { thread_ts: payload.threadTs } : {}),
        ...(payload.blocks ? { blocks: payload.blocks as any } : {}),
      });

      return { ok: true, ts: result.ts as string | undefined };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Slack postMessage failed: ${message}`);
      return { ok: false };
    }
  }

  public async updateMessage(payload: {
    channelId: string;
    ts: string;
    text: string;
    blocks?: unknown[];
  }): Promise<boolean> {
    if (!this.webClient) {
      this.logger.error('Cannot update message: Slack Web API is not initialized.');
      return false;
    }

    try {
      await this.webClient.chat.update({
        channel: payload.channelId,
        ts: payload.ts,
        text: payload.text,
        ...(payload.blocks ? { blocks: payload.blocks as any } : {}),
      });
      return true;
    } catch (error: unknown) {
      this.logSlackError(`Failed to update message ${payload.ts}`, error);
      return false;
    }
  }

  public async getPermalink(
    channelId: string,
    messageTs: string,
  ): Promise<string | null> {
    if (!this.webClient) {
      return null;
    }

    try {
      const result = await this.webClient.chat.getPermalink({
        channel: channelId,
        message_ts: messageTs,
      });

      return result.permalink ?? null;
    } catch (error: unknown) {
      this.logSlackError(
        `Failed to get permalink for ${channelId}/${messageTs}`,
        error,
      );
      return null;
    }
  }

  private logSlackError(context: string, error: unknown): void {
    const err = error as { message?: string; data?: { error?: string; needed?: string; provided?: string } };
    const slackError = err?.data?.error;
    const needed = err?.data?.needed;
    const provided = err?.data?.provided;

    if (slackError) {
      this.logger.error(
        `${context}: Slack API error="${slackError}"` +
          (needed ? ` needed="${needed}"` : '') +
          (provided ? ` provided="${provided}"` : ''),
      );
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(`${context}: ${message}`);
  }
}