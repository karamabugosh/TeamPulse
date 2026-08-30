import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JiraService } from './jira.service';
import { JiraCacheService } from './jira-cache.service';
import { JiraBlockerService } from './jira-blocker.service';
import { resolveActiveWorkspaceId } from '../common/workspace-context';
import { WorkspaceMembersService } from '../common/workspace-members.service';
import {
  memberDisplayLabel,
  resolveSlackMentionsInText,
} from '../common/slack-member.util';
import { buildSlackThreadUrl } from '../slack/slack-checkin.views';

type StatusBucket = 'done' | 'in_progress' | 'todo' | 'blocked';

function bucketStatus(status: string | null | undefined): StatusBucket {
  const normalized = (status ?? '').trim().toLowerCase();
  if (!normalized) {
    return 'todo';
  }
  if (
    normalized.includes('done') ||
    normalized.includes('closed') ||
    normalized.includes('resolved') ||
    normalized.includes('complete')
  ) {
    return 'done';
  }
  if (normalized.includes('block')) {
    return 'blocked';
  }
  if (
    normalized.includes('progress') ||
    normalized.includes('review') ||
    normalized.includes('testing')
  ) {
    return 'in_progress';
  }
  return 'todo';
}

@Injectable()
export class JiraHubService {
  private readonly logger = new Logger(JiraHubService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jiraService: JiraService,
    private readonly jiraCacheService: JiraCacheService,
    private readonly jiraBlockerService: JiraBlockerService,
    private readonly workspaceMembers: WorkspaceMembersService,
  ) {}

  private async resolveWorkspaceId(): Promise<string | null> {
    return resolveActiveWorkspaceId(this.prisma);
  }

