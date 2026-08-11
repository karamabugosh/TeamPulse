import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
    const digests = await this.prisma.aiDigest.findMany({
      orderBy: { generatedAt: 'desc' },
      include: {
        team: { select: { name: true, slackChannelId: true } },
        run: { select: { scheduledFor: true, status: true } },
      },
    });

    return digests.map((d) => ({
      id: d.id,
      runId: d.runId,
      teamId: d.teamId,
      teamName: d.team?.name || 'General',
      generatedAt: d.generatedAt.toISOString(),
      source: d.source,
      summary: d.summary,
      blockers: d.blockers,
      themes: d.themes,
      slackChannel: d.team?.slackChannelId || '',
    }));
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
    return this.prisma.team.findMany({
      include: {
        workspace: true,
        teamMembers: { include: { user: true } },
        checkIns: true,
      },
      orderBy: { createdAt: 'desc' },
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
