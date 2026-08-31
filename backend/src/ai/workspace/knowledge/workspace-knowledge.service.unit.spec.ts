import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { PrismaService } from '../../../prisma/prisma.service';
import { JiraService } from '../../../jira/jira.service';
import { JiraCacheService } from '../../../jira/jira-cache.service';
import { SlackMemberCacheService } from '../../../slack/slack-member-cache.service';
import { JiraMemberCacheService } from '../../../jira/jira-member-cache.service';
import { JiraBlockerService } from '../../../jira/jira-blocker.service';
import { DEMO_SLACK_WORKSPACE_ID } from '../../../demo/demo.constants';
import { WorkspaceKnowledgeService } from './workspace-knowledge.service';
import { WorkspaceSearchFilters } from '../types/workspace-ai.types';

jest.mock('../../../common/workspace-context', () => ({
  resolveActiveWorkspaceId: jest.fn(),
}));

jest.mock('../../../common/slack-member.util', () => {
  const actual = jest.requireActual(
    '../../../common/slack-member.util',
  ) as typeof import('../../../common/slack-member.util');
  return {
    ...actual,
    isPlaceholderSlackUser: jest.fn(actual.isPlaceholderSlackUser),
  };
});

import { resolveActiveWorkspaceId } from '../../../common/workspace-context';
import { isPlaceholderSlackUser } from '../../../common/slack-member.util';

const mockedResolveActiveWorkspaceId =
  resolveActiveWorkspaceId as jest.MockedFunction<
    typeof resolveActiveWorkspaceId
  >;
const mockedIsPlaceholderSlackUser =
  isPlaceholderSlackUser as jest.MockedFunction<typeof isPlaceholderSlackUser>;

type AsyncMock = jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;

function asyncMock(
  impl?: (...args: unknown[]) => Promise<unknown>,
): AsyncMock {
  return (
    impl ? jest.fn(impl) : jest.fn(async () => undefined)
  ) as AsyncMock;
}

function emptyCountFindMany() {
  return {
    count: asyncMock(async () => 0),
    findMany: asyncMock(async () => [] as unknown[]),
    findFirst: asyncMock(async () => null),
    findUnique: asyncMock(async () => null),
  };
}

type PrismaMock = {
  workspace: { findUnique: AsyncMock };
  user: { findFirst: AsyncMock; findMany: AsyncMock };
  standupSubmission: ReturnType<typeof emptyCountFindMany>;
  standupThreadUpdate: ReturnType<typeof emptyCountFindMany>;
  standupRun: ReturnType<typeof emptyCountFindMany>;
  checkIn: ReturnType<typeof emptyCountFindMany>;
  jiraIssueCacheEntry: ReturnType<typeof emptyCountFindMany>;
  jiraConnection: { findFirst: AsyncMock };
  pulseBlocker: ReturnType<typeof emptyCountFindMany>;
  pulseBlockerUpdate: ReturnType<typeof emptyCountFindMany>;
  aiDigest: ReturnType<typeof emptyCountFindMany>;
  teamMember: { findMany: AsyncMock };
  slackMemberCache: { count: AsyncMock };
  jiraMemberCache: { count: AsyncMock };
  slackChannel: ReturnType<typeof emptyCountFindMany>;
  teamMemoryDocument: ReturnType<typeof emptyCountFindMany>;
  jiraAuditLog: ReturnType<typeof emptyCountFindMany>;
  slackAiChatLog: ReturnType<typeof emptyCountFindMany>;
  aiConversation: { count: AsyncMock };
  aiConversationMessage: { findMany: AsyncMock };
};

type JiraServiceMock = {
  findLiveConnectionForWorkspace: AsyncMock;
  lookupIssueForUser: AsyncMock;
  searchIssuesByAssignee: AsyncMock;
};

type JiraCacheMock = {
  upsertFromSnapshot: AsyncMock;
};

type SlackMemberCacheMock = {
  syncFromLive: AsyncMock;
  listHumanCache: AsyncMock;
};

type JiraMemberCacheMock = {
  syncFromLive: AsyncMock;
  listActiveCache: AsyncMock;
};

type JiraBlockersMock = {
  getBlockerStatsForWorkspace: AsyncMock;
  listDashboardBlockersForWorkspace: AsyncMock;
};

const WS = 'ws-1';
const NOW = new Date('2026-03-15T12:00:00.000Z');

function makeLiveConnection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    userId: 'jira-user-1',
    cloudId: 'cloud-1',
    siteUrl: 'https://acme.atlassian.net',
    ...overrides,
  };
}

function makeCacheIssue(overrides: Record<string, unknown> = {}) {
  return {
    issueKey: 'SCRUM-1',
    summary: 'Fix login',
    status: 'In Progress',
    assigneeName: 'Karam Waleed',
    assigneeAccountId: 'acc-karam',
    priority: 'High',
    issueUrl: 'https://acme.atlassian.net/browse/SCRUM-1',
    projectKey: 'SCRUM',
    projectName: 'Scrum',
    issueType: 'Bug',
    refreshedAt: NOW,
    workspaceId: WS,
    ...overrides,
  };
}

