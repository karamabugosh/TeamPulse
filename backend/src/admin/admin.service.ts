import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, QuestionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  describeSemanticAnswer,
  getSemanticSentiment,
} from '../common/question-semantics';
import {
  buildParticipantProfiles,
  buildReportStatistics,
  groupBlockersByPerson,
} from '../check-in/report-participant.utils';
import { buildSlackThreadUrl } from '../slack/slack-checkin.views';
import {
  resolveActiveWorkspaceId,
  workspaceCheckInFilter,
  workspaceDigestFilter,
  workspaceRunFilter,
  workspaceSubmissionFilter,
  workspaceTeamFilter,
  workspaceUserFilter,
} from '../common/workspace-context';
import {
  isPlaceholderSlackUser,
  isUsableSlackBotToken,
} from '../common/slack-member.util';
import { WorkspaceMembersService } from '../common/workspace-members.service';
import { WorkspaceBootstrapService } from '../common/workspace-bootstrap.service';
import { SlackMemberCacheService } from '../slack/slack-member-cache.service';
import { WorkspaceAnalyticsService } from '../analytics/workspace-analytics.service';
import { resolveSlackIdsInDigest } from '../common/report-slack-resolution.util';
import {
  lookupSlackDisplayName,
  resolveAllSlackIdsInText,
} from '../common/slack-member.util';
import { AiDigestResult } from '../ai/dto/ai-result.dto';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceMembers: WorkspaceMembersService,
    private readonly slackMemberCache: SlackMemberCacheService,
    private readonly workspaceAnalytics: WorkspaceAnalyticsService,
    private readonly workspaceBootstrap: WorkspaceBootstrapService,
  ) {}

  async listWorkspaces() {
    await this.workspaceBootstrap.ensureFromSlackToken();

    const workspaces = await this.prisma.workspace.findMany({
      orderBy: { installedAt: 'asc' },
      select: {
        id: true,
        slackWorkspaceId: true,
        slackWorkspaceName: true,
        installedAt: true,
        _count: {
          select: { users: true, teams: true },
        },
      },
    });

    return workspaces.map((ws) => ({
      id: ws.id,
      slackWorkspaceId: ws.slackWorkspaceId,
      name: ws.slackWorkspaceName,
      installedAt: ws.installedAt,
      userCount: ws._count.users,
      teamCount: ws._count.teams,
      plan: 'Pro',
    }));
  }

  private async activeWorkspaceId(): Promise<string | null> {
    return resolveActiveWorkspaceId(this.prisma);
  }

  async getOverviewStats() {
    const workspaceId = await this.activeWorkspaceId();
    const teamScope = workspaceId ? workspaceTeamFilter(workspaceId) : {};
    const checkInScope = workspaceId ? workspaceCheckInFilter(workspaceId) : {};
    const submissionScope = workspaceId ? workspaceSubmissionFilter(workspaceId) : {};
    const digestScope = workspaceId ? workspaceDigestFilter(workspaceId) : {};

    const activeCheckInsCount = await this.prisma.checkIn.count({
      where: { enabled: true, publishStatus: 'published', ...checkInScope },
    });

    const activeTeamsCount = await this.prisma.team.count({
      where: { schedulerEnabled: true, ...teamScope },
    });

    const totalSubmissions = await this.prisma.standupSubmission.count({
      where: submissionScope,
    });
    const completedSubmissions = await this.prisma.standupSubmission.count({
      where: { status: 'completed', ...submissionScope },
    });

    const completionRate =
      totalSubmissions > 0
        ? Math.round((completedSubmissions / totalSubmissions) * 100)
        : 0;

    const pendingResponses = await this.prisma.standupSubmission.count({
      where: { status: { in: ['pending', 'in_progress'] }, ...submissionScope },
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayReportsCount = await this.prisma.aiDigest.count({
      where: { generatedAt: { gte: todayStart }, ...digestScope },
    });

    const completedWithTime = await this.prisma.standupSubmission.findMany({
      where: {
        status: 'completed',
        startedAt: { not: null },
        completedAt: { not: null },
        ...submissionScope,
      },
      select: { startedAt: true, completedAt: true },
      take: 500,
      orderBy: { completedAt: 'desc' },
    });

    let avgResponseTimeMinutes = 0;
    if (completedWithTime.length > 0) {
      const totalMs = completedWithTime.reduce(
        (sum, s) => sum + (s.completedAt!.getTime() - s.startedAt!.getTime()),
        0,
      );
      avgResponseTimeMinutes = Math.round((totalMs / completedWithTime.length / 60000) * 10) / 10;
    }

    const weeklyParticipation = await this.buildWeeklyParticipation(workspaceId);
    const completionTrend = await this.buildCompletionTrend(workspaceId);
    const topBlockers = await this.buildTopBlockers(workspaceId);
    const recentActivity = await this.buildRecentActivity(workspaceId);
    const upcomingCheckIns = await this.buildUpcomingCheckIns(workspaceId);

    const aiInsights = await this.buildAiInsights(workspaceId);
    const aiAnalytics = await this.buildAiAnalytics(activeCheckInsCount, workspaceId);

    let workspaceSnapshot = null;
    if (workspaceId) {
      workspaceSnapshot = await this.workspaceAnalytics.collectSnapshot({
        workspaceId,
        refreshJira: true,
      });
    }

    return {
      stats: {
        activeCheckIns: activeCheckInsCount,
        activeTeams: activeTeamsCount,
        completionRate,
        pendingResponses,
        avgResponseTimeMinutes,
        todayReports: todayReportsCount,
        openBlockers: workspaceSnapshot?.blockers.openBlockers ?? null,
        totalBlockers: workspaceSnapshot?.blockers.total ?? null,
        workspaceMembers: workspaceSnapshot?.members.total ?? null,
        jiraIssues: workspaceSnapshot?.jira.totalIssues ?? null,
        standupSubmissions: workspaceSnapshot?.standups.totalSubmissions ?? null,
      },
      weeklyParticipation,
      completionTrend,
      topBlockers,
      recentActivity,
      upcomingCheckIns,
      aiInsights,
      aiAnalytics,
    };
  }

  private async buildWeeklyParticipation(workspaceId?: string | null) {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const result = [];
    const submissionScope = workspaceId ? workspaceSubmissionFilter(workspaceId) : {};

    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date();
      dayStart.setDate(dayStart.getDate() - i);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const total = await this.prisma.standupSubmission.count({
        where: { createdAt: { gte: dayStart, lt: dayEnd }, ...submissionScope },
      });
      const completed = await this.prisma.standupSubmission.count({
        where: {
          status: 'completed',
          createdAt: { gte: dayStart, lt: dayEnd },
          ...submissionScope,
        },
      });

      result.push({
        day: days[dayStart.getDay()],
        completion: total > 0 ? Math.round((completed / total) * 100) : 0,
        target: 85,
        responses: completed,
      });
    }

    return result;
  }

  private async buildCompletionTrend(workspaceId?: string | null) {
    const result = [];
    const submissionScope = workspaceId ? workspaceSubmissionFilter(workspaceId) : {};
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date();
      dayStart.setDate(dayStart.getDate() - i);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const total = await this.prisma.standupSubmission.count({
        where: { createdAt: { gte: dayStart, lt: dayEnd }, ...submissionScope },
      });
      const completed = await this.prisma.standupSubmission.count({
        where: {
          status: 'completed',
          createdAt: { gte: dayStart, lt: dayEnd },
          ...submissionScope,
        },
      });

      result.push({
        date: dayStart.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }),
        rate: total > 0 ? Math.round((completed / total) * 100) : 0,
      });
    }
    return result;
  }

  private async buildTopBlockers(workspaceId?: string | null) {
    if (!workspaceId) return [];

    const snapshot = await this.workspaceAnalytics.collectSnapshot({
      workspaceId,
      refreshJira: false,
    });

    return snapshot.blockers.active.slice(0, 5).map((blocker, idx) => ({
      id: String(idx + 1),
      description: blocker.title,
      count: 1,
      severity:
        blocker.severity?.toLowerCase() === 'critical'
          ? 'high'
          : blocker.severity?.toLowerCase() === 'high'
            ? 'high'
            : blocker.severity?.toLowerCase() === 'medium'
              ? 'medium'
              : 'low',
      team: blocker.reporter,
    }));
  }

  private async buildRecentActivity(workspaceId?: string | null) {
    const activities: any[] = [];
    const digestScope = workspaceId ? workspaceDigestFilter(workspaceId) : {};
    const submissionScope = workspaceId ? workspaceSubmissionFilter(workspaceId) : {};
    const runScope = workspaceId ? workspaceRunFilter(workspaceId) : {};

    const recentDigests = await this.prisma.aiDigest.findMany({
      where: digestScope,
      take: 5,
      orderBy: { generatedAt: 'desc' },
      include: { team: { select: { name: true } } },
    });

    for (const d of recentDigests) {
      activities.push({
        id: `digest-${d.id}`,
        type: 'digest_generated',
        title: 'Check-in Report Generated',
        team: d.team?.name || 'General',
        timestamp: d.generatedAt.toISOString(),
        status: 'success',
      });
    }

    const recentSubmissions = await this.prisma.standupSubmission.findMany({
      where: { status: 'completed', ...submissionScope },
      take: 5,
      orderBy: { completedAt: 'desc' },
      include: {
        user: { select: { slackDisplayName: true } },
        run: { include: { checkIn: { select: { name: true } }, team: { select: { name: true } } } },
      },
    });

    for (const s of recentSubmissions) {
      activities.push({
        id: `sub-${s.id}`,
        type: 'submission_completed',
        title: `${s.user.slackDisplayName} completed check-in`,
        team: s.run.team?.name || 'General',
        timestamp: (s.completedAt || s.updatedAt).toISOString(),
        status: 'completed',
      });
    }

    const recentRuns = await this.prisma.standupRun.findMany({
      where: runScope,
      take: 5,
      orderBy: { startedAt: 'desc' },
      include: { team: { select: { name: true } }, checkIn: { select: { name: true } } },
    });

    for (const r of recentRuns) {
      activities.push({
        id: `run-${r.id}`,
        type: 'run_started',
        title: `${r.checkIn?.name || 'Check-in'} run started`,
        team: r.team?.name || 'General',
        timestamp: r.startedAt.toISOString(),
        status: r.status,
      });
    }

    return activities
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);
  }

  private async buildUpcomingCheckIns(workspaceId?: string | null) {
    const checkIns = await this.prisma.checkIn.findMany({
      where: {
        enabled: true,
        publishStatus: 'published',
        scheduleEnabled: true,
        ...(workspaceId ? workspaceCheckInFilter(workspaceId) : {}),
      },
      include: { team: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });

    return checkIns.map((c) => {
      const parts = c.collectionCron.trim().split(/\s+/);
      const minute = parts[0] || '0';
      const hour = parts[1] || '9';
      const h = parseInt(hour, 10);
      const m = parseInt(minute, 10);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      const time = `${h12}:${String(m).padStart(2, '0')} ${ampm}`;

      return {
        id: c.id,
        name: c.name,
        time,
        team: c.team.name,
        cron: c.collectionCron,
        timezone: c.timezone,
      };
    });
  }

  private isPlaceholderAnalyticsText(text: string | null | undefined): boolean {
    if (!text || typeof text !== 'string') {
      return true;
    }

    const normalized = text.trim().toLowerCase();
    if (!normalized) {
      return true;
    }

    return (
      normalized.startsWith('ai analysis is unavailable') ||
      normalized.includes('no substantive standup answers were available') ||
      normalized === 'no blockers reported.' ||
      normalized === 'no blockers reported' ||
      normalized === 'no additional insights.' ||
      normalized === 'no action items suggested.' ||
      /^collected \d+ substantive answer\(s\) from \d+ participant\(s\)\.$/.test(
        normalized,
      )
    );
  }

  private async buildAiInsights(workspaceId?: string | null) {
    const latestDigest = await this.prisma.aiDigest.findFirst({
      where: {
        source: 'ai',
        generationError: null,
        slackReportText: { not: null },
        run: {
          checkInId: { not: null },
          ...(workspaceId ? { team: { workspaceId } } : {}),
        },
      },
      orderBy: { generatedAt: 'desc' },
      select: {
        summary: true,
        reportSections: true,
      },
    });
    if (!latestDigest) {
      return null;
    }

    const sections = this.parseReportSections(latestDigest.reportSections);
    const summary = this.isPlaceholderAnalyticsText(latestDigest.summary)
      ? null
      : latestDigest.summary.trim();

    const insight = sections.aiInsights.find(
      (item) => !this.isPlaceholderAnalyticsText(item),
    );

    const recommendation = sections.actionItems.find(
      (item) => !this.isPlaceholderAnalyticsText(item),
    );

    if (!summary && !insight && !recommendation) {
      return null;
    }

    return {
      headline: summary || insight || 'Latest standup report',
      summary:
        sections.overallProgress && !this.isPlaceholderAnalyticsText(sections.overallProgress)
          ? sections.overallProgress
          : summary || insight || '',
      recommendation: recommendation || null,
    };
  }

  private async buildAiAnalytics(activeCheckInsCount: number, workspaceId?: string | null) {
    const recentRuns = await this.prisma.standupRun.findMany({
      where: {
        status: 'completed',
        checkInId: { not: null },
        ...(workspaceId ? { team: { workspaceId } } : {}),
        aiDigest: {
          is: {
            slackReportText: { not: null },
            source: 'ai',
            generationError: null,
          },
        },
      },
      orderBy: { startedAt: 'desc' },
      take: 7,
      include: {
        checkIn: { select: { name: true } },
        submissions: {
          select: {
            id: true,
            status: true,
            user: {
              select: {
                slackUserId: true,
                slackDisplayName: true,
              },
            },
          },
        },
        aiDigest: {
          select: {
            summary: true,
            source: true,
            blockers: true,
            themes: true,
            reportSections: true,
          },
        },
      },
    });

    if (recentRuns.length === 0) {
      return {
        available: false,
        message: 'Waiting for completed standup reports',
      };
    }

    const latestRun = recentRuns[0];
    const latestTotal = latestRun.submissions.length;
    const latestCompleted = latestRun.submissions.filter(
      (submission) => submission.status === 'completed',
    ).length;

    if (latestTotal === 0) {
      return {
        available: false,
        message: 'Not enough responses to generate analytics',
      };
    }

    if (latestCompleted === 0) {
      return {
        available: false,
        message: 'Not enough responses to generate analytics',
      };
    }

    const latestDigest = latestRun.aiDigest;
    if (!latestDigest) {
      return {
        available: false,
        message: 'Waiting for completed standup reports',
      };
    }

    const latestSections = this.parseReportSections(latestDigest.reportSections);

    const completionRate =
      latestTotal > 0
        ? Math.round((latestCompleted / latestTotal) * 100)
        : null;

    const productivityTrend = [...recentRuns]
      .reverse()
      .map((run) => {
        const total = run.submissions.length;
        const completed = run.submissions.filter(
          (submission) => submission.status === 'completed',
        ).length;

        if (total === 0) {
          return null;
        }

        return {
          runId: run.id,
          label: run.startedAt.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
          checkInName: run.checkIn?.name || 'Check-in',
          rate: Math.round((completed / total) * 100),
          completed,
          total,
        };
      })
      .filter(
        (
          point,
        ): point is {
          runId: string;
          label: string;
          checkInName: string;
          rate: number;
          completed: number;
          total: number;
        } => point !== null,
      );

    const aiBlockers = this.extractAiDigestBlockers(
      latestDigest.blockers,
      latestRun,
      latestSections.participantUpdates as Array<{
        slackUserId: string;
        displayName: string;
      }>,
      await this.resolveSlackDisplayNames(
        this.extractBlockerSlackUserIds(latestDigest.blockers),
      ),
    );

    const answerBlockers = await this.extractAnswerBlockers(latestRun.id);
    const activeBlockers = this.mergeBlockers(aiBlockers, answerBlockers);

    const authoritativeBlockerStats = workspaceId
      ? await this.workspaceAnalytics.getBlockerStats(workspaceId)
      : null;
    const openBlockerCount = authoritativeBlockerStats?.openBlockers ?? 0;

    const blockedMemberCount = new Set(
      activeBlockers.map((blocker) => blocker.memberKey),
    ).size;

    const runIds = recentRuns.map((run) => run.id);
    const scaleAnswers = await this.prisma.answer.findMany({
      where: {
        submission: {
          runId: { in: runIds },
          status: 'completed',
        },
        question: { type: QuestionType.SCALE_1_5 },
      },
      select: { text: true, structuredValue: true },
    });

    const scaleValues = scaleAnswers
      .map((answer) => {
        const structured = answer.structuredValue as { value?: number } | null;
        if (
          typeof structured?.value === 'number' &&
          structured.value >= 1 &&
          structured.value <= 5
        ) {
          return structured.value;
        }

        const parsed = Number.parseInt(answer.text, 10);
        if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 5) {
          return parsed;
        }

        return null;
      })
      .filter((value): value is number => value !== null);

    const averageConfidence =
      scaleValues.length > 0
        ? Math.round(
            (scaleValues.reduce((sum, value) => sum + value, 0) /
              scaleValues.length) *
              10,
          ) / 10
        : null;

    const highBlockers = activeBlockers.filter(
      (blocker) => blocker.severity === 'high',
    ).length;

    const teamHealth = this.computeTeamHealth({
      completionRate,
      blockerCount: openBlockerCount,
      highBlockers,
      summary: this.isPlaceholderAnalyticsText(latestDigest.summary)
        ? ''
        : latestDigest.summary,
    });

    const insights = this.buildAnalyticsInsights({
      digest: latestDigest,
      sections: latestSections,
      productivityTrend,
      recentRuns,
      blockedMemberCount: openBlockerCount,
      completionRate,
    });

    const recommendations = latestSections.actionItems
      .map((item) => item.trim())
      .filter((item) => item && !this.isPlaceholderAnalyticsText(item))
      .slice(0, 8);

    const previousRate =
      productivityTrend.length >= 2
        ? productivityTrend[productivityTrend.length - 2].rate
        : null;
    const completionTrendDelta =
      completionRate !== null && previousRate !== null
        ? completionRate - previousRate
        : null;

    return {
      available: true,
      teamHealth: teamHealth?.status ?? null,
      teamHealthLabel: teamHealth?.label ?? 'Not available',
      completionRate,
      completionRateLabel:
        completionRate !== null ? `${completionRate}%` : 'Not enough responses',
      completionTrendDelta,
      activeBlockersCount: openBlockerCount,
      activeBlockers: activeBlockers.map(({ memberKey: _memberKey, ...blocker }) => blocker),
      averageConfidence,
      averageConfidenceLabel:
        averageConfidence !== null
          ? `${averageConfidence} / 5`
          : 'Not available',
      averageConfidenceScale: 5,
      activeCheckIns: activeCheckInsCount,
      productivityTrend:
        productivityTrend.length >= 2 ? productivityTrend : [],
      productivityTrendLabel:
        productivityTrend.length >= 2
          ? `Completion rate across ${productivityTrend.length} standup runs`
          : 'Not enough historical standup runs',
      insights,
      insightsLabel:
        insights.length > 0
          ? 'From latest stored AI report'
          : 'No data available yet',
      recommendations,
      recommendationsLabel:
        recommendations.length > 0
          ? 'From latest stored AI report'
          : 'No recommendations available',
      basedOnRuns: recentRuns.length,
      latestRunId: latestRun.id,
      latestCheckInName: latestRun.checkIn?.name || null,
    };
  }

  private extractBlockerSlackUserIds(blockersJson: unknown): string[] {
    if (!Array.isArray(blockersJson)) {
      return [];
    }

    return [
      ...new Set(
        (blockersJson as Array<{ userId?: string }>)
          .map((blocker) => blocker.userId)
          .filter((userId): userId is string => typeof userId === 'string'),
      ),
    ];
  }

  private async resolveSlackDisplayNames(slackUserIds: string[]) {
    if (slackUserIds.length === 0) {
      return new Map<string, string>();
    }

    const users = await this.prisma.user.findMany({
      where: { slackUserId: { in: slackUserIds } },
      select: { slackUserId: true, slackDisplayName: true },
    });

    return new Map(users.map((user) => [user.slackUserId, user.slackDisplayName]));
  }

  private extractAiDigestBlockers(
    blockersJson: unknown,
    run: {
      id: string;
      checkIn: { name: string } | null;
    },
    participantUpdates: Array<{ slackUserId: string; displayName: string }>,
    userMap: Map<string, string>,
  ) {
    if (!Array.isArray(blockersJson)) {
      return [] as Array<{
        memberKey: string;
        memberName: string;
        standup: string;
        description: string;
        severity: string;
        runId: string;
        source: string;
      }>;
    }

    const nameFromParticipants = new Map(
      participantUpdates.map((participant) => [
        participant.slackUserId,
        participant.displayName,
      ]),
    );

    return (blockersJson as Array<{
      userId?: string;
      description?: string;
      severity?: string;
    }>)
      .filter(
        (blocker) =>
          blocker.description &&
          !this.isPlaceholderAnalyticsText(blocker.description),
      )
      .map((blocker) => {
        const memberKey = blocker.userId || blocker.description || 'unknown';
        return {
          memberKey,
          memberName:
            (blocker.userId && nameFromParticipants.get(blocker.userId)) ||
            (blocker.userId && userMap.get(blocker.userId)) ||
            blocker.userId ||
            'Unknown member',
          standup: run.checkIn?.name || 'Check-in',
          description: blocker.description!.trim(),
          severity: blocker.severity || 'medium',
          runId: run.id,
          source: 'ai_report',
        };
      });
  }

  private async extractAnswerBlockers(runId: string) {
    const answers = await this.prisma.answer.findMany({
      where: {
        submission: { runId, status: 'completed' },
        question: {
          type: {
            in: [
              QuestionType.YES_NO,
              QuestionType.YES_NO_MAYBE,
              QuestionType.BLOCKER,
            ],
          },
        },
      },
      include: {
        question: { select: { question: true, type: true } },
        user: { select: { slackUserId: true, slackDisplayName: true } },
        submission: {
          select: {
            run: {
              select: {
                id: true,
                checkIn: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const blockers: Array<{
      memberKey: string;
      memberName: string;
      standup: string;
      description: string;
      severity: string;
      runId: string;
      source: string;
    }> = [];

    for (const answer of answers) {
      const sentiment = getSemanticSentiment({
        question: answer.question.question,
        type: answer.question.type,
        text: answer.text,
        structuredValue: answer.structuredValue,
      });

      if (sentiment !== 'negative') {
        continue;
      }

      const interpretation =
        describeSemanticAnswer({
          question: answer.question.question,
          type: answer.question.type,
          text: answer.text,
          structuredValue: answer.structuredValue,
        }) || answer.text.trim();

      if (!interpretation || this.isPlaceholderAnalyticsText(interpretation)) {
        continue;
      }

      blockers.push({
        memberKey: answer.user.slackUserId,
        memberName: answer.user.slackDisplayName,
        standup:
          answer.submission?.run.checkIn?.name || 'Check-in',
        description: interpretation,
        severity: 'medium',
        runId,
        source: 'standup_answer',
      });
    }

    return blockers;
  }

  private mergeBlockers(
    aiBlockers: Array<{
      memberKey: string;
      memberName: string;
      standup: string;
      description: string;
      severity: string;
      runId: string;
      source: string;
    }>,
    answerBlockers: Array<{
      memberKey: string;
      memberName: string;
      standup: string;
      description: string;
      severity: string;
      runId: string;
      source: string;
    }>,
  ) {
    const merged = new Map<string, (typeof aiBlockers)[number]>();

    for (const blocker of [...aiBlockers, ...answerBlockers]) {
      const key = `${blocker.memberKey}:${blocker.description.toLowerCase()}`;
      if (!merged.has(key)) {
        merged.set(key, blocker);
      }
    }

    return [...merged.values()];
  }

  private computeTeamHealth(params: {
    completionRate: number | null;
    blockerCount: number;
    highBlockers: number;
    summary: string;
  }): { status: 'healthy' | 'needs_attention' | 'critical'; label: string } | null {
    if (params.completionRate === null) {
      return null;
    }

    const summarySignalsRisk =
      !this.isPlaceholderAnalyticsText(params.summary) &&
      /\b(blocked|blocker|at risk|behind|concern|issue|impediment|waiting)\b/i.test(
        params.summary,
      );

    if (params.completionRate < 60 || params.highBlockers >= 2) {
      return { status: 'critical', label: 'Critical' };
    }

    if (
      params.completionRate < 85 ||
      params.blockerCount > 0 ||
      summarySignalsRisk
    ) {
      return { status: 'needs_attention', label: 'Needs Attention' };
    }

    return { status: 'healthy', label: 'Healthy' };
  }

  private buildAnalyticsInsights(params: {
    digest: {
      summary: string;
      source: string;
      themes: unknown;
      blockers: unknown;
    };
    sections: {
      aiInsights: string[];
      risks: string[];
      keyAccomplishments: string[];
      overallProgress: string;
    };
    productivityTrend: Array<{
      rate: number;
      label: string;
      checkInName: string;
    }>;
    recentRuns: Array<{ aiDigest: { blockers: unknown } | null }>;
    blockedMemberCount: number;
    completionRate: number | null;
  }): string[] {
    const insights: string[] = [];
    const seen = new Set<string>();

    const addInsight = (text: string | null | undefined) => {
      const trimmed = text?.trim();
      if (!trimmed || this.isPlaceholderAnalyticsText(trimmed) || seen.has(trimmed)) {
        return;
      }
      seen.add(trimmed);
      insights.push(trimmed);
    };

    for (const insight of params.sections.aiInsights) {
      addInsight(insight);
    }

    for (const risk of params.sections.risks) {
      addInsight(risk);
    }

    for (const accomplishment of params.sections.keyAccomplishments) {
      addInsight(`Key accomplishment: ${accomplishment}`);
    }

    if (Array.isArray(params.digest.themes)) {
      for (const theme of params.digest.themes as Array<{
        theme?: string;
        summary?: string;
        mentionCount?: number;
      }>) {
        if (theme.theme && theme.summary) {
          addInsight(
            `${theme.theme} (${theme.mentionCount ?? 1} mention(s)): ${theme.summary}`,
          );
        } else if (theme.theme) {
          addInsight(
            `Frequently mentioned: ${theme.theme} (${theme.mentionCount ?? 1} mention(s))`,
          );
        }
      }
    }

    if (
      params.digest.source === 'ai' &&
      !this.isPlaceholderAnalyticsText(params.digest.summary)
    ) {
      addInsight(params.digest.summary);
    } else if (
      params.sections.overallProgress &&
      !this.isPlaceholderAnalyticsText(params.sections.overallProgress)
    ) {
      addInsight(params.sections.overallProgress);
    }

    if (params.blockedMemberCount > 0) {
      addInsight(
        `${params.blockedMemberCount} team member(s) reported blockers in the latest standup.`,
      );
    }

    const recurringBlockers = this.aggregateRecurringBlockers(params.recentRuns);
    for (const [description, count] of recurringBlockers.slice(0, 3)) {
      if (count >= 2) {
        addInsight(`Repeated blocker across recent standups: ${description} (${count} runs)`);
      }
    }

    if (params.productivityTrend.length >= 2 && params.completionRate !== null) {
      const first = params.productivityTrend[0].rate;
      const last = params.productivityTrend[params.productivityTrend.length - 1].rate;
      if (last > first) {
        addInsight(
          `Team productivity trend: completion rate increased from ${first}% to ${last}% across recent standup runs.`,
        );
      } else if (last < first) {
        addInsight(
          `Team productivity trend: completion rate decreased from ${first}% to ${last}% across recent standup runs.`,
        );
      }
    }

    return insights.slice(0, 8);
  }

  private aggregateRecurringBlockers(
    runs: Array<{ aiDigest: { blockers: unknown } | null }>,
  ) {
    const counts = new Map<string, number>();

    for (const run of runs) {
      const blockers = Array.isArray(run.aiDigest?.blockers)
        ? (run.aiDigest!.blockers as Array<{ description?: string }>)
        : [];

      for (const blocker of blockers) {
        if (
          !blocker.description ||
          this.isPlaceholderAnalyticsText(blocker.description)
        ) {
          continue;
        }

        const key = blocker.description.trim();
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }

    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }

  async getAnalyticsData() {
    const workspaceId = await this.activeWorkspaceId();
    if (!workspaceId) {
      return {
        stats: {
          overallCompletion: 0,
          pendingResponses: 0,
          missedCheckIns: 0,
          avgResponseTimeMinutes: 0,
        },
        completionRateTrend: [],
        responseSpeedDistribution: [],
        teamPerformance: [],
        recurringBlockers: [],
        missedStandups: [],
        aiInsights: {
          headline: 'No workspace selected',
          summary: 'Select a workspace to view analytics.',
          recommendation: '',
        },
      };
    }

    const snapshot = await this.workspaceAnalytics.collectSnapshot({
      workspaceId,
      refreshJira: true,
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const submissionScope = workspaceSubmissionFilter(workspaceId);

    const completedWithTime = await this.prisma.standupSubmission.findMany({
      where: {
        status: 'completed',
        startedAt: { not: null },
        completedAt: { not: null, gte: thirtyDaysAgo },
        ...submissionScope,
      },
      select: { startedAt: true, completedAt: true },
      take: 500,
      orderBy: { completedAt: 'desc' },
    });

    let avgResponseTimeMinutes = 0;
    if (completedWithTime.length > 0) {
      const totalMs = completedWithTime.reduce(
        (sum, s) => sum + (s.completedAt!.getTime() - s.startedAt!.getTime()),
        0,
      );
      avgResponseTimeMinutes =
        Math.round((totalMs / completedWithTime.length / 60000) * 10) / 10;
    }

    const responseSpeedDistribution = [
      { timeSlot: '< 5 min', count: 0 },
      { timeSlot: '5-15 min', count: 0 },
      { timeSlot: '15-30 min', count: 0 },
      { timeSlot: '30-60 min', count: 0 },
      { timeSlot: '> 1 hr', count: 0 },
    ];
    for (const row of completedWithTime) {
      const minutes =
        (row.completedAt!.getTime() - row.startedAt!.getTime()) / 60000;
      if (minutes < 5) responseSpeedDistribution[0].count += 1;
      else if (minutes < 15) responseSpeedDistribution[1].count += 1;
      else if (minutes < 30) responseSpeedDistribution[2].count += 1;
      else if (minutes < 60) responseSpeedDistribution[3].count += 1;
      else responseSpeedDistribution[4].count += 1;
    }

    const teams = await this.prisma.team.findMany({
      where: workspaceTeamFilter(workspaceId),
      include: {
        teamMembers: { where: { optedOut: false } },
        standupRuns: {
          where: { startedAt: { gte: thirtyDaysAgo } },
          include: { submissions: true },
        },
      },
    });

    const teamPerformance = teams.map((team) => {
      const subs = team.standupRuns.flatMap((r) => r.submissions);
      const completed = subs.filter((s) => s.status === 'completed').length;
      const rate = subs.length > 0 ? Math.round((completed / subs.length) * 100) : 0;
      return {
        teamName: team.name,
        completionRate: rate,
        avgTime: 'n/a',
        activeMembers: team.teamMembers.length,
      };
    });

    const recurringBlockers = Object.entries(snapshot.blockers.byOwner)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, occurrences]) => ({
        category,
        occurrences,
        impact: occurrences >= 5 ? 'High' : occurrences >= 2 ? 'Medium' : 'Low',
      }));

    const overallCompletion =
      snapshot.standups.totalSubmissions > 0
        ? Math.round(
            (snapshot.standups.completedSubmissions /
              snapshot.standups.totalSubmissions) *
              100,
          )
        : 0;

    return {
      stats: {
        overallCompletion,
        pendingResponses: snapshot.standups.pendingSubmissions,
        missedCheckIns: snapshot.standups.missedSubmissions,
        avgResponseTimeMinutes,
        openBlockers: snapshot.blockers.openBlockers,
        criticalBlockers: snapshot.blockers.critical,
        jiraIssues: snapshot.jira.totalIssues,
        workspaceMembers: snapshot.members.total,
      },
      completionRateTrend: snapshot.standups.weeklyTrend.map((w) => ({
        week: w.weekLabel,
        rate: w.rate,
        target: 85,
      })),
      responseSpeedDistribution,
      teamPerformance,
      recurringBlockers,
      missedStandups: [],
      aiInsights: {
        headline: `${snapshot.standups.completedSubmissions} of ${snapshot.members.activeParticipants} members submitted standups (${snapshot.standups.participationRate ?? 'n/a'}%).`,
        summary: `${snapshot.blockers.openBlockers} blockers remain open. ${snapshot.jira.inProgressIssues} Jira issues in progress. Completion rate ${overallCompletion}%.`,
        recommendation:
          snapshot.blockers.openBlockers > 0
            ? `Review ${snapshot.blockers.openBlockers} open blocker(s) on the Blockers page.`
            : 'No open blockers — maintain current standup cadence.',
      },
      generatedAt: snapshot.generatedAt,
      workspaceId: snapshot.workspaceId,
    };
  }

  async getAnalyticsSnapshot() {
    const workspaceId = await this.activeWorkspaceId();
    if (!workspaceId) {
      throw new NotFoundException('No active workspace');
    }
    return this.workspaceAnalytics.collectSnapshot({
      workspaceId,
      refreshJira: true,
    });
  }

  async getReportsList(search?: string, timeframe?: string) {
    const workspaceId = await this.activeWorkspaceId();
    const where: any = {
      source: 'ai',
      slackReportText: { not: null },
      generationError: null,
      run: {
        checkInId: { not: null },
        ...(workspaceId ? { team: { workspaceId } } : {}),
      },
    };

    if (timeframe === 'week') {
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      where.generatedAt = { gte: weekAgo };
    }

    const digests = await this.prisma.aiDigest.findMany({
      where,
      orderBy: { run: { startedAt: 'desc' } },
      include: {
        team: {
          select: {
            name: true,
            workspace: {
              select: {
                slackWorkspaceId: true,
                slackWorkspaceName: true,
              },
            },
          },
        },
        run: {
          select: {
            id: true,
            scheduledFor: true,
            startedAt: true,
            completedAt: true,
            status: true,
            reportGeneratedAt: true,
            reportStatus: true,
            slackChannelId: true,
            slackThreadTs: true,
            checkIn: {
              select: {
                id: true,
                name: true,
                timezone: true,
              },
            },
            submissions: {
              select: {
                status: true,
              },
            },
          },
        },
      },
    });

    const query = search?.trim().toLowerCase() ?? '';

    return digests
      .filter((digest) => digest.run?.checkIn)
      .filter((digest) => {
        if (!query) return true;
        const checkInName = digest.run?.checkIn?.name?.toLowerCase() ?? '';
        const teamName = digest.team?.name?.toLowerCase() ?? '';
        const summary = digest.summary.toLowerCase();
        return (
          checkInName.includes(query) ||
          teamName.includes(query) ||
          summary.includes(query)
        );
      })
      .map((digest) => this.mapReportListItem(digest));
  }

  async getReportsGrouped(search?: string, timeframe?: string) {
    const items = await this.getReportsList(search, timeframe);
    const groups = new Map<
      string,
      {
        checkInId: string;
        checkInName: string;
        teamName: string;
        latestReport: Awaited<ReturnType<AdminService['getReportsList']>>[number];
        totalReports: number;
      }
    >();

    for (const item of items) {
      if (!item.checkInId) continue;

      const existing = groups.get(item.checkInId);
      if (!existing) {
        groups.set(item.checkInId, {
          checkInId: item.checkInId,
          checkInName: item.checkInName,
          teamName: item.teamName,
          latestReport: item,
          totalReports: 1,
        });
      } else {
        existing.totalReports += 1;
      }
    }

    return Array.from(groups.values()).sort(
      (a, b) =>
        new Date(b.latestReport.runDate).getTime() -
        new Date(a.latestReport.runDate).getTime(),
    );
  }

  async getReportsForCheckIn(checkInId: string) {
    const checkIn = await this.prisma.checkIn.findUnique({
      where: { id: checkInId },
      select: { id: true, name: true, team: { select: { name: true } } },
    });

    if (!checkIn) {
      throw new NotFoundException(`CheckIn ${checkInId} was not found.`);
    }

    const digests = await this.prisma.aiDigest.findMany({
      where: {
        source: 'ai',
        slackReportText: { not: null },
        generationError: null,
        run: { checkInId },
      },
      orderBy: { run: { startedAt: 'desc' } },
      include: {
        team: {
          select: {
            name: true,
            workspace: {
              select: {
                slackWorkspaceId: true,
                slackWorkspaceName: true,
              },
            },
          },
        },
        run: {
          select: {
            id: true,
            scheduledFor: true,
            startedAt: true,
            completedAt: true,
            status: true,
            reportGeneratedAt: true,
            reportStatus: true,
            slackChannelId: true,
            slackThreadTs: true,
            checkIn: {
              select: {
                id: true,
                name: true,
                timezone: true,
              },
            },
            submissions: {
              select: { status: true },
            },
          },
        },
      },
    });

    return {
      checkInId: checkIn.id,
      checkInName: checkIn.name,
      teamName: checkIn.team?.name ?? 'General',
      reports: digests
        .filter((digest) => digest.run?.checkIn)
        .map((digest) => this.mapReportListItem(digest)),
    };
  }

  async getReportByRunId(runId: string) {
    const digest = await this.prisma.aiDigest.findUnique({
      where: { runId },
    });

    if (!digest?.slackReportText && !digest?.generationError) {
      throw new NotFoundException('Report is not generated yet.');
    }

    if (digest.source !== 'ai') {
      throw new NotFoundException(
        'Report is not available — only AI-generated reports are shown.',
      );
    }

    return this.getReportDetail(digest.id);
  }

  async getReportDetail(id: string) {
    const digest = await this.prisma.aiDigest.findUnique({
      where: { id },
      include: {
        team: {
          select: {
            id: true,
            name: true,
            workspaceId: true,
            workspace: {
              select: {
                slackWorkspaceId: true,
                slackWorkspaceName: true,
              },
            },
          },
        },
        run: {
          include: {
            checkIn: {
              select: {
                id: true,
                name: true,
                timezone: true,
                description: true,
              },
            },
            submissions: {
              include: {
                user: {
                  select: {
                    id: true,
                    slackUserId: true,
                    slackDisplayName: true,
                  },
                },
                answers: {
                  include: { question: true },
                  orderBy: { createdAt: 'asc' },
                },
                jiraIssueLinks: {
                  orderBy: [{ questionId: 'asc' }, { issueKey: 'asc' }],
                },
              },
              orderBy: { completedAt: 'asc' },
            },
          },
        },
      },
    });

    if (!digest?.run?.checkIn) {
      throw new NotFoundException(`Report ${id} was not found.`);
    }

    if (!digest.slackReportText && !digest.generationError) {
      throw new NotFoundException('Report is not generated yet.');
    }

    if (digest.source !== 'ai' && !digest.generationError) {
      throw new NotFoundException(
        'Report is not available — only AI-generated reports are shown.',
      );
    }

    const listItem = this.mapReportListItem(digest);
    let reportSections = this.enrichReportSectionsForDetail(
      digest,
      digest.run.submissions,
    );
    const nonResponderNames = Array.isArray(digest.nonResponderNames)
      ? (digest.nonResponderNames as string[])
      : [];

    let summary = listItem.summary;
    let slackReportText = digest.slackReportText ?? null;
    let nameMap: Map<string, string> | null = null;

    if (digest.team.workspaceId) {
      nameMap = await this.workspaceMembers.buildReportNameMap(
        digest.team.workspaceId,
        digest.run.submissions.map((submission) => ({
          slackUserId: submission.user.slackUserId,
          displayName: submission.user.slackDisplayName,
        })),
      );
      const resolved = resolveSlackIdsInDigest(
        {
          teamId: digest.teamId,
          runId: digest.runId,
          generatedAt: digest.generatedAt.toISOString(),
          source: digest.source as 'ai' | 'rules_fallback' | 'failed',
          summary: digest.summary ?? '',
          blockers:
            (digest.blockers as unknown as AiDigestResult['blockers']) ?? [],
          themes: (digest.themes as unknown as AiDigestResult['themes']) ?? [],
          reportSections: reportSections as AiDigestResult['reportSections'],
        },
        nameMap,
      );
      summary = resolved.summary;
      reportSections = resolved.reportSections as typeof reportSections;
      slackReportText = slackReportText
        ? resolveAllSlackIdsInText(slackReportText, nameMap)
        : null;
    }

    const blockers = Array.isArray(digest.blockers)
      ? (digest.blockers as Array<Record<string, unknown>>).map((blocker) => {
          const userId = String(blocker.userId ?? '');
          return {
            ...blocker,
            displayName: nameMap
              ? lookupSlackDisplayName(userId, nameMap)
              : digest.run.submissions.find(
                  (submission) => submission.user.slackUserId === userId,
                )?.user.slackDisplayName ?? 'Unknown User',
          };
        })
      : [];

    return {
      ...listItem,
      summary,
      description: digest.run.checkIn.description,
      runStatus: digest.run.status,
      reportStatus: digest.run.reportStatus,
      nonResponderNames,
      slackReportText,
      generationError: digest.generationError ?? null,
      reportSections,
      participants: this.buildParticipantsFromSubmissions(
        digest.run.submissions,
      ),
      participantProfiles: reportSections.participantProfiles ?? [],
      statistics: reportSections.statistics ?? null,
      blockers,
      themes: digest.themes,
    };
  }

  private buildParticipantsFromSubmissions(
    submissions: Array<{
      status: string;
      answers: Array<{
        text: string;
        questionId: string;
        question: { question: string; order?: number | null };
      }>;
      jiraIssueLinks?: Array<{
        questionId: string;
        issueKey: string;
        summary: string;
        status: string | null;
        assigneeName: string | null;
        projectKey: string | null;
        issueUrl: string | null;
      }>;
      user: { slackUserId: string; slackDisplayName: string };
    }>,
  ) {
    return submissions
      .filter((submission) => submission.status === 'completed')
      .map((submission) => {
        const linksByQuestion = new Map<
          string,
          Array<{
            issueKey: string;
            summary: string;
            status: string | null;
            assigneeName: string | null;
            projectKey: string | null;
            issueUrl: string | null;
          }>
        >();

        for (const link of submission.jiraIssueLinks ?? []) {
          const existing = linksByQuestion.get(link.questionId) ?? [];
          existing.push({
            issueKey: link.issueKey,
            summary: link.summary,
            status: link.status,
            assigneeName: link.assigneeName,
            projectKey: link.projectKey,
            issueUrl: link.issueUrl,
          });
          linksByQuestion.set(link.questionId, existing);
        }

        return {
          slackUserId: submission.user.slackUserId,
          displayName: submission.user.slackDisplayName,
          answers: [...submission.answers]
            .sort(
              (left, right) =>
                (left.question.order ?? 0) - (right.question.order ?? 0),
            )
            .map((answer) => ({
              question: answer.question.question,
              answer: answer.text,
              linkedJiraIssues:
                linksByQuestion.get(answer.questionId) ?? [],
            })),
        };
      });
  }

  private enrichReportSectionsForDetail(
    digest: {
      blockers: unknown;
      reportSections?: unknown;
    },
    submissions: Array<{
      status: string;
      answers: Array<{
        text: string;
        structuredValue?: unknown;
        question: { question: string; type: QuestionType; order?: number };
      }>;
      user: { slackUserId: string; slackDisplayName: string };
    }>,
  ) {
    const parsed = this.parseReportSections(digest.reportSections);
    const completedCount = submissions.filter(
      (submission) => submission.status === 'completed',
    ).length;
    const totalCount = submissions.length;

    const participantProfiles =
      parsed.participantProfiles && parsed.participantProfiles.length > 0
        ? parsed.participantProfiles
        : buildParticipantProfiles(submissions);

    const blockers = Array.isArray(digest.blockers)
      ? (digest.blockers as Array<{ userId: string; description: string; dependency?: string | null }>)
      : [];

    const userIdToName = new Map(
      submissions.map((submission) => [
        submission.user.slackUserId,
        submission.user.slackDisplayName,
      ]),
    );

    const statistics =
      parsed.statistics ??
      buildReportStatistics(
        submissions,
        blockers as any,
        participantProfiles,
        completedCount,
        totalCount,
      );

    const namedBlockers =
      parsed.namedBlockers && parsed.namedBlockers.length > 0
        ? parsed.namedBlockers
        : groupBlockersByPerson(blockers as any, userIdToName);

    const helpRequests =
      parsed.helpRequests && parsed.helpRequests.length > 0
        ? parsed.helpRequests
        : participantProfiles
            .filter((profile) => profile.helpRequested)
            .map((profile) => ({
              displayName: profile.displayName,
              items: [profile.helpDetail || profile.todaysPlan].filter(
                (item) => item && item !== '—',
              ),
            }))
            .filter((section) => section.items.length > 0);

    const namedRisks =
      parsed.namedRisks && parsed.namedRisks.length > 0
        ? parsed.namedRisks
        : participantProfiles
            .filter(
              (profile) =>
                profile.blocked ||
                (profile.confidence != null && profile.confidence <= 2),
            )
            .map((profile) => ({
              displayName: profile.displayName,
              items: [
                profile.blockedDetail || profile.todaysPlan || profile.taskStatus,
              ].filter((item) => item && item !== '—'),
            }))
            .filter((section) => section.items.length > 0);

    const namedAccomplishments =
      parsed.namedAccomplishments && parsed.namedAccomplishments.length > 0
        ? parsed.namedAccomplishments
        : participantProfiles
            .filter((profile) => profile.yesterdaysWork !== '—')
            .map((profile) => ({
              displayName: profile.displayName,
              items: [profile.yesterdaysWork],
            }));

    return {
      ...parsed,
      participantProfiles,
      statistics,
      namedBlockers,
      helpRequests,
      namedRisks,
      namedAccomplishments,
      teamProgress:
        parsed.teamProgress && parsed.teamProgress.length > 0
          ? parsed.teamProgress
          : statistics.teamProgressBullets,
    };
  }

  private mapReportListItem(digest: {
    id: string;
    runId: string;
    teamId: string;
    generatedAt: Date;
    source: string;
    summary: string;
    blockers: unknown;
    themes: unknown;
    reportSections?: unknown;
    slackReportText?: string | null;
    team: {
      name: string;
      workspace?: {
        slackWorkspaceId: string;
        slackWorkspaceName: string | null;
      } | null;
    } | null;
    run: {
      id: string;
      scheduledFor: Date;
      startedAt: Date;
      completedAt: Date | null;
      status: string;
      reportGeneratedAt: Date | null;
      reportStatus: string;
      slackChannelId: string | null;
      slackThreadTs: string | null;
      checkIn: { id: string; name: string; timezone: string } | null;
      submissions: { status: string }[];
    } | null;
  }) {
    const run = digest.run!;
    const totalParticipants = run.submissions.length;
    const participantsResponded = run.submissions.filter(
      (submission) => submission.status === 'completed',
    ).length;
    const completionRate =
      totalParticipants > 0
        ? Math.round((participantsResponded / totalParticipants) * 100)
        : 0;

    const workspaceId =
      digest.team?.workspace?.slackWorkspaceId ||
      process.env.SLACK_TEAM_ID ||
      '';
    const slackThreadUrl =
      run.slackChannelId && run.slackThreadTs
        ? buildSlackThreadUrl(
            workspaceId,
            run.slackChannelId,
            run.slackThreadTs,
          )
        : null;

    return {
      id: digest.id,
      runId: digest.runId,
      teamId: digest.teamId,
      checkInId: run.checkIn?.id ?? null,
      checkInName: run.checkIn?.name ?? 'CheckIn',
      teamName: digest.team?.name ?? 'General',
      runDate: run.startedAt.toISOString(),
      scheduledFor: run.scheduledFor.toISOString(),
      generatedAt: digest.generatedAt.toISOString(),
      source: digest.source,
      aiProvider:
        digest.source === 'ai'
          ? 'OpenAI'
          : digest.source === 'failed'
            ? 'Failed'
            : 'Unavailable',
      summary: digest.summary,
      blockers: digest.blockers,
      themes: digest.themes,
      reportSections: this.parseReportSections(digest.reportSections),
      totalParticipants,
      participantsResponded,
      completionRate,
      runStatus: run.status,
      reportPosted: !!run.reportGeneratedAt && !!digest.slackReportText,
      slackThreadUrl,
    };
  }

  private buildParticipantUpdates(
    submissions: Array<{
      status: string;
      user: {
        slackUserId: string;
        slackDisplayName: string;
      };
      answers: Array<{
        text: string;
        question: { question: string };
      }>;
    }>,
  ) {
    return submissions.map((submission) => ({
      slackUserId: submission.user.slackUserId,
      displayName: submission.user.slackDisplayName,
      status: submission.status,
      answers: submission.answers.map((answer) => ({
        question: answer.question.question,
        answer: answer.text,
      })),
    }));
  }

  private parseReportSections(value: unknown) {
    if (!value || typeof value !== 'object') {
      return {
        keyAccomplishments: [] as string[],
        risks: [] as string[],
        aiInsights: [] as string[],
        actionItems: [] as string[],
        participantUpdates: [] as Array<{
          slackUserId: string;
          displayName: string;
          answers: Array<{ question: string; answer: string }>;
        }>,
        overallProgress: '',
        namedBlockers: [] as Array<{ displayName: string; items: string[] }>,
        helpRequests: [] as Array<{ displayName: string; items: string[] }>,
        namedRisks: [] as Array<{ displayName: string; items: string[] }>,
        namedAccomplishments: [] as Array<{ displayName: string; items: string[] }>,
        teamProgress: [] as string[],
        participantProfiles: [] as Array<Record<string, unknown>>,
        statistics: null as Record<string, unknown> | null,
      };
    }

    const record = value as Record<string, unknown>;
    const toStringArray = (input: unknown) =>
      Array.isArray(input)
        ? input.filter((item): item is string => typeof item === 'string')
        : [];

    const parseNamed = (input: unknown) =>
      Array.isArray(input)
        ? input
            .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
            .map((item) => ({
              displayName: String(item.displayName ?? '').trim(),
              items: Array.isArray(item.items)
                ? item.items.filter((entry): entry is string => typeof entry === 'string')
                : [],
            }))
            .filter((section) => section.displayName && section.items.length > 0)
        : [];

    return {
      keyAccomplishments: toStringArray(record.keyAccomplishments),
      risks: toStringArray(record.risks),
      aiInsights: toStringArray(record.aiInsights),
      actionItems: toStringArray(record.actionItems),
      participantUpdates: Array.isArray(record.participantUpdates)
        ? record.participantUpdates
        : [],
      overallProgress:
        typeof record.overallProgress === 'string'
          ? record.overallProgress
          : '',
      namedBlockers: parseNamed(record.namedBlockers),
      helpRequests: parseNamed(record.helpRequests),
      namedRisks: parseNamed(record.namedRisks),
      namedAccomplishments: parseNamed(record.namedAccomplishments),
      teamProgress: toStringArray(record.teamProgress),
      participantProfiles: Array.isArray(record.participantProfiles)
        ? record.participantProfiles
        : [],
      statistics:
        record.statistics && typeof record.statistics === 'object'
          ? (record.statistics as Record<string, unknown>)
          : null,
    };
  }

  async exportReportCsv(id: string) {
    const digest = await this.prisma.aiDigest.findUnique({
      where: { id },
      include: { team: true },
    });

    if (!digest) {
      throw new NotFoundException(`Report ${id} not found`);
    }

    const rows = [
      ['ID', 'Team', 'Generated At', 'Source', 'Summary'],
      [digest.id, digest.team.name, digest.generatedAt.toISOString(), digest.source, `"${digest.summary.replace(/"/g, '""')}"`],
    ];

    return rows.map((r) => r.join(',')).join('\n');
  }

  async exportReportPdf(id: string) {
    const digest = await this.prisma.aiDigest.findUnique({
      where: { id },
      include: { team: true },
    });

    if (!digest) {
      throw new NotFoundException(`Report ${id} not found`);
    }

    return `
==================================================
PULSE STANDUP REPORT
==================================================
Report ID: ${digest.id}
Team: ${digest.team.name}
Generated At: ${digest.generatedAt.toISOString()}
Source: ${digest.source}

SUMMARY:
${digest.summary}

BLOCKERS:
${JSON.stringify(digest.blockers, null, 2)}

THEMES:
${JSON.stringify(digest.themes, null, 2)}
==================================================
`;
  }

  async getSettings() {
    const workspace = await this.prisma.workspace.findFirst();

    return {
      workspace: {
        id: workspace?.id || 'default-ws',
        name: workspace?.slackWorkspaceName || 'TeamPulse Workspace',
        slackWorkspaceId: workspace?.slackWorkspaceId || '',
        botTokenSet: Boolean(workspace?.botToken),
      },
      slack: {
        botTokenSet: Boolean(process.env.SLACK_BOT_TOKEN),
        signingSecretSet: Boolean(process.env.SLACK_SIGNING_SECRET),
        socketModeEnabled: process.env.SLACK_SOCKET_MODE_ENABLED === 'true',
        defaultDigestChannel: process.env.SLACK_DIGEST_CHANNEL_ID || '',
      },
      openai: {
        enabled: process.env.PULSE_AI_ENABLED === 'true',
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        apiKeySet: Boolean(process.env.OPENAI_API_KEY),
      },
      system: {
        timezone: process.env.DAILY_DIGEST_TIMEZONE || 'Asia/Riyadh',
        collectionCron: process.env.DAILY_COLLECTION_CRON || '8 11 * * 1-5',
        digestCron: process.env.DAILY_DIGEST_CRON || '8 11 * * 1-5',
        schedulerEnabled: process.env.DIGEST_SCHEDULER_ENABLED === 'true',
        databaseStatus: 'Healthy',
      },
    };
  }

  async updateSettings(body: any) {
    this.logger.log('Updating admin settings:', body);
    return { status: 'success', updated: body };
  }

  async getTeams() {
    const workspaceId = await this.activeWorkspaceId();
    const teams = await this.prisma.team.findMany({
      where: workspaceId ? workspaceTeamFilter(workspaceId) : undefined,
      include: {
        workspace: true,
        teamMembers: {
          include: { user: true },
          orderBy: { joinedAt: 'asc' },
        },
        _count: {
          select: {
            checkIns: true,
            standupRuns: {
              where: {
                status: 'collecting',
                checkInId: { not: null },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [...new Set(teams.flatMap((team) => team.teamMembers.map((m) => m.userId)))];
    const profiles =
      userIds.length > 0
        ? await this.prisma.$queryRaw<
            Array<{
              id: string;
              slackRealName: string | null;
              slackAvatarUrl: string | null;
            }>
          >`
            SELECT id, "slackRealName", "slackAvatarUrl"
            FROM "User"
            WHERE id IN (${Prisma.join(userIds)})
          `
        : [];
    const profileById = new Map(profiles.map((p) => [p.id, p]));

    return teams.map((team) => {
      const enrichedMembers = team.teamMembers.map((member) => {
        const profile = profileById.get(member.userId);
        return {
          ...member,
          user: {
            ...member.user,
            slackRealName: profile?.slackRealName ?? null,
            slackAvatarUrl: profile?.slackAvatarUrl ?? null,
          },
        };
      });
      const lead = enrichedMembers.find((member) => member.role === 'lead');
      const memberNames = enrichedMembers.map(
        (member) =>
          member.user.slackRealName ||
          member.user.slackDisplayName ||
          member.user.email ||
          member.user.slackUserId,
      );

      return {
        id: team.id,
        workspaceId: team.workspaceId,
        name: team.name,
        slackChannelId: team.slackChannelId,
        scheduleCron: team.scheduleCron,
        timezone: team.timezone,
        schedulerEnabled: team.schedulerEnabled,
        createdAt: team.createdAt,
        updatedAt: team.updatedAt,
        workspace: team.workspace,
        teamMembers: enrichedMembers,
        teamLead: lead
          ? {
              id: lead.id,
              userId: lead.userId,
              name:
                lead.user.slackRealName ||
                lead.user.slackDisplayName ||
                lead.user.email ||
                lead.user.slackUserId,
            }
          : null,
        memberCount: enrichedMembers.length,
        memberNames,
        checkInCount: team._count.checkIns,
        activeRunCount: team._count.standupRuns,
      };
    });
  }

  async createTeam(data: { name: string; slackChannelId?: string; timezone?: string; scheduleCron?: string }) {
    const name = data.name?.trim();
    if (!name) {
      throw new BadRequestException('name is required.');
    }

    await this.workspaceBootstrap.ensureFromSlackToken();

    const workspaceId = await this.activeWorkspaceId();
    if (!workspaceId) {
      throw new NotFoundException('No workspace found');
    }

    const slackChannelId = data.slackChannelId?.trim() || null;

    return this.prisma.team.create({
      data: {
        workspaceId,
        name,
        slackChannelId,
        timezone: data.timezone?.trim() || 'Asia/Riyadh',
        scheduleCron: data.scheduleCron?.trim() || '0 9 * * 1-5',
        schedulerEnabled: true,
      },
    });
  }

  async deleteTeam(id: string) {
    const workspaceId = await this.activeWorkspaceId();
    const team = await this.prisma.team.findUnique({ where: { id } });
    if (!team) throw new NotFoundException(`Team ${id} not found`);
    if (workspaceId && team.workspaceId !== workspaceId) {
      throw new NotFoundException(`Team ${id} was not found.`);
    }
    return this.prisma.team.delete({ where: { id } });
  }

  async getUsers(search?: string) {
    const workspaceId = await this.activeWorkspaceId();
    if (!workspaceId) return [];

    const members = await this.workspaceMembers.listHumanMembers(workspaceId, {
      search,
    });

    // Preserve prior getUsers shape (team memberships included).
    const users = await this.prisma.user.findMany({
      where: { id: { in: members.map((m) => m.id) } },
      include: {
        teamMembers: { include: { team: true } },
      },
    });

    const order = new Map(members.map((m, index) => [m.id, index]));
    return users.sort(
      (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );
  }

  /**
   * Slack workspace members for the active Pulse workspace.
   * Prefers a live Slack users.list sync into the User table, then returns
   * human members only (no bots/apps/deleted/placeholders), scoped by workspaceId.
   */
  async listWorkspaceMembers(params?: {
    search?: string;
    teamId?: string;
    sync?: boolean;
  }) {
    const workspaceId = await this.activeWorkspaceId();
    if (!workspaceId) {
      return {
        members: [],
        source: 'none' as const,
        synced: false,
        workspaceId: null,
      };
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        botToken: true,
        slackWorkspaceId: true,
        slackWorkspaceName: true,
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    let synced = false;
    let source: 'slack_api' | 'database' = 'database';

    const shouldSync = params?.sync !== false;
    if (shouldSync && isUsableSlackBotToken(workspace.botToken)) {
      try {
        const count = await this.syncSlackMembersForWorkspace(workspace);
        synced = count > 0;
        source = 'slack_api';
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Slack member sync failed for workspace ${workspace.id}: ${message}. Falling back to DB.`,
        );
      }
    }

    const search = params?.search?.trim().toLowerCase() ?? '';
    const profileRows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        slackUserId: string;
        slackDisplayName: string;
        slackRealName: string | null;
        slackAvatarUrl: string | null;
        email: string | null;
        timezone: string | null;
      }>
    >`
      SELECT
        id,
        "slackUserId",
        "slackDisplayName",
        "slackRealName",
        "slackAvatarUrl",
        email,
        timezone
      FROM "User"
      WHERE "workspaceId" = ${workspaceId}
      ORDER BY COALESCE("slackRealName", "slackDisplayName") ASC
    `;

    const memberships = params?.teamId
      ? await this.prisma.teamMember.findMany({
          where: {
            teamId: params.teamId,
            userId: { in: profileRows.map((row) => row.id) },
          },
          select: {
            id: true,
            userId: true,
            teamId: true,
            role: true,
            team: { select: { id: true, name: true } },
          },
        })
      : await this.prisma.teamMember.findMany({
          where: {
            userId: { in: profileRows.map((row) => row.id) },
            team: { workspaceId },
          },
          select: {
            id: true,
            userId: true,
            teamId: true,
            role: true,
            team: { select: { id: true, name: true } },
          },
        });

    const membershipsByUser = new Map<string, typeof memberships>();
    for (const membership of memberships) {
      const list = membershipsByUser.get(membership.userId) ?? [];
      list.push(membership);
      membershipsByUser.set(membership.userId, list);
    }

    const members = profileRows
      .filter(
        (user) =>
          !isPlaceholderSlackUser({
            slackUserId: user.slackUserId,
            slackDisplayName: user.slackDisplayName,
            email: user.email,
          }),
      )
      .filter((user) => {
        if (!search) return true;
        const haystack = [
          user.slackRealName,
          user.slackDisplayName,
          user.email,
          user.slackUserId,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      })
      .map((user) => {
        const userMemberships = membershipsByUser.get(user.id) ?? [];
        const membership = params?.teamId
          ? userMemberships.find((m) => m.teamId === params.teamId) ?? null
          : userMemberships[0] ?? null;

        const fullName =
          user.slackRealName?.trim() ||
          user.slackDisplayName?.trim() ||
          user.slackUserId;
        const displayName = user.slackDisplayName?.trim() || null;

        return {
          id: user.id,
          slackUserId: user.slackUserId,
          fullName,
          displayName,
          email: user.email,
          avatarUrl: user.slackAvatarUrl,
          timezone: user.timezone,
          alreadyOnTeam: Boolean(
            params?.teamId &&
              userMemberships.some((m) => m.teamId === params.teamId),
          ),
          currentRole: membership?.role ?? null,
          teamMemberships: userMemberships.map((m) => ({
            teamId: m.teamId,
            teamName: m.team.name,
            role: m.role,
          })),
        };
      });

    return {
      members,
      source: synced ? source : 'database',
      synced,
      workspaceId: workspace.id,
      slackWorkspaceId: workspace.slackWorkspaceId,
      slackWorkspaceName: workspace.slackWorkspaceName,
      total: members.length,
    };
  }

  async syncWorkspaceMembers() {
    const workspaceId = await this.activeWorkspaceId();
    if (!workspaceId) {
      throw new NotFoundException('No workspace found');
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        botToken: true,
        slackWorkspaceId: true,
        slackWorkspaceName: true,
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    if (!isUsableSlackBotToken(workspace.botToken)) {
      return {
        synced: false,
        reason:
          'No usable Slack bot token for this workspace. Showing members already stored in Pulse.',
        count: await this.prisma.user.count({ where: { workspaceId } }),
      };
    }

    const count = await this.syncSlackMembersForWorkspace(workspace);
    this.workspaceMembers.invalidateWorkspace(workspace.id);
    return { synced: true, count, reason: null };
  }

  private async syncSlackMembersForWorkspace(workspace: {
    id: string;
    botToken: string;
    slackWorkspaceId: string;
  }): Promise<number> {
    const result = await this.slackMemberCache.syncFromLive(workspace.id);
    return result.humans.length || result.synced;
  }

  async addTeamMember(teamId: string, data: { userId?: string; slackUserId?: string; role?: string }) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException(`Team ${teamId} not found`);

    const activeWorkspaceId = await this.activeWorkspaceId();
    if (activeWorkspaceId && team.workspaceId !== activeWorkspaceId) {
      throw new NotFoundException(`Team ${teamId} was not found.`);
    }

    const user = data.userId
      ? await this.prisma.user.findUnique({ where: { id: data.userId } })
      : await this.prisma.user.findUnique({ where: { slackUserId: data.slackUserId } });

    if (!user) throw new NotFoundException('User not found');
    if (user.workspaceId !== team.workspaceId) {
      throw new BadRequestException(
        'Cannot add a user from a different workspace to this team.',
      );
    }

    return this.prisma.teamMember.upsert({
      where: { teamId_userId: { teamId, userId: user.id } },
      update: { role: data.role || 'member', optedOut: false },
      create: { teamId, userId: user.id, role: data.role || 'member' },
      include: { user: true },
    });
  }

  async removeTeamMember(teamId: string, memberId: string) {
    const member = await this.prisma.teamMember.findFirst({ where: { id: memberId, teamId } });
    if (!member) throw new NotFoundException('Team member not found');
    return this.prisma.teamMember.delete({ where: { id: memberId } });
  }

  async updateTeamMemberRole(teamId: string, memberId: string, role: string) {
    const member = await this.prisma.teamMember.findFirst({ where: { id: memberId, teamId } });
    if (!member) throw new NotFoundException('Team member not found');
    return this.prisma.teamMember.update({
      where: { id: memberId },
      data: { role },
      include: { user: true },
    });
  }

  async searchTeamMembers(teamId: string, query?: string) {
    return this.prisma.teamMember.findMany({
      where: {
        teamId,
        ...(query
          ? {
              user: {
                OR: [
                  { slackDisplayName: { contains: query, mode: 'insensitive' } },
                  { slackUserId: { contains: query, mode: 'insensitive' } },
                ],
              },
            }
          : {}),
      },
      include: { user: true },
      orderBy: { joinedAt: 'asc' },
    });
  }
}