  private async loadCachedIssues(workspaceId: string) {
    const rows = await this.prisma.jiraIssueCacheEntry.findMany({
      where: { user: { workspaceId } },
      orderBy: { refreshedAt: 'desc' },
    });
    const byKey = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!byKey.has(row.issueKey)) byKey.set(row.issueKey, row);
    }
    return [...byKey.values()];
  }

  async getOverview() {
    const connection = await this.jiraService.getConnectionStatus();
    const workspaceId = await this.resolveWorkspaceId();

    let projectCount = 0;
    let visibleIssueCount = 0;

    if (connection.connected) {
      try {
        const projects = await this.jiraService.getProjects();
        projectCount = projects.total;
        const issues = await this.jiraService.getIssues(100);
        visibleIssueCount = issues.total;
      } catch (error: unknown) {
        this.logger.warn(
          `Could not load live Jira counts for hub overview: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        if (workspaceId) {
          const cached = await this.loadCachedIssues(workspaceId);
          visibleIssueCount = cached.length;
          projectCount =
            new Set(cached.map((c) => c.projectKey).filter(Boolean)).size || 1;
        }
      }
    } else if (workspaceId) {
      const cached = await this.loadCachedIssues(workspaceId);
      if (cached.length > 0) {
        visibleIssueCount = cached.length;
        projectCount =
          new Set(cached.map((c) => c.projectKey).filter(Boolean)).size || 1;
      }
    }

    const linkedIssueCount = workspaceId
      ? await this.prisma.answerJiraIssueLink.count({
          where: { workspaceId },
        })
      : 0;
    const openBlockerCount = workspaceId
      ? (await this.jiraBlockerService.getBlockerStatsForWorkspace(workspaceId))
          .openBlockers
      : await this.prisma.pulseBlocker.count({
          where: { status: 'open' },
        });

    return {
      connection: {
        ...connection,
        projectCount,
        visibleIssueCount,
      },
      summary: {
        linkedIssues: linkedIssueCount,
        openBlockers: openBlockerCount,
      },
    };
  }

  async getProjectsWithIssues(maxIssuesPerProject = 5) {
    const workspaceId = await this.resolveWorkspaceId();

    try {
      const { projects } = await this.jiraService.getProjects();
      const userId = await this.jiraService.getConnectedUserId();

      const enriched = await Promise.all(
        projects.map(async (project) => {
          let issueCount = 0;
          let recentIssues: Array<{
            key: string;
            summary: string;
            status: string | null;
            issueUrl: string | null;
          }> = [];

          try {
            if (userId) {
              const search = await this.jiraService.searchIssuesForUser(
                userId,
                `project = "${project.key}" ORDER BY updated DESC`,
                maxIssuesPerProject,
              );
              issueCount = search.total;
              recentIssues = search.issues.map((issue) => ({
                key: issue.key,
                summary: issue.summary,
                status: issue.status,
                issueUrl: issue.issueUrl,
              }));
            }
          } catch (error: unknown) {
            this.logger.warn(
              `Could not load issues for project ${project.key}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }

          return {
            id: project.id,
            key: project.key,
            name: project.name,
            issueCount,
            recentIssues,
          };
        }),
      );

      if (enriched.length > 0) {
        return { projects: enriched };
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Live Jira projects unavailable; falling back to cache: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!workspaceId) {
      return { projects: [] };
    }

    const cached = await this.loadCachedIssues(workspaceId);
    const byProject = new Map<
      string,
      { id: string; key: string; name: string; issues: typeof cached }
    >();

    for (const issue of cached) {
      const key = issue.projectKey || 'SCRUM';
      const existing = byProject.get(key) ?? {
        id: `cache-${key}`,
        key,
        name: issue.projectName || `${key} Board`,
        issues: [] as typeof cached,
      };
      existing.issues.push(issue);
      byProject.set(key, existing);
    }

    return {
      projects: [...byProject.values()].map((project) => ({
        id: project.id,
        key: project.key,
        name: project.name,
        issueCount: project.issues.length,
        recentIssues: project.issues.slice(0, maxIssuesPerProject).map((issue) => ({
          key: issue.issueKey,
          summary: issue.summary,
          status: issue.status,
          issueUrl: issue.issueUrl,
        })),
      })),
    };
  }

  async getRecentLinkedIssues(limit = 50) {
    const workspaceId = await this.resolveWorkspaceId();
    if (!workspaceId) {
      return [];
    }
    const links = await this.prisma.answerJiraIssueLink.findMany({
      where: { user: { workspaceId } },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            slackDisplayName: true,
          },
        },
        submission: {
          select: {
            id: true,
            runId: true,
            completedAt: true,
            run: {
              select: {
                id: true,
                checkIn: {
                  select: { id: true, name: true },
                },
              },
            },
          },
        },
      },
    });

    return links.map((link) => ({
      id: link.id,
      issueKey: link.issueKey,
      issueId: link.issueId,
      summary: link.summary,
      status: link.status,
      projectKey: link.projectKey,
      issueUrl: link.issueUrl,
      linkedCheckIn: link.submission.run.checkIn?.name ?? 'Check-in',
      linkedCheckInId: link.submission.run.checkIn?.id ?? null,
      linkedBy: link.user.slackDisplayName,
      linkedByUserId: link.user.id,
      linkedAt: link.createdAt.toISOString(),
      submissionId: link.submissionId,
      runId: link.runId ?? link.submission.runId,
    }));
  }

  async getBlockers(teamId?: string) {
    const dashboard = await this.jiraBlockerService.listDashboardBlockers(teamId);
    return dashboard
      .filter((blocker) => blocker.status === 'open')
      .map((blocker) => ({
        id: blocker.id,
        title: blocker.title,
        description: blocker.description,
        reporter: blocker.slackDisplayName,
        reporterUserId: blocker.reporterUserId,
        linkedIssueKey: blocker.jiraIssue?.key ?? null,
        linkedIssueUrl: blocker.jiraIssue?.url ?? null,
        linkedIssueSummary: blocker.jiraIssue?.summary ?? null,
        linkedIssueStatus: blocker.jiraIssue?.status ?? null,
        createdAt: blocker.createdAt,
        status: blocker.status,
        severity: blocker.priority,
        category: blocker.category,
        expectedResolution: blocker.expectedResolution,
        dependency: null,
        owner: blocker.ownerLabel ?? blocker.slackDisplayName,
        teamId: blocker.teamId,
        runId: blocker.runId,
        submissionId: blocker.submissionId,
      }));
  }

  async getAnalytics() {
    const connection = await this.jiraService.getConnectionStatus();
    const workspaceId = await this.resolveWorkspaceId();
    const linkedIssues = await this.prisma.answerJiraIssueLink.count({
      where: workspaceId ? { workspaceId } : undefined,
    });
    const openBlockers = await this.prisma.pulseBlocker.count({
      where: {
        status: 'open',
        ...(workspaceId ? { workspaceId } : {}),
      },
    });

    let projectCount = 0;
    const distribution: Record<StatusBucket, number> = {
      done: 0,
      in_progress: 0,
      todo: 0,
      blocked: 0,
    };

    let usedLive = false;
    if (connection.connected) {
      try {
        const projects = await this.jiraService.getProjects();
        projectCount = projects.total;
        const issues = await this.jiraService.getIssues(100);
        for (const issue of issues.issues) {
          const bucket = bucketStatus(issue.status);
          distribution[bucket] += 1;
        }
        usedLive = true;
      } catch (error: unknown) {
        this.logger.warn(
          `Could not load Jira analytics: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    if (!usedLive && workspaceId) {
      const cached = await this.loadCachedIssues(workspaceId);
      projectCount =
        new Set(cached.map((c) => c.projectKey).filter(Boolean)).size ||
        (cached.length ? 1 : 0);
      for (const issue of cached) {
        distribution[bucketStatus(issue.status)] += 1;
      }
    }

    return {
      kpis: {
        projects: projectCount,
        linkedIssues,
        openIssues: distribution.todo + distribution.in_progress,
        doneIssues: distribution.done,
        blockedIssues: distribution.blocked + openBlockers,
      },
      statusDistribution: [
        { name: 'Done', value: distribution.done, key: 'done' },
        { name: 'In Progress', value: distribution.in_progress, key: 'in_progress' },
        { name: 'To Do', value: distribution.todo, key: 'todo' },
        { name: 'Blocked', value: distribution.blocked, key: 'blocked' },
      ],
    };
  }

  async getLinkedStandups(issueKey?: string) {
    const workspaceId = await this.resolveWorkspaceId();
    const links = await this.prisma.answerJiraIssueLink.findMany({
      where: {
        ...(issueKey ? { issueKey: issueKey.toUpperCase() } : {}),
        ...(workspaceId ? { user: { workspaceId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        answer: {
          select: {
            text: true,
            createdAt: true,
          },
        },
        user: {
          select: { slackDisplayName: true },
        },
        submission: {
          select: {
            id: true,
            completedAt: true,
            run: {
              select: {
                id: true,
                scheduledFor: true,
                checkIn: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const grouped = new Map<
      string,
      {
        issueKey: string;
        summary: string;
        status: string | null;
        issueUrl: string | null;
        timeline: Array<{
          date: string;
          checkInName: string;
          participant: string;
          update: string;
          submissionId: string;
          runId: string | null;
        }>;
      }
    >();

    for (const link of links) {
      const key = link.issueKey;
      const existing = grouped.get(key) ?? {
        issueKey: key,
        summary: link.summary,
        status: link.status,
        issueUrl: link.issueUrl,
        timeline: [],
      };

      const eventDate =
        link.submission.completedAt ??
        link.answer?.createdAt ??
        link.capturedAt;

      existing.timeline.push({
        date: eventDate.toISOString(),
        checkInName: link.submission.run.checkIn?.name ?? 'Check-in',
        participant: link.user.slackDisplayName,
        update: link.answer?.text?.trim() || link.summary,
        submissionId: link.submission.id,
        runId: link.runId ?? link.submission.run.id,
      });

      grouped.set(key, existing);
    }

    return {
      issues: [...grouped.values()].map((issue) => ({
        ...issue,
        timeline: issue.timeline.sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        ),
      })),
    };
  }

  async getAiInsights() {
    const workspaceId = await this.resolveWorkspaceId();
    const links = await this.prisma.answerJiraIssueLink.findMany({
      where: workspaceId ? { user: { workspaceId } } : undefined,
      select: {
        issueKey: true,
        summary: true,
        status: true,
        createdAt: true,
        userId: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const mentionCounts = new Map<string, { count: number; summary: string; status: string | null }>();
    const userDayKeys = new Map<string, Set<string>>();

    for (const link of links) {
      const current = mentionCounts.get(link.issueKey) ?? {
        count: 0,
        summary: link.summary,
        status: link.status,
      };
      current.count += 1;
      mentionCounts.set(link.issueKey, current);

      const day = link.createdAt.toISOString().slice(0, 10);
      const userDay = `${link.userId}:${day}`;
      const issuesOnDay = userDayKeys.get(userDay) ?? new Set<string>();
      issuesOnDay.add(link.issueKey);
      userDayKeys.set(userDay, issuesOnDay);
    }

    const mostMentioned = [...mentionCounts.entries()]
      .sort((a, b) => b[1].count - a[1].count)[0];

    const likelyBlocked = [...mentionCounts.entries()].find(([, value]) =>
      (value.status ?? '').toLowerCase().includes('block'),
    );

    const repeatedStandup = [...userDayKeys.entries()].find(
      ([, issueSet]) => issueSet.size === 1 && mentionCounts.size > 0,
    );

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const inactiveIssue = [...mentionCounts.entries()].find(([issueKey]) => {
      const latest = links.find((link) => link.issueKey === issueKey);
      return latest ? latest.createdAt.getTime() < sevenDaysAgo : false;
    });

    const inProgressIssues = [...mentionCounts.entries()].filter(([, value]) =>
      bucketStatus(value.status) === 'in_progress',
    );

    return {
      insights: [
        mostMentioned
          ? {
              type: 'most_mentioned',
              title: 'Most Mentioned Issue',
              issueKey: mostMentioned[0],
              summary: mostMentioned[1].summary,
              metric: `${mostMentioned[1].count} standup link(s)`,
            }
          : null,
        likelyBlocked
          ? {
              type: 'likely_blocked',
              title: 'Likely Blocked Issue',
              issueKey: likelyBlocked[0],
              summary: likelyBlocked[1].summary,
              metric: likelyBlocked[1].status ?? 'Blocked status in Jira',
            }
          : null,
        inProgressIssues[0]
          ? {
              type: 'estimated_completion',
              title: 'Estimated Completion',
              issueKey: inProgressIssues[0][0],
              summary: inProgressIssues[0][1].summary,
              metric: 'In progress in Jira with recent standup activity',
            }
          : null,
        repeatedStandup
          ? {
              type: 'repeated_standup',
              title: 'Repeated Standup Focus',
              issueKey: [...(userDayKeys.get(repeatedStandup[0]) ?? [])][0] ?? null,
              summary: 'Same issue referenced across consecutive standups',
              metric: 'Repeated daily focus detected',
            }
          : null,
        inactiveIssue
          ? {
              type: 'inactive_issue',
              title: 'Inactive Issue',
              issueKey: inactiveIssue[0],
              summary: inactiveIssue[1].summary,
              metric: 'No standup link activity in the last 7 days',
            }
          : null,
      ].filter(Boolean),
    };
  }

  async getStandupHistory(params?: {
    search?: string;
    userId?: string;
    checkInId?: string;
    issueKey?: string;
    preset?: string;
    from?: string;
    to?: string;
    limit?: number;
  }) {
    const workspaceId = await this.resolveWorkspaceId();
    if (!workspaceId) {
      return {
        records: [],
        filters: { users: [], standups: [], issues: [] },
        total: 0,
      };
    }

    const range = this.resolveStandupHistoryRange(params);
    const limit = Math.min(Math.max(params?.limit ?? 100, 1), 250);

    const where: Prisma.StandupSubmissionWhereInput = {
      status: 'completed',
      user: { workspaceId },
      run: {
        team: { workspaceId },
        checkInId: { not: null },
        ...(params?.checkInId && params.checkInId !== 'all'
          ? { checkInId: params.checkInId }
          : {}),
      },
      ...(params?.userId && params.userId !== 'all'
        ? { userId: params.userId }
        : {}),
      ...(range
        ? {
            OR: [
              { completedAt: { gte: range.from, lte: range.to } },
              {
                AND: [
                  { completedAt: null },
                  { createdAt: { gte: range.from, lte: range.to } },
                ],
              },
            ],
          }
        : {}),
      ...(params?.issueKey && params.issueKey !== 'all'
        ? params.issueKey === 'none'
          ? { jiraIssueLinks: { none: {} } }
          : {
              jiraIssueLinks: {
                some: { issueKey: params.issueKey.toUpperCase() },
              },
            }
        : {}),
    };

    const submissions = await this.prisma.standupSubmission.findMany({
      where,
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            slackUserId: true,
            slackDisplayName: true,
            workspace: { select: { slackWorkspaceId: true } },
          },
        },
        answers: {
          include: {
            question: {
              select: {
                id: true,
                question: true,
                order: true,
                type: true,
              },
            },
          },
          orderBy: { question: { order: 'asc' } },
        },
        jiraIssueLinks: {
          orderBy: { createdAt: 'asc' },
        },
        run: {
          select: {
            id: true,
            slackThreadUrl: true,
            slackChannelId: true,
            slackThreadTs: true,
            reportGeneratedAt: true,
            checkIn: { select: { id: true, name: true } },
            team: {
              select: {
                workspace: { select: { slackWorkspaceId: true } },
              },
            },
            aiDigest: {
              select: {
                id: true,
                generatedAt: true,
                summary: true,
              },
            },
          },
        },
      },
    });

    const submissionIds = submissions.map((s) => s.id);
    const blockers = submissionIds.length
      ? await this.prisma.pulseBlocker.findMany({
          where: {
            submissionId: { in: submissionIds },
            workspaceId,
          },
          select: { submissionId: true, status: true },
        })
      : [];
    const blockerBySubmission = new Set(
      blockers
        .filter((b) => b.submissionId)
        .map((b) => b.submissionId as string),
    );

    const search = params?.search?.trim().toLowerCase() ?? '';
    const nameMap = await this.workspaceMembers.getDisplayNameMap(workspaceId);

    const records = submissions
      .map((submission) => {
        const slots = this.classifyStandupAnswers(submission.answers);
        const primaryLink = submission.jiraIssueLinks[0] ?? null;
        const submittedAt =
          submission.completedAt ?? submission.createdAt ?? new Date();
        const hasBlocker =
          blockerBySubmission.has(submission.id) ||
          this.isMeaningfulBlockerText(slots.blockers);
        const slackWorkspaceId =
          submission.user.workspace.slackWorkspaceId ||
          submission.run.team.workspace.slackWorkspaceId;
        const slackThreadUrl =
          submission.run.slackThreadUrl ||
          (submission.slackDmChannelId &&
          submission.slackDmThreadTs &&
          slackWorkspaceId
            ? buildSlackThreadUrl(
                slackWorkspaceId,
                submission.slackDmChannelId,
                submission.slackDmThreadTs,
              )
            : submission.run.slackChannelId &&
                submission.run.slackThreadTs &&
                slackWorkspaceId
              ? buildSlackThreadUrl(
                  slackWorkspaceId,
                  submission.run.slackChannelId,
                  submission.run.slackThreadTs,
                )
              : null);

        const userName = memberDisplayLabel({
          slackDisplayName: submission.user.slackDisplayName,
          slackUserId: submission.user.slackUserId,
        });
        const initials = this.initialsFromName(userName);

        return {
          id: submission.id,
          userId: submission.user.id,
          userName,
          userAvatar: null as string | null,
          userInitials: initials,
          date: submittedAt.toISOString(),
          standupName: submission.run.checkIn?.name ?? 'Standup',
          checkInId: submission.run.checkIn?.id ?? null,
          yesterdayAnswer: resolveSlackMentionsInText(
            slots.yesterday || '—',
            nameMap,
          ),
          todayAnswer: resolveSlackMentionsInText(slots.today || '—', nameMap),
          blockersAnswer: resolveSlackMentionsInText(
            slots.blockers || 'None',
            nameMap,
          ),
          linkedJiraIssue: primaryLink
            ? {
                key: primaryLink.issueKey,
                summary: primaryLink.summary,
                url:
                  primaryLink.issueUrl ||
                  `https://atlassian.net/browse/${primaryLink.issueKey}`,
              }
            : null,
          linkedIssueKeys: submission.jiraIssueLinks.map((l) => l.issueKey),
          slackThreadUrl,
          runId: submission.run.id,
          submissionId: submission.id,
          hasBlocker,
          reportGeneratedAt:
            submission.run.aiDigest?.generatedAt?.toISOString() ??
            submission.run.reportGeneratedAt?.toISOString() ??
            null,
          reportSummary: submission.run.aiDigest?.summary ?? null,
          issueLinkedAt: primaryLink?.createdAt?.toISOString() ?? null,
        };
      })
      .filter((record) => {
        if (!search) return true;
        const haystack = [
          record.userName,
          record.standupName,
          record.yesterdayAnswer,
          record.todayAnswer,
          record.blockersAnswer,
          record.linkedJiraIssue?.key,
          record.linkedJiraIssue?.summary,
          ...record.linkedIssueKeys,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      });

    const [users, standups, linkedIssues] = await Promise.all([
      // Canonical workspace Slack humans — not "users who submitted standups".
      this.workspaceMembers.listFilterOptions(workspaceId),
      this.prisma.checkIn.findMany({
        where: { team: { workspaceId } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.answerJiraIssueLink.findMany({
        where: { user: { workspaceId } },
        distinct: ['issueKey'],
        select: { issueKey: true, summary: true },
        orderBy: { issueKey: 'asc' },
      }),
    ]);

    return {
      records,
      total: records.length,
      filters: {
        users,
        standups: standups.map((c) => ({
          value: c.id,
          label: c.name,
        })),
        issues: linkedIssues.map((i) => ({
          value: i.issueKey,
          label: i.summary ? `${i.issueKey} · ${i.summary}` : i.issueKey,
        })),
      },
    };
  }

  private resolveStandupHistoryRange(params?: {
    preset?: string;
    from?: string;
    to?: string;
  }): { from: Date; to: Date } | null {
    const now = new Date();
    const startOfDay = (d: Date) => {
      const copy = new Date(d);
      copy.setHours(0, 0, 0, 0);
      return copy;
    };
    const endOfDay = (d: Date) => {
      const copy = new Date(d);
      copy.setHours(23, 59, 59, 999);
      return copy;
    };

    const preset = (params?.preset ?? 'last7').toLowerCase();
    if (preset === 'today') {
      return { from: startOfDay(now), to: endOfDay(now) };
    }
    if (preset === 'yesterday') {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
    }
    if (preset === 'last7') {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return { from: startOfDay(weekAgo), to: endOfDay(now) };
    }
    if (preset === 'custom') {
      const from = params?.from ? startOfDay(new Date(params.from)) : null;
      const to = params?.to ? endOfDay(new Date(params.to)) : endOfDay(now);
      if (from && !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
        return { from, to };
      }
      if (from && !Number.isNaN(from.getTime())) {
        return { from, to: endOfDay(now) };
      }
      if (params?.to && !Number.isNaN(to.getTime())) {
        return { from: new Date(0), to };
      }
    }
    return null;
  }

  private classifyStandupAnswers(
    answers: Array<{
      text: string;
      question: { question: string; order: number; type: string };
    }>,
  ): { yesterday: string; today: string; blockers: string } {
    const slots: {
      yesterday: string | null;
      today: string | null;
      blockers: string | null;
    } = { yesterday: null, today: null, blockers: null };

    const freeText: Array<{ text: string; order: number }> = [];

    for (const answer of answers) {
      const text = answer.text?.trim() ?? '';
      if (!text) continue;
      const q = answer.question.question.toLowerCase();
      const type = answer.question.type;

      if (
        type !== 'ISSUE_REF' &&
        (/block|impediment|stuck|waiting|anything blocking/.test(q) ||
          /\bblockers?\b/.test(q))
      ) {
        slots.blockers ??= text;
        continue;
      }
      if (
        /yesterday|last (day|night)|did you (work|do)|what did you|completed yesterday/.test(
          q,
        )
      ) {
        slots.yesterday ??= text;
        continue;
      }
      if (
        /today|will you|working on today|plan for today|what will you/.test(q)
      ) {
        slots.today ??= text;
        continue;
      }
      if (type !== 'ISSUE_REF') {
        freeText.push({ text, order: answer.question.order });
      }
    }

    freeText.sort((a, b) => a.order - b.order);
    for (const item of freeText) {
      if (!slots.yesterday) {
        slots.yesterday = item.text;
      } else if (!slots.today) {
        slots.today = item.text;
      } else if (!slots.blockers) {
        slots.blockers = item.text;
      }
    }

    return {
      yesterday: slots.yesterday ?? '',
      today: slots.today ?? '',
      blockers: slots.blockers ?? '',
    };
  }

  private isMeaningfulBlockerText(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    if (!normalized) return false;
    if (
      [
        'none',
        'no',
        'n/a',
        'na',
        '-',
        '—',
        'no blockers',
        'no blocker',
        'nothing',
        'nope',
        'clear',
      ].includes(normalized)
    ) {
      return false;
    }
    return true;
  }

  private initialsFromName(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  }

  async getRecentActivity(params?: {
    days?: number;
    maxIssues?: number;
    limit?: number;
  }) {
    return this.jiraService.getRecentActivity(params);
  }
}
