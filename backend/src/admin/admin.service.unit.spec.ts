import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { QuestionType } from '@prisma/client';
import { WorkspaceAnalyticsSnapshot } from '../analytics/workspace-analytics.types';
import { WorkspaceAnalyticsService } from '../analytics/workspace-analytics.service';
import { WorkspaceMembersService } from '../common/workspace-members.service';
import { PrismaService } from '../prisma/prisma.service';
import { SlackMemberCacheService } from '../slack/slack-member-cache.service';
import { AdminService } from './admin.service';

jest.mock('../common/workspace-context', () => ({
  resolveActiveWorkspaceId: jest.fn(),
  workspaceCheckInFilter: jest.fn((workspaceId: string) => ({
    team: { workspaceId },
  })),
  workspaceDigestFilter: jest.fn((workspaceId: string) => ({
    team: { workspaceId },
  })),
  workspaceRunFilter: jest.fn((workspaceId: string) => ({
    team: { workspaceId },
  })),
  workspaceSubmissionFilter: jest.fn((workspaceId: string) => ({
    run: { team: { workspaceId } },
  })),
  workspaceTeamFilter: jest.fn((workspaceId: string) => ({ workspaceId })),
  workspaceUserFilter: jest.fn((workspaceId: string) => ({ workspaceId })),
}));

jest.mock('../common/slack-member.util', () => {
  const actual = jest.requireActual<typeof import('../common/slack-member.util')>(
    '../common/slack-member.util',
  );
  return {
    ...actual,
    isUsableSlackBotToken: jest.fn(),
    isPlaceholderSlackUser: jest.fn(),
    lookupSlackDisplayName: jest.fn(),
    resolveAllSlackIdsInText: jest.fn(),
  };
});

import { resolveActiveWorkspaceId } from '../common/workspace-context';
import {
  isPlaceholderSlackUser,
  isUsableSlackBotToken,
  lookupSlackDisplayName,
  resolveAllSlackIdsInText,
} from '../common/slack-member.util';

const resolveWorkspaceIdMock = resolveActiveWorkspaceId as jest.MockedFunction<
  typeof resolveActiveWorkspaceId
>;
const isUsableSlackBotTokenMock = isUsableSlackBotToken as jest.MockedFunction<
  typeof isUsableSlackBotToken
>;
const isPlaceholderSlackUserMock = isPlaceholderSlackUser as jest.MockedFunction<
  typeof isPlaceholderSlackUser
>;
const lookupSlackDisplayNameMock = lookupSlackDisplayName as jest.MockedFunction<
  typeof lookupSlackDisplayName
>;
const resolveAllSlackIdsInTextMock = resolveAllSlackIdsInText as jest.MockedFunction<
  typeof resolveAllSlackIdsInText
>;

function makeAnalyticsSnapshot(
  overrides: Partial<WorkspaceAnalyticsSnapshot> = {},
): WorkspaceAnalyticsSnapshot {
  return {
    workspaceId: 'ws-1',
    workspaceName: 'Acme',
    generatedAt: '2024-06-01T12:00:00.000Z',
    generationMs: 42,
    timeRange: { from: '2024-05-01', to: '2024-06-01', label: '30d' },
    queriesExecuted: ['standups'],
    liveJiraRefresh: {
      attempted: true,
      success: true,
      issuesRefreshed: 3,
    },
    members: { total: 10, activeParticipants: 8 },
    standups: {
      totalSubmissions: 20,
      completedSubmissions: 16,
      pendingSubmissions: 2,
      missedSubmissions: 2,
      participationRate: 80,
      runsInRange: 5,
      dailyActivity: [],
      weeklyTrend: [
        { weekLabel: 'Week 1', completed: 8, total: 10, rate: 80 },
        { weekLabel: 'Week 2', completed: 8, total: 10, rate: 80 },
      ],
    },
    blockers: {
      openBlockers: 3,
      critical: 1,
      waitingMoreThan3Days: 1,
      resolvedThisWeek: 2,
      total: 5,
      resolved: 2,
      createdInRange: 1,
      resolvedInRange: 1,
      updatesInRange: 2,
      active: [
        {
          title: 'API outage',
          status: 'open',
          severity: 'critical',
          reporter: 'Alice',
          linkedIssueKey: 'SCRUM-1',
        },
        {
          title: 'Waiting on design',
          status: 'open',
          severity: 'medium',
          reporter: 'Bob',
          linkedIssueKey: null,
        },
      ],
      byOwner: { Alice: 3, Bob: 2 },
      byIssue: { 'SCRUM-1': 1 },
    },
    jira: {
      totalIssues: 12,
      openIssues: 4,
      closedIssues: 8,
      inProgressIssues: 3,
      blockedIssues: 1,
      issuesUpdatedInRange: 2,
      byStatus: {},
      byPriority: {},
      byAssignee: {},
      sampleIssues: [],
      fromLiveRefresh: true,
    },
    team: {
      mostActiveMember: 'Alice',
      leastActiveMember: 'Bob',
      completionByMember: {},
    },
    ...overrides,
  };
}

