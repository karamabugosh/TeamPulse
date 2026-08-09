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

    // 3. Ensure User belongs to a Team
    const existingMembership = await this.prisma.teamMember.findFirst({
      where: { userId: user.id },
    });

    if (!existingMembership) {
      let team = await this.prisma.team.findFirst({
        where: { workspaceId: workspace.id },
        orderBy: { createdAt: 'asc' },
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
      }

      await this.prisma.teamMember.upsert({
        where: {
          teamId_userId: {
            teamId: team.id,
            userId: user.id,
          },
        },
        update: { optedOut: false },
        create: {
          teamId: team.id,
          userId: user.id,
          role: 'member',
          optedOut: false,
        },
      });
    }

    return user;
  }
}