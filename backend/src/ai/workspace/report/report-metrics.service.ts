import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';

import {

  ReportTimeRange,

  WorkspaceReportType,

} from '../types/workspace-ai.types';

import { WorkspaceAnalyticsService } from '../../../analytics/workspace-analytics.service';

import { AnalyticsTimeRange } from '../../../analytics/workspace-analytics.types';

import { workspaceBlockerFilter } from '../../../common/workspace-context';

import { WorkspaceMembersService } from '../../../common/workspace-members.service';

import { resolveAllSlackIdsInText } from '../../../common/slack-member.util';



export type ReportMetricsBundle = {

  workspaceId: string;

  workspaceName: string;

  reportType: WorkspaceReportType;

  timeRange: ReportTimeRange;

  userFocus: string | null;

  sourcesUsed: string[];

  dataPoints: number;

  participation: {

    expectedParticipants: number;

    completedSubmissions: number;

    pendingSubmissions: number;

    participationRate: number | null;

    responders: string[];

    nonResponders: string[];

  };

  standups: {

    runsInRange: number;

    completedAnswers: number;

    highlights: Array<{

      user: string;

      standup: string;

      completedAt: string | null;

      answers: string[];

    }>;

  };

  jira: {

    totalCachedIssues: number;

    issuesUpdatedInRange: number;

    doneLikeCount: number;

    inProgressCount: number;

    todoLikeCount: number;

    byStatus: Record<string, number>;

    sampleIssues: Array<{

      key: string;

      summary: string;

      status: string | null;

      assignee: string | null;

      updatedAt: string | null;

    }>;

    note: string;

  };

  blockers: {

    openCount: number;

    createdInRange: number;

    resolvedInRange: number;

    updatesInRange: number;

    active: Array<{

      title: string;

      status: string;

      severity: string;

      reporter: string;

      linkedIssueKey: string | null;

    }>;

    recentlyResolved: Array<{

      title: string;

      resolvedAt: string | null;

      reporter: string;

    }>;

  };

  digests: {

    count: number;

    summaries: Array<{ title: string; summary: string; createdAt: string }>;

  };

  risks: string[];

};



function startOfDay(date: Date): Date {

  const d = new Date(date);

  d.setHours(0, 0, 0, 0);

  return d;

}



function endOfDay(date: Date): Date {

  const d = new Date(date);

  d.setHours(23, 59, 59, 999);

  return d;

}



/**

 * Report metrics facade — delegates numeric aggregation to WorkspaceAnalyticsService.

 */

@Injectable()

export class ReportMetricsService {

  private readonly logger = new Logger(ReportMetricsService.name);



  constructor(

    private readonly prisma: PrismaService,

    private readonly analytics: WorkspaceAnalyticsService,

    private readonly workspaceMembers: WorkspaceMembersService,

  ) {}



  resolveTimeRange(

    reportType: WorkspaceReportType,

    now = new Date(),

  ): ReportTimeRange {

    if (reportType === WorkspaceReportType.WEEKLY) {

      const from = startOfDay(new Date(now));

      from.setDate(from.getDate() - 6);

      const to = endOfDay(now);

      return {

        from: from.toISOString(),

        to: to.toISOString(),

        label: 'Last 7 days',

      };

    }



    if (

      reportType === WorkspaceReportType.SPRINT ||

      reportType === WorkspaceReportType.EXECUTIVE

    ) {

      const from = startOfDay(new Date(now));

      from.setDate(from.getDate() - 13);

      const to = endOfDay(now);

      return {

        from: from.toISOString(),

        to: to.toISOString(),

        label:

          reportType === WorkspaceReportType.EXECUTIVE

            ? 'Last 14 days (executive window)'

            : 'Last 14 days (sprint window)',

      };

    }



    const from = startOfDay(now);

    const to = endOfDay(now);

    return {

      from: from.toISOString(),

      to: to.toISOString(),

      label: reportType === WorkspaceReportType.PERSONAL ? 'Today' : 'Today',

    };

  }



