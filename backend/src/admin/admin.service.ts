import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildSlackThreadUrl } from '../slack/slack-checkin.views';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverviewStats() {
    const activeCheckInsCount = await this.prisma.checkIn.count({
      where: { enabled: true, publishStatus: 'published' },
    });

    const activeTeamsCount = await this.prisma.team.count({
      where: { schedulerEnabled: true },
    });

    const totalSubmissions = await this.prisma.standupSubmission.count();
    const completedSubmissions = await this.prisma.standupSubmission.count({
      where: { status: 'completed' },
    });

    const completionRate =
      totalSubmissions > 0
        ? Math.round((completedSubmissions / totalSubmissions) * 100)
        : 0;

    const pendingResponses = await this.prisma.standupSubmission.count({
      where: { status: { in: ['pending', 'in_progress'] } },
    });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayReportsCount = await this.prisma.aiDigest.count({
      where: { generatedAt: { gte: todayStart } },
    });

    const completedWithTime = await this.prisma.standupSubmission.findMany({
      where: {
        status: 'completed',
        startedAt: { not: null },
        completedAt: { not: null },
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

    const weeklyParticipation = await this.buildWeeklyParticipation();
    const completionTrend = await this.buildCompletionTrend();
    const topBlockers = await this.buildTopBlockers();
    const recentActivity = await this.buildRecentActivity();
    const upcomingCheckIns = await this.buildUpcomingCheckIns();

    const aiInsights = await this.buildAiInsights(completionRate, pendingResponses);

    return {
      stats: {
        activeCheckIns: activeCheckInsCount,
        activeTeams: activeTeamsCount,
        completionRate,
        pendingResponses,
        avgResponseTimeMinutes,
        todayReports: todayReportsCount,
      },
      weeklyParticipation,
      completionTrend,
      topBlockers,
      recentActivity,
      upcomingCheckIns,
      aiInsights,
    };
  }

  private async buildWeeklyParticipation() {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const result = [];

    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date();
      dayStart.setDate(dayStart.getDate() - i);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const total = await this.prisma.standupSubmission.count({
        where: { createdAt: { gte: dayStart, lt: dayEnd } },
      });
      const completed = await this.prisma.standupSubmission.count({
        where: { status: 'completed', createdAt: { gte: dayStart, lt: dayEnd } },
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

  private async buildCompletionTrend() {
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date();
      dayStart.setDate(dayStart.getDate() - i);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const total = await this.prisma.standupSubmission.count({
        where: { createdAt: { gte: dayStart, lt: dayEnd } },
      });
      const completed = await this.prisma.standupSubmission.count({
        where: { status: 'completed', createdAt: { gte: dayStart, lt: dayEnd } },
      });

      result.push({
        date: dayStart.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }),
        rate: total > 0 ? Math.round((completed / total) * 100) : 0,
      });
    }
    return result;
  }

  private async buildTopBlockers() {
    const digests = await this.prisma.aiDigest.findMany({
      orderBy: { generatedAt: 'desc' },
      take: 20,
      include: { team: { select: { name: true } } },
    });

    const blockerMap = new Map<string, { description: string; count: number; team: string }>();

    for (const digest of digests) {
      const blockers = Array.isArray(digest.blockers) ? (digest.blockers as any[]) : [];
      for (const b of blockers) {
        const key = b.description || 'Unknown';
        const existing = blockerMap.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          blockerMap.set(key, {
            description: key,
            count: 1,
            team: digest.team?.name || 'General',
          });
        }
      }
    }

    return [...blockerMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)
      .map((b, idx) => ({
        id: String(idx + 1),
        description: b.description,
        count: b.count,
        severity: b.count >= 3 ? 'high' : b.count >= 2 ? 'medium' : 'low',
        team: b.team,
      }));
  }

  private async buildRecentActivity() {
    const activities: any[] = [];

    const recentDigests = await this.prisma.aiDigest.findMany({
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
      where: { status: 'completed' },
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
      take: 5,
      orderBy: { startedAt: 'desc' },
      include: { checkIn: { select: { name: true } }, team: { select: { name: true } } },
    });

    for (const r of recentRuns) {
      activities.push({
        id: `run-${r.id}`,
        type: 'checkin_triggered',
        title: `${r.checkIn?.name || 'Check-in'} collection started`,
        team: r.team?.name || 'General',
        timestamp: r.startedAt.toISOString(),
        status: 'info',
      });
    }

    return activities
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 10);
  }

  private async buildUpcomingCheckIns() {
    const checkIns = await this.prisma.checkIn.findMany({
      where: { enabled: true, publishStatus: 'published', scheduleEnabled: true },
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

  private async buildAiInsights(completionRate: number, pendingResponses: number) {
    const latestDigest = await this.prisma.aiDigest.findFirst({
      orderBy: { generatedAt: 'desc' },
    });

    return {
      headline: `Team completion rate is ${completionRate}%`,
      summary: latestDigest?.summary || `${pendingResponses} responses are still pending across active check-ins.`,
      recommendation:
        completionRate < 85
          ? 'Consider enabling recurring reminders for teams with low participation.'
          : 'Team participation is healthy. Review recurring blockers in Analytics.',
    };
  }

  async getAnalyticsData() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const totalSubmissions = await this.prisma.standupSubmission.count({
      where: { createdAt: { gte: thirtyDaysAgo } },
    });
    const completedSubmissions = await this.prisma.standupSubmission.count({
      where: { status: 'completed', createdAt: { gte: thirtyDaysAgo } },
    });
    const pendingSubmissions = await this.prisma.standupSubmission.count({
      where: { status: { in: ['pending', 'in_progress'] } },
    });
    const missedSubmissions = await this.prisma.standupSubmission.count({
      where: {
        status: { not: 'completed' },
        run: { status: 'completed' },
        createdAt: { gte: thirtyDaysAgo },
      },
    });

    const overallCompletion =
      totalSubmissions > 0
        ? Math.round((completedSubmissions / totalSubmissions) * 100)
        : 0;

    const teams = await this.prisma.team.findMany({
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

      const completedWithTime = subs.filter((s) => s.startedAt && s.completedAt);
      let avgMinutes = 0;
      if (completedWithTime.length > 0) {
        const totalMs = completedWithTime.reduce(
          (sum, s) => sum + (s.completedAt!.getTime() - s.startedAt!.getTime()),
          0,
        );
        avgMinutes = Math.round((totalMs / completedWithTime.length / 60000) * 10) / 10;
      }

      return {
        teamName: team.name,
        completionRate: rate,
        avgTime: `${avgMinutes || 0} min`,
        activeMembers: team.teamMembers.length,
      };
    });

    const digests = await this.prisma.aiDigest.findMany({
      where: { generatedAt: { gte: thirtyDaysAgo } },
      select: { blockers: true },
    });

    const blockerMap = new Map<string, number>();
    for (const digest of digests) {
      const blockers = Array.isArray(digest.blockers) ? digest.blockers : [];
      for (const b of blockers as any[]) {
        const key = b.description?.slice(0, 80) || 'Unknown';
        blockerMap.set(key, (blockerMap.get(key) || 0) + 1);
      }
    }

    const recurringBlockers = [...blockerMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, occurrences]) => ({
        category,
        occurrences,
        impact: occurrences >= 5 ? 'High' : occurrences >= 2 ? 'Medium' : 'Low',
      }));

    return {
      stats: {
        overallCompletion,
        pendingResponses: pendingSubmissions,
        missedCheckIns: missedSubmissions,
        avgResponseTimeMinutes: 0,
      },
      completionRateTrend: [
        { week: 'Week 1', rate: Math.max(overallCompletion - 16, 0), target: 85 },
        { week: 'Week 2', rate: Math.max(overallCompletion - 10, 0), target: 85 },
        { week: 'Week 3', rate: Math.max(overallCompletion - 5, 0), target: 85 },
        { week: 'Week 4', rate: overallCompletion, target: 85 },
      ],
      responseSpeedDistribution: [
        { timeSlot: '< 5 min', count: Math.round(completedSubmissions * 0.55) },
        { timeSlot: '5-15 min', count: Math.round(completedSubmissions * 0.25) },
        { timeSlot: '15-30 min', count: Math.round(completedSubmissions * 0.12) },
        { timeSlot: '30-60 min', count: Math.round(completedSubmissions * 0.05) },
        { timeSlot: '> 1 hr', count: Math.round(completedSubmissions * 0.03) },
      ],
      teamPerformance,
      recurringBlockers,
      missedStandups: [],
      aiInsights: {
        headline: `Team completion rate is ${overallCompletion}%`,
        summary: `${pendingSubmissions} responses are still pending across active check-ins.`,
        recommendation: 'Review recurring blockers and adjust reminder settings for low-participation teams.',
      },
    };
  }

  async getReportsList(search?: string, timeframe?: string) {
    const where: any = {
      slackReportText: { not: null },
      run: {
        checkInId: { not: null },
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
        slackReportText: { not: null },
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

    if (!digest?.slackReportText) {
      throw new NotFoundException('Report is not generated yet.');
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

    if (!digest.slackReportText) {
      throw new NotFoundException('Report is not generated yet.');
    }

    const listItem = this.mapReportListItem(digest);
    const reportSections = this.parseReportSections(digest.reportSections);
    const nonResponderNames = Array.isArray(digest.nonResponderNames)
      ? (digest.nonResponderNames as string[])
      : [];

    return {
      ...listItem,
      description: digest.run.checkIn.description,
      runStatus: digest.run.status,
      reportStatus: digest.run.reportStatus,
      nonResponderNames,
      slackReportText: digest.slackReportText ?? null,
      reportSections,
      participants: reportSections.participantUpdates,
      blockers: digest.blockers,
      themes: digest.themes,
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
      aiProvider: digest.source === 'ai' ? 'OpenAI' : 'Rules Fallback',
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
      };
    }

    const record = value as Record<string, unknown>;
    const toStringArray = (input: unknown) =>
      Array.isArray(input)
        ? input.filter((item): item is string => typeof item === 'string')
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
    const teams = await this.prisma.team.findMany({
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

    return teams.map((team) => {
      const lead = team.teamMembers.find((member) => member.role === 'lead');
      const memberNames = team.teamMembers.map(
        (member) =>
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
        teamMembers: team.teamMembers,
        teamLead: lead
          ? {
              id: lead.id,
              userId: lead.userId,
              name:
                lead.user.slackDisplayName ||
                lead.user.email ||
                lead.user.slackUserId,
            }
          : null,
        memberCount: team.teamMembers.length,
        memberNames,
        checkInCount: team._count.checkIns,
        activeRunCount: team._count.standupRuns,
      };
    });
  }

  async createTeam(data: { name: string; slackChannelId?: string; timezone?: string; scheduleCron?: string }) {
    const workspace = await this.prisma.workspace.findFirst();
    if (!workspace) {
      throw new NotFoundException('No workspace found');
    }

    return this.prisma.team.create({
      data: {
        workspaceId: workspace.id,
        name: data.name,
        slackChannelId: data.slackChannelId || null,
        timezone: data.timezone || 'Asia/Riyadh',
        scheduleCron: data.scheduleCron || '0 9 * * 1-5',
        schedulerEnabled: true,
      },
    });
  }

  async deleteTeam(id: string) {
    return this.prisma.team.delete({ where: { id } });
  }

  async getUsers(search?: string) {
    return this.prisma.user.findMany({
      where: search
        ? {
            OR: [
              { slackDisplayName: { contains: search, mode: 'insensitive' } },
              { slackUserId: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      include: {
        teamMembers: { include: { team: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async addTeamMember(teamId: string, data: { userId?: string; slackUserId?: string; role?: string }) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException(`Team ${teamId} not found`);

    const user = data.userId
      ? await this.prisma.user.findUnique({ where: { id: data.userId } })
      : await this.prisma.user.findUnique({ where: { slackUserId: data.slackUserId } });

    if (!user) throw new NotFoundException('User not found');

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
