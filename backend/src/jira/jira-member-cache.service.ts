import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JiraService } from './jira.service';
import { DEMO_SLACK_WORKSPACE_ID } from '../demo/demo.constants';
import { JiraWorkspaceMember } from './jira.types';

export type JiraMemberCacheRow = {
  accountId: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  accountType: string | null;
  active: boolean;
};

export type JiraMemberSyncResult = {
  source: 'live_jira' | 'none';
  synced: number;
  members: JiraMemberCacheRow[];
};

/**
 * Live Jira users/search → JiraMemberCache.
 * Priority: Live Jira → Cache → Demo (seeded cache only).
 */
@Injectable()
export class JiraMemberCacheService {
  private readonly logger = new Logger(JiraMemberCacheService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jiraService: JiraService,
  ) {}

  async hasUsableLiveJira(workspaceId: string): Promise<boolean> {
    const connection = await this.findUsableConnection(workspaceId);
    return Boolean(connection);
  }

  /**
   * Call Jira listWorkspaceMembers and refresh JiraMemberCache for the workspace.
   * Returns active human members when Live succeeds.
   */
  async syncFromLive(workspaceId: string): Promise<JiraMemberSyncResult> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, slackWorkspaceId: true },
    });

    if (!workspace) {
      return { source: 'none', synced: 0, members: [] };
    }

    // Demo never calls Live Atlassian — cache is seeded.
    if (workspace.slackWorkspaceId === DEMO_SLACK_WORKSPACE_ID) {
      this.logger.log(
        `Jira live member sync skipped — Demo workspace=${workspaceId}`,
      );
      return { source: 'none', synced: 0, members: [] };
    }

    const connection = await this.findUsableConnection(workspaceId);
    if (!connection) {
      this.logger.log(
        `Jira live member sync skipped — no usable connection for workspace=${workspaceId}`,
      );
      return { source: 'none', synced: 0, members: [] };
    }

    let liveMembers: JiraWorkspaceMember[] = [];
    try {
      liveMembers = await this.jiraService.listWorkspaceMembers({
        connection,
        maxResults: 200,
      });
    } catch (error) {
      this.logger.warn(
        `Jira live member list failed for workspace=${workspaceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { source: 'none', synced: 0, members: [] };
    }

    const now = new Date();
    const seenIds = new Set<string>();
    const members: JiraMemberCacheRow[] = [];

    for (const member of liveMembers) {
      if (!member.accountId || !member.displayName?.trim()) continue;
      const active = member.active !== false;
      seenIds.add(member.accountId);

      await this.prisma.jiraMemberCache.upsert({
        where: {
          workspaceId_accountId: {
            workspaceId: workspace.id,
            accountId: member.accountId,
          },
        },
        create: {
          workspaceId: workspace.id,
          accountId: member.accountId,
          displayName: member.displayName.trim(),
          email: member.emailAddress ?? null,
          avatarUrl: member.avatarUrl ?? null,
          accountType: member.accountType ?? null,
          active,
          cachedAt: now,
        },
        update: {
          displayName: member.displayName.trim(),
          email: member.emailAddress ?? null,
          avatarUrl: member.avatarUrl ?? null,
          accountType: member.accountType ?? null,
          active,
          cachedAt: now,
        },
      });

      if (active) {
        members.push({
          accountId: member.accountId,
          displayName: member.displayName.trim(),
          email: member.emailAddress ?? null,
          avatarUrl: member.avatarUrl ?? null,
          accountType: member.accountType ?? null,
          active: true,
        });
      }
    }

    // Mark accounts missing from this sync as inactive
    if (seenIds.size > 0) {
      const stale = await this.prisma.jiraMemberCache.findMany({
        where: {
          workspaceId: workspace.id,
          accountId: { notIn: [...seenIds] },
          active: true,
        },
        select: { id: true },
      });
      if (stale.length > 0) {
        await this.prisma.jiraMemberCache.updateMany({
          where: { id: { in: stale.map((r) => r.id) } },
          data: { active: false },
        });
      }
    }

    members.sort((a, b) => a.displayName.localeCompare(b.displayName));

    this.logger.log(
      `Jira member cache refreshed workspace=${workspaceId} synced=${seenIds.size} active=${members.length} source=live_jira`,
    );

    return {
      source: 'live_jira',
      synced: seenIds.size,
      members,
    };
  }

  /** Active human members from cache for this workspace only. */
  async listActiveCache(workspaceId: string): Promise<JiraMemberCacheRow[]> {
    const rows = await this.prisma.jiraMemberCache.findMany({
      where: { workspaceId, active: true },
      orderBy: { displayName: 'asc' },
    });
    return rows.map((row) => ({
      accountId: row.accountId,
      displayName: row.displayName,
      email: row.email,
      avatarUrl: row.avatarUrl,
      accountType: row.accountType,
      active: row.active,
    }));
  }

  private async findUsableConnection(workspaceId: string) {
    return this.jiraService.findLiveConnectionForWorkspace(workspaceId);
  }
}