  async collect(params: {

    workspaceId: string;

    reportType: WorkspaceReportType;

    timeRange: ReportTimeRange;

    userQuery?: string | null;

  }): Promise<ReportMetricsBundle> {

    const { workspaceId, reportType, timeRange } = params;

    const from = new Date(timeRange.from);

    const to = new Date(timeRange.to);

    const userFocus = params.userQuery?.trim() || null;



    this.logger.log(

      `Collecting report metrics via WorkspaceAnalyticsService type=${reportType} range=${timeRange.label}`,

    );



    const analyticsRange: AnalyticsTimeRange = {

      from: timeRange.from,

      to: timeRange.to,

      label: timeRange.label,

    };



    const snapshot = await this.analytics.collectSnapshot({

      workspaceId,

      timeRange: analyticsRange,

      refreshJira: true,

    });



    const userWhere = userFocus

      ? {

          workspaceId,

          OR: [

            {

              slackDisplayName: {

                contains: userFocus,

                mode: 'insensitive' as const,

              },

            },

            { email: { contains: userFocus, mode: 'insensitive' as const } },

          ],

        }

      : { workspaceId };



    const submissions = await this.prisma.standupSubmission.findMany({

      where: {

        user: userWhere,

        OR: [

          { completedAt: { gte: from, lte: to } },

          { completedAt: null, createdAt: { gte: from, lte: to } },

        ],

      },

      include: {

        user: { select: { slackDisplayName: true } },

        answers: {

          include: { question: { select: { question: true } } },

          orderBy: { createdAt: 'asc' },

        },

        run: {

          include: { checkIn: { select: { name: true } } },

        },

      },

      orderBy: { completedAt: 'desc' },

      take: 200,

    });



    const completed = submissions.filter((s) => s.status === 'completed');

    const pending = submissions.filter((s) => s.status !== 'completed');

    const responders = [

      ...new Set(completed.map((s) => s.user.slackDisplayName)),

    ];



    const expectedNames = Object.keys(snapshot.team.completionByMember);

    const nonResponders = expectedNames.filter(

      (name) => !responders.includes(name),

    );



    const highlights = completed.slice(0, 25).map((submission) => ({

      user: submission.user.slackDisplayName,

      standup: submission.run.checkIn?.name ?? 'Standup',

      completedAt: submission.completedAt?.toISOString() ?? null,

      answers: submission.answers.map(

        (a) => `Q: ${a.question.question} → A: ${a.text.trim()}`,

      ),

    }));



    const digests = await this.prisma.aiDigest.findMany({

      where: {

        team: { workspaceId },

        createdAt: { gte: from, lte: to },

      },

      include: {

        run: { include: { checkIn: { select: { name: true } } } },

        team: { select: { name: true } },

      },

      orderBy: { createdAt: 'desc' },

      take: 20,

    });



    const resolvedRows = await this.prisma.pulseBlocker.findMany({

      where: {

        ...workspaceBlockerFilter(workspaceId),

        resolvedAt: { gte: from, lte: to },

      },

      include: { user: { select: { slackDisplayName: true } } },

      orderBy: { resolvedAt: 'desc' },

      take: 15,

    });



    const todoLikeCount = Math.max(

      0,

      snapshot.jira.openIssues -

        snapshot.jira.inProgressIssues -

        snapshot.jira.blockedIssues,

    );



    const risks: string[] = [];

    if (snapshot.blockers.openBlockers > 0) {

      risks.push(

        `${snapshot.blockers.openBlockers} active blocker(s) still open`,

      );

    }

    if (

      snapshot.standups.participationRate != null &&

      snapshot.standups.participationRate < 70

    ) {

      risks.push(

        `Participation is ${snapshot.standups.participationRate}% (${nonResponders.length} expected member(s) missing standup)`,

      );

    }

    if (

      snapshot.jira.inProgressIssues > 0 &&

      snapshot.jira.closedIssues === 0 &&

      snapshot.jira.totalIssues > 0

    ) {

      risks.push('Jira shows in-progress work but no done-like issues');

    }

    if (completed.length === 0 && reportType !== WorkspaceReportType.JIRA) {

      risks.push('No completed standup submissions found in this time range');

    }



    const nameMap = await this.workspaceMembers.buildReportNameMap(workspaceId);

    const resolvedHighlights = highlights.map((highlight) => ({

      ...highlight,

      answers: highlight.answers.map((answer) =>

        resolveAllSlackIdsInText(answer, nameMap),

      ),

    }));

    const resolvedDigestSummaries = digests.map((digest) => ({

      title: `${digest.run.checkIn?.name ?? 'Standup'} — ${digest.team.name}`,

      summary: resolveAllSlackIdsInText(

        digest.summary?.slice(0, 400) || '(empty digest)',

        nameMap,

      ),

      createdAt: digest.createdAt.toISOString(),

    }));

    const resolvedRisks = risks.map((risk) =>

      resolveAllSlackIdsInText(risk, nameMap),

    );



    const dataPoints =

      completed.length +

      snapshot.jira.totalIssues +

      snapshot.blockers.total +

      digests.length +

      snapshot.standups.runsInRange +

      snapshot.blockers.updatesInRange;



    const jiraNote = snapshot.liveJiraRefresh.success

      ? 'Jira metrics from JiraIssueCacheEntry refreshed via Live Jira API before report generation.'

      : snapshot.liveJiraRefresh.attempted

        ? 'Live Jira refresh attempted but returned no issues — metrics use last known cache.'

        : 'Jira metrics from JiraIssueCacheEntry (no Live Jira connection for this workspace).';



    return {

      workspaceId,

      workspaceName: snapshot.workspaceName,

      reportType,

      timeRange,

      userFocus,

      sourcesUsed: [

        'WorkspaceAnalyticsService',

        'StandupSubmission',

        'PulseBlocker (JiraBlockerService)',

        'JiraIssueCacheEntry',

        'Team participation',

        'Slack standup answers',

        ...(snapshot.liveJiraRefresh.success ? ['Live Jira API refresh'] : []),

      ],

      dataPoints,

      participation: {

        expectedParticipants: snapshot.members.activeParticipants,

        completedSubmissions: snapshot.standups.completedSubmissions,

        pendingSubmissions: pending.length,

        participationRate: snapshot.standups.participationRate,

        responders,

        nonResponders: nonResponders.slice(0, 50),

      },

      standups: {

        runsInRange: snapshot.standups.runsInRange,

        completedAnswers: completed.reduce(

          (sum, s) => sum + s.answers.length,

          0,

        ),

        highlights: resolvedHighlights,

      },

      jira: {

        totalCachedIssues: snapshot.jira.totalIssues,

        issuesUpdatedInRange: snapshot.jira.issuesUpdatedInRange,

        doneLikeCount: snapshot.jira.closedIssues,

        inProgressCount: snapshot.jira.inProgressIssues,

        todoLikeCount,

        byStatus: snapshot.jira.byStatus,

        sampleIssues: snapshot.jira.sampleIssues.map((issue) => ({

          key: issue.key,

          summary: issue.summary,

          status: issue.status,

          assignee: issue.assignee,

          updatedAt: issue.updatedAt,

        })),

        note: jiraNote,

      },

      blockers: {

        openCount: snapshot.blockers.openBlockers,

        createdInRange: snapshot.blockers.createdInRange,

        resolvedInRange: snapshot.blockers.resolvedInRange,

        updatesInRange: snapshot.blockers.updatesInRange,

        active: snapshot.blockers.active,

        recentlyResolved: resolvedRows.map((b) => ({

          title: b.title?.trim() || b.description.slice(0, 80),

          resolvedAt: b.resolvedAt?.toISOString() ?? null,

          reporter: b.user.slackDisplayName,

        })),

      },

      digests: {

        count: digests.length,

        summaries: resolvedDigestSummaries,

      },

      risks: resolvedRisks,

    };

  }

}