function makeDigestRow(overrides: Record<string, unknown> = {}) {
  const startedAt = new Date('2024-06-01T09:00:00.000Z');
  const scheduledFor = new Date('2024-06-01T08:55:00.000Z');
  return {
    id: 'digest-1',
    runId: 'run-1',
    teamId: 'team-1',
    generatedAt: new Date('2024-06-01T10:00:00.000Z'),
    source: 'ai',
    summary: 'Team made strong progress on the release.',
    blockers: [
      { userId: 'U1', description: 'Blocked on deploy', severity: 'high' },
    ],
    themes: [{ theme: 'Release', summary: 'Shipping soon', mentionCount: 2 }],
    reportSections: {
      keyAccomplishments: ['Shipped feature X'],
      risks: ['Deploy risk'],
      aiInsights: ['Velocity is up'],
      actionItems: ['Review deploy checklist'],
      overallProgress: 'Good momentum',
      participantUpdates: [
        {
          slackUserId: 'U1',
          displayName: 'Alice',
          answers: [{ question: 'Yesterday?', answer: 'Built API' }],
        },
      ],
    },
    slackReportText: 'Report for <@U1>',
    generationError: null,
    nonResponderNames: ['Charlie'],
    team: {
      id: 'team-1',
      name: 'Platform',
      workspaceId: 'ws-1',
      workspace: {
        slackWorkspaceId: 'T123',
        slackWorkspaceName: 'Acme',
      },
    },
    run: {
      id: 'run-1',
      scheduledFor,
      startedAt,
      completedAt: new Date('2024-06-01T10:30:00.000Z'),
      status: 'completed',
      reportGeneratedAt: new Date('2024-06-01T10:05:00.000Z'),
      reportStatus: 'posted',
      slackChannelId: 'C123',
      slackThreadTs: '1234.5678',
      checkIn: {
        id: 'checkin-1',
        name: 'Daily Standup',
        timezone: 'Asia/Riyadh',
        description: 'Morning sync',
      },
      submissions: [
        {
          id: 'sub-1',
          status: 'completed',
          completedAt: new Date('2024-06-01T09:30:00.000Z'),
          updatedAt: new Date('2024-06-01T09:30:00.000Z'),
          user: {
            id: 'user-1',
            slackUserId: 'U1',
            slackDisplayName: 'Alice',
          },
          answers: [
            {
              id: 'ans-1',
              text: 'yes',
              questionId: 'q-1',
              structuredValue: { value: 'yes' },
              createdAt: new Date('2024-06-01T09:10:00.000Z'),
              question: {
                question: 'Any blockers?',
                type: QuestionType.YES_NO,
                order: 1,
              },
            },
            {
              id: 'ans-2',
              text: '4',
              questionId: 'q-2',
              structuredValue: { value: 4 },
              createdAt: new Date('2024-06-01T09:11:00.000Z'),
              question: {
                question: 'Confidence?',
                type: QuestionType.SCALE_1_5,
                order: 2,
              },
            },
          ],
          jiraIssueLinks: [],
        },
        {
          id: 'sub-2',
          status: 'pending',
          completedAt: null,
          updatedAt: new Date('2024-06-01T09:00:00.000Z'),
          user: {
            id: 'user-2',
            slackUserId: 'U2',
            slackDisplayName: 'Bob',
          },
          answers: [],
          jiraIssueLinks: [],
        },
      ],
    },
    ...overrides,
  };
}

type PrismaMock = {
  workspace: {
    findMany: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    findFirst: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    findUnique: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
  };
  checkIn: {
    count: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    findMany: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    findUnique: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
  };
  team: {
    count: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    findMany: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    create: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    findUnique: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    delete: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
  };
  standupSubmission: {
    count: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    findMany: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
  };
  aiDigest: {
    count: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    findMany: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    findFirst: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    findUnique: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
  };
  standupRun: {
    findMany: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
  };
  user: {
    findMany: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    findUnique: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    count: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
  };
  teamMember: {
    findMany: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    findFirst: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    upsert: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    delete: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
    update: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
  };
  answer: {
    findMany: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
  };
  $queryRaw: jest.MockedFunction<(args?: unknown) => Promise<unknown>>;
};

