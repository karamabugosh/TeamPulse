import { Injectable, Logger } from '@nestjs/common';
import { WebClient } from '@slack/web-api';
import { PrismaService } from '../prisma/prisma.service';
import {
  isPlaceholderSlackUser,
  isUsableSlackBotToken,
} from '../common/slack-member.util';

export type SlackMemberCacheRow = {
  slackUserId: string;
  displayName: string;
  realName: string | null;
  email: string | null;
  isBot: boolean;
  deleted: boolean;
};

export type SlackMemberSyncResult = {
  source: 'live_slack' | 'none';
  synced: number;
  humans: SlackMemberCacheRow[];
};

/**
 * Live Slack users.list → SlackMemberCache (+ User upsert for humans).
 * Same priority model as Jira: Live → Cache → TeamMember/User → Demo.
 */
@Injectable()
export class SlackMemberCacheService {
  private readonly logger = new Logger(SlackMemberCacheService.name);

  constructor(private readonly prisma: PrismaService) {}

  async hasUsableLiveSlack(workspaceId: string): Promise<boolean> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { botToken: true },
    });
    return isUsableSlackBotToken(workspace?.botToken);
  }

  /**
   * Call Slack users.list and refresh SlackMemberCache for the workspace.
   * Returns human (non-bot, non-deleted, non-placeholder) members when Live succeeds.
   */
  async syncFromLive(workspaceId: string): Promise<SlackMemberSyncResult> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        botToken: true,
        slackWorkspaceId: true,
      },
    });

    if (!workspace || !isUsableSlackBotToken(workspace.botToken)) {
      this.logger.log(
        `Slack live sync skipped — no usable bot token for workspace=${workspaceId}`,
      );
      return { source: 'none', synced: 0, humans: [] };
    }

    const client = new WebClient(workspace.botToken);
    let cursor: string | undefined;
    let synced = 0;
    const humans: SlackMemberCacheRow[] = [];
    const seenIds = new Set<string>();

    do {
      const result = await client.users.list({
        limit: 200,
        cursor,
      });

      for (const member of result.members ?? []) {
        if (!member?.id) continue;
        seenIds.add(member.id);

        const isBot = Boolean(
          member.is_bot ||
            member.is_app_user ||
            member.id === 'USLACKBOT' ||
            member.name === 'slackbot',
        );
        const deleted = Boolean(member.deleted);
        const displayName =
          member.profile?.display_name?.trim() ||
          member.profile?.real_name?.trim() ||
          member.real_name?.trim() ||
          member.name?.trim() ||
          member.id;
        const realName =
          member.profile?.real_name?.trim() ||
          member.real_name?.trim() ||
          displayName;
        const email = member.profile?.email ?? null;
        const avatarUrl =
          member.profile?.image_192 ||
          member.profile?.image_72 ||
          member.profile?.image_48 ||
          null;

        await this.prisma.slackMemberCache.upsert({
          where: {
            workspaceId_slackUserId: {
              workspaceId: workspace.id,
              slackUserId: member.id,
            },
          },
          create: {
            workspaceId: workspace.id,
            slackUserId: member.id,
            displayName,
            realName,
            email,
            isBot,
            deleted,
          },
          update: {
            displayName,
            realName,
            email,
            isBot,
            deleted,
          },
        });
        synced += 1;

        if (deleted || isBot) continue;
        if (
          isPlaceholderSlackUser({
            slackUserId: member.id,
            slackDisplayName: displayName,
            email,
          })
        ) {
          continue;
        }

        humans.push({
          slackUserId: member.id,
          displayName,
          realName,
          email,
          isBot: false,
          deleted: false,
        });

        // Keep User table in sync for Pulse product features (teams, standups).
        const existing = await this.prisma.user.findUnique({
          where: { slackUserId: member.id },
          select: { id: true, workspaceId: true },
        });
        if (existing && existing.workspaceId !== workspace.id) {
          continue;
        }

        await this.prisma.user.upsert({
          where: { slackUserId: member.id },
          update: {
            workspaceId: workspace.id,
            slackDisplayName: displayName,
            email,
            timezone: member.tz ?? null,
          },
          create: {
            workspaceId: workspace.id,
            slackUserId: member.id,
            slackDisplayName: displayName,
            email,
            timezone: member.tz ?? null,
          },
        });

        await this.prisma.$executeRaw`
          UPDATE "User"
          SET
            "slackRealName" = ${realName},
            "slackAvatarUrl" = ${avatarUrl}
          WHERE "slackUserId" = ${member.id}
            AND "workspaceId" = ${workspace.id}
        `;
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    // Mark cache rows not returned by this sync as deleted (left the workspace).
    if (seenIds.size > 0) {
      await this.prisma.slackMemberCache.updateMany({
        where: {
          workspaceId: workspace.id,
          deleted: false,
          slackUserId: { notIn: [...seenIds] },
        },
        data: { deleted: true },
      });
    }

    this.logger.log(
      `Slack live sync OK workspace=${workspace.id} slackTeam=${workspace.slackWorkspaceId} synced=${synced} humans=${humans.length}`,
    );

    return { source: 'live_slack', synced, humans };
  }

  async listHumanCache(workspaceId: string): Promise<SlackMemberCacheRow[]> {
    const rows = await this.prisma.slackMemberCache.findMany({
      where: {
        workspaceId,
        isBot: false,
        deleted: false,
      },
      orderBy: { displayName: 'asc' },
    });

    return rows
      .filter(
        (row) =>
          !isPlaceholderSlackUser({
            slackUserId: row.slackUserId,
            slackDisplayName: row.displayName,
            email: row.email,
          }),
      )
      .map((row) => ({
        slackUserId: row.slackUserId,
        displayName: row.displayName,
        realName: row.realName,
        email: row.email,
        isBot: row.isBot,
        deleted: row.deleted,
      }));
  }

  async upsertDemoMembers(
    workspaceId: string,
    members: Array<{
      slackUserId: string;
      displayName: string;
      realName?: string | null;
      email?: string | null;
    }>,
  ): Promise<void> {
    for (const member of members) {
      await this.prisma.slackMemberCache.upsert({
        where: {
          workspaceId_slackUserId: {
            workspaceId,
            slackUserId: member.slackUserId,
          },
        },
        create: {
          workspaceId,
          slackUserId: member.slackUserId,
          displayName: member.displayName,
          realName: member.realName ?? member.displayName,
          email: member.email ?? null,
          isBot: false,
          deleted: false,
        },
        update: {
          displayName: member.displayName,
          realName: member.realName ?? member.displayName,
          email: member.email ?? null,
          isBot: false,
          deleted: false,
        },
      });
    }
  }
}
