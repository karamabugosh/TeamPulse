import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolveActiveWorkspaceId } from './workspace-context';
import { WorkspaceMembersService } from './workspace-members.service';
import { memberDisplayLabel } from './slack-member.util';

export type WorkspaceTimelineEventType =
  | 'standup_submitted'
  | 'jira_status_change'
  | 'jira_update'
  | 'jira_comment'
  | 'jira_link'
  | 'blocker_created'
  | 'blocker_update'
  | 'blocker_resolved'
  | 'ai_digest'
  | 'ai_report'
  | 'slack_thread'
  | 'team_memory';

export type WorkspaceTimelineEvent = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  type: WorkspaceTimelineEventType;
  timestamp: string;
  userName: string;
  userId: string | null;
  eventType: string;
  description: string;
  jiraIssueKey: string | null;
  jiraIssueUrl: string | null;
  href: string | null;
  related: {
    blockerId?: string | null;
    submissionId?: string | null;
    runId?: string | null;
    checkInId?: string | null;
    memoryId?: string | null;
    digestId?: string | null;
  };
};

type UserSelect = {
  id: true;
  slackUserId: true;
  slackDisplayName: true;
  slackRealName: true;
};

const USER_SELECT: UserSelect = {
  id: true,
  slackUserId: true,
  slackDisplayName: true,
  slackRealName: true,
};

/**
 * Builds a chronological workspace activity timeline from PostgreSQL only.
 * No hardcoded / demo-static timeline items.
 */
@Injectable()
export class WorkspaceTimelineService {
  private readonly logger = new Logger(WorkspaceTimelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly members: WorkspaceMembersService,
  ) {}

  async getTimeline(params: {
    workspaceId?: string | null;
    userId?: string | null;
    eventType?: string | null;
    issueKey?: string | null;
    from?: string | null;
    to?: string | null;
    limit?: number;
  }): Promise<{
    workspaceId: string;
    workspaceName: string;
    events: WorkspaceTimelineEvent[];
    filters: {
      users: Array<{ value: string; label: string }>;
      eventTypes: Array<{ value: string; label: string }>;
      issues: Array<{ value: string; label: string }>;
    };
  }> {
    const workspaceId =
      (await resolveActiveWorkspaceId(this.prisma, params.workspaceId)) ??
      'unknown';

    if (workspaceId === 'unknown') {
      return {
        workspaceId,
        workspaceName: 'Unknown',
        events: [],
        filters: {
          users: [],
          eventTypes: EVENT_TYPE_OPTIONS,
          issues: [],
        },
      };
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { slackWorkspaceName: true },
    });
    const workspaceName = workspace?.slackWorkspaceName ?? 'Workspace';

    const from = parseDate(params.from, true);
    const to = parseDate(params.to, false);
    const userFilter = params.userId?.trim() || null;
    const typeFilter = params.eventType?.trim() || null;
    const issueFilter = params.issueKey?.trim().toUpperCase() || null;
    const limit = Math.min(Math.max(params.limit ?? 120, 1), 300);

    const [
      standups,
      issueUpdates,
      links,
      blockers,
      blockerUpdates,
      digests,
      memories,
      audits,
      slackThreads,
    ] = await Promise.all([
      this.collectStandups(workspaceId, workspaceName, from, to, userFilter),
      this.collectJiraIssueUpdates(workspaceId, workspaceName, from, to),
      this.collectJiraLinks(workspaceId, workspaceName, from, to, userFilter),
      this.collectBlockers(workspaceId, workspaceName, from, to, userFilter),
      this.collectBlockerUpdates(
        workspaceId,
        workspaceName,
        from,
        to,
        userFilter,
      ),
      this.collectDigests(workspaceId, workspaceName, from, to),
      this.collectTeamMemory(workspaceId, workspaceName, from, to, userFilter),
      this.collectJiraAudits(workspaceId, workspaceName, from, to, userFilter),
      this.collectSlackThreads(
        workspaceId,
        workspaceName,
        from,
        to,
        userFilter,
      ),
    ]);

    let events = dedupeEvents([
      ...standups,
      ...issueUpdates,
      ...links,
      ...blockers,
      ...blockerUpdates,
      ...digests,
      ...memories,
      ...audits,
      ...slackThreads,
    ]);

    if (typeFilter) {
      events = events.filter((event) => event.type === typeFilter);
    }
    if (issueFilter) {
      events = events.filter(
        (event) =>
          event.jiraIssueKey?.toUpperCase() === issueFilter ||
          event.description.toUpperCase().includes(issueFilter),
      );
    }
    if (userFilter) {
      events = events.filter((event) => event.userId === userFilter);
    }

