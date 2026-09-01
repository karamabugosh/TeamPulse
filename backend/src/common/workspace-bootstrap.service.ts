import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { WebClient } from '@slack/web-api';
import { PrismaService } from '../prisma/prisma.service';
import { isUsableSlackBotToken } from './slack-member.util';

/**
 * Ensures a Workspace row exists for dashboard APIs on fresh production deploys.
 * Slack Socket Mode creates workspaces when users interact; the web dashboard
 * needs a row before any Slack traffic arrives.
 */
@Injectable()
export class WorkspaceBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(WorkspaceBootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureFromSlackToken();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Workspace bootstrap on startup skipped: ${message}`);
    }
  }

  async ensureFromSlackToken(): Promise<string | null> {
    const existing = await this.prisma.workspace.findFirst({
      orderBy: { installedAt: 'asc' },
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }

    const botToken = process.env.SLACK_BOT_TOKEN?.trim();
    if (!isUsableSlackBotToken(botToken)) {
      this.logger.warn(
        'No workspace in database and SLACK_BOT_TOKEN is missing or unusable.',
      );
      return null;
    }

    const client = new WebClient(botToken);
    const auth = await client.auth.test();

    if (!auth.team_id) {
      this.logger.warn('Slack auth.test did not return team_id.');
      return null;
    }

    const workspace = await this.prisma.workspace.upsert({
      where: { slackWorkspaceId: auth.team_id },
      update: {
        slackWorkspaceName: auth.team ?? 'Slack Workspace',
        botToken,
      },
      create: {
        slackWorkspaceId: auth.team_id,
        slackWorkspaceName: auth.team ?? 'Slack Workspace',
        botToken,
      },
    });

    this.logger.log(
      `Bootstrapped workspace "${workspace.slackWorkspaceName}" (${workspace.id}).`,
    );
    return workspace.id;
  }
}
