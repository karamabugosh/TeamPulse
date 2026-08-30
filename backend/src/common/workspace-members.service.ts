import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  isPlaceholderSlackUser,
  isSlackBotUserId,
  lookupSlackDisplayName,
  memberDisplayLabel,
  PULSE_SLACK_BOT_LABEL,
  resolveAllSlackIdsInText,
  resolveOwnerDisplayName,
  resolveSlackMentionsInText,
} from './slack-member.util';

export type WorkspaceMemberOption = {
  id: string;
  slackUserId: string;
  label: string;
  email: string | null;
};

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const MEMBER_CACHE_TTL_MS = 60_000;

/**
 * Canonical workspace-scoped Slack member listing + display-name resolution.
 * Used by Jira filters, Admin pickers, blockers, AI, and timeline.
 */
@Injectable()
export class WorkspaceMembersService {
  private readonly logger = new Logger(WorkspaceMembersService.name);
  private readonly listCache = new Map<string, CacheEntry<WorkspaceMemberOption[]>>();
  private readonly nameMapCache = new Map<string, CacheEntry<Map<string, string>>>();

  constructor(private readonly prisma: PrismaService) {}

  /** Invalidate caches after Slack member sync. */
  invalidateWorkspace(workspaceId: string): void {
    this.listCache.delete(workspaceId);
    this.nameMapCache.delete(workspaceId);
  }

  /**
   * Human members for a single workspace:
   * - scoped by workspaceId (never global)
   * - excludes placeholders / test accounts
   * - de-duplicated by slackUserId
   * - sorted alphabetically by display name
   * - TTL-cached (~60s)
   */
  async listHumanMembers(
    workspaceId: string,
    opts?: { search?: string; bypassCache?: boolean },
  ): Promise<WorkspaceMemberOption[]> {
    const search = opts?.search?.trim();
    const cacheKey = workspaceId;

    if (!search && !opts?.bypassCache) {
      const cached = this.listCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
      }
    }