    events.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    events = events.slice(0, limit);

    const [users, issueOptions] = await Promise.all([
      this.members.listFilterOptions(workspaceId),
      this.listIssueFilterOptions(workspaceId),
    ]);

    this.logger.log(
      `Timeline workspace=${workspaceId} events=${events.length} user=${userFilter ?? 'all'} type=${typeFilter ?? 'all'} issue=${issueFilter ?? 'all'}`,
    );

    return {
      workspaceId,
      workspaceName,
      events,
      filters: {
        users,
        eventTypes: EVENT_TYPE_OPTIONS,
        issues: issueOptions,
      },
    };
  }

  private async listIssueFilterOptions(
    workspaceId: string,
  ): Promise<Array<{ value: string; label: string }>> {
    const [links, blockers, memory] = await Promise.all([
      this.prisma.answerJiraIssueLink.findMany({
        where: { user: { workspaceId } },
        select: { issueKey: true, summary: true },
        take: 200,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.pulseBlocker.findMany({
        where: {
          user: { workspaceId },
          linkedIssueKey: { not: null },
        },
        select: { linkedIssueKey: true, title: true },
        take: 100,
      }),
      this.prisma.teamMemoryDocument.findMany({
        where: { workspaceId, issueKey: { not: null } },
        select: { issueKey: true, title: true },
        take: 100,
      }),
    ]);

    const map = new Map<string, string>();
    for (const row of links) {
      if (!row.issueKey) continue;
      map.set(
        row.issueKey,
        row.summary ? `${row.issueKey} · ${row.summary}` : row.issueKey,
      );
    }
    for (const row of blockers) {
      if (!row.linkedIssueKey) continue;
      if (!map.has(row.linkedIssueKey)) {
        map.set(
          row.linkedIssueKey,
          row.title
            ? `${row.linkedIssueKey} · ${row.title}`
            : row.linkedIssueKey,
        );
      }
    }
    for (const row of memory) {
      if (!row.issueKey) continue;
      if (!map.has(row.issueKey)) {
        map.set(
          row.issueKey,
          row.title ? `${row.issueKey} · ${row.title}` : row.issueKey,
        );
      }
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, label]) => ({ value, label }));
  }

  private async collectStandups(
    workspaceId: string,
    workspaceName: string,
    from: Date | null,
    to: Date | null,
    userId: string | null,
  ): Promise<WorkspaceTimelineEvent[]> {
    const submissions = await this.prisma.standupSubmission.findMany({
      where: {
        status: 'completed',
        user: { workspaceId },
        ...(userId ? { userId } : {}),
        ...(from || to
          ? {
              OR: [
                {
                  completedAt: {
                    ...(from ? { gte: from } : {}),
                    ...(to ? { lte: to } : {}),
                  },
                },
                {
                  AND: [
                    { completedAt: null },
                    {
                      createdAt: {
                        ...(from ? { gte: from } : {}),
                        ...(to ? { lte: to } : {}),
                      },
                    },
                  ],
                },
              ],
            }
          : {}),
      },
      take: 200,
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
      include: {
        user: { select: USER_SELECT },
        run: {
          include: {
            checkIn: { select: { id: true, name: true } },
          },
        },
      },
    });

    return submissions.map((sub) => {
      const userName = labelUser(sub.user);
      const standupName = sub.run.checkIn?.name ?? 'Daily Standup';
      const ts = (sub.completedAt ?? sub.createdAt).toISOString();
      return {
        id: `standup-${sub.id}`,
        workspaceId,
        workspaceName,
        type: 'standup_submitted' as const,
        timestamp: ts,
        userName,
        userId: sub.user.id,
        eventType: 'Standup',
        description: `${userName} completed their ${standupName}.`,
        jiraIssueKey: null,
        jiraIssueUrl: null,
        href: `/jira#standup-history`,
        related: {
          submissionId: sub.id,
          runId: sub.runId,
          checkInId: sub.run.checkIn?.id ?? null,
        },
      };
    });
  }

  private async collectJiraIssueUpdates(
    workspaceId: string,
    workspaceName: string,
    from: Date | null,
    to: Date | null,
  ): Promise<WorkspaceTimelineEvent[]> {
    const issues = await this.prisma.jiraIssueCacheEntry.findMany({
      where: {
        user: { workspaceId },
        ...(from || to
          ? {
              refreshedAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      take: 120,
      orderBy: { refreshedAt: 'desc' },
      select: {
        id: true,
        issueKey: true,
        summary: true,
        status: true,
        assigneeName: true,
        issueUrl: true,
        refreshedAt: true,
        user: { select: USER_SELECT },
      },
    });

    return issues.map((issue) => {
      const status = issue.status?.trim() || 'updated';
      const actor =
        issue.assigneeName?.trim() ||
        labelUser(issue.user) ||
        'Jira';
      const summaryBit = issue.summary ? ` (${issue.summary})` : '';
      return {
        id: `jira-cache-${issue.id}`,
        workspaceId,
        workspaceName,
        type: 'jira_status_change' as const,
        timestamp: issue.refreshedAt.toISOString(),
        userName: actor,
        userId: issue.user?.id ?? null,
        eventType: 'Jira',
        description: `${actor} updated ${issue.issueKey} — status is now ${status}${summaryBit}.`,
        jiraIssueKey: issue.issueKey,
        jiraIssueUrl: issue.issueUrl,
        href: `/jira?issue=${encodeURIComponent(issue.issueKey)}`,
        related: {},
      };
    });
  }

  private async collectJiraAudits(
    workspaceId: string,
    workspaceName: string,
    from: Date | null,
    to: Date | null,
    userId: string | null,
  ): Promise<WorkspaceTimelineEvent[]> {
    const rows = await this.prisma.jiraAuditLog.findMany({
      where: {
        user: { workspaceId },
        ...(userId ? { userId } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      take: 120,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: USER_SELECT } },
    });

    return rows.map((row) => {
      const userName = labelUser(row.user);
      const issueKey = row.jiraIssueKey;
      const isComment = /comment/i.test(row.actionType);
      let description: string;
      if (isComment && issueKey) {
        description = `${userName} commented on ${issueKey}.`;
      } else if (issueKey) {
        description = `${userName} updated ${issueKey} in Jira.`;
      } else {
        description = `${userName} recorded a Jira ${row.actionType.replace(/_/g, ' ')}.`;
      }
      return {
        id: `audit-${row.id}`,
        workspaceId,
        workspaceName,
        type: (isComment ? 'jira_comment' : 'jira_update') as
          | 'jira_comment'
          | 'jira_update',
        timestamp: row.createdAt.toISOString(),
        userName,
        userId: row.userId,
        eventType: isComment ? 'Jira Comment' : 'Jira',
        description,
        jiraIssueKey: issueKey,
        jiraIssueUrl: null,
        href: issueKey
          ? `/jira?issue=${encodeURIComponent(issueKey)}`
          : '/jira',
        related: {},
      };
    });
  }

  private async collectJiraLinks(
    workspaceId: string,
    workspaceName: string,
    from: Date | null,
    to: Date | null,
    userId: string | null,
  ): Promise<WorkspaceTimelineEvent[]> {
    const links = await this.prisma.answerJiraIssueLink.findMany({
      where: {
        user: { workspaceId },
        ...(userId ? { userId } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      take: 150,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: USER_SELECT },
        submission: {
          include: {
            run: {
              include: { checkIn: { select: { name: true } } },
            },
          },
        },
      },
    });

    return links.map((link) => {
      const userName = labelUser(link.user);
      const standupName =
        link.submission?.run?.checkIn?.name?.trim() || "today's standup";
      return {
        id: `link-${link.id}`,
        workspaceId,
        workspaceName,
        type: 'jira_link' as const,
        timestamp: link.createdAt.toISOString(),
        userName,
        userId: link.userId,
        eventType: 'Jira Link',
        description: `${userName} linked ${link.issueKey} to ${standupName}.`,
        jiraIssueKey: link.issueKey,
        jiraIssueUrl: link.issueUrl,
        href: `/jira?issue=${encodeURIComponent(link.issueKey)}`,
        related: { submissionId: link.submissionId, runId: link.runId },
      };
    });
  }

  private async collectBlockers(
    workspaceId: string,
    workspaceName: string,
    from: Date | null,
    to: Date | null,
    userId: string | null,
  ): Promise<WorkspaceTimelineEvent[]> {
    const blockers = await this.prisma.pulseBlocker.findMany({
      where: {
        user: { workspaceId },
        ...(userId ? { userId } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      take: 150,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: USER_SELECT } },
    });

    // Only emit creation here — resolutions come from blocker updates
    // to avoid duplicate "resolved" cards.
    return blockers.map((blocker) => {
      const userName = labelUser(blocker.user);
      const title = blocker.title?.trim() || blocker.description.slice(0, 80);
      return {
        id: `blocker-created-${blocker.id}`,
        workspaceId,
        workspaceName,
        type: 'blocker_created' as const,
        timestamp: blocker.createdAt.toISOString(),
        userName,
        userId: blocker.userId,
        eventType: 'Blocker',
        description: `${userName} reported blocker "${title}".`,
        jiraIssueKey: blocker.linkedIssueKey,
        jiraIssueUrl: blocker.linkedIssueUrl,
        href: `/blockers?id=${encodeURIComponent(blocker.id)}`,
        related: {
          blockerId: blocker.id,
          submissionId: blocker.submissionId,
          runId: blocker.runId,
          checkInId: blocker.checkInId,
        },
      };
    });
  }

  private async collectBlockerUpdates(
    workspaceId: string,
    workspaceName: string,
    from: Date | null,
    to: Date | null,
    userId: string | null,
  ): Promise<WorkspaceTimelineEvent[]> {
    const updates = await this.prisma.pulseBlockerUpdate.findMany({
      where: {
        blocker: { user: { workspaceId } },
        ...(userId ? { userId } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
        NOT: { previousStatus: 'none' },
      },
      take: 200,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: USER_SELECT },
        blocker: {
          select: {
            id: true,
            title: true,
            description: true,
            linkedIssueKey: true,
            linkedIssueUrl: true,
          },
        },
      },
    });

    return updates.map((update) => {
      const userName = labelUser(update.user);
      const title =
        update.blocker.title?.trim() ||
        update.blocker.description.slice(0, 60);
      const newStatus = update.newStatus.toLowerCase();
      const resolved = newStatus === 'resolved';
      let description = `${userName} updated blocker "${title}" (${update.previousStatus} → ${update.newStatus}).`;
      if (resolved) {
        description = `${userName} resolved blocker "${title}".`;
      } else if (newStatus === 'open' && update.previousStatus !== 'open') {
        description = `${userName} reopened blocker "${title}".`;
      }

      return {
        id: `blocker-update-${update.id}`,
        workspaceId,
        workspaceName,
        type: (resolved ? 'blocker_resolved' : 'blocker_update') as
          | 'blocker_resolved'
          | 'blocker_update',
        timestamp: update.createdAt.toISOString(),
        userName,
        userId: update.userId,
        eventType: resolved ? 'Blocker Resolved' : 'Blocker Update',
        description,
        jiraIssueKey: update.blocker.linkedIssueKey,
        jiraIssueUrl: update.blocker.linkedIssueUrl,
        href: `/blockers?id=${encodeURIComponent(update.blocker.id)}`,
        related: { blockerId: update.blocker.id },
      };
    });
  }

  private async collectDigests(
    workspaceId: string,
    workspaceName: string,
    from: Date | null,
    to: Date | null,
  ): Promise<WorkspaceTimelineEvent[]> {
    const digests = await this.prisma.aiDigest.findMany({
      where: {
        team: { workspaceId },
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      take: 80,
      orderBy: { createdAt: 'desc' },
      include: {
        team: { select: { name: true } },
        run: {
          include: {
            checkIn: { select: { id: true, name: true } },
          },
        },
      },
    });

    return digests.map((digest) => {
      const standupName = digest.run.checkIn?.name ?? 'Standup';
      const summary = (digest.summary ?? '').toLowerCase();
      const isExecutive =
        summary.includes('executive') ||
        /sprint/i.test(standupName) ||
        summary.includes('sprint');
      const type = isExecutive ? ('ai_report' as const) : ('ai_digest' as const);
      const label = isExecutive
        ? `AI generated ${standupName} Executive Report.`
        : `AI generated ${standupName} report for ${digest.team.name}.`;

      return {
        id: `digest-${digest.id}`,
        workspaceId,
        workspaceName,
        type,
        timestamp: digest.createdAt.toISOString(),
        userName: 'Pulse AI',
        userId: null,
        eventType: isExecutive ? 'AI Report' : 'AI Digest',
        description: label,
        jiraIssueKey: null,
        jiraIssueUrl: null,
        href: `/reports/run/${encodeURIComponent(digest.runId)}`,
        related: {
          digestId: digest.id,
          runId: digest.runId,
          checkInId: digest.run.checkIn?.id ?? null,
        },
      };
    });
  }

  private async collectTeamMemory(
    workspaceId: string,
    workspaceName: string,
    from: Date | null,
    to: Date | null,
    userId: string | null,
  ): Promise<WorkspaceTimelineEvent[]> {
    const rows = await this.prisma.teamMemoryDocument.findMany({
      where: {
        workspaceId,
        ...(userId ? { userId } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      take: 80,
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [
      ...new Set(rows.map((r) => r.userId).filter(Boolean) as string[]),
    ];
    const users =
      userIds.length > 0
        ? await this.prisma.user.findMany({
            where: { id: { in: userIds }, workspaceId },
            select: USER_SELECT,
          })
        : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    return rows.map((row) => {
      const user = row.userId ? userById.get(row.userId) : null;
      const userName = user ? labelUser(user) : 'Team';
      const title = row.title?.trim() || row.content.slice(0, 80);
      return {
        id: `memory-${row.id}`,
        workspaceId,
        workspaceName,
        type: 'team_memory' as const,
        timestamp: row.createdAt.toISOString(),
        userName,
        userId: row.userId,
        eventType: 'Team Memory',
        description: `${userName} updated team memory "${title}".`,
        jiraIssueKey: row.issueKey,
        jiraIssueUrl: null,
        href: row.issueKey
          ? `/jira?issue=${encodeURIComponent(row.issueKey)}`
          : '/jira',
        related: {
          memoryId: row.id,
          submissionId: row.submissionId,
          runId: row.runId,
        },
      };
    });
  }

  private async collectSlackThreads(
    workspaceId: string,
    workspaceName: string,
    from: Date | null,
    to: Date | null,
    userId: string | null,
  ): Promise<WorkspaceTimelineEvent[]> {
    const rows = await this.prisma.standupThreadUpdate.findMany({
      where: {
        user: { workspaceId },
        ...(userId ? { userId } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      take: 120,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: USER_SELECT },
        run: {
          include: { checkIn: { select: { id: true, name: true } } },
        },
      },
    });

    return rows.map((row) => {
      const userName = labelUser(row.user);
      const standupName = row.run.checkIn?.name ?? 'standup thread';
      const snippet = row.content?.trim().slice(0, 100);
      const typeLabel = row.type?.replace(/_/g, ' ') || 'update';
      return {
        id: `slack-thread-${row.id}`,
        workspaceId,
        workspaceName,
        type: 'slack_thread' as const,
        timestamp: row.createdAt.toISOString(),
        userName,
        userId: row.userId,
        eventType: 'Slack',
        description: snippet
          ? `${userName} posted a Slack ${typeLabel} in ${standupName}: "${snippet}".`
          : `${userName} posted a Slack ${typeLabel} in ${standupName}.`,
        jiraIssueKey: null,
        jiraIssueUrl: null,
        href: `/jira#standup-history`,
        related: {
          submissionId: row.submissionId,
          runId: row.runId,
          checkInId: row.run.checkIn?.id ?? null,
        },
      };
    });
  }
}

const EVENT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'standup_submitted', label: 'Standups' },
  { value: 'jira_status_change', label: 'Jira Status' },
  { value: 'jira_update', label: 'Jira Updates' },
  { value: 'jira_comment', label: 'Jira Comments' },
  { value: 'jira_link', label: 'Jira Links' },
  { value: 'blocker_created', label: 'Blockers' },
  { value: 'blocker_update', label: 'Blocker Updates' },
  { value: 'blocker_resolved', label: 'Blockers Resolved' },
  { value: 'ai_digest', label: 'AI Digests' },
  { value: 'ai_report', label: 'AI Reports' },
  { value: 'slack_thread', label: 'Slack' },
  { value: 'team_memory', label: 'Team Memory' },
];

function labelUser(user: {
  slackUserId: string;
  slackDisplayName?: string | null;
  slackRealName?: string | null;
}): string {
  return memberDisplayLabel({
    slackDisplayName: user.slackDisplayName,
    slackRealName: user.slackRealName,
    slackUserId: user.slackUserId,
  });
}

/**
 * Drop exact duplicate ids and near-duplicate fingerprints
 * (same type + entity + second-precision timestamp).
 */
function dedupeEvents(
  events: WorkspaceTimelineEvent[],
): WorkspaceTimelineEvent[] {
  const byId = new Map<string, WorkspaceTimelineEvent>();
  for (const event of events) {
    byId.set(event.id, event);
  }

  const seenFingerprints = new Set<string>();
  const out: WorkspaceTimelineEvent[] = [];
  for (const event of byId.values()) {
    const second = event.timestamp.slice(0, 19);
    const entity =
      event.related.blockerId ||
      event.related.digestId ||
      event.related.memoryId ||
      event.related.submissionId ||
      event.jiraIssueKey ||
      event.id;
    const fingerprint = `${event.type}|${entity}|${second}|${event.userId ?? ''}`;
    if (seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);
    out.push(event);
  }
  return out;
}

function parseDate(
  value: string | null | undefined,
  startOfDay: boolean,
): Date | null {
  if (!value?.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (startOfDay) d.setHours(0, 0, 0, 0);
  else d.setHours(23, 59, 59, 999);
  return d;
}
