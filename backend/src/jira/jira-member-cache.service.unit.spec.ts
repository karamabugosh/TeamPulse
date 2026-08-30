import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { DEMO_SLACK_WORKSPACE_ID } from '../demo/demo.constants';
import { PrismaService } from '../prisma/prisma.service';
import { JiraMemberCacheService } from './jira-member-cache.service';
import { JiraService } from './jira.service';

describe('JiraMemberCacheService', () => {
  let service: JiraMemberCacheService;
  let prisma: {
    workspace: {
      findUnique: jest.MockedFunction<(args: unknown) => Promise<unknown>>;
    };
    jiraMemberCache: {
      upsert: jest.MockedFunction<(args: unknown) => Promise<unknown>>;
      findMany: jest.MockedFunction<(args: unknown) => Promise<unknown>>;
      updateMany: jest.MockedFunction<(args: unknown) => Promise<unknown>>;
    };
  };
  let jiraService: {
    findLiveConnectionForWorkspace: jest.MockedFunction<
      (workspaceId: string) => Promise<unknown>
    >;
    listWorkspaceMembers: jest.MockedFunction<
      (args: unknown) => Promise<unknown>
    >;
  };

  const connection = { id: 'conn-1', workspaceId: 'ws-1' };

  beforeEach(async () => {
    prisma = {
      workspace: {
        findUnique: jest.fn<(args: unknown) => Promise<unknown>>(),
      },
      jiraMemberCache: {
        upsert: jest.fn<(args: unknown) => Promise<unknown>>().mockResolvedValue({}),
        findMany: jest.fn<(args: unknown) => Promise<unknown>>(),
        updateMany: jest.fn<(args: unknown) => Promise<unknown>>().mockResolvedValue({ count: 0 }),
      },
    };
    jiraService = {
      findLiveConnectionForWorkspace: jest.fn<
        (workspaceId: string) => Promise<unknown>
      >(),
      listWorkspaceMembers: jest.fn<(args: unknown) => Promise<unknown>>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JiraMemberCacheService,
        { provide: PrismaService, useValue: prisma },
        { provide: JiraService, useValue: jiraService },
      ],
    }).compile();

    service = module.get(JiraMemberCacheService);
  });

  describe('hasUsableLiveJira', () => {
    it('returns true when a live connection exists', async () => {
      jiraService.findLiveConnectionForWorkspace.mockResolvedValue(connection);

      await expect(service.hasUsableLiveJira('ws-1')).resolves.toBe(true);
    });

    it('returns false when no connection exists', async () => {
      jiraService.findLiveConnectionForWorkspace.mockResolvedValue(null);

      await expect(service.hasUsableLiveJira('ws-1')).resolves.toBe(false);
    });
  });

  describe('listActiveCache', () => {
    it('maps active cache rows sorted by display name', async () => {
      prisma.jiraMemberCache.findMany.mockResolvedValue([
        {
          accountId: 'a1',
          displayName: 'Alice',
          email: 'a@test.com',
          avatarUrl: null,
          accountType: 'atlassian',
          active: true,
        },
      ]);

      const rows = await service.listActiveCache('ws-1');

      expect(rows).toEqual([
        {
          accountId: 'a1',
          displayName: 'Alice',
          email: 'a@test.com',
          avatarUrl: null,
          accountType: 'atlassian',
          active: true,
        },
      ]);
      expect(prisma.jiraMemberCache.findMany).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-1', active: true },
        orderBy: { displayName: 'asc' },
      });
    });
  });

  describe('syncFromLive', () => {
    it('returns none when workspace is missing', async () => {
      prisma.workspace.findUnique.mockResolvedValue(null);

      await expect(service.syncFromLive('missing')).resolves.toEqual({
        source: 'none',
        synced: 0,
        members: [],
      });
    });

    it('skips live sync for demo workspace', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'demo-ws',
        slackWorkspaceId: DEMO_SLACK_WORKSPACE_ID,
      });

      const result = await service.syncFromLive('demo-ws');

      expect(result).toEqual({ source: 'none', synced: 0, members: [] });
      expect(jiraService.findLiveConnectionForWorkspace).not.toHaveBeenCalled();
    });

    it('returns none when no usable Jira connection exists', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        slackWorkspaceId: 'T123',
      });
      jiraService.findLiveConnectionForWorkspace.mockResolvedValue(null);

      const result = await service.syncFromLive('ws-1');

      expect(result.source).toBe('none');
      expect(jiraService.listWorkspaceMembers).not.toHaveBeenCalled();
    });

    it('returns none when live member list throws an Error', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        slackWorkspaceId: 'T123',
      });
      jiraService.findLiveConnectionForWorkspace.mockResolvedValue(connection);
      jiraService.listWorkspaceMembers.mockRejectedValue(new Error('Jira down'));

      const result = await service.syncFromLive('ws-1');

      expect(result).toEqual({ source: 'none', synced: 0, members: [] });
    });

    it('returns none when live member list throws a non-Error', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        slackWorkspaceId: 'T123',
      });
      jiraService.findLiveConnectionForWorkspace.mockResolvedValue(connection);
      jiraService.listWorkspaceMembers.mockRejectedValue('timeout');

      await expect(service.syncFromLive('ws-1')).resolves.toEqual({
        source: 'none',
        synced: 0,
        members: [],
      });
    });

    it('upserts active members and deactivates stale cache rows', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        slackWorkspaceId: 'T123',
      });
      jiraService.findLiveConnectionForWorkspace.mockResolvedValue(connection);
      jiraService.listWorkspaceMembers.mockResolvedValue([
        {
          accountId: 'acc-1',
          displayName: 'Bob',
          emailAddress: 'bob@test.com',
          avatarUrl: 'https://avatar',
          accountType: 'atlassian',
          active: true,
        },
        {
          accountId: 'acc-2',
          displayName: '  Carol  ',
          active: false,
        },
        {
          accountId: '',
          displayName: 'Skip Me',
        },
        {
          accountId: 'acc-3',
          displayName: '   ',
        },
        {
          accountId: 'acc-4',
          displayName: undefined,
        },
      ]);
      prisma.jiraMemberCache.findMany.mockResolvedValue([{ id: 'stale-1' }]);

      const result = await service.syncFromLive('ws-1');

      expect(result.source).toBe('live_jira');
      expect(result.synced).toBe(2);
      expect(result.members).toEqual([
        {
          accountId: 'acc-1',
          displayName: 'Bob',
          email: 'bob@test.com',
          avatarUrl: 'https://avatar',
          accountType: 'atlassian',
          active: true,
        },
      ]);
      expect(prisma.jiraMemberCache.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.jiraMemberCache.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['stale-1'] } },
        data: { active: false },
      });
    });

    it('does not deactivate stale rows when none are returned', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        slackWorkspaceId: 'T123',
      });
      jiraService.findLiveConnectionForWorkspace.mockResolvedValue(connection);
      jiraService.listWorkspaceMembers.mockResolvedValue([
        { accountId: 'acc-1', displayName: 'Zara', active: true },
      ]);
      prisma.jiraMemberCache.findMany.mockResolvedValue([]);

      await service.syncFromLive('ws-1');

      expect(prisma.jiraMemberCache.updateMany).not.toHaveBeenCalled();
    });

    it('skips stale deactivation when every live member was filtered out', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        slackWorkspaceId: 'T123',
      });
      jiraService.findLiveConnectionForWorkspace.mockResolvedValue(connection);
      jiraService.listWorkspaceMembers.mockResolvedValue([
        { accountId: '', displayName: 'Bad' },
      ]);

      const result = await service.syncFromLive('ws-1');

      expect(result.synced).toBe(0);
      expect(prisma.jiraMemberCache.findMany).not.toHaveBeenCalled();
    });

    it('sorts active members alphabetically by display name', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        slackWorkspaceId: 'T123',
      });
      jiraService.findLiveConnectionForWorkspace.mockResolvedValue(connection);
      jiraService.listWorkspaceMembers.mockResolvedValue([
        { accountId: 'z', displayName: 'Zara', active: true },
        { accountId: 'a', displayName: 'Alice', active: true },
      ]);
      prisma.jiraMemberCache.findMany.mockResolvedValue([]);

      const result = await service.syncFromLive('ws-1');

      expect(result.members.map((m) => m.displayName)).toEqual(['Alice', 'Zara']);
    });

    it('defaults optional member fields to null on upsert', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        slackWorkspaceId: 'T123',
      });
      jiraService.findLiveConnectionForWorkspace.mockResolvedValue(connection);
      jiraService.listWorkspaceMembers.mockResolvedValue([
        { accountId: 'acc-1', displayName: 'Min', active: true },
      ]);
      prisma.jiraMemberCache.findMany.mockResolvedValue([]);

      await service.syncFromLive('ws-1');

      expect(prisma.jiraMemberCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            email: null,
            avatarUrl: null,
            accountType: null,
          }),
        }),
      );
    });
  });
});