    const rows = await this.prisma.user.findMany({
      where: {
        workspaceId,
        ...(search
          ? {
              OR: [
                {
                  slackDisplayName: {
                    contains: search,
                    mode: 'insensitive' as const,
                  },
                },
                {
                  slackUserId: {
                    contains: search,
                    mode: 'insensitive' as const,
                  },
                },
                { email: { contains: search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        slackUserId: true,
        slackDisplayName: true,
        email: true,
      },
      orderBy: { slackDisplayName: 'asc' },
    });

    const seenSlackIds = new Set<string>();
    const members: WorkspaceMemberOption[] = [];

    for (const user of rows) {
      if (
        isPlaceholderSlackUser({
          slackUserId: user.slackUserId,
          slackDisplayName: user.slackDisplayName,
          email: user.email,
        })
      ) {
        continue;
      }

      // Slack bot is not a human teammate for pickers.
      if (isSlackBotUserId(user.slackUserId)) continue;

      const slackKey = user.slackUserId.trim().toLowerCase();
      if (seenSlackIds.has(slackKey)) continue;
      seenSlackIds.add(slackKey);

      members.push({
        id: user.id,
        slackUserId: user.slackUserId,
        label: memberDisplayLabel({
          slackDisplayName: user.slackDisplayName,
          slackUserId: user.slackUserId,
        }),
        email: user.email,
      });
    }

    members.sort((a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
    );

    if (!search) {
      this.listCache.set(cacheKey, {
        value: members,
        expiresAt: Date.now() + MEMBER_CACHE_TTL_MS,
      });
    }

    return members;
  }

  /** Filter-option shape for dropdowns (`value` / `label`). */
  async listFilterOptions(
    workspaceId: string,
  ): Promise<Array<{ value: string; label: string }>> {
    const members = await this.listHumanMembers(workspaceId);
    return members.map((m) => ({ value: m.id, label: m.label }));
  }

  /**
   * Workspace-scoped map: slackUserId → display label (includes bot label).
   * Cached ~60s to avoid duplicate lookups across blockers / timeline / AI.
   */
  async getDisplayNameMap(workspaceId: string): Promise<Map<string, string>> {
    const cached = this.nameMapCache.get(workspaceId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const rows = await this.prisma.user.findMany({
      where: { workspaceId },
      select: {
        slackUserId: true,
        slackDisplayName: true,
        slackRealName: true,
        email: true,
      },
    });

    const map = new Map<string, string>();
    map.set('USLACKBOT', PULSE_SLACK_BOT_LABEL);
    map.set('uslackbot', PULSE_SLACK_BOT_LABEL);
    map.set('SLACKBOT', PULSE_SLACK_BOT_LABEL);

    for (const user of rows) {
      const slackUserId = user.slackUserId?.trim();
      if (!slackUserId) {
        this.logger.warn(
          `Skipping User with missing slackUserId while building display map: ${JSON.stringify(
            {
              slackDisplayName: user.slackDisplayName,
              slackRealName: user.slackRealName,
              email: user.email,
            },
          )}`,
        );
        continue;
      }
      const label = memberDisplayLabel({
        slackDisplayName: user.slackDisplayName,
        slackRealName: user.slackRealName,
        slackUserId,
      });
      map.set(slackUserId, label);
      map.set(slackUserId.toUpperCase(), label);
      map.set(slackUserId.toLowerCase(), label);
    }

    this.nameMapCache.set(workspaceId, {
      value: map,
      expiresAt: Date.now() + MEMBER_CACHE_TTL_MS,
    });
    return map;
  }

  async resolveDisplayName(
    workspaceId: string,
    slackUserId: string | null | undefined,
  ): Promise<string | null> {
    if (!slackUserId?.trim()) return null;
    if (isSlackBotUserId(slackUserId)) return PULSE_SLACK_BOT_LABEL;
    const map = await this.getDisplayNameMap(workspaceId);
    return (
      map.get(slackUserId) ||
      map.get(slackUserId.toUpperCase()) ||
      map.get(slackUserId.toLowerCase()) ||
      'Unknown User'
    );
  }

  async resolveAllSlackIdsInText(
    workspaceId: string,
    text: string | null | undefined,
  ): Promise<string> {
    if (!text) return '';
    const map = await this.buildReportNameMap(workspaceId);
    return resolveAllSlackIdsInText(text, map);
  }

  /**
   * Build a workspace-scoped Slack user id → display name map for reports.
   * Priority: User table → SlackMemberCache → participant profile overrides.
   */
  async buildReportNameMap(
    workspaceId: string,
    participantOverrides?: Array<{
      slackUserId: string;
      displayName?: string | null;
      slackRealName?: string | null;
    }>,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    map.set('USLACKBOT', PULSE_SLACK_BOT_LABEL);
    map.set('uslackbot', PULSE_SLACK_BOT_LABEL);
    map.set('SLACKBOT', PULSE_SLACK_BOT_LABEL);

    const setEntry = (
      slackUserId: string | null | undefined,
      label: string,
    ) => {
      const id = slackUserId?.trim();
      if (!id) {
        this.logger.warn(
          `Skipping name-map entry with missing slackUserId (label=${JSON.stringify(label)})`,
        );
        return;
      }
      const trimmed = label.trim();
      if (!trimmed || trimmed === id) return;
      map.set(id, trimmed);
      map.set(id.toUpperCase(), trimmed);
      map.set(id.toLowerCase(), trimmed);
    };

    const users = await this.prisma.user.findMany({
      where: { workspaceId },
      select: {
        slackUserId: true,
        slackDisplayName: true,
        slackRealName: true,
        email: true,
      },
    });

    for (const user of users) {
      if (
        isPlaceholderSlackUser({
          slackUserId: user.slackUserId,
          slackDisplayName: user.slackDisplayName,
          email: user.email,
        })
      ) {
        continue;
      }
      setEntry(
        user.slackUserId,
        memberDisplayLabel({
          slackDisplayName: user.slackDisplayName,
          slackRealName: user.slackRealName,
          slackUserId: user.slackUserId,
        }),
      );
    }

    const cacheRows = await this.prisma.slackMemberCache.findMany({
      where: { workspaceId, deleted: false, isBot: false },
      select: {
        slackUserId: true,
        displayName: true,
        realName: true,
        email: true,
      },
    });

    for (const row of cacheRows) {
      if (map.has(row.slackUserId)) continue;
      if (
        isPlaceholderSlackUser({
          slackUserId: row.slackUserId,
          slackDisplayName: row.displayName,
          email: row.email,
        })
      ) {
        continue;
      }
      const label =
        row.realName?.trim() ||
        row.displayName?.trim() ||
        lookupSlackDisplayName(row.slackUserId, map);
      if (label !== 'Unknown User') {
        setEntry(row.slackUserId, label);
      }
    }

    for (const participant of participantOverrides ?? []) {
      const id = participant.slackUserId?.trim();
      if (!id || map.has(id)) continue;
      const label =
        participant.slackRealName?.trim() ||
        participant.displayName?.trim() ||
        null;
      if (label && label !== id) {
        setEntry(id, label);
      }
    }

    this.nameMapCache.set(workspaceId, {
      value: map,
      expiresAt: Date.now() + MEMBER_CACHE_TTL_MS,
    });

    return map;
  }

  async resolveMentionsInText(
    workspaceId: string,
    text: string | null | undefined,
  ): Promise<string> {
    if (!text) return '';
    const map = await this.getDisplayNameMap(workspaceId);
    return resolveSlackMentionsInText(text, map);
  }

  async resolveOwnerLabel(
    workspaceId: string,
    ownerLabel: string | null | undefined,
  ): Promise<string | null> {
    if (!ownerLabel?.trim()) return null;
    const map = await this.getDisplayNameMap(workspaceId);
    return resolveOwnerDisplayName(ownerLabel, map);
  }

  /**
   * Resolve a Slack user id to a display name using DB first.
   * Used when writing blocker owner labels so we never persist `<@U…>`.
   */
  async resolveSlackUserIdToLabel(
    workspaceId: string | null | undefined,
    slackUserId: string | null | undefined,
  ): Promise<string | null> {
    if (!slackUserId?.trim()) return null;
    if (isSlackBotUserId(slackUserId)) return PULSE_SLACK_BOT_LABEL;

    const user = await this.prisma.user.findFirst({
      where: {
        slackUserId,
        ...(workspaceId ? { workspaceId } : {}),
      },
      select: { slackDisplayName: true, slackUserId: true },
      orderBy: { createdAt: 'desc' },
    });
    if (user) {
      return memberDisplayLabel({
        slackDisplayName: user.slackDisplayName,
        slackUserId: user.slackUserId,
      });
    }

    return null;
  }
}
