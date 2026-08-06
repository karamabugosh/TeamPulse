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

  public async sendMessage(
    payload: OutgoingMessageDto,
  ): Promise<boolean> {
    if (!this.webClient) {
      this.logger.error(
        'Cannot send message: Slack Web API is not initialized.',
      );

      return false;
    }

    const channelId = payload.channelId?.trim();
    const text = payload.text?.trim();

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
        });

        this.logger.log(
          `Slack message delivered to ${channelId}.`,
        );

        return true;
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        this.logger.error(
          `Slack message attempt ${attempt}/${maxAttempts} failed: ${message}`,
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
}