function createPrismaMock(): PrismaMock {
  return {
    workspace: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    checkIn: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    team: {
      count: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    standupSubmission: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    aiDigest: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    standupRun: {
      findMany: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    teamMember: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      update: jest.fn(),
    },
    answer: {
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
}

function setupOverviewDefaults(prisma: PrismaMock) {
  prisma.checkIn.count.mockResolvedValue(2);
  prisma.team.count.mockResolvedValue(3);
  prisma.standupSubmission.count
    .mockResolvedValueOnce(10)
    .mockResolvedValueOnce(8)
    .mockResolvedValueOnce(1);
  prisma.aiDigest.count.mockResolvedValue(1);
  prisma.standupSubmission.findMany.mockImplementation(async (args?: {
    where?: { status?: string; startedAt?: unknown };
  }) => {
    if (args?.where?.startedAt) {
      return [
        {
          startedAt: new Date('2024-06-01T09:00:00.000Z'),
          completedAt: new Date('2024-06-01T09:10:00.000Z'),
        },
      ];
    }
    if (args?.where?.status === 'completed') {
      return [
        {
          id: 'sub-1',
          completedAt: new Date('2024-06-01T09:30:00.000Z'),
          updatedAt: new Date('2024-06-01T09:30:00.000Z'),
          user: { slackDisplayName: 'Alice' },
          run: { team: { name: 'Platform' } },
        },
      ];
    }
    return [];
  });
  prisma.standupSubmission.count.mockImplementation(async () => 0);
  prisma.aiDigest.findMany.mockResolvedValue([
    {
      id: 'd-1',
      generatedAt: new Date('2024-06-01T11:00:00.000Z'),
      team: { name: 'Platform' },
    },
  ]);
  prisma.standupRun.findMany.mockResolvedValue([
    {
      id: 'run-1',
      startedAt: new Date('2024-06-01T09:00:00.000Z'),
      status: 'completed',
      team: { name: 'Platform' },
      checkIn: { name: 'Daily' },
    },
  ]);
  prisma.checkIn.findMany.mockResolvedValue([
    {
      id: 'ci-1',
      name: 'Daily',
      collectionCron: '0 9 * * 1-5',
      timezone: 'Asia/Riyadh',
      team: { name: 'Platform' },
    },
  ]);
  prisma.aiDigest.findFirst.mockResolvedValue({
    summary: 'Strong progress',
    reportSections: {
      aiInsights: ['Velocity improved'],
      actionItems: ['Ship release'],
      overallProgress: 'On track',
    },
  });
}

describe('AdminService', () => {
  let service: AdminService;
  let prisma: PrismaMock;
  let workspaceMembers: {
    buildReportNameMap: jest.MockedFunction<
      (workspaceId: string, participants: unknown[]) => Promise<Map<string, string>>
    >;
    listHumanMembers: jest.MockedFunction<
      (workspaceId: string, opts?: { search?: string }) => Promise<unknown[]>
    >;
    invalidateWorkspace: jest.MockedFunction<(workspaceId: string) => void>;
  };
  let slackMemberCache: {
    syncFromLive: jest.MockedFunction<
      (workspaceId: string) => Promise<{ humans: unknown[]; synced: number }>
    >;
  };
  let workspaceAnalytics: {
    collectSnapshot: jest.MockedFunction<
      (params: { workspaceId: string; refreshJira?: boolean }) => Promise<WorkspaceAnalyticsSnapshot>
    >;
    getBlockerStats: jest.MockedFunction<
      (workspaceId: string) => Promise<{ openBlockers: number }>
    >;
  };

  beforeEach(async () => {
    resolveWorkspaceIdMock.mockReset();
    isUsableSlackBotTokenMock.mockReset();
    isPlaceholderSlackUserMock.mockReset();
    lookupSlackDisplayNameMock.mockReset();
    resolveAllSlackIdsInTextMock.mockReset();

    resolveWorkspaceIdMock.mockResolvedValue('ws-1');
    isUsableSlackBotTokenMock.mockReturnValue(false);
    isPlaceholderSlackUserMock.mockReturnValue(false);
    lookupSlackDisplayNameMock.mockImplementation(
      (userId: string, nameMap: Map<string, string>) =>
        nameMap.get(userId) ?? 'Resolved Name',
    );
    resolveAllSlackIdsInTextMock.mockImplementation(
      (text: string, nameMap: Map<string, string>) =>
        text.replace(/<@(\w+)>/g, (_match, id: string) => nameMap.get(id) ?? id),
    );

    prisma = createPrismaMock();
    workspaceMembers = {
      buildReportNameMap: jest.fn(),
      listHumanMembers: jest.fn(),
      invalidateWorkspace: jest.fn(),
    };
    slackMemberCache = {
      syncFromLive: jest.fn(),
    };
    workspaceAnalytics = {
      collectSnapshot: jest.fn(),
      getBlockerStats: jest.fn(),
    };

    workspaceAnalytics.collectSnapshot.mockResolvedValue(makeAnalyticsSnapshot());
    workspaceAnalytics.getBlockerStats.mockResolvedValue({ openBlockers: 2 });
    workspaceMembers.buildReportNameMap.mockResolvedValue(
      new Map([['U1', 'Alice Resolved']]),
    );
    workspaceMembers.listHumanMembers.mockResolvedValue([
      { id: 'user-1', slackUserId: 'U1' },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: WorkspaceMembersService, useValue: workspaceMembers },
        { provide: SlackMemberCacheService, useValue: slackMemberCache },
        { provide: WorkspaceAnalyticsService, useValue: workspaceAnalytics },
      ],
    }).compile();

    service = module.get(AdminService);
  });

  describe('listWorkspaces', () => {
    it('maps workspace rows with counts and plan', async () => {
      prisma.workspace.findMany.mockResolvedValue([
        {
          id: 'ws-1',
          slackWorkspaceId: 'T123',
          slackWorkspaceName: 'Acme',
          installedAt: new Date('2024-01-01T00:00:00.000Z'),
          _count: { users: 5, teams: 2 },
        },
      ]);

      const result = await service.listWorkspaces();

      expect(result).toEqual([
        {
          id: 'ws-1',
          slackWorkspaceId: 'T123',
          name: 'Acme',
          installedAt: new Date('2024-01-01T00:00:00.000Z'),
          userCount: 5,
          teamCount: 2,
          plan: 'Pro',
        },
      ]);
    });
  });

  describe('getOverviewStats', () => {
    it('returns aggregated stats with workspace snapshot when workspace is active', async () => {
      setupOverviewDefaults(prisma);
      prisma.standupSubmission.count
        .mockReset()
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(1);
      for (let i = 0; i < 14; i += 1) {
        prisma.standupSubmission.count.mockResolvedValueOnce(5);
        prisma.standupSubmission.count.mockResolvedValueOnce(4);
      }
      prisma.standupRun.findMany
        .mockResolvedValueOnce([
          {
            id: 'run-1',
            startedAt: new Date('2024-06-01T09:00:00.000Z'),
            status: 'completed',
            team: { name: 'Platform' },
            checkIn: { name: 'Daily' },
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'run-1',
            startedAt: new Date('2024-06-01T09:00:00.000Z'),
            status: 'completed',
            checkInId: 'ci-1',
            checkIn: { name: 'Daily' },
            submissions: [
              {
                id: 's1',
                status: 'completed',
                user: { slackUserId: 'U1', slackDisplayName: 'Alice' },
              },
              {
                id: 's2',
                status: 'completed',
                user: { slackUserId: 'U2', slackDisplayName: 'Bob' },
              },
            ],
            aiDigest: {
              summary: 'Good week',
              source: 'ai',
              blockers: [
                { userId: 'U1', description: 'Deploy blocked', severity: 'high' },
              ],
              themes: [],
              reportSections: {
                aiInsights: ['Insight'],
                risks: [],
                keyAccomplishments: [],
                overallProgress: 'Progress',
                actionItems: [],
              },
            },
          },
          {
            id: 'run-0',
            startedAt: new Date('2024-05-31T09:00:00.000Z'),
            status: 'completed',
            checkInId: 'ci-1',
            checkIn: { name: 'Daily' },
            submissions: [
              {
                id: 's3',
                status: 'completed',
                user: { slackUserId: 'U1', slackDisplayName: 'Alice' },
              },
            ],
            aiDigest: {
              summary: 'Earlier run',
              source: 'ai',
              blockers: [
                { userId: 'U1', description: 'Deploy blocked', severity: 'high' },
              ],
              themes: [],
              reportSections: {
                aiInsights: [],
                risks: [],
                keyAccomplishments: [],
                overallProgress: '',
                actionItems: [],
              },
            },
          },
        ]);
      prisma.user.findMany.mockResolvedValue([
        { slackUserId: 'U1', slackDisplayName: 'Alice' },
      ]);
      prisma.answer.findMany.mockResolvedValue([
        {
          text: 'blocked on deploy',
          structuredValue: { value: 'yes' },
          question: { question: 'Any blockers?', type: QuestionType.YES_NO },
          user: { slackUserId: 'U1', slackDisplayName: 'Alice' },
          submission: {
            run: {
              id: 'run-1',
              checkIn: { name: 'Daily' },
            },
          },
        },
        {
          text: '4',
          structuredValue: { value: 4 },
          question: { question: 'Confidence?', type: QuestionType.SCALE_1_5 },
          user: { slackUserId: 'U2', slackDisplayName: 'Bob' },
          submission: {
            run: {
              id: 'run-1',
              checkIn: { name: 'Daily' },
            },
          },
        },
        {
          text: '3',
          structuredValue: null,
          question: { question: 'Confidence follow-up?', type: QuestionType.SCALE_1_5 },
          user: { slackUserId: 'U2', slackDisplayName: 'Bob' },
          submission: {
            run: {
              id: 'run-1',
              checkIn: { name: 'Daily' },
            },
          },
        },
      ]);

      const result = await service.getOverviewStats();

      expect(result.stats.activeCheckIns).toBe(2);
      expect(result.stats.completionRate).toBe(80);
      expect(result.stats.openBlockers).toBe(3);
      expect(result.weeklyParticipation).toHaveLength(7);
      expect(result.completionTrend).toHaveLength(7);
      expect(result.topBlockers.length).toBeGreaterThan(0);
      expect(result.aiInsights).not.toBeNull();
      expect(result.aiAnalytics.available).toBe(true);
      expect(workspaceAnalytics.collectSnapshot).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        refreshJira: true,
      });
    });

    it('returns null snapshot fields when no workspace is active', async () => {
      resolveWorkspaceIdMock.mockResolvedValue(null);
      setupOverviewDefaults(prisma);
      prisma.standupSubmission.count.mockResolvedValue(0);
      prisma.standupRun.findMany.mockResolvedValue([]);
      prisma.aiDigest.findFirst.mockResolvedValue(null);

      const result = await service.getOverviewStats();

      expect(result.stats.openBlockers).toBeNull();
      expect(result.topBlockers).toEqual([]);
      expect(result.aiAnalytics.available).toBe(false);
      expect(workspaceAnalytics.collectSnapshot).not.toHaveBeenCalled();
    });

    it('returns null aiInsights when digest sections are placeholders', async () => {
      setupOverviewDefaults(prisma);
      prisma.standupSubmission.count.mockResolvedValue(0);
      prisma.standupRun.findMany.mockResolvedValue([]);
      prisma.aiDigest.findFirst.mockResolvedValue({
        summary: 'AI analysis is unavailable right now.',
        reportSections: {
          aiInsights: ['No additional insights.'],
          actionItems: ['No action items suggested.'],
          overallProgress: 'No substantive standup answers were available.',
        },
      });

      const result = await service.getOverviewStats();

      expect(result.aiInsights).toBeNull();
    });
  });

  describe('getAnalyticsData', () => {
    it('returns empty analytics when no workspace is selected', async () => {
      resolveWorkspaceIdMock.mockResolvedValue(null);

      const result = await service.getAnalyticsData();

      expect(result.stats.overallCompletion).toBe(0);
      expect(result.aiInsights.headline).toBe('No workspace selected');
      expect(workspaceAnalytics.collectSnapshot).not.toHaveBeenCalled();
    });

    it('returns analytics payload for active workspace', async () => {
      prisma.standupSubmission.findMany.mockResolvedValue([
        {
          startedAt: new Date('2024-06-01T09:00:00.000Z'),
          completedAt: new Date('2024-06-01T09:03:00.000Z'),
        },
        {
          startedAt: new Date('2024-06-01T09:00:00.000Z'),
          completedAt: new Date('2024-06-01T09:20:00.000Z'),
        },
        {
          startedAt: new Date('2024-06-01T09:00:00.000Z'),
          completedAt: new Date('2024-06-01T10:30:00.000Z'),
        },
      ]);
      prisma.team.findMany.mockResolvedValue([
        {
          name: 'Platform',
          teamMembers: [{ optedOut: false }, { optedOut: false }],
          standupRuns: [
            {
              submissions: [
                { status: 'completed' },
                { status: 'pending' },
              ],
            },
          ],
        },
      ]);

      const result = await service.getAnalyticsData();

      expect(result.stats.overallCompletion).toBe(80);
      expect(result.stats.openBlockers).toBe(3);
      expect(result.completionRateTrend).toHaveLength(2);
      expect(result.teamPerformance[0].teamName).toBe('Platform');
      expect(result.recurringBlockers[0].impact).toBe('Medium');
      expect(result.workspaceId).toBe('ws-1');
      expect(result.responseSpeedDistribution[0].count).toBe(1);
      expect(result.responseSpeedDistribution[2].count).toBe(1);
      expect(result.responseSpeedDistribution[4].count).toBe(1);
    });
  });

  describe('getAnalyticsSnapshot', () => {
    it('throws when no active workspace', async () => {
      resolveWorkspaceIdMock.mockResolvedValue(null);

      await expect(service.getAnalyticsSnapshot()).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('delegates to workspace analytics', async () => {
      const snapshot = makeAnalyticsSnapshot();
      workspaceAnalytics.collectSnapshot.mockResolvedValue(snapshot);

      const result = await service.getAnalyticsSnapshot();

      expect(result).toBe(snapshot);
      expect(workspaceAnalytics.collectSnapshot).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        refreshJira: true,
      });
    });
  });

  describe('reports', () => {
    const listDigest = makeDigestRow();

    beforeEach(() => {
      prisma.aiDigest.findMany.mockResolvedValue([listDigest]);
    });

    it('getReportsList filters by search and timeframe', async () => {
      const all = [
        listDigest,
        makeDigestRow({
          id: 'digest-2',
          summary: 'Different topic',
          run: {
            ...listDigest.run,
            checkIn: { id: 'checkin-2', name: 'Weekly Retro', timezone: 'UTC' },
          },
        }),
      ];
      prisma.aiDigest.findMany.mockResolvedValue(all);

      const filtered = await service.getReportsList('weekly', 'week');

      expect(filtered).toHaveLength(1);
      expect(filtered[0].checkInName).toBe('Weekly Retro');
      expect(prisma.aiDigest.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            generatedAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        }),
      );
    });

    it('getReportsGrouped groups by check-in', async () => {
      const grouped = await service.getReportsGrouped();

      expect(grouped).toHaveLength(1);
      expect(grouped[0].checkInId).toBe('checkin-1');
      expect(grouped[0].totalReports).toBe(1);
    });

    it('getReportsForCheckIn throws when check-in missing', async () => {
      prisma.checkIn.findUnique.mockResolvedValue(null);

      await expect(service.getReportsForCheckIn('missing')).rejects.toThrow(
        'CheckIn missing was not found.',
      );
    });

    it('getReportsForCheckIn returns mapped reports', async () => {
      prisma.checkIn.findUnique.mockResolvedValue({
        id: 'checkin-1',
        name: 'Daily Standup',
        team: { name: 'Platform' },
      });

      const result = await service.getReportsForCheckIn('checkin-1');

      expect(result.checkInName).toBe('Daily Standup');
      expect(result.reports).toHaveLength(1);
      expect(result.reports[0].completionRate).toBe(50);
    });

    it('getReportByRunId throws when report not generated', async () => {
      prisma.aiDigest.findUnique.mockResolvedValue({
        runId: 'run-1',
        slackReportText: null,
        generationError: null,
        source: 'ai',
        id: 'digest-1',
      });

      await expect(service.getReportByRunId('run-1')).rejects.toThrow(
        'Report is not generated yet.',
      );
    });

    it('getReportByRunId throws for non-ai source', async () => {
      prisma.aiDigest.findUnique.mockResolvedValue({
        runId: 'run-1',
        slackReportText: 'text',
        generationError: null,
        source: 'rules_fallback',
        id: 'digest-1',
      });

      await expect(service.getReportByRunId('run-1')).rejects.toThrow(
        'only AI-generated reports',
      );
    });

    it('getReportByRunId delegates to getReportDetail', async () => {
      const digest = makeDigestRow();
      prisma.aiDigest.findUnique
        .mockResolvedValueOnce({
          runId: 'run-1',
          slackReportText: 'text',
          generationError: null,
          source: 'ai',
          id: 'digest-1',
        })
        .mockResolvedValueOnce(digest);

      const result = await service.getReportByRunId('run-1');

      expect(result.id).toBe('digest-1');
      expect(workspaceMembers.buildReportNameMap).toHaveBeenCalled();
    });

    it('getReportDetail throws when report not found', async () => {
      prisma.aiDigest.findUnique.mockResolvedValue(null);

      await expect(service.getReportDetail('missing')).rejects.toThrow(
        'Report missing was not found.',
      );
    });

    it('getReportDetail throws when report not generated', async () => {
      prisma.aiDigest.findUnique.mockResolvedValue(
        makeDigestRow({
          slackReportText: null,
          generationError: null,
          source: 'ai',
        }),
      );

      await expect(service.getReportDetail('digest-1')).rejects.toThrow(
        'Report is not generated yet.',
      );
    });

    it('getReportDetail throws for unavailable non-ai report', async () => {
      prisma.aiDigest.findUnique.mockResolvedValue(
        makeDigestRow({
          source: 'rules_fallback',
          slackReportText: 'fallback',
          generationError: null,
        }),
      );

      await expect(service.getReportDetail('digest-1')).rejects.toThrow(
        'only AI-generated reports',
      );
    });

    it('getReportDetail returns enriched report with resolved slack names', async () => {
      prisma.aiDigest.findUnique.mockResolvedValue(makeDigestRow());

      const result = await service.getReportDetail('digest-1');

      expect(result.summary).toBeDefined();
      expect(result.participants).toHaveLength(1);
      expect(result.blockers[0].displayName).toBe('Alice Resolved');
      expect(resolveAllSlackIdsInTextMock).toHaveBeenCalled();
      expect(result.nonResponderNames).toEqual(['Charlie']);
    });

    it('getReportDetail works without workspace name map', async () => {
      const digest = makeDigestRow({
        team: {
          id: 'team-1',
          name: 'Platform',
          workspaceId: null,
          workspace: null,
        },
      });
      prisma.aiDigest.findUnique.mockResolvedValue(digest);

      const result = await service.getReportDetail('digest-1');

      expect(workspaceMembers.buildReportNameMap).not.toHaveBeenCalled();
      expect(result.blockers[0].displayName).toBe('Alice');
    });
  });

  describe('exportReportCsv', () => {
    it('throws when digest is missing', async () => {
      prisma.aiDigest.findUnique.mockResolvedValue(null);

      await expect(service.exportReportCsv('missing')).rejects.toThrow(
        'Report missing not found',
      );
    });

    it('escapes quotes in csv summary', async () => {
      prisma.aiDigest.findUnique.mockResolvedValue({
        id: 'digest-1',
        team: { name: 'Platform' },
        generatedAt: new Date('2024-06-01T10:00:00.000Z'),
        source: 'ai',
        summary: 'Said "hello"',
      });

      const csv = await service.exportReportCsv('digest-1');

      expect(csv).toContain('"Said ""hello"""');
      expect(csv.split('\n')).toHaveLength(2);
    });
  });

  describe('exportReportPdf', () => {
    it('throws when digest is missing', async () => {
      prisma.aiDigest.findUnique.mockResolvedValue(null);

      await expect(service.exportReportPdf('missing')).rejects.toThrow(
        'Report missing not found',
      );
    });

    it('returns formatted pdf text', async () => {
      prisma.aiDigest.findUnique.mockResolvedValue({
        id: 'digest-1',
        team: { name: 'Platform' },
        generatedAt: new Date('2024-06-01T10:00:00.000Z'),
        source: 'ai',
        summary: 'All good',
        blockers: [],
        themes: [],
      });

      const pdf = await service.exportReportPdf('digest-1');

      expect(pdf).toContain('PULSE STANDUP REPORT');
      expect(pdf).toContain('All good');
    });
  });

  describe('getSettings', () => {
    it('returns settings from workspace and env defaults', async () => {
      prisma.workspace.findFirst.mockResolvedValue({
        id: 'ws-1',
        slackWorkspaceName: 'Acme',
        slackWorkspaceId: 'T123',
        botToken: 'xoxb-token',
      });

      const settings = await service.getSettings();

      expect(settings.workspace.name).toBe('Acme');
      expect(settings.workspace.botTokenSet).toBe(true);
      expect(settings.openai.model).toBeTruthy();
      expect(settings.system.databaseStatus).toBe('Healthy');
    });

    it('falls back to defaults when workspace is missing', async () => {
      prisma.workspace.findFirst.mockResolvedValue(null);

      const settings = await service.getSettings();

      expect(settings.workspace.id).toBe('default-ws');
      expect(settings.workspace.name).toBe('TeamPulse Workspace');
    });
  });

  describe('updateSettings', () => {
    it('logs and returns success payload', async () => {
      const body = { timezone: 'UTC' };

      const result = await service.updateSettings(body);

      expect(result).toEqual({ status: 'success', updated: body });
    });
  });

  describe('getTeams', () => {
    it('enriches teams with member profiles and counts', async () => {
      prisma.team.findMany.mockResolvedValue([
        {
          id: 'team-1',
          workspaceId: 'ws-1',
          name: 'Platform',
          slackChannelId: 'C1',
          scheduleCron: '0 9 * * 1-5',
          timezone: 'UTC',
          schedulerEnabled: true,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-02T00:00:00.000Z'),
          workspace: { id: 'ws-1' },
          teamMembers: [
            {
              id: 'tm-1',
              userId: 'user-1',
              role: 'lead',
              joinedAt: new Date('2024-01-01T00:00:00.000Z'),
              user: {
                slackRealName: 'Alice Real',
                slackDisplayName: 'Alice',
                email: 'alice@example.com',
                slackUserId: 'U1',
              },
            },
          ],
          _count: { checkIns: 2, standupRuns: 1 },
        },
      ]);
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'user-1',
          slackRealName: 'Alice Real',
          slackAvatarUrl: 'https://avatar',
        },
      ]);

      const teams = await service.getTeams();

      expect(teams[0].teamLead?.name).toBe('Alice Real');
      expect(teams[0].memberCount).toBe(1);
      expect(teams[0].checkInCount).toBe(2);
      expect(teams[0].activeRunCount).toBe(1);
    });
  });

  describe('createTeam', () => {
    it('throws when no workspace is active', async () => {
      resolveWorkspaceIdMock.mockResolvedValue(null);

      await expect(
        service.createTeam({ name: 'New Team' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates team with defaults', async () => {
      prisma.team.create.mockResolvedValue({ id: 'team-new', name: 'New Team' });

      const team = await service.createTeam({ name: 'New Team' });

      expect(team).toEqual({ id: 'team-new', name: 'New Team' });
      expect(prisma.team.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          name: 'New Team',
          timezone: 'Asia/Riyadh',
          scheduleCron: '0 9 * * 1-5',
          schedulerEnabled: true,
        }),
      });
    });
  });

  describe('deleteTeam', () => {
    it('throws when team does not exist', async () => {
      prisma.team.findUnique.mockResolvedValue(null);

      await expect(service.deleteTeam('missing')).rejects.toThrow(
        'Team missing not found',
      );
    });

    it('throws when team is outside active workspace', async () => {
      prisma.team.findUnique.mockResolvedValue({
        id: 'team-2',
        workspaceId: 'ws-other',
      });

      await expect(service.deleteTeam('team-2')).rejects.toThrow(
        'Team team-2 was not found.',
      );
    });

    it('deletes team in active workspace', async () => {
      prisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        workspaceId: 'ws-1',
      });
      prisma.team.delete.mockResolvedValue({ id: 'team-1' });

      const result = await service.deleteTeam('team-1');

      expect(result).toEqual({ id: 'team-1' });
    });
  });

  describe('getUsers', () => {
    it('returns empty list when no workspace', async () => {
      resolveWorkspaceIdMock.mockResolvedValue(null);

      const users = await service.getUsers('alice');

      expect(users).toEqual([]);
    });

    it('returns users sorted by member order', async () => {
      workspaceMembers.listHumanMembers.mockResolvedValue([
        { id: 'user-2' },
        { id: 'user-1' },
      ]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'user-1', teamMembers: [] },
        { id: 'user-2', teamMembers: [] },
      ]);

      const users = await service.getUsers();

      expect(users.map((u) => u.id)).toEqual(['user-2', 'user-1']);
      expect(workspaceMembers.listHumanMembers).toHaveBeenCalledWith('ws-1', {
        search: undefined,
      });
    });
  });

  describe('listWorkspaceMembers', () => {
  const profileRows = [
    {
      id: 'user-1',
      slackUserId: 'U1',
      slackDisplayName: 'Alice',
      slackRealName: 'Alice Real',
      slackAvatarUrl: null,
      email: 'alice@example.com',
      timezone: 'UTC',
    },
    {
      id: 'user-2',
      slackUserId: 'U_PLACEHOLDER',
      slackDisplayName: 'placeholder',
      slackRealName: null,
      slackAvatarUrl: null,
      email: null,
      timezone: null,
    },
  ];

    it('returns empty payload when no workspace', async () => {
      resolveWorkspaceIdMock.mockResolvedValue(null);

      const result = await service.listWorkspaceMembers();

      expect(result.members).toEqual([]);
      expect(result.source).toBe('none');
    });

    it('throws when workspace record is missing', async () => {
      prisma.workspace.findUnique.mockResolvedValue(null);

      await expect(service.listWorkspaceMembers()).rejects.toThrow(
        'Workspace not found',
      );
    });

    it('syncs from slack when token is usable', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        botToken: 'xoxb-valid',
        slackWorkspaceId: 'T123',
        slackWorkspaceName: 'Acme',
      });
      isUsableSlackBotTokenMock.mockReturnValue(true);
      isPlaceholderSlackUserMock.mockImplementation(
        ({ slackUserId }) => slackUserId === 'U_PLACEHOLDER',
      );
      slackMemberCache.syncFromLive.mockResolvedValue({
        humans: [{ id: 'user-1' }],
        synced: 1,
      });
      prisma.$queryRaw.mockResolvedValue(profileRows);
      prisma.teamMember.findMany.mockResolvedValue([
        {
          id: 'tm-1',
          userId: 'user-1',
          teamId: 'team-1',
          role: 'member',
          team: { id: 'team-1', name: 'Platform' },
        },
      ]);

      const result = await service.listWorkspaceMembers({ sync: true });

      expect(result.synced).toBe(true);
      expect(result.source).toBe('slack_api');
      expect(result.members).toHaveLength(1);
      expect(result.members[0].fullName).toBe('Alice Real');
    });

    it('falls back to database when slack sync fails', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        botToken: 'xoxb-valid',
        slackWorkspaceId: 'T123',
        slackWorkspaceName: 'Acme',
      });
      isUsableSlackBotTokenMock.mockReturnValue(true);
      slackMemberCache.syncFromLive.mockRejectedValue(new Error('Slack down'));
      prisma.$queryRaw.mockResolvedValue(profileRows);
      prisma.teamMember.findMany.mockResolvedValue([]);
      isPlaceholderSlackUserMock.mockImplementation(({ slackUserId }) =>
        slackUserId === 'U_PLACEHOLDER',
      );

      const result = await service.listWorkspaceMembers();

      expect(result.synced).toBe(false);
      expect(result.source).toBe('database');
      expect(result.members).toHaveLength(1);
    });

    it('filters members by search and team membership', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        botToken: null,
        slackWorkspaceId: 'T123',
        slackWorkspaceName: 'Acme',
      });
      prisma.$queryRaw.mockResolvedValue(profileRows);
      prisma.teamMember.findMany.mockResolvedValue([
        {
          id: 'tm-1',
          userId: 'user-1',
          teamId: 'team-1',
          role: 'lead',
          team: { id: 'team-1', name: 'Platform' },
        },
      ]);

      const result = await service.listWorkspaceMembers({
        search: 'alice',
        teamId: 'team-1',
        sync: false,
      });

      expect(result.members).toHaveLength(1);
      expect(result.members[0].alreadyOnTeam).toBe(true);
      expect(result.members[0].currentRole).toBe('lead');
    });
  });

  describe('syncWorkspaceMembers', () => {
    it('throws when no workspace', async () => {
      resolveWorkspaceIdMock.mockResolvedValue(null);

      await expect(service.syncWorkspaceMembers()).rejects.toThrow(
        'No workspace found',
      );
    });

    it('returns unsynced reason when bot token is unusable', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        botToken: null,
        slackWorkspaceId: 'T123',
        slackWorkspaceName: 'Acme',
      });
      prisma.user.count.mockResolvedValue(4);

      const result = await service.syncWorkspaceMembers();

      expect(result.synced).toBe(false);
      expect(result.count).toBe(4);
      expect(result.reason).toContain('No usable Slack bot token');
    });

    it('syncs members and invalidates cache', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        botToken: 'xoxb-valid',
        slackWorkspaceId: 'T123',
        slackWorkspaceName: 'Acme',
      });
      isUsableSlackBotTokenMock.mockReturnValue(true);
      slackMemberCache.syncFromLive.mockResolvedValue({
        humans: [{ id: 'user-1' }],
        synced: 2,
      });

      const result = await service.syncWorkspaceMembers();

      expect(result).toEqual({ synced: true, count: 1, reason: null });
      expect(workspaceMembers.invalidateWorkspace).toHaveBeenCalledWith('ws-1');
    });
  });

  describe('team member management', () => {
    const team = { id: 'team-1', workspaceId: 'ws-1' };
    const user = { id: 'user-1', workspaceId: 'ws-1', slackUserId: 'U1' };

    it('addTeamMember throws when team is missing', async () => {
      prisma.team.findUnique.mockResolvedValue(null);

      await expect(
        service.addTeamMember('team-1', { userId: 'user-1' }),
      ).rejects.toThrow('Team team-1 not found');
    });

    it('addTeamMember throws when team is outside workspace', async () => {
      prisma.team.findUnique.mockResolvedValue({
        id: 'team-1',
        workspaceId: 'ws-other',
      });

      await expect(
        service.addTeamMember('team-1', { userId: 'user-1' }),
      ).rejects.toThrow('Team team-1 was not found.');
    });

    it('addTeamMember throws when user is missing', async () => {
      prisma.team.findUnique.mockResolvedValue(team);
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.addTeamMember('team-1', { userId: 'user-1' }),
      ).rejects.toThrow('User not found');
    });

    it('addTeamMember throws for cross-workspace user', async () => {
      prisma.team.findUnique.mockResolvedValue(team);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        workspaceId: 'ws-other',
      });

      await expect(
        service.addTeamMember('team-1', { userId: 'user-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('addTeamMember upserts by slackUserId', async () => {
      prisma.team.findUnique.mockResolvedValue(team);
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.teamMember.upsert.mockResolvedValue({
        id: 'tm-1',
        role: 'lead',
        user,
      });

      const result = await service.addTeamMember('team-1', {
        slackUserId: 'U1',
        role: 'lead',
      });

      expect(result.role).toBe('lead');
      expect(prisma.teamMember.upsert).toHaveBeenCalled();
    });

    it('removeTeamMember throws when member missing', async () => {
      prisma.teamMember.findFirst.mockResolvedValue(null);

      await expect(
        service.removeTeamMember('team-1', 'tm-1'),
      ).rejects.toThrow('Team member not found');
    });

    it('removeTeamMember deletes member', async () => {
      prisma.teamMember.findFirst.mockResolvedValue({ id: 'tm-1' });
      prisma.teamMember.delete.mockResolvedValue({ id: 'tm-1' });

      const result = await service.removeTeamMember('team-1', 'tm-1');

      expect(result).toEqual({ id: 'tm-1' });
    });

    it('updateTeamMemberRole throws when member missing', async () => {
      prisma.teamMember.findFirst.mockResolvedValue(null);

      await expect(
        service.updateTeamMemberRole('team-1', 'tm-1', 'lead'),
      ).rejects.toThrow('Team member not found');
    });

    it('updateTeamMemberRole updates role', async () => {
      prisma.teamMember.findFirst.mockResolvedValue({ id: 'tm-1' });
      prisma.teamMember.update.mockResolvedValue({
        id: 'tm-1',
        role: 'lead',
        user,
      });

      const result = await service.updateTeamMemberRole('team-1', 'tm-1', 'lead');

      expect(result.role).toBe('lead');
    });

    it('searchTeamMembers queries with optional search', async () => {
      prisma.teamMember.findMany.mockResolvedValue([{ id: 'tm-1', user }]);

      await service.searchTeamMembers('team-1', 'alice');

      expect(prisma.teamMember.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            teamId: 'team-1',
            user: expect.objectContaining({
              OR: expect.any(Array),
            }),
          }),
        }),
      );

      await service.searchTeamMembers('team-1');

      expect(prisma.teamMember.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { teamId: 'team-1' },
        }),
      );
    });
  });

  describe('additional coverage paths', () => {
    it('getOverviewStats handles zero submissions and empty ai analytics runs', async () => {
      setupOverviewDefaults(prisma);
      prisma.standupSubmission.count.mockReset().mockResolvedValue(0);
      prisma.standupSubmission.findMany.mockReset().mockResolvedValue([]);
      prisma.standupRun.findMany.mockResolvedValue([]);
      prisma.aiDigest.findFirst.mockResolvedValue(null);

      const result = await service.getOverviewStats();

      expect(result.stats.completionRate).toBe(0);
      expect(result.stats.avgResponseTimeMinutes).toBe(0);
      expect(result.aiAnalytics.available).toBe(false);
      expect(result.aiAnalytics.message).toBe('Waiting for completed standup reports');
    });

    it('getOverviewStats returns not-enough-responses when latest run has no submissions', async () => {
      setupOverviewDefaults(prisma);
      prisma.standupSubmission.count.mockReset().mockResolvedValue(0);
      prisma.standupRun.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'run-empty',
            startedAt: new Date('2024-06-01T09:00:00.000Z'),
            status: 'completed',
            checkInId: 'ci-1',
            checkIn: { name: 'Daily' },
            submissions: [],
            aiDigest: {
              summary: 'Summary',
              source: 'ai',
              blockers: [],
              themes: [],
              reportSections: {},
            },
          },
        ]);

      const result = await service.getOverviewStats();

      expect(result.aiAnalytics).toEqual({
        available: false,
        message: 'Not enough responses to generate analytics',
      });
    });

    it('getOverviewStats marks team health critical when completion is low', async () => {
      setupOverviewDefaults(prisma);
      prisma.standupSubmission.count.mockReset().mockResolvedValue(0);
      prisma.standupRun.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'run-1',
            startedAt: new Date('2024-06-01T09:00:00.000Z'),
            status: 'completed',
            checkInId: 'ci-1',
            checkIn: { name: 'Daily' },
            submissions: [
              {
                id: 's1',
                status: 'completed',
                user: { slackUserId: 'U1', slackDisplayName: 'Alice' },
              },
              {
                id: 's2',
                status: 'pending',
                user: { slackUserId: 'U2', slackDisplayName: 'Bob' },
              },
              {
                id: 's3',
                status: 'pending',
                user: { slackUserId: 'U3', slackDisplayName: 'Carol' },
              },
            ],
            aiDigest: {
              summary: 'Team is blocked on deploy',
              source: 'ai',
              blockers: [
                { userId: 'U1', description: 'Critical outage', severity: 'critical' },
                { userId: 'U2', description: 'Another critical', severity: 'critical' },
              ],
              themes: [{ theme: 'Deploy', summary: 'Risky', mentionCount: 2 }],
              reportSections: {
                aiInsights: ['Insight'],
                risks: ['Deploy risk'],
                keyAccomplishments: ['Shipped'],
                overallProgress: 'Behind schedule',
                actionItems: ['Fix deploy'],
              },
            },
          },
          {
            id: 'run-0',
            startedAt: new Date('2024-05-31T09:00:00.000Z'),
            status: 'completed',
            checkInId: 'ci-1',
            checkIn: { name: 'Daily' },
            submissions: [
              {
                id: 's4',
                status: 'completed',
                user: { slackUserId: 'U1', slackDisplayName: 'Alice' },
              },
            ],
            aiDigest: {
              summary: 'Earlier',
              source: 'ai',
              blockers: [
                { userId: 'U1', description: 'Critical outage', severity: 'critical' },
              ],
              themes: [],
              reportSections: {
                aiInsights: [],
                risks: [],
                keyAccomplishments: [],
                overallProgress: '',
                actionItems: [],
              },
            },
          },
        ]);
      prisma.user.findMany.mockResolvedValue([]);
      prisma.answer.findMany.mockResolvedValue([]);

      const result = await service.getOverviewStats();

      expect(result.aiAnalytics.available).toBe(true);
      expect(result.aiAnalytics.teamHealth).toBe('critical');
      expect(result.aiAnalytics.insights.length).toBeGreaterThan(0);
      expect(result.aiAnalytics.recommendations).toContain('Fix deploy');
    });

    it('getReportsGrouped increments totalReports for duplicate check-ins', async () => {
      const older = makeDigestRow({
        id: 'digest-old',
        run: {
          ...makeDigestRow().run,
          startedAt: new Date('2024-05-01T09:00:00.000Z'),
        },
      });
      const newer = makeDigestRow({
        id: 'digest-new',
        run: {
          ...makeDigestRow().run,
          startedAt: new Date('2024-06-01T09:00:00.000Z'),
        },
      });
      prisma.aiDigest.findMany.mockResolvedValue([newer, older]);

      const grouped = await service.getReportsGrouped();

      expect(grouped[0].totalReports).toBe(2);
      expect(grouped[0].latestReport.id).toBe('digest-new');
    });

    it('getReportDetail builds participant profiles and jira links from submissions', async () => {
      const digest = makeDigestRow({
        reportSections: null,
        blockers: [{ userId: 'U1', description: 'Blocked', severity: 'medium' }],
        run: {
          ...makeDigestRow().run,
          submissions: [
            {
              id: 'sub-1',
              status: 'completed',
              completedAt: new Date('2024-06-01T09:30:00.000Z'),
              updatedAt: new Date('2024-06-01T09:30:00.000Z'),
              user: {
                id: 'user-1',
                slackUserId: 'U1',
                slackDisplayName: 'Alice',
              },
              answers: [
                {
                  id: 'ans-1',
                  text: 'Working on API',
                  questionId: 'q-1',
                  structuredValue: null,
                  createdAt: new Date('2024-06-01T09:10:00.000Z'),
                  question: {
                    question: 'Yesterday?',
                    type: QuestionType.FREE_TEXT,
                    order: 2,
                  },
                },
                {
                  id: 'ans-2',
                  text: 'Blocked',
                  questionId: 'q-2',
                  structuredValue: { value: 'yes' },
                  createdAt: new Date('2024-06-01T09:11:00.000Z'),
                  question: {
                    question: 'Blockers?',
                    type: QuestionType.BLOCKER,
                    order: 1,
                  },
                },
              ],
              jiraIssueLinks: [
                {
                  questionId: 'q-1',
                  issueKey: 'SCRUM-1',
                  summary: 'API task',
                  status: 'In Progress',
                  assigneeName: 'Alice',
                  projectKey: 'SCRUM',
                  issueUrl: 'https://jira/SCRUM-1',
                },
              ],
            },
          ],
        },
      });
      prisma.aiDigest.findUnique.mockResolvedValue(digest);

      const result = await service.getReportDetail('digest-1');

      const linkedAnswer = result.participants[0].answers.find(
        (answer) => answer.linkedJiraIssues.length > 0,
      );

      expect(linkedAnswer?.linkedJiraIssues).toHaveLength(1);
      expect(result.participantProfiles.length).toBeGreaterThan(0);
      expect(result.reportSections.helpRequests.length).toBeGreaterThanOrEqual(0);
      expect(result.reportSections.namedRisks.length).toBeGreaterThanOrEqual(0);
    });

    it('getReportDetail allows failed source when generationError is set', async () => {
      prisma.aiDigest.findUnique.mockResolvedValue(
        makeDigestRow({
          source: 'failed',
          generationError: 'OpenAI timeout',
          slackReportText: null,
        }),
      );

      const result = await service.getReportDetail('digest-1');

      expect(result.generationError).toBe('OpenAI timeout');
      expect(result.aiProvider).toBe('Failed');
    });

    it('getAnalyticsData recommends maintaining cadence when no blockers', async () => {
      workspaceAnalytics.collectSnapshot.mockResolvedValue(
        makeAnalyticsSnapshot({
          blockers: {
            ...makeAnalyticsSnapshot().blockers,
            openBlockers: 0,
          },
        }),
      );
      prisma.standupSubmission.findMany.mockResolvedValue([]);
      prisma.team.findMany.mockResolvedValue([]);

      const result = await service.getAnalyticsData();

      expect(result.aiInsights.recommendation).toBe(
        'No open blockers — maintain current standup cadence.',
      );
    });

    it('syncWorkspaceMembers throws when workspace record missing', async () => {
      prisma.workspace.findUnique.mockResolvedValue(null);

      await expect(service.syncWorkspaceMembers()).rejects.toThrow(
        'Workspace not found',
      );
    });
  });
});