describe('WorkspaceKnowledgeService', () => {
  let service: WorkspaceKnowledgeService;
  let prisma: PrismaMock;
  let jiraService: JiraServiceMock;
  let jiraCache: JiraCacheMock;
  let slackMemberCache: SlackMemberCacheMock;
  let jiraMemberCache: JiraMemberCacheMock;
  let jiraBlockers: JiraBlockersMock;

  beforeEach(async () => {
    prisma = {
      workspace: { findUnique: asyncMock(async () => null) },
      user: {
        findFirst: asyncMock(async () => null),
        findMany: asyncMock(async () => []),
      },
      standupSubmission: emptyCountFindMany(),
      standupThreadUpdate: emptyCountFindMany(),
      standupRun: emptyCountFindMany(),
      checkIn: emptyCountFindMany(),
      jiraIssueCacheEntry: emptyCountFindMany(),
      jiraConnection: { findFirst: asyncMock(async () => null) },
      pulseBlocker: emptyCountFindMany(),
      pulseBlockerUpdate: emptyCountFindMany(),
      aiDigest: emptyCountFindMany(),
      teamMember: { findMany: asyncMock(async () => []) },
      slackMemberCache: { count: asyncMock(async () => 0) },
      jiraMemberCache: { count: asyncMock(async () => 0) },
      slackChannel: emptyCountFindMany(),
      teamMemoryDocument: emptyCountFindMany(),
      jiraAuditLog: emptyCountFindMany(),
      slackAiChatLog: emptyCountFindMany(),
      aiConversation: { count: asyncMock(async () => 0) },
      aiConversationMessage: { findMany: asyncMock(async () => []) },
    };

    jiraService = {
      findLiveConnectionForWorkspace: asyncMock(async () => null),
      lookupIssueForUser: asyncMock(async () => null),
      searchIssuesByAssignee: asyncMock(async () => ({ issues: [] })),
    };
    jiraCache = {
      upsertFromSnapshot: asyncMock(async () => undefined),
    };
    slackMemberCache = {
      syncFromLive: asyncMock(async () => ({ source: 'none', humans: [] })),
      listHumanCache: asyncMock(async () => []),
    };
    jiraMemberCache = {
      syncFromLive: asyncMock(async () => ({ source: 'none', members: [] })),
      listActiveCache: asyncMock(async () => []),
    };
    jiraBlockers = {
      getBlockerStatsForWorkspace: asyncMock(async () => ({
        openBlockers: 0,
        critical: 0,
        waitingMoreThan3Days: 0,
        resolvedThisWeek: 0,
        total: 0,
        resolved: 0,
      })),
      listDashboardBlockersForWorkspace: asyncMock(async () => []),
    };

    mockedResolveActiveWorkspaceId.mockReset();
    mockedIsPlaceholderSlackUser.mockClear();
    mockedIsPlaceholderSlackUser.mockImplementation(
      (
        jest.requireActual('../../../common/slack-member.util') as typeof import('../../../common/slack-member.util')
      ).isPlaceholderSlackUser,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceKnowledgeService,
        { provide: PrismaService, useValue: prisma },
        { provide: JiraService, useValue: jiraService },
        { provide: JiraCacheService, useValue: jiraCache },
        { provide: SlackMemberCacheService, useValue: slackMemberCache },
        { provide: JiraMemberCacheService, useValue: jiraMemberCache },
        { provide: JiraBlockerService, useValue: jiraBlockers },
      ],
    }).compile();

    service = module.get(WorkspaceKnowledgeService);
  });

  describe('resolveWorkspaceId', () => {
    it('delegates to resolveActiveWorkspaceId with prisma and preferred id', async () => {
      mockedResolveActiveWorkspaceId.mockResolvedValue('ws-preferred');

      const result = await service.resolveWorkspaceId('ws-preferred');

      expect(result).toBe('ws-preferred');
      expect(mockedResolveActiveWorkspaceId).toHaveBeenCalledWith(
        prisma,
        'ws-preferred',
      );
    });

    it('passes null preferred through and returns null when resolver finds none', async () => {
      mockedResolveActiveWorkspaceId.mockResolvedValue(null);

      const result = await service.resolveWorkspaceId(null);

      expect(result).toBeNull();
      expect(mockedResolveActiveWorkspaceId).toHaveBeenCalledWith(prisma, null);
    });
  });

  describe('resolveMemoryAclUserId', () => {
    it('returns preferred user when found in workspace', async () => {
      prisma.user.findFirst.mockResolvedValueOnce({ id: 'user-1' });

      const result = await service.resolveMemoryAclUserId(WS, '  user-1  ');

      expect(result).toBe('user-1');
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1', workspaceId: WS },
        }),
      );
    });

    it('falls back to earliest workspace user when preferred missing', async () => {
      prisma.user.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'user-fallback' });

      const result = await service.resolveMemoryAclUserId(WS, 'missing');

      expect(result).toBe('user-fallback');
      expect(prisma.user.findFirst).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { workspaceId: WS },
          orderBy: { createdAt: 'asc' },
        }),
      );
    });

    it('skips preferred lookup when preferred is empty and uses fallback', async () => {
      prisma.user.findFirst.mockResolvedValueOnce({ id: 'first' });

      const result = await service.resolveMemoryAclUserId(WS, '   ');

      expect(result).toBe('first');
      expect(prisma.user.findFirst).toHaveBeenCalledTimes(1);
    });

    it('returns null when workspace has no users', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await service.resolveMemoryAclUserId(WS, null);

      expect(result).toBeNull();
    });
  });

  describe('getWorkspaceRoutingSnapshot', () => {
    it('returns workspace + live jira connection fields', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        id: WS,
        slackWorkspaceName: 'Acme',
        slackWorkspaceId: 'T123',
      });
      jiraService.findLiveConnectionForWorkspace.mockResolvedValue(
        makeLiveConnection(),
      );

      const result = await service.getWorkspaceRoutingSnapshot(WS);

      expect(result).toEqual({
        workspaceId: WS,
        workspaceName: 'Acme',
        slackWorkspaceId: 'T123',
        jiraConnectionId: 'conn-1',
        jiraCloudId: 'cloud-1',
        jiraSiteUrl: 'https://acme.atlassian.net',
        hasLiveJira: true,
      });
    });

    it('returns null connection fields when workspace and jira missing', async () => {
      prisma.workspace.findUnique.mockResolvedValue(null);
      jiraService.findLiveConnectionForWorkspace.mockResolvedValue(null);

      const result = await service.getWorkspaceRoutingSnapshot(WS);

      expect(result.hasLiveJira).toBe(false);
      expect(result.workspaceName).toBeNull();
      expect(result.jiraConnectionId).toBeNull();
    });
  });

  describe('resolveAssigneeCandidates', () => {
    it('ranks workspace users and merges matching cache assignees + jira members', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          slackDisplayName: 'Karam',
          slackRealName: 'Karam Waleed',
          email: 'karam@acme.com',
        },
        {
          slackDisplayName: 'Other',
          slackRealName: 'Other Person',
          email: 'other@acme.com',
        },
      ]);
      prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([
        {
          assigneeName: 'Karam Waleed',
          assigneeAccountId: 'acc-karam',
        },
        { assigneeName: 'Unrelated', assigneeAccountId: 'acc-x' },
      ]);
      prisma.jiraConnection.findFirst.mockResolvedValue({
        userId: 'jira-user-1',
      });
      jiraMemberCache.listActiveCache.mockResolvedValue([
        { displayName: 'Karam W.', accountId: 'acc-kw' },
        { displayName: '  ', accountId: 'acc-blank' },
        { displayName: 'Someone Else', accountId: 'acc-other' },
      ]);

      const result = await service.resolveAssigneeCandidates(WS, 'Karam');

      expect(result.query).toBe('Karam');
      expect(result.workspaceMemberNames).toContain('Karam Waleed');
      expect(result.displayNames).toEqual(
        expect.arrayContaining(['Karam Waleed', 'Karam W.']),
      );
      expect(result.accountIds).toEqual(
        expect.arrayContaining(['acc-karam', 'acc-kw']),
      );
    });

    it('falls back to raw query when no candidates match', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([]);
      prisma.jiraConnection.findFirst.mockResolvedValue(null);

      const result = await service.resolveAssigneeCandidates(WS, 'Nobody');

      expect(result.displayNames).toEqual(['Nobody']);
      expect(result.workspaceMemberNames).toEqual([]);
    });

    it('swallows jira member cache errors', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          slackDisplayName: 'Ada',
          slackRealName: null,
          email: null,
        },
      ]);
      prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([]);
      prisma.jiraConnection.findFirst.mockResolvedValue({
        userId: 'u1',
      });
      jiraMemberCache.listActiveCache.mockRejectedValue(new Error('cache down'));

      const result = await service.resolveAssigneeCandidates(WS, 'Ada');

      expect(result.displayNames).toContain('Ada');
    });
  });

  describe('resolveUserQuery', () => {
    it('returns null for empty candidates', async () => {
      await expect(service.resolveUserQuery(WS, [])).resolves.toBeNull();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('matches slack display name and returns it', async () => {
      prisma.user.findMany.mockResolvedValue([
        { slackDisplayName: 'Karam Waleed', email: 'k@acme.com' },
      ]);

      await expect(service.resolveUserQuery(WS, ['karam'])).resolves.toBe(
        'Karam Waleed',
      );
    });

    it('matches email prefix', async () => {
      prisma.user.findMany.mockResolvedValue([
        { slackDisplayName: 'Ada', email: 'ada.lovelace@acme.com' },
      ]);

      await expect(service.resolveUserQuery(WS, ['ada.lovelace'])).resolves.toBe(
        'Ada',
      );
    });

    it('returns first candidate when no user matches', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await expect(
        service.resolveUserQuery(WS, ['Unknown Person']),
      ).resolves.toBe('Unknown Person');
    });
  });

  describe('resolveSubjectUserId', () => {
    it('returns null for empty candidates', async () => {
      await expect(service.resolveSubjectUserId(WS, [])).resolves.toBeNull();
    });

    it('returns unique match id', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', slackDisplayName: 'Karam', email: 'k@acme.com' },
        { id: 'u2', slackDisplayName: 'Other', email: 'o@acme.com' },
      ]);

      await expect(service.resolveSubjectUserId(WS, ['karam'])).resolves.toBe(
        'u1',
      );
    });

    it('returns exact match when multiple partial matches exist', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', slackDisplayName: 'Karam', email: null },
        { id: 'u2', slackDisplayName: 'Karam Waleed', email: null },
      ]);

      await expect(service.resolveSubjectUserId(WS, ['karam'])).resolves.toBe(
        'u1',
      );
    });

    it('returns null when multiple matches and no exact name', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', slackDisplayName: 'Karam A', email: null },
        { id: 'u2', slackDisplayName: 'Karam B', email: null },
      ]);

      await expect(service.resolveSubjectUserId(WS, ['karam'])).resolves.toBeNull();
    });

    it('returns null when no candidates match any user', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', slackDisplayName: 'Ada', email: 'ada@acme.com' },
      ]);

      await expect(
        service.resolveSubjectUserId(WS, ['nobody']),
      ).resolves.toBeNull();
    });
  });

  describe('collectSnapshot', () => {
    async function collect(
      filters: WorkspaceSearchFilters = {},
      limit = 10,
    ) {
      return service.collectSnapshot(WS, filters, limit);
    }

    it('runs all collectors by default and buckets documents by entity', async () => {
      const snap = await collect({});

      expect(snap.workspaceId).toBe(WS);
      expect(snap.diagnostics.length).toBeGreaterThanOrEqual(14);
      expect(snap.documents).toEqual([]);
      expect(snap.byEntity).toEqual({});
    });

    it('limits collectors to jira_members when jiraMembersOnly', async () => {
      const snap = await collect({ jiraMembersOnly: true });

      expect(snap.diagnostics).toHaveLength(1);
      expect(snap.diagnostics[0].sourceKey).toBe('jira_members');
    });

    it('limits collectors to slack_members when slackMembersOnly', async () => {
      const snap = await collect({ slackMembersOnly: true });

      expect(snap.diagnostics).toHaveLength(1);
      expect(snap.diagnostics[0].sourceKey).toBe('slack_members');
    });

    it('runs only selectedSources when provided', async () => {
      const snap = await collect({
        selectedSources: ['reports', 'check_ins'],
      });

      expect(snap.diagnostics.map((d) => d.sourceKey).sort()).toEqual([
        'check_ins',
        'reports',
      ]);
    });

    it('records collector_error diagnostic when a collector throws', async () => {
      prisma.checkIn.count.mockRejectedValue(new Error('db down'));

      const snap = await collect({ selectedSources: ['check_ins'] });

      expect(snap.diagnostics[0]).toMatchObject({
        sourceKey: 'check_ins',
        reasonCode: 'collector_error',
        reason: 'db down',
        found: 0,
      });
    });

    it('stringifies non-Error collector failures', async () => {
      prisma.checkIn.count.mockRejectedValue('boom');

      const snap = await collect({ selectedSources: ['check_ins'] });

      expect(snap.diagnostics[0].reason).toBe('unknown collector error');
    });

    it('returns cached snapshot within TTL for non-issueKey requests', async () => {
      prisma.checkIn.count.mockResolvedValue(0);
      prisma.checkIn.findMany.mockResolvedValue([]);

      const first = await collect({ selectedSources: ['check_ins'] });
      prisma.checkIn.count.mockClear();
      const second = await collect({ selectedSources: ['check_ins'] });

      expect(second).toBe(first);
      expect(prisma.checkIn.count).not.toHaveBeenCalled();
    });

    it('skips cache when issueKey is set', async () => {
      jiraService.findLiveConnectionForWorkspace.mockResolvedValue(null);
      prisma.jiraIssueCacheEntry.count.mockResolvedValue(0);
      prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([]);
      prisma.workspace.findUnique.mockResolvedValue({
        id: WS,
        slackWorkspaceName: 'Acme',
        slackWorkspaceId: 'T1',
      });

      await collect({
        selectedSources: ['jira'],
        issueKey: 'SCRUM-1',
      });
      await collect({
        selectedSources: ['jira'],
        issueKey: 'SCRUM-1',
      });

      expect(prisma.jiraIssueCacheEntry.count).toHaveBeenCalledTimes(2);
    });

    describe('collectStandups via selectedSources', () => {
      it('maps completed submissions to standup_submission docs', async () => {
        prisma.standupSubmission.count.mockResolvedValue(1);
        prisma.standupSubmission.findMany.mockResolvedValue([
          {
            id: 'sub-1',
            runId: 'run-1',
            userId: 'u1',
            completedAt: NOW,
            createdAt: NOW,
            user: { slackDisplayName: 'Karam', slackUserId: 'U1' },
            answers: [
              {
                text: '  Working on login  ',
                question: { question: 'What did you do?' },
                createdAt: NOW,
              },
            ],
            run: {
              slackThreadUrl: 'https://slack/thread',
              checkIn: { name: 'Daily' },
            },
          },
        ]);

        const snap = await collect({
          selectedSources: ['slack_standups'],
          userQuery: 'Karam',
          searchTokens: ['login'],
          dateFrom: new Date('2026-03-01'),
          dateTo: new Date('2026-03-31'),
          latestStandupSubmissionId: 'sub-1',
          issueKey: 'SCRUM-1',
        });

        expect(snap.standups).toHaveLength(1);
        expect(snap.standups[0]).toMatchObject({
          entity: 'standup_submission',
          title: 'Daily — Karam',
          url: 'https://slack/thread',
        });
        expect(snap.standups[0].content).toContain('Working on login');
        expect(snap.diagnostics[0].reasonCode).toBe('ok');
      });

      it('emits empty answers content and filters_excluded_all when workspace has rows', async () => {
        prisma.standupSubmission.count.mockResolvedValue(5);
        prisma.standupSubmission.findMany.mockResolvedValue([]);

        const snap = await collect({
          selectedSources: ['slack_standups'],
          keyword: 'xyzzy',
          latestStandupRunId: 'run-9',
          subjectUserId: 'u9',
        });

        expect(snap.standups).toHaveLength(0);
        expect(snap.diagnostics[0].reasonCode).toBe('filters_excluded_all');
      });

      it('uses (no answers) when submission has empty answers list', async () => {
        prisma.standupSubmission.count.mockResolvedValue(1);
        prisma.standupSubmission.findMany.mockResolvedValue([
          {
            id: 'sub-2',
            runId: 'run-2',
            userId: 'u2',
            completedAt: null,
            createdAt: NOW,
            user: { slackDisplayName: 'Ada', slackUserId: 'U2' },
            answers: [],
            run: { slackThreadUrl: null, checkIn: null },
          },
        ]);

        const snap = await collect({ selectedSources: ['slack_standups'] });

        expect(snap.standups[0].content).toBe('(no answers)');
        expect(snap.standups[0].title).toContain('Standup');
      });
    });

    describe('collectStandupThreads', () => {
      it('maps thread updates to standup_thread docs', async () => {
        prisma.standupThreadUpdate.count.mockResolvedValue(1);
        prisma.standupThreadUpdate.findMany.mockResolvedValue([
          {
            id: 'th-1',
            runId: 'run-1',
            submissionId: 'sub-1',
            type: 'reply',
            content: 'Need help',
            createdAt: NOW,
            user: { slackDisplayName: 'Ada' },
            run: { checkIn: { name: 'Daily' } },
          },
        ]);

        const snap = await collect({
          selectedSources: ['slack_threads'],
          userQuery: 'Ada',
          searchTokens: ['help'],
          dateFrom: NOW,
        });

        expect(snap.standupThreads[0]).toMatchObject({
          entity: 'standup_thread',
          title: 'Thread update — Ada',
        });
        expect(snap.standupThreads[0].content).toContain('Need help');
      });

      it('uses Standup fallback name and dateTo-only filter', async () => {
        prisma.standupThreadUpdate.count.mockResolvedValue(1);
        prisma.standupThreadUpdate.findMany.mockResolvedValue([
          {
            id: 'th-2',
            runId: 'run-2',
            submissionId: null,
            type: 'note',
            content: 'ok',
            createdAt: NOW,
            user: { slackDisplayName: 'Bob' },
            run: { checkIn: null },
          },
        ]);

        const snap = await collect({
          selectedSources: ['slack_threads'],
          dateTo: NOW,
        });

        expect(snap.standupThreads[0].content).toContain('Standup: Standup');
      });
    });

    describe('collectStandupRuns', () => {
      it('maps runs to standup_run docs', async () => {
        prisma.standupRun.count.mockResolvedValue(1);
        prisma.standupRun.findMany.mockResolvedValue([
          {
            id: 'run-1',
            checkInId: 'ci-1',
            teamId: 't1',
            status: 'completed',
            triggerSource: 'schedule',
            scheduledFor: NOW,
            slackThreadUrl: 'https://slack/r',
            checkIn: { name: 'Morning' },
            team: { name: 'Platform' },
            _count: { submissions: 3 },
          },
        ]);

        const snap = await collect({
          selectedSources: ['standup_runs'],
          searchTokens: ['completed'],
          dateFrom: NOW,
        });

        expect(snap.standupRuns[0]).toMatchObject({
          entity: 'standup_run',
          source: 'standup_runs',
        });
        expect(snap.standupRuns[0].content).toContain('Submissions: 3');
      });
    });

    describe('collectCheckIns', () => {
      it('maps check-ins with optional description omitted', async () => {
        prisma.checkIn.count.mockResolvedValue(1);
        prisma.checkIn.findMany.mockResolvedValue([
          {
            id: 'ci-1',
            name: 'Daily Sync',
            description: null,
            enabled: true,
            timezone: 'UTC',
            teamId: 't1',
            updatedAt: NOW,
            team: { name: 'Eng' },
            _count: { questions: 2, participants: 4 },
          },
        ]);

        const snap = await collect({
          selectedSources: ['check_ins'],
          keyword: 'Daily',
        });

        expect(snap.checkIns[0].title).toBe('Daily Sync');
        expect(snap.checkIns[0].content).not.toContain('Description:');
        expect(snap.checkIns[0].content).toContain('Questions: 2');
      });

      it('includes description when present', async () => {
        prisma.checkIn.count.mockResolvedValue(1);
        prisma.checkIn.findMany.mockResolvedValue([
          {
            id: 'ci-2',
            name: 'Weekly',
            description: 'Deep dive',
            enabled: false,
            timezone: 'Asia/Riyadh',
            teamId: 't1',
            updatedAt: NOW,
            team: { name: 'Eng' },
            _count: { questions: 1, participants: 1 },
          },
        ]);

        const snap = await collect({ selectedSources: ['check_ins'] });

        expect(snap.checkIns[0].content).toContain('Description: Deep dive');
      });
    });

    describe('collectJiraIssues', () => {
      it('returns live authoritative doc when live refresh succeeds', async () => {
        jiraService.findLiveConnectionForWorkspace.mockResolvedValue(
          makeLiveConnection(),
        );
        prisma.workspace.findUnique.mockResolvedValue({
          id: WS,
          slackWorkspaceName: 'Acme',
          slackWorkspaceId: 'T1',
        });
        jiraService.lookupIssueForUser.mockResolvedValue({
          issueKey: 'SCRUM-1',
          summary: 'Fix login bug',
          status: 'Done',
          assigneeName: 'Karam',
          priority: 'High',
          reporterName: 'Ada',
          issueUrl: 'https://acme/browse/SCRUM-1',
          projectKey: 'SCRUM',
          projectName: 'Scrum Board',
          issueType: 'Bug',
          labels: ['auth'],
          components: ['api'],
          dueDate: '2026-04-01',
          resolution: 'Fixed',
          sprint: 'Sprint 12',
        });
        prisma.jiraIssueCacheEntry.count.mockResolvedValue(1);
        prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([
          makeCacheIssue({ status: 'Stale' }),
        ]);

        const snap = await collect({
          selectedSources: ['jira'],
          issueKey: 'SCRUM-1',
          jiraFieldsOnly: true,
        });

        expect(snap.jiraIssues).toHaveLength(1);
        expect(snap.jiraIssues[0].content).toContain('Live Jira API');
        expect(snap.jiraIssues[0].content).toContain('JIRA_FIELDS_ONLY: true');
        expect(snap.jiraIssues[0].content).toContain('Status: Done');
        expect(jiraCache.upsertFromSnapshot).toHaveBeenCalled();
        expect(snap.diagnostics[0].label).toContain('live refresh');
      });

      it('retries live refresh once when first attempt returns null', async () => {
        jiraService.findLiveConnectionForWorkspace.mockResolvedValue(
          makeLiveConnection(),
        );
        prisma.workspace.findUnique.mockResolvedValue({
          id: WS,
          slackWorkspaceName: 'Acme',
          slackWorkspaceId: 'T1',
        });
        jiraService.lookupIssueForUser
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            issueKey: 'SCRUM-2',
            summary: 'Retry ok',
            status: 'Open',
            assigneeName: null,
            priority: null,
          });
        prisma.jiraIssueCacheEntry.count.mockResolvedValue(0);
        prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([]);

        const snap = await collect({
          selectedSources: ['jira'],
          issueKey: 'SCRUM-2',
        });

        expect(jiraService.lookupIssueForUser).toHaveBeenCalledTimes(2);
        expect(snap.jiraIssues[0].content).toContain('Status: Open');
      });

      it('emits live_miss when live connection exists but issue not found', async () => {
        jiraService.findLiveConnectionForWorkspace.mockResolvedValue(
          makeLiveConnection(),
        );
        prisma.workspace.findUnique.mockResolvedValue({
          id: WS,
          slackWorkspaceName: 'Acme WS',
          slackWorkspaceId: 'T1',
        });
        jiraService.lookupIssueForUser.mockResolvedValue(null);
        prisma.jiraIssueCacheEntry.count.mockResolvedValue(0);
        prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([]);

        const snap = await collect({
          selectedSources: ['jira'],
          issueKey: 'SCRUM-404',
        });

        expect(snap.jiraIssues[0].content).toContain('ISSUE_NOT_FOUND');
        expect(snap.jiraIssues[0].metadata).toMatchObject({
          jiraSource: 'live_miss',
          issueFound: false,
        });
      });

      it('ignores placeholder live payloads and treats as miss when live connected', async () => {
        jiraService.findLiveConnectionForWorkspace.mockResolvedValue(
          makeLiveConnection(),
        );
        prisma.workspace.findUnique.mockResolvedValue({
          id: WS,
          slackWorkspaceName: null,
          slackWorkspaceId: 'T1',
        });
        jiraService.lookupIssueForUser.mockResolvedValue({
          issueKey: 'SCRUM-3',
          summary: 'Untitled issue',
          status: null,
          assigneeName: null,
          priority: null,
        });
        prisma.jiraIssueCacheEntry.count.mockResolvedValue(0);
        prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([]);

        const snap = await collect({
          selectedSources: ['jira'],
          issueKey: 'SCRUM-3',
        });

        expect(snap.jiraIssues[0].content).toContain('ISSUE_NOT_FOUND');
        expect(jiraCache.upsertFromSnapshot).not.toHaveBeenCalled();
      });

      it('uses cache when no live jira connection', async () => {
        jiraService.findLiveConnectionForWorkspace.mockResolvedValue(null);
        prisma.workspace.findUnique.mockResolvedValue({
          id: WS,
          slackWorkspaceName: 'Offline',
          slackWorkspaceId: 'T1',
        });
        prisma.jiraIssueCacheEntry.count.mockResolvedValue(1);
        prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([
          makeCacheIssue({
            summary: 'Cached summary',
            status: 'To Do',
            assigneeName: null,
            priority: null,
            projectKey: null,
            issueType: null,
          }),
        ]);

        const snap = await collect({
          selectedSources: ['jira'],
          issueKey: 'SCRUM-1',
        });

        expect(snap.jiraIssues[0].content).toContain('Cache (offline only)');
        expect(snap.jiraIssues[0].content).toContain('Assignee: (unassigned');
        expect(snap.jiraIssues[0].content).toContain('Priority: (not set');
      });

      it('emits jira not connected when no live and no cache entry', async () => {
        jiraService.findLiveConnectionForWorkspace.mockResolvedValue(null);
        prisma.workspace.findUnique.mockResolvedValue({
          id: WS,
          slackWorkspaceName: '  ',
          slackWorkspaceId: 'T1',
        });
        prisma.jiraIssueCacheEntry.count.mockResolvedValue(0);
        prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([]);

        const snap = await collect({
          selectedSources: ['jira'],
          issueKey: 'SCRUM-9',
        });

        expect(snap.jiraIssues[0].content).toContain('JIRA_NOT_CONNECTED');
        expect(snap.jiraIssues[0].title).toContain('Jira not connected');
      });

      it('lists offline cache issues when no issueKey and no live jira', async () => {
        jiraService.findLiveConnectionForWorkspace.mockResolvedValue(null);
        prisma.jiraIssueCacheEntry.count.mockResolvedValue(2);
        prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([
          makeCacheIssue({ issueKey: 'SCRUM-1', assigneeName: '  ' }),
          makeCacheIssue({
            issueKey: 'SCRUM-1',
            summary: 'Duplicate older',
            refreshedAt: new Date('2020-01-01'),
          }),
          makeCacheIssue({
            issueKey: 'SCRUM-2',
            status: null,
            priority: null,
            projectKey: null,
            issueType: null,
            assigneeName: 'Ada',
          }),
          makeCacheIssue({ issueKey: '' }),
        ]);

        const snap = await collect({
          selectedSources: ['jira'],
          searchTokens: ['login'],
          dateFrom: NOW,
        });

        expect(snap.jiraIssues.length).toBe(2);
        expect(snap.jiraIssues[0].content).toContain(
          'Data source: JiraIssueCacheEntry',
        );
      });

      it('skips bulk cache rows when live jira is connected without issueKey', async () => {
        jiraService.findLiveConnectionForWorkspace.mockResolvedValue(
          makeLiveConnection(),
        );
        prisma.jiraIssueCacheEntry.count.mockResolvedValue(1);
        prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([
          makeCacheIssue(),
        ]);

        const snap = await collect({ selectedSources: ['jira'] });

        expect(snap.jiraIssues).toHaveLength(0);
      });

      it('handles lookupIssueForUser throw and falls through to not found live', async () => {
        jiraService.findLiveConnectionForWorkspace.mockResolvedValue(
          makeLiveConnection(),
        );
        prisma.workspace.findUnique.mockResolvedValue({
          id: WS,
          slackWorkspaceName: 'Acme',
          slackWorkspaceId: 'T1',
        });
        jiraService.lookupIssueForUser.mockRejectedValue(new Error('timeout'));
        prisma.jiraIssueCacheEntry.count.mockResolvedValue(0);
        prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([]);

        const snap = await collect({
          selectedSources: ['jira'],
          issueKey: 'SCRUM-1',
        });

        expect(snap.jiraIssues[0].metadata).toMatchObject({
          jiraSource: 'live_miss',
        });
      });

      it('handles non-Error live refresh failures', async () => {
        jiraService.findLiveConnectionForWorkspace.mockResolvedValue(
          makeLiveConnection(),
        );
        prisma.workspace.findUnique.mockResolvedValue({
          id: WS,
          slackWorkspaceName: 'Acme',
          slackWorkspaceId: 'T1',
        });
        jiraService.lookupIssueForUser.mockRejectedValue('network');
        prisma.jiraIssueCacheEntry.count.mockResolvedValue(0);
        prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([]);

        const snap = await collect({
          selectedSources: ['jira'],
          issueKey: 'SCRUM-1',
        });

        expect(snap.jiraIssues[0].metadata).toMatchObject({
          jiraSource: 'live_miss',
        });
      });

      it('builds minimal live doc fields when optional fields are empty', async () => {
        jiraService.findLiveConnectionForWorkspace.mockResolvedValue(
          makeLiveConnection(),
        );
        prisma.workspace.findUnique.mockResolvedValue({
          id: WS,
          slackWorkspaceName: 'Acme',
          slackWorkspaceId: 'T1',
        });
        jiraService.lookupIssueForUser.mockResolvedValue({
          issueKey: 'SCRUM-5',
          summary: '  ',
          status: 'Open',
          assigneeName: '  ',
          priority: null,
          reporterName: null,
          issueUrl: null,
          projectKey: 'SCRUM',
          projectName: null,
          issueType: null,
          labels: [],
          components: [],
        });
        prisma.jiraIssueCacheEntry.count.mockResolvedValue(0);
        prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([]);

        const snap = await collect({
          selectedSources: ['jira'],
          issueKey: 'SCRUM-5',
        });

        expect(snap.jiraIssues[0].title).toBe('SCRUM-5');
        expect(snap.jiraIssues[0].content).toContain('Summary: (not set');
        expect(snap.jiraIssues[0].content).toContain('Project: SCRUM');
      });

      it('uses offline cache with full optional fields populated', async () => {
        jiraService.findLiveConnectionForWorkspace.mockResolvedValue(null);
        prisma.workspace.findUnique.mockResolvedValue({
          id: WS,
          slackWorkspaceName: 'Offline',
          slackWorkspaceId: 'T1',
        });
        prisma.jiraIssueCacheEntry.count.mockResolvedValue(1);
        prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([
          makeCacheIssue({
            summary: 'Full fields',
            status: 'Done',
            assigneeName: 'Ada',
            priority: 'Low',
            projectKey: 'SCRUM',
            projectName: 'Scrum',
            issueType: 'Story',
            issueUrl: 'https://x',
          }),
        ]);

        const snap = await collect({
          selectedSources: ['jira'],
          issueKey: 'SCRUM-1',
          jiraFieldsOnly: false,
        });

        expect(snap.jiraIssues[0].content).toContain('Assignee: Ada');
        expect(snap.jiraIssues[0].content).toContain('Priority: Low');
        expect(snap.jiraIssues[0].content).toContain('Type: Story');
      });

      it('records no_records_in_db for empty jira workspace without filters', async () => {
        jiraService.findLiveConnectionForWorkspace.mockResolvedValue(null);
        prisma.jiraIssueCacheEntry.count.mockResolvedValue(0);
        prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([]);

        const snap = await collect({ selectedSources: ['jira'] });

        expect(snap.diagnostics[0].reasonCode).toBe('no_records_in_db');
      });
    });

    describe('collectJiraIssuesForAssignee', () => {
      beforeEach(() => {
        prisma.user.findMany.mockResolvedValue([
          {
            slackDisplayName: 'Karam',
            slackRealName: 'Karam Waleed',
            email: 'k@acme.com',
          },
        ]);
        prisma.jiraIssueCacheEntry.findMany.mockResolvedValue([]);
      });

      it('uses live assignee search and prepends list header', async () => {
        jiraService.findLiveConnectionForWorkspace.mockResolvedValue(
          makeLiveConnection(),
        );
        prisma.jiraConnection.findFirst.mockResolvedValue({
          userId: 'jira-user-1',
        });
        jiraService.searchIssuesByAssignee.mockResolvedValue({
          issues: [
            {
              key: 'SCRUM-10',
              id: '10',
              summary: 'Task A',
              status: 'Open',
              projectKey: 'SCRUM',
              projectName: 'Scrum',
              issueType: 'Task',
              priority: 'Medium',
              issueUrl: 'https://x/SCRUM-10',
              updatedAt: NOW.toISOString(),
              assignee: 'Karam Waleed',
              assigneeAccountId: 'acc-karam',
              reporter: 'Ada',
              labels: ['a'],
              components: [],
              dueDate: null,
              resolution: null,
              sprint: null,
            },
            {
              key: 'scrum-10',
              id: '10b',
              summary: 'dup',
              status: 'Open',
              projectKey: 'SCRUM',
              projectName: null,
              issueType: null,
              priority: null,
              issueUrl: null,
              updatedAt: null,
              assignee: null,
              assigneeAccountId: null,
            },
          ],
        });
        prisma.jiraIssueCacheEntry.count.mockResolvedValue(1);

        const snap = await collect({
          selectedSources: ['jira'],
          assigneeQuery: 'Karam',
        });

        expect(snap.jiraIssues[0].content).toContain(
          'AUTHORITATIVE_ASSIGNEE_LIST',
        );
        expect(snap.jiraIssues.some((d) => d.reference.entityId === 'SCRUM-10')).toBe(
          true,
        );
        expect(jiraCache.upsertFromSnapshot).toHaveBeenCalled();
      });

      it('falls back to cache assignees when live search fails', async () => {
        jiraService.findLiveConnectionForWorkspace.mockResolvedValue(
          makeLiveConnection(),
        );
        prisma.jiraConnection.findFirst.mockResolvedValue({
          userId: 'jira-user-1',
        });
        jiraService.searchIssuesByAssignee.mockRejectedValue(
          new Error('search fail'),
        );
        prisma.jiraIssueCacheEntry.findMany
          .mockResolvedValueOnce([]) // resolveAssigneeCandidates cache scan
          .mockResolvedValueOnce([
            makeCacheIssue({
              issueKey: 'SCRUM-20',
              assigneeName: 'Karam Waleed',
              assigneeAccountId: 'acc-karam',
            }),
            makeCacheIssue({
              issueKey: 'SCRUM-21',
              assigneeName: 'Other',
              assigneeAccountId: 'acc-other',
            }),
          ]);
        prisma.jiraIssueCacheEntry.count.mockResolvedValue(2);

        const snap = await collect({
          selectedSources: ['jira'],
          jiraAssigneeList: true,
          userQuery: 'Karam',
        });

        expect(
          snap.jiraIssues.some((d) => d.reference.entityId === 'SCRUM-20'),
        ).toBe(true);
        expect(
          snap.jiraIssues.some((d) => d.reference.entityId === 'SCRUM-21'),
        ).toBe(false);
      });

      it('handles non-Error assignee search failures', async () => {
        jiraService.findLiveConnectionForWorkspace.mockResolvedValue(
          makeLiveConnection(),
        );
        prisma.jiraConnection.findFirst.mockResolvedValue({
          userId: 'jira-user-1',
        });
        jiraService.searchIssuesByAssignee.mockRejectedValue('timeout');
        prisma.jiraIssueCacheEntry.findMany
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);
        prisma.jiraIssueCacheEntry.count.mockResolvedValue(0);

        const snap = await collect({
          selectedSources: ['jira'],
          assigneeQuery: 'Ghost',
        });

        expect(snap.jiraIssues[0].content).toContain('ASSIGNEE_LIST_EMPTY');
      });

      it('emits empty assignee list sentinel when nothing matches', async () => {
        jiraService.findLiveConnectionForWorkspace.mockResolvedValue(null);
        prisma.jiraConnection.findFirst.mockResolvedValue(null);
        prisma.jiraIssueCacheEntry.findMany
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);
        prisma.jiraIssueCacheEntry.count.mockResolvedValue(0);

        const snap = await collect({
          selectedSources: ['jira'],
          assigneeQuery: 'Ghost',
        });

        expect(snap.jiraIssues[0].content).toContain('ASSIGNEE_LIST_EMPTY');
        expect(snap.diagnostics[0].reasonCode).toBe('filters_excluded_all');
      });
    });

    describe('collectBlockers', () => {
      it('maps pulse blockers with optional fields omitted', async () => {
        prisma.pulseBlocker.count.mockResolvedValue(1);
        prisma.pulseBlocker.findMany.mockResolvedValue([
          {
            id: 'b1',
            title: null,
            description: 'Waiting on API keys from vendor for deployment',
            status: 'open',
            severity: 'high',
            category: null,
            linkedIssueKey: null,
            linkedIssueUrl: null,
            createdAt: NOW,
            user: { slackDisplayName: 'Ada', slackUserId: 'U1' },
          },
        ]);

        const snap = await collect({
          selectedSources: ['blockers'],
          userQuery: 'Ada',
          searchTokens: ['API'],
          dateFrom: NOW,
          latestStandupRunId: 'run-1',
          subjectUserId: 'u1',
          issueKey: 'SCRUM-1',
        });

        expect(snap.blockers[0].entity).toBe('blocker');
        expect(snap.blockers[0].title).toContain('Waiting on API');
        expect(snap.blockers[0].content).not.toContain('Title:');
      });

      it('uses dashboard path when blockersFullList is true', async () => {
        jiraBlockers.getBlockerStatsForWorkspace.mockResolvedValue({
          openBlockers: 2,
          critical: 1,
          waitingMoreThan3Days: 0,
          resolvedThisWeek: 0,
          total: 3,
          resolved: 1,
        });
        jiraBlockers.listDashboardBlockersForWorkspace.mockResolvedValue([
          {
            id: 'db1',
            title: 'Critical outage',
            description: 'Prod down',
            status: 'open',
            statusLabel: 'Open',
            priority: 'critical',
            category: 'infra',
            createdAt: NOW.toISOString(),
            resolvedAt: null,
            reporter: 'Ada',
            ownerName: 'Karam',
            ownerSlackId: 'U1',
            ownerUserId: 'u1',
            jiraIssue: { key: 'SCRUM-1', url: 'https://x/SCRUM-1' },
            slackThreadUrl: null,
          },
          {
            id: 'db2',
            title: null,
            description: 'Resolved already long text filler for title slice',
            status: 'resolved',
            statusLabel: 'Resolved',
            priority: 'low',
            category: null,
            createdAt: new Date('2026-03-10').toISOString(),
            resolvedAt: NOW.toISOString(),
            reporter: 'Bob',
            ownerName: null,
            ownerSlackId: null,
            ownerUserId: null,
            jiraIssue: null,
            slackThreadUrl: 'https://slack/t',
          },
          {
            id: 'db3',
            title: 'Other open',
            description: 'Waiting',
            status: 'in_progress',
            statusLabel: 'In Progress',
            priority: 'medium',
            category: null,
            createdAt: new Date('2026-03-14').toISOString(),
            resolvedAt: null,
            reporter: 'Cara',
            ownerName: '  ',
            ownerSlackId: 'U2',
            ownerUserId: null,
            jiraIssue: { key: 'SCRUM-2', url: null },
            slackThreadUrl: null,
          },
        ]);

        const snap = await collect({
          selectedSources: ['blockers'],
          blockersFullList: true,
          keyword: 'critical blockers',
        });

        expect(snap.blockers[0].content).toContain(
          'AUTHORITATIVE_BLOCKER_STATS',
        );
        expect(snap.blockers.some((d) => d.content.includes('AUTHORITATIVE_BLOCKER_OWNERS'))).toBe(
          true,
        );
        expect(snap.diagnostics[0].label).toBe('Blockers (dashboard)');
        // critical filter applied
        expect(
          snap.blockers.filter((d) => d.metadata?.fromDashboard === true),
        ).toHaveLength(1);
      });

      it('filters dashboard blockers by issueKey and skips owners doc when none open', async () => {
        jiraBlockers.getBlockerStatsForWorkspace.mockResolvedValue({
          openBlockers: 0,
          critical: 0,
          waitingMoreThan3Days: 0,
          resolvedThisWeek: 1,
          total: 1,
          resolved: 1,
        });
        jiraBlockers.listDashboardBlockersForWorkspace.mockResolvedValue([
          {
            id: 'db1',
            title: 'Done',
            description: 'Done',
            status: 'resolved',
            statusLabel: 'Resolved',
            priority: 'low',
            category: null,
            createdAt: NOW.toISOString(),
            resolvedAt: NOW.toISOString(),
            reporter: 'Ada',
            ownerName: 'Ada',
            ownerSlackId: 'U1',
            ownerUserId: 'u1',
            jiraIssue: { key: 'SCRUM-9', url: null },
            slackThreadUrl: null,
          },
        ]);

        const snap = await collect({
          selectedSources: ['blockers'],
          blockersFullList: true,
          issueKey: 'SCRUM-9',
          keyword: 'resolved',
        });

        expect(
          snap.blockers.some((d) =>
            d.content.includes('AUTHORITATIVE_BLOCKER_OWNERS'),
          ),
        ).toBe(false);
        expect(
          snap.blockers.filter((d) => d.metadata?.fromDashboard === true),
        ).toHaveLength(1);
      });

      it('returns no_records_in_db for empty dashboard', async () => {
        jiraBlockers.getBlockerStatsForWorkspace.mockResolvedValue({
          openBlockers: 0,
          critical: 0,
          waitingMoreThan3Days: 0,
          resolvedThisWeek: 0,
          total: 0,
          resolved: 0,
        });
        jiraBlockers.listDashboardBlockersForWorkspace.mockResolvedValue([]);

        const snap = await collect({
          selectedSources: ['blockers'],
          blockersFullList: true,
        });

        expect(snap.diagnostics[0].reasonCode).toBe('no_records_in_db');
        expect(snap.blockers).toHaveLength(1); // stats only
      });

      it('sorts open blockers before resolved and newer first within status', async () => {
        jiraBlockers.getBlockerStatsForWorkspace.mockResolvedValue({
          openBlockers: 2,
          critical: 0,
          waitingMoreThan3Days: 0,
          resolvedThisWeek: 1,
          total: 3,
          resolved: 1,
        });
        jiraBlockers.listDashboardBlockersForWorkspace.mockResolvedValue([
          {
            id: 'older-open',
            title: 'Older open',
            description: 'Older',
            status: 'open',
            statusLabel: 'Open',
            priority: 'medium',
            category: null,
            createdAt: '2026-03-01T00:00:00.000Z',
            resolvedAt: null,
            reporter: 'A',
            ownerName: 'Owner A',
            ownerSlackId: 'U1',
            ownerUserId: 'u1',
            jiraIssue: null,
            slackThreadUrl: null,
          },
          {
            id: 'resolved',
            title: 'Resolved',
            description: 'Done',
            status: 'resolved',
            statusLabel: 'Resolved',
            priority: 'low',
            category: null,
            createdAt: '2026-03-20T00:00:00.000Z',
            resolvedAt: '2026-03-21T00:00:00.000Z',
            reporter: 'B',
            ownerName: 'Owner B',
            ownerSlackId: 'U2',
            ownerUserId: 'u2',
            jiraIssue: null,
            slackThreadUrl: null,
          },
          {
            id: 'newer-open',
            title: 'Newer open',
            description: 'Newer',
            status: 'in_progress',
            statusLabel: 'In Progress',
            priority: 'high',
            category: null,
            createdAt: '2026-03-15T00:00:00.000Z',
            resolvedAt: null,
            reporter: 'C',
            ownerName: 'Owner C',
            ownerSlackId: 'U3',
            ownerUserId: 'u3',
            jiraIssue: null,
            slackThreadUrl: null,
          },
        ]);

        const snap = await collect({
          selectedSources: ['blockers'],
          blockersFullList: true,
          keyword: 'open blockers',
        });

        const dashboardDocs = snap.blockers.filter(
          (d) => d.metadata?.fromDashboard === true,
        );
        expect(dashboardDocs.map((d) => d.reference.entityId)).toEqual([
          'newer-open',
          'older-open',
          'resolved',
        ]);
      });

      it('maps pulse blockers with title category and linked jira', async () => {
        prisma.pulseBlocker.count.mockResolvedValue(1);
        prisma.pulseBlocker.findMany.mockResolvedValue([
          {
            id: 'b2',
            title: 'DB lock',
            description: 'Cannot migrate',
            status: 'open',
            severity: 'critical',
            category: 'infra',
            linkedIssueKey: 'SCRUM-7',
            linkedIssueUrl: 'https://x/SCRUM-7',
            createdAt: NOW,
            user: { slackDisplayName: 'Ada', slackUserId: 'U1' },
          },
        ]);

        const snap = await collect({ selectedSources: ['blockers'] });

        expect(snap.blockers[0].content).toContain('Title: DB lock');
        expect(snap.blockers[0].content).toContain('Category: infra');
        expect(snap.blockers[0].content).toContain('Linked Jira: SCRUM-7');
      });
    });

    describe('collectBlockerUpdates', () => {
      it('maps updates with optional notes/resolution/daysOpen', async () => {
        prisma.pulseBlockerUpdate.count.mockResolvedValue(1);
        prisma.pulseBlockerUpdate.findMany.mockResolvedValue([
          {
            id: 'bu1',
            blockerId: 'b1',
            previousStatus: 'open',
            newStatus: 'resolved',
            notes: 'Fixed',
            resolutionType: 'done',
            daysOpen: 3,
            updatedFrom: 'slack',
            createdAt: NOW,
            user: { slackDisplayName: 'Ada' },
            blocker: {
              id: 'b1',
              title: 'API keys',
              linkedIssueKey: 'SCRUM-1',
              linkedIssueUrl: 'https://x',
            },
          },
          {
            id: 'bu2',
            blockerId: 'b2',
            previousStatus: 'open',
            newStatus: 'open',
            notes: null,
            resolutionType: null,
            daysOpen: null,
            updatedFrom: 'web',
            createdAt: NOW,
            user: { slackDisplayName: 'Bob' },
            blocker: {
              id: 'b2',
              title: null,
              linkedIssueKey: null,
              linkedIssueUrl: null,
            },
          },
        ]);

        const snap = await collect({
          selectedSources: ['blocker_updates'],
          searchTokens: ['Fixed'],
          issueKey: 'SCRUM-1',
          dateFrom: NOW,
        });

        expect(snap.blockerUpdates).toHaveLength(2);
        expect(snap.blockerUpdates[0].content).toContain('Days open: 3');
        expect(snap.blockerUpdates[1].title).toContain('Follow-up: b2');
      });
    });

    describe('collectReports', () => {
      it('maps digests including empty report fallback', async () => {
        prisma.aiDigest.count.mockResolvedValue(2);
        prisma.aiDigest.findMany.mockResolvedValue([
          {
            id: 'd1',
            runId: 'run-1',
            teamId: 't1',
            summary: 'Good day',
            themes: ['auth'],
            blockers: [{ id: 1 }],
            createdAt: NOW,
            run: { checkIn: { name: 'Daily' } },
            team: { name: 'Platform' },
          },
          {
            id: 'd2',
            runId: 'run-2',
            teamId: 't1',
            summary: null,
            themes: null,
            blockers: null,
            createdAt: NOW,
            run: { checkIn: null },
            team: { name: 'Platform' },
          },
        ]);

        const snap = await collect({
          selectedSources: ['reports'],
          searchTokens: ['auth'],
          dateFrom: NOW,
        });

        expect(snap.reports).toHaveLength(2);
        expect(snap.reports[0].content).toContain('Themes:');
        expect(snap.reports[1].content).toBe('(empty report)');
      });
    });

    describe('collectUsers / Slack members', () => {
      it('uses Live Slack humans when sync succeeds', async () => {
        slackMemberCache.syncFromLive.mockResolvedValue({
          source: 'live_slack',
          humans: [
            {
              slackUserId: 'U1',
              displayName: 'Ada',
              realName: 'Ada Lovelace',
              email: 'ada@acme.com',
              isBot: false,
              deleted: false,
            },
          ],
        });
        prisma.slackMemberCache.count.mockResolvedValue(1);

        const snap = await collect({
          selectedSources: ['slack_members'],
          slackMembersOnly: true,
        });

        expect(snap.users[0].content).toContain('Data source: Live Slack');
        expect(snap.diagnostics[0].label).toBe('Slack Members (live)');
      });

      it('falls back to SlackMemberCache and marks Demo workspace', async () => {
        slackMemberCache.syncFromLive.mockRejectedValue(new Error('no token'));
        slackMemberCache.listHumanCache.mockResolvedValue([
          {
            slackUserId: 'U0DM1',
            displayName: 'Demo User',
            realName: null,
            email: null,
            isBot: false,
            deleted: false,
          },
        ]);
        prisma.workspace.findUnique.mockResolvedValue({
          slackWorkspaceId: 'T_DEMO_PULSE_WS',
        });
        prisma.slackMemberCache.count.mockResolvedValue(1);

        const snap = await collect({ selectedSources: ['slack_members'] });

        expect(snap.users[0].content).toContain('Data source: Demo');
      });

      it('labels SlackMemberCache when workspace is not demo', async () => {
        slackMemberCache.syncFromLive.mockResolvedValue({
          source: 'cache',
          humans: [],
        });
        slackMemberCache.listHumanCache.mockResolvedValue([
          {
            slackUserId: 'U55',
            displayName: 'Cached Ada',
            realName: 'Ada',
            email: 'ada@acme.com',
            isBot: false,
            deleted: false,
          },
        ]);
        prisma.workspace.findUnique.mockResolvedValue({
          slackWorkspaceId: 'T_REAL',
        });
        prisma.slackMemberCache.count.mockResolvedValue(1);

        const snap = await collect({ selectedSources: ['slack_members'] });

        expect(snap.users[0].content).toContain('Data source: SlackMemberCache');
      });

      it('falls back to TeamMember then filters placeholders and name tokens', async () => {
        slackMemberCache.syncFromLive.mockResolvedValue({
          source: 'none',
          humans: [],
        });
        slackMemberCache.listHumanCache.mockResolvedValue([]);
        prisma.teamMember.findMany.mockResolvedValue([
          {
            user: {
              slackUserId: 'U1',
              slackDisplayName: 'Ada',
              slackRealName: null,
              email: 'ada@acme.com',
            },
          },
          {
            user: {
              slackUserId: 'U2',
              slackDisplayName: 'Bob',
              slackRealName: 'Robert',
              email: 'bob@acme.com',
            },
          },
          {
            user: {
              slackUserId: 'verify-slack-user',
              slackDisplayName: 'Placeholder',
              slackRealName: null,
              email: null,
            },
          },
        ]);
        prisma.slackMemberCache.count.mockResolvedValue(0);

        const snap = await collect({
          selectedSources: ['slack_members'],
          userQuery: 'Ada',
        });

        expect(snap.users).toHaveLength(1);
        expect(snap.users[0].content).toContain('Data source: TeamMember');
      });

      it('prefers slackRealName for TeamMember display labels', async () => {
        slackMemberCache.syncFromLive.mockResolvedValue({
          source: 'none',
          humans: [],
        });
        slackMemberCache.listHumanCache.mockResolvedValue([]);
        prisma.teamMember.findMany.mockResolvedValue([
          {
            user: {
              slackUserId: 'U7',
              slackDisplayName: 'nick',
              slackRealName: 'Real Name',
              email: null,
            },
          },
        ]);
        prisma.slackMemberCache.count.mockResolvedValue(0);

        const snap = await collect({ selectedSources: ['slack_members'] });

        expect(snap.users[0].title).toBe('Real Name');
      });

      it('falls back to User table and labels non-demo as User', async () => {
        slackMemberCache.syncFromLive.mockResolvedValue({
          source: 'none',
          humans: [],
        });
        slackMemberCache.listHumanCache.mockResolvedValue([]);
        prisma.teamMember.findMany.mockResolvedValue([]);
        prisma.user.findMany.mockResolvedValue([
          {
            slackUserId: 'U9',
            slackDisplayName: 'Zoe',
            slackRealName: '  ',
            email: 'zoe@acme.com',
          },
          {
            slackUserId: 'U10',
            slackDisplayName: '  ',
            slackRealName: null,
            email: null,
          },
        ]);
        prisma.workspace.findUnique.mockResolvedValue({
          slackWorkspaceId: 'T_REAL',
        });
        prisma.slackMemberCache.count.mockResolvedValue(0);

        const snap = await collect({ selectedSources: ['slack_members'] });

        expect(snap.users[0].content).toContain('Data source: User');
        expect(snap.users[0].title).toBe('Zoe');
        expect(snap.users[1].title).toBe('U10');
      });

      it('handles non-Error slack live sync failures', async () => {
        slackMemberCache.syncFromLive.mockRejectedValue('sync-fail');
        slackMemberCache.listHumanCache.mockResolvedValue([]);
        prisma.teamMember.findMany.mockResolvedValue([]);
        prisma.user.findMany.mockResolvedValue([]);
        prisma.slackMemberCache.count.mockResolvedValue(0);

        const snap = await collect({ selectedSources: ['slack_members'] });

        expect(snap.users).toHaveLength(0);
      });

      it('labels User fallback as Demo when workspace is demo', async () => {
        slackMemberCache.syncFromLive.mockResolvedValue({
          source: 'none',
          humans: [],
        });
        slackMemberCache.listHumanCache.mockResolvedValue([]);
        prisma.teamMember.findMany.mockResolvedValue([]);
        prisma.user.findMany.mockResolvedValue([
          {
            slackUserId: 'U0DM2',
            slackDisplayName: 'Demo Two',
            slackRealName: null,
            email: null,
          },
        ]);
        prisma.workspace.findUnique.mockResolvedValue({
          slackWorkspaceId: DEMO_SLACK_WORKSPACE_ID,
        });
        prisma.slackMemberCache.count.mockResolvedValue(0);

        const snap = await collect({ selectedSources: ['slack_members'] });

        expect(snap.users[0].content).toContain('Data source: Demo');
      });

      it('returns none source reason when no members found', async () => {
        slackMemberCache.syncFromLive.mockResolvedValue({
          source: 'none',
          humans: [],
        });
        slackMemberCache.listHumanCache.mockResolvedValue([]);
        prisma.teamMember.findMany.mockResolvedValue([]);
        prisma.user.findMany.mockResolvedValue([]);
        prisma.slackMemberCache.count.mockResolvedValue(0);

        const snap = await collect({ selectedSources: ['slack_members'] });

        expect(snap.users).toHaveLength(0);
        expect(snap.diagnostics[0].reasonCode).toBe('no_records_in_db');
      });
    });

    describe('collectJiraMembers', () => {
      it('uses live jira members when sync succeeds', async () => {
        jiraMemberCache.syncFromLive.mockResolvedValue({
          source: 'live_jira',
          members: [
            {
              accountId: 'acc-1',
              displayName: 'Karam',
              email: 'k@acme.com',
              accountType: 'atlassian',
              active: true,
            },
          ],
        });
        prisma.jiraMemberCache.count.mockResolvedValue(1);

        const snap = await collect({
          selectedSources: ['jira_members'],
          jiraMembersOnly: true,
        });

        expect(snap.documents[0].entity).toBe('jira_member');
        expect(snap.documents[0].content).toContain('Data source: Live Jira');
        expect(snap.diagnostics[0].label).toBe('Jira Members (live)');
      });

      it('handles non-Error jira member sync failures', async () => {
        jiraMemberCache.syncFromLive.mockRejectedValue('oauth-down');
        jiraMemberCache.listActiveCache.mockResolvedValue([]);
        prisma.jiraMemberCache.count.mockResolvedValue(0);

        const snap = await collect({ selectedSources: ['jira_members'] });

        expect(snap.documents).toHaveLength(0);
        expect(snap.diagnostics[0].reasonCode).toBe('no_records_in_db');
      });

      it('falls back to cache and marks Demo', async () => {
        jiraMemberCache.syncFromLive.mockRejectedValue(new Error('oauth'));
        jiraMemberCache.listActiveCache.mockResolvedValue([
          {
            accountId: 'acc-d',
            displayName: 'Demo Jira',
            email: null,
            accountType: null,
            active: false,
          },
        ]);
        prisma.workspace.findUnique.mockResolvedValue({
          slackWorkspaceId: DEMO_SLACK_WORKSPACE_ID,
        });
        prisma.jiraMemberCache.count.mockResolvedValue(1);

        const snap = await collect({
          selectedSources: ['jira_members'],
          userQuery: 'Demo',
        });

        expect(snap.documents[0].content).toContain('Data source: Demo');
        expect(snap.documents[0].content).toContain('Active: false');
      });

      it('labels JiraMemberCache for non-demo workspaces', async () => {
        jiraMemberCache.syncFromLive.mockResolvedValue({
          source: 'none',
          members: [],
        });
        jiraMemberCache.listActiveCache.mockResolvedValue([
          {
            accountId: 'acc-2',
            displayName: 'Cached Jira',
            email: 'c@acme.com',
            accountType: 'atlassian',
            active: true,
          },
        ]);
        prisma.workspace.findUnique.mockResolvedValue({
          slackWorkspaceId: 'T_REAL',
        });
        prisma.jiraMemberCache.count.mockResolvedValue(1);

        const snap = await collect({ selectedSources: ['jira_members'] });

        expect(snap.documents[0].content).toContain(
          'Data source: JiraMemberCache',
        );
      });

      it('returns none when empty after filter', async () => {
        jiraMemberCache.syncFromLive.mockResolvedValue({
          source: 'none',
          members: [],
        });
        jiraMemberCache.listActiveCache.mockResolvedValue([
          {
            accountId: 'acc-1',
            displayName: 'Ada',
            email: null,
            accountType: null,
            active: true,
          },
        ]);
        prisma.workspace.findUnique.mockResolvedValue({
          slackWorkspaceId: 'T_REAL',
        });
        prisma.jiraMemberCache.count.mockResolvedValue(1);

        const snap = await collect({
          selectedSources: ['jira_members'],
          userQuery: 'zzzz-no-match',
        });

        expect(snap.documents).toHaveLength(0);
      });
    });

    describe('collectSlackChannels', () => {
      it('maps channels with optional topic/purpose/memberCount', async () => {
        prisma.slackChannel.count.mockResolvedValue(2);
        prisma.slackChannel.findMany.mockResolvedValue([
          {
            slackChannelId: 'C1',
            name: 'general',
            topic: 'All hands',
            purpose: 'Chat',
            memberCount: 10,
            isPrivate: false,
            updatedAt: NOW,
          },
          {
            slackChannelId: 'C2',
            name: 'secret',
            topic: null,
            purpose: null,
            memberCount: null,
            isPrivate: true,
            updatedAt: NOW,
          },
        ]);

        const snap = await collect({
          selectedSources: ['slack_channels'],
          searchTokens: ['general'],
        });

        const channels = snap.documents.filter(
          (d) => d.entity === 'slack_channel',
        );
        expect(channels).toHaveLength(2);
        expect(channels[0].content).toContain('Visibility: public');
        expect(channels[1].content).toContain('Visibility: private');
      });
    });

    describe('collectTeamMemory', () => {
      it('maps team memory documents', async () => {
        prisma.teamMemoryDocument.count.mockResolvedValue(1);
        prisma.teamMemoryDocument.findMany.mockResolvedValue([
          {
            id: 'tm1',
            title: 'Decision',
            content: 'We chose Postgres',
            indexedAt: NOW,
            sourceType: 'NOTE',
            sourceId: 'n1',
            issueKey: 'SCRUM-1',
            runId: 'run-1',
          },
        ]);

        const snap = await collect({
          selectedSources: ['team_memory'],
          issueKey: 'SCRUM-1',
          dateFrom: NOW,
        });

        expect(snap.teamMemory[0]).toMatchObject({
          entity: 'team_memory',
          title: 'Decision',
        });
      });

      it('uses token OR when no issueKey', async () => {
        prisma.teamMemoryDocument.count.mockResolvedValue(0);
        prisma.teamMemoryDocument.findMany.mockResolvedValue([]);

        const snap = await collect({
          selectedSources: ['team_memory'],
          searchTokens: ['postgres'],
        });

        expect(snap.diagnostics[0].reasonCode).toBe('no_records_in_db');
      });
    });

    describe('collectJiraAudits', () => {
      it('maps audit logs with and without issue/metadata', async () => {
        prisma.jiraAuditLog.count.mockResolvedValue(2);
        prisma.jiraAuditLog.findMany.mockResolvedValue([
          {
            id: 'a1',
            actionType: 'transition',
            status: 'ok',
            jiraIssueKey: 'SCRUM-1',
            metadata: { from: 'To Do' },
            createdAt: NOW,
            user: { slackDisplayName: 'Ada' },
          },
          {
            id: 'a2',
            actionType: 'comment',
            status: 'ok',
            jiraIssueKey: null,
            metadata: null,
            createdAt: NOW,
            user: { slackDisplayName: 'Bob' },
          },
        ]);

        const snap = await collect({
          selectedSources: ['jira_audit'],
          issueKey: 'scrum-1',
          dateFrom: NOW,
        });

        const audits = snap.documents.filter((d) => d.entity === 'jira_audit');
        expect(audits).toHaveLength(2);
        expect(audits[0].content).toContain('Metadata:');
        expect(audits[1].title).toBe('Jira audit — comment');
      });

      it('applies searchTokens OR filter when issueKey is absent', async () => {
        prisma.jiraAuditLog.count.mockResolvedValue(1);
        prisma.jiraAuditLog.findMany.mockResolvedValue([
          {
            id: 'a3',
            actionType: 'transition',
            status: 'ok',
            jiraIssueKey: 'SCRUM-8',
            metadata: null,
            createdAt: NOW,
            user: { slackDisplayName: 'Cara' },
          },
        ]);

        const snap = await collect({
          selectedSources: ['jira_audit'],
          searchTokens: ['transition'],
        });

        expect(prisma.jiraAuditLog.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              OR: expect.any(Array),
            }),
          }),
        );
        expect(snap.documents[0].reference.entityId).toBe('a3');
      });
    });

    describe('collectSlackAiChats', () => {
      it('maps slack AI chat logs', async () => {
        prisma.slackAiChatLog.count.mockResolvedValue(1);
        prisma.slackAiChatLog.findMany.mockResolvedValue([
          {
            id: 'c1',
            question: 'Any blockers?',
            answer: 'None',
            intent: 'GET_BLOCKERS',
            confidence: 'High',
            conversationId: 'conv-1',
            createdAt: NOW,
            user: { slackDisplayName: 'Ada' },
          },
          {
            id: 'c2',
            question: 'Hi',
            answer: 'Hello',
            intent: null,
            confidence: null,
            conversationId: null,
            createdAt: NOW,
            user: { slackDisplayName: 'Bob' },
          },
        ]);

        const snap = await collect({
          selectedSources: ['slack_ai_chat'],
          userQuery: 'Ada',
          searchTokens: ['blockers'],
          dateFrom: NOW,
        });

        const chats = snap.documents.filter((d) => d.entity === 'ai_chat');
        expect(chats).toHaveLength(2);
        expect(chats[0].content).toContain('Intent: GET_BLOCKERS');
      });
    });

    describe('collectAiConversations', () => {
      it('maps conversation messages and caps take', async () => {
        prisma.aiConversation.count.mockResolvedValue(1);
        prisma.aiConversationMessage.findMany.mockResolvedValue([
          {
            id: 'm1',
            role: 'user',
            content: 'Status of SCRUM-1?',
            intent: 'ISSUE_STATUS',
            createdAt: NOW,
            conversation: { id: 'conv-aaaaaaaa', title: 'Status ask' },
          },
          {
            id: 'm2',
            role: 'assistant',
            content: 'Done',
            intent: null,
            createdAt: NOW,
            conversation: { id: 'conv-bbbbbbbb', title: null },
          },
        ]);

        const snap = await collect({
          selectedSources: ['ai_conversations'],
          issueKey: 'SCRUM-1',
          searchTokens: ['status'],
          dateFrom: NOW,
        });

        const chats = snap.documents.filter((d) => d.entity === 'ai_chat');
        expect(chats).toHaveLength(2);
        expect(chats[0].content).toContain('CONTEXT_ONLY');
        expect(chats[1].title).toContain('AI history — conv-bbb');
      });
    });

    it('uses keyword-derived tokens when searchTokens absent', async () => {
      prisma.slackChannel.count.mockResolvedValue(0);
      prisma.slackChannel.findMany.mockResolvedValue([]);

      await collect({
        selectedSources: ['slack_channels'],
        keyword: 'engineering channel topic',
      });

      expect(prisma.slackChannel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.any(Array),
          }),
        }),
      );
    });
  });
});
