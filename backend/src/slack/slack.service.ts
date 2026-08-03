import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App } from '@slack/bolt';
import { PrismaService } from '../prisma/prisma.service';
import { OutgoingMessageDto } from './dto/outgoing-message.dto';

@Injectable()
export class SlackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlackService.name);
  private app?: App;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initializeSlack();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.app) {
      await this.app.stop();
    }

    this.logger.log('Slack service shutting down.');
  }

  private async initializeSlack(): Promise<void> {
    const token = this.configService.get<string>('SLACK_BOT_TOKEN');
    const signingSecret =
      this.configService.get<string>('SLACK_SIGNING_SECRET');
    const appToken =
      this.configService.get<string>('SLACK_APP_TOKEN');

    if (!token || !signingSecret || !appToken) {
      this.logger.warn(
        'Slack tokens are missing. Slack App will not be initialized.',
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
        '⚡️ Slack Bolt app is running in Socket Mode!',
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `Error initializing Slack app: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  public getSlackApp(): App | undefined {
    return this.app;
  }

  /**
   * Ensures the Slack workspace and user exist in PostgreSQL.
   * Returns the internal database User.id.
   */
  public async ensureUserRegistered(
    slackUserId: string,
  ): Promise<string> {
    if (!this.app) {
      throw new Error('Slack app is not initialized.');
    }

    const botToken =
      this.configService.get<string>('SLACK_BOT_TOKEN');

    if (!botToken) {
      throw new Error('SLACK_BOT_TOKEN is not configured.');
    }

    /*
     * auth.test returns information about the workspace
     * connected to the current bot token.
     */
    const authResult = await this.app.client.auth.test();

    const slackWorkspaceId = authResult.team_id;
    const slackWorkspaceName = authResult.team;

    if (!slackWorkspaceId) {
      throw new Error(
        'Slack API did not return a workspace ID.',
      );
    }

    const workspace = await this.prisma.workspace.upsert({
      where: {
        slackWorkspaceId,
      },
      update: {
        slackWorkspaceName:
          slackWorkspaceName ?? 'Slack Workspace',
        botToken,
      },
      create: {
        slackWorkspaceId,
        slackWorkspaceName:
          slackWorkspaceName ?? 'Slack Workspace',
        botToken,
      },
    });

    /*
     * users.info returns profile information for the person
     * who sent the Slack message.
     */
    const userResult = await this.app.client.users.info({
      user: slackUserId,
    });

    const slackUser = userResult.user;

    if (!slackUser?.id) {
      throw new Error(
        `Slack user ${slackUserId} could not be loaded.`,
      );
    }

    const displayName =
      slackUser.profile?.display_name ||
      slackUser.profile?.real_name ||
      slackUser.name ||
      slackUser.id;

    const user = await this.prisma.user.upsert({
      where: {
        slackUserId: slackUser.id,
      },
      update: {
        workspaceId: workspace.id,
        slackDisplayName: displayName,
        email: slackUser.profile?.email ?? null,
        timezone: slackUser.tz ?? null,
      },
      create: {
        workspaceId: workspace.id,
        slackUserId: slackUser.id,
        slackDisplayName: displayName,
        email: slackUser.profile?.email ?? null,
        timezone: slackUser.tz ?? null,
      },
    });

    this.logger.log(
      `Slack user ${slackUserId} registered as database user ${user.id}`,
    );

    return user.id;
  }

  public async sendMessage(
    payload: OutgoingMessageDto,
  ): Promise<void> {
    if (!this.app) {
      throw new Error(
        'Cannot send message: Slack app is not initialized.',
      );
    }

    if (!payload.channelId || !payload.text) {
      throw new Error(
        'Cannot send message: channelId and text are required.',
      );
    }

    const maxAttempts = 3;
    let delay = 1000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.logger.log(
          `Sending message to channel ${payload.channelId} ` +
            `(attempt ${attempt}/${maxAttempts})`,
        );

        await this.app.client.chat.postMessage({
          channel: payload.channelId,
          text: payload.text,
        });

        return;
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unknown Slack error';

        this.logger.error(
          `Failed to send Slack message: ${message}`,
        );

        if (attempt === maxAttempts) {
          throw error;
        }

        await new Promise<void>((resolve) => {
          setTimeout(resolve, delay);
        });

        delay *= 2;
      }
    }
  }
}