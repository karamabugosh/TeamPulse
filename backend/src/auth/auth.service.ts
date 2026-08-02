import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async syncSlackUser(slackUserId: string, slackWorkspaceId: string, slackWorkspaceName = 'Unknown Workspace') {
    // 1. Upsert Workspace
    const workspace = await this.prisma.workspace.upsert({
      where: { slackWorkspaceId },
      update: {},
      create: {
        slackWorkspaceId,
        slackWorkspaceName,
        botToken: process.env.SLACK_BOT_TOKEN || '', // Assuming single-workspace for now
      },
    });

    // 2. Upsert User
    const user = await this.prisma.user.upsert({
      where: { slackUserId },
      update: {},
      create: {
        slackUserId,
        workspaceId: workspace.id,
        slackDisplayName: slackUserId, // Can be updated with Slack API info later
      },
    });

    return user;
  }
}