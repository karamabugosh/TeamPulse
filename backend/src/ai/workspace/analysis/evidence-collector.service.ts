import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { JiraService } from '../../../jira/jira.service';
import { WorkspaceKnowledgeService } from '../knowledge/workspace-knowledge.service';
import { DetectiveFocus, EvidenceEvent } from './analysis.types';

const LOOKBACK_DAYS = 60;

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

function sourceLabel(kind: EvidenceEvent['source']): string {
  switch (kind) {
    case 'slack_standup':
      return 'Slack Standups';
    case 'jira_issue':
      return 'Jira Issue Cache';
    case 'jira_changelog':
      return 'Jira Status History';
    case 'blocker':
      return 'Blockers';
    case 'blocker_update':
      return 'Blocker History';
    case 'report':
      return 'AI / Sprint Reports';
    case 'team_memory':
      return 'Team Memory';
    case 'standup_thread':
      return 'Slack Threads';
    default:
      return kind;
  }
}

/**
 * Collects dated evidence from workspace DB (+ optional live Jira changelog).
 * Never invents events — only returns records that exist.
 */
@Injectable()
export class EvidenceCollectorService {
  private readonly logger = new Logger(EvidenceCollectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: WorkspaceKnowledgeService,
    @Optional() private readonly jiraService?: JiraService,
  ) {}

  async collect(params: {
    workspaceId: string;
    focus: DetectiveFocus;
  }): Promise<{
    events: EvidenceEvent[];
    sourcesUsed: string[];
    workspaceName: string;
  }> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: params.workspaceId },
      select: { slackWorkspaceName: true },
    });
    const workspaceName = workspace?.slackWorkspaceName ?? 'Workspace';
    const since = daysAgo(LOOKBACK_DAYS);
    const events: EvidenceEvent[] = [];
    const sourceSet = new Set<string>();

    const focusUserIds = await this.resolveFocusUserIds(
      params.workspaceId,
      params.focus.userQuery,
    );

    await Promise.all([
      this.collectStandups({
        workspaceId: params.workspaceId,
        focus: params.focus,
        focusUserIds,
        since,
        events,
        sourceSet,
      }),
      this.collectBlockers({
        workspaceId: params.workspaceId,
        focus: params.focus,
        focusUserIds,
        since,
        events,
        sourceSet,
      }),
      this.collectJiraCache({
        workspaceId: params.workspaceId,
        focus: params.focus,
        since,
        events,
        sourceSet,
      }),
      this.collectReports({
        workspaceId: params.workspaceId,
        focus: params.focus,
        since,
        events,
        sourceSet,
      }),
      this.collectTeamMemory({
        workspaceId: params.workspaceId,
        focus: params.focus,
        since,
        events,
        sourceSet,
      }),
      this.collectThreads({
        workspaceId: params.workspaceId,
        focus: params.focus,
        since,
        events,
        sourceSet,
      }),
      this.collectJiraChangelog({
        focus: params.focus,
        events,
        sourceSet,
      }),
    ]);

    events.sort(
      (a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );

    this.logger.log(
      `Detective evidence workspace=${params.workspaceId} events=${events.length} sources=${[...sourceSet].join(',')}`,
    );

    return {
      events,
      sourcesUsed: [...sourceSet],
      workspaceName,
    };
  }

  private async resolveFocusUserIds(
    workspaceId: string,
    userQuery: string | null,
  ): Promise<string[]> {
    if (!userQuery?.trim()) return [];
    const resolved =
      (await this.knowledge.resolveUserQuery(workspaceId, [userQuery])) ??
      userQuery;
    const users = await this.prisma.user.findMany({
      where: {
        workspaceId,
        OR: [
          { slackDisplayName: { contains: resolved, mode: 'insensitive' } },
          { slackUserId: { contains: resolved, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
      take: 10,
    });
    return users.map((u) => u.id);
  }

  private async collectStandups(params: {
    workspaceId: string;
    focus: DetectiveFocus;
    focusUserIds: string[];
    since: Date;
    events: EvidenceEvent[];
    sourceSet: Set<string>;
  }) {
    const submissions = await this.prisma.standupSubmission.findMany({
      where: {
        status: 'completed',
        completedAt: { gte: params.since },
        user: { workspaceId: params.workspaceId },
        ...(params.focusUserIds.length && !params.focus.issueKey
          ? { userId: { in: params.focusUserIds } }
          : {}),
      },
      include: {
        user: { select: { slackDisplayName: true } },
        answers: {
          include: {
            question: { select: { question: true } },
            jiraIssueLinks: { select: { issueKey: true, summary: true } },
          },
        },
        jiraIssueLinks: { select: { issueKey: true, summary: true } },
      },
      orderBy: { completedAt: 'asc' },
      take: 120,
    });

    const issueKey = params.focus.issueKey?.toUpperCase() ?? null;
    const sprint = params.focus.sprintQuery?.toLowerCase() ?? null;
    const keyword = params.focus.keyword?.toLowerCase() ?? null;

    for (const submission of submissions) {
      const answerText = submission.answers
        .map((a) => `${a.question.question}: ${a.text}`)
        .join('\n');
      const linkedKeys = [
        ...submission.jiraIssueLinks.map((l) => l.issueKey),
        ...submission.answers.flatMap((a) =>
          a.jiraIssueLinks.map((l) => l.issueKey),
        ),
      ];
      const haystack = `${answerText}\n${linkedKeys.join(' ')}`.toLowerCase();

      if (
        !matchesStandupFocus({
          issueKey,
          sprint,
          keyword,
          userQuery: params.focus.userQuery,
          focusUserIds: params.focusUserIds,
          submissionUserId: submission.userId,
          linkedKeys,
          haystack,
        })
      ) {
        continue;
      }

      const at = submission.completedAt ?? submission.createdAt;
      const snippet = answerText.replace(/\s+/g, ' ').trim().slice(0, 280);
      params.events.push({
        id: `standup-${submission.id}`,
        occurredAt: at.toISOString(),
        source: 'slack_standup',
        label: `Slack Standup · ${at.toISOString().slice(0, 10)}`,
        summary: `${submission.user.slackDisplayName} submitted standup`,
        details: snippet || 'Standup submitted (no answer text).',
        issueKey:
          linkedKeys.find((k) => !issueKey || k.toUpperCase() === issueKey) ??
          linkedKeys[0] ??
          null,
        actor: submission.user.slackDisplayName,
        weight:
          issueKey && linkedKeys.some((k) => k.toUpperCase() === issueKey)
            ? 3
            : 1,
      });
      params.sourceSet.add(sourceLabel('slack_standup'));
    }
  }

  private async collectBlockers(params: {
    workspaceId: string;
    focus: DetectiveFocus;
    focusUserIds: string[];
    since: Date;
    events: EvidenceEvent[];
    sourceSet: Set<string>;
  }) {
    const issueKey = params.focus.issueKey?.toUpperCase() ?? null;

    const blockers = await this.prisma.pulseBlocker.findMany({
      where: {
        user: { workspaceId: params.workspaceId },
        AND: [
          {
            OR: [
              { createdAt: { gte: params.since } },
              { updatedAt: { gte: params.since } },
              { resolvedAt: { gte: params.since } },
            ],
          },
          ...(params.focusUserIds.length && !issueKey
            ? [{ userId: { in: params.focusUserIds } }]
            : []),
          ...(issueKey
            ? [
                {
                  OR: [
                    {
                      linkedIssueKey: {
                        equals: issueKey,
                        mode: 'insensitive' as const,
                      },
                    },
                    {
                      description: {
                        contains: issueKey,
                        mode: 'insensitive' as const,
                      },
                    },
                    {
                      title: {
                        contains: issueKey,
                        mode: 'insensitive' as const,
                      },
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      include: {
        user: { select: { slackDisplayName: true } },
        updates: {
          where: { createdAt: { gte: params.since } },
          orderBy: { createdAt: 'asc' },
          include: { user: { select: { slackDisplayName: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 80,
    });

    const sprint = params.focus.sprintQuery?.toLowerCase() ?? null;

    for (const blocker of blockers) {
      const title = blocker.title?.trim() || blocker.description.slice(0, 80);
      const text =
        `${title} ${blocker.description} ${blocker.dependency ?? ''}`.toLowerCase();
      if (
        sprint &&
        !issueKey &&
        !text.includes(sprint) &&
        !params.focusUserIds.length
      ) {
        continue;
      }

      params.events.push({
        id: `blocker-${blocker.id}`,
        occurredAt: blocker.createdAt.toISOString(),
        source: 'blocker',
        label: `Blocker · ${blocker.createdAt.toISOString().slice(0, 10)}`,
        summary: `${blocker.user.slackDisplayName} reported blocker: ${title}`,
        details: [
          blocker.description.slice(0, 240),
          blocker.dependency ? `Dependency: ${blocker.dependency}` : null,
          blocker.linkedIssueKey ? `Linked: ${blocker.linkedIssueKey}` : null,
          `Status: ${blocker.status}`,
        ]
          .filter(Boolean)
          .join(' · '),
        issueKey: blocker.linkedIssueKey,
        actor: blocker.user.slackDisplayName,
        weight: 4,
      });
      params.sourceSet.add(sourceLabel('blocker'));

      if (blocker.resolvedAt) {
        params.events.push({
          id: `blocker-resolved-${blocker.id}`,
          occurredAt: blocker.resolvedAt.toISOString(),
          source: 'blocker',
          label: `Blocker Resolved · ${blocker.resolvedAt
            .toISOString()
            .slice(0, 10)}`,
          summary: `Blocker resolved: ${title}`,
          details:
            blocker.resolutionNotes?.slice(0, 200) ??
            `Status → ${blocker.status}`,
          issueKey: blocker.linkedIssueKey,
          actor: blocker.user.slackDisplayName,
          weight: 3,
        });
      }

      for (const update of blocker.updates) {
        params.events.push({
          id: `blocker-update-${update.id}`,
          occurredAt: update.createdAt.toISOString(),
          source: 'blocker_update',
          label: `Blocker Update · ${update.createdAt.toISOString().slice(0, 10)}`,
          summary: `${update.user.slackDisplayName}: ${update.previousStatus} → ${update.newStatus}`,
          details: [
            update.notes?.slice(0, 200) ?? null,
            update.needsEscalation ? 'Escalation flagged' : null,
            typeof update.daysOpen === 'number'
              ? `Days open: ${update.daysOpen}`
              : null,
          ]
            .filter(Boolean)
            .join(' · '),
          issueKey: blocker.linkedIssueKey,
          actor: update.user.slackDisplayName,
          weight: update.needsEscalation ? 4 : 2,
        });
        params.sourceSet.add(sourceLabel('blocker_update'));
      }
    }
  }

  private async collectJiraCache(params: {
    workspaceId: string;
    focus: DetectiveFocus;
    since: Date;
    events: EvidenceEvent[];
    sourceSet: Set<string>;
  }) {
    const issueKey = params.focus.issueKey?.toUpperCase() ?? null;

    const entries = await this.prisma.jiraIssueCacheEntry.findMany({
      where: {
        user: { workspaceId: params.workspaceId },
        ...(issueKey
          ? { issueKey: { equals: issueKey, mode: 'insensitive' } }
          : {
              OR: [
                { refreshedAt: { gte: params.since } },
                { jiraUpdatedAt: { gte: params.since } },
              ],
            }),
        ...(params.focus.userQuery
          ? {
              assigneeName: {
                contains: params.focus.userQuery,
                mode: 'insensitive',
              },
            }
          : {}),
        ...(params.focus.sprintQuery && !issueKey
          ? {
              summary: {
                contains: params.focus.sprintQuery,
                mode: 'insensitive',
              },
            }
          : {}),
      },
      orderBy: { refreshedAt: 'desc' },
      take: issueKey ? 5 : 40,
    });

    const seen = new Set<string>();
    for (const entry of entries) {
      const key = entry.issueKey.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const at = entry.jiraUpdatedAt ?? entry.refreshedAt;
      params.events.push({
        id: `jira-cache-${entry.id}`,
        occurredAt: at.toISOString(),
        source: 'jira_issue',
        label: `Jira ${entry.issueKey} · ${at.toISOString().slice(0, 10)}`,
        summary: `${entry.issueKey} — ${entry.summary}`,
        details: [
          entry.status ? `Status: ${entry.status}` : null,
          entry.assigneeName ? `Assignee: ${entry.assigneeName}` : null,
          entry.priority ? `Priority: ${entry.priority}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        issueKey: entry.issueKey,
        actor: entry.assigneeName,
        weight: issueKey ? 3 : 1,
      });
      params.sourceSet.add(
        issueKey ? `Jira Issue ${entry.issueKey}` : sourceLabel('jira_issue'),
      );
    }
  }

  private async collectReports(params: {
    workspaceId: string;
    focus: DetectiveFocus;
    since: Date;
    events: EvidenceEvent[];
    sourceSet: Set<string>;
  }) {
    const digests = await this.prisma.aiDigest.findMany({
      where: {
        team: { workspaceId: params.workspaceId },
        generatedAt: { gte: params.since },
      },
      include: {
        run: { include: { checkIn: { select: { name: true } } } },
      },
      orderBy: { generatedAt: 'asc' },
      take: 40,
    });

    const issueKey = params.focus.issueKey?.toLowerCase() ?? null;
    const sprint = params.focus.sprintQuery?.toLowerCase() ?? null;
    const userQ = params.focus.userQuery?.toLowerCase() ?? null;

    for (const digest of digests) {
      const body = [
        digest.summary,
        digest.slackReportText ?? '',
        JSON.stringify(digest.themes ?? ''),
        JSON.stringify(digest.blockers ?? ''),
      ]
        .join('\n')
        .toLowerCase();

      if (issueKey && !body.includes(issueKey)) continue;
      if (userQ && !issueKey && !sprint && !body.includes(userQ)) continue;
      if (sprint && !issueKey && !body.includes(sprint) && !body.includes('sprint')) {
        // Keep sprint-window digests even without the literal sprint label.
      }

      params.events.push({
        id: `report-${digest.id}`,
        occurredAt: digest.generatedAt.toISOString(),
        source: 'report',
        label: `Report · ${digest.generatedAt.toISOString().slice(0, 10)}`,
        summary: digest.run.checkIn?.name
          ? `AI report for ${digest.run.checkIn.name}`
          : 'AI standup report',
        details: digest.summary.slice(0, 280),
        issueKey: params.focus.issueKey,
        actor: null,
        weight: 2,
      });
      params.sourceSet.add(sourceLabel('report'));
    }
  }

  private async collectTeamMemory(params: {
    workspaceId: string;
    focus: DetectiveFocus;
    since: Date;
    events: EvidenceEvent[];
    sourceSet: Set<string>;
  }) {
    const issueKey = params.focus.issueKey?.toUpperCase() ?? null;
    const docs = await this.prisma.teamMemoryDocument.findMany({
      where: {
        workspaceId: params.workspaceId,
        createdAt: { gte: params.since },
        ...(issueKey
          ? {
              OR: [
                { issueKey: { equals: issueKey, mode: 'insensitive' } },
                { content: { contains: issueKey, mode: 'insensitive' } },
                { title: { contains: issueKey, mode: 'insensitive' } },
              ],
            }
          : {}),
        ...(params.focus.userQuery
          ? {
              content: {
                contains: params.focus.userQuery,
                mode: 'insensitive',
              },
            }
          : {}),
        ...(params.focus.sprintQuery
          ? {
              OR: [
                {
                  content: {
                    contains: params.focus.sprintQuery,
                    mode: 'insensitive',
                  },
                },
                {
                  title: {
                    contains: params.focus.sprintQuery,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 40,
    });

    for (const doc of docs) {
      params.events.push({
        id: `memory-${doc.id}`,
        occurredAt: doc.createdAt.toISOString(),
        source: 'team_memory',
        label: `Team Memory · ${doc.createdAt.toISOString().slice(0, 10)}`,
        summary: doc.title,
        details: doc.content.slice(0, 280),
        issueKey: doc.issueKey,
        actor: null,
        weight: 2,
      });
      params.sourceSet.add(sourceLabel('team_memory'));
    }
  }

  private async collectThreads(params: {
    workspaceId: string;
    focus: DetectiveFocus;
    since: Date;
    events: EvidenceEvent[];
    sourceSet: Set<string>;
  }) {
    const issueKey = params.focus.issueKey?.toLowerCase() ?? null;
    const keyword = (
      params.focus.keyword ||
      params.focus.sprintQuery ||
      params.focus.userQuery ||
      ''
    ).toLowerCase();

    const threads = await this.prisma.standupThreadUpdate.findMany({
      where: {
        run: { team: { workspaceId: params.workspaceId } },
        createdAt: { gte: params.since },
        ...(keyword
          ? { content: { contains: keyword, mode: 'insensitive' } }
          : {}),
      },
      include: { user: { select: { slackDisplayName: true } } },
      orderBy: { createdAt: 'asc' },
      take: 40,
    });

    for (const thread of threads) {
      const content = thread.content.toLowerCase();
      if (issueKey && !content.includes(issueKey)) continue;
      params.events.push({
        id: `thread-${thread.id}`,
        occurredAt: thread.createdAt.toISOString(),
        source: 'standup_thread',
        label: `Slack Thread · ${thread.createdAt.toISOString().slice(0, 10)}`,
        summary: `${thread.user.slackDisplayName} · ${thread.type}`,
        details: thread.content.slice(0, 240),
        issueKey: params.focus.issueKey,
        actor: thread.user.slackDisplayName,
        weight: 1,
      });
      params.sourceSet.add(sourceLabel('standup_thread'));
    }
  }

  private async collectJiraChangelog(params: {
    focus: DetectiveFocus;
    events: EvidenceEvent[];
    sourceSet: Set<string>;
  }) {
    if (!params.focus.issueKey || !this.jiraService) return;
    try {
      const feed = await this.jiraService.getIssueActivityTimeline(
        params.focus.issueKey,
      );
      if (!feed.available) return;
      for (const activity of feed.activities) {
        const detailParts = [
          activity.activityType,
          activity.previousValue
            ? `${activity.previousValue} → ${activity.newValue ?? '—'}`
            : activity.newValue,
        ].filter(Boolean);
        params.events.push({
          id: `jira-change-${activity.id}`,
          occurredAt: activity.occurredAt,
          source: 'jira_changelog',
          label: `Jira ${activity.issueKey} · ${activity.occurredAt.slice(0, 10)}`,
          summary: `${activity.issueKey}: ${activity.activityType}${
            activity.author ? ` by ${activity.author}` : ''
          }`,
          details: detailParts.join(' · '),
          issueKey: activity.issueKey,
          actor: activity.author,
          weight: activity.activityType === 'Status Changed' ? 4 : 2,
        });
      }
      params.sourceSet.add(`Jira Issue ${params.focus.issueKey}`);
      params.sourceSet.add(sourceLabel('jira_changelog'));
    } catch (error) {
      this.logger.warn(
        `Changelog collect failed: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }
}

function matchesStandupFocus(params: {
  issueKey: string | null;
  sprint: string | null;
  keyword: string | null;
  userQuery: string | null;
  focusUserIds: string[];
  submissionUserId: string;
  linkedKeys: string[];
  haystack: string;
}): boolean {
  const {
    issueKey,
    sprint,
    keyword,
    userQuery,
    focusUserIds,
    submissionUserId,
    linkedKeys,
    haystack,
  } = params;

  if (issueKey) {
    return (
      linkedKeys.some((k) => k.toUpperCase() === issueKey) ||
      haystack.includes(issueKey.toLowerCase())
    );
  }

  if (focusUserIds.length > 0) {
    if (focusUserIds.includes(submissionUserId)) return true;
    if (userQuery && haystack.includes(userQuery.toLowerCase())) return true;
    return false;
  }

  if (sprint) {
    return haystack.includes(sprint);
  }

  if (keyword) {
    return haystack.includes(keyword);
  }

  // No specific focus — keep recent completed standups (capped by query take).
  return true;
}
