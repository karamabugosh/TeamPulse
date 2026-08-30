import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryAclContext } from './memory-retrieval.types';
import { MemoryAclService } from './memory-acl.service';

type PrismaMock = {
  user: {
    findFirst: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
  teamMember: {
    findMany: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
};

function makeAcl(overrides: Partial<MemoryAclContext> = {}): MemoryAclContext {
  return {
    workspaceId: 'ws-1',
    userId: 'user-1',
    authorizedTeamIds: ['team-a'],
    userInWorkspace: true,
    ...overrides,
  };
}

describe('MemoryAclService', () => {
  let service: MemoryAclService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = {
      user: { findFirst: jest.fn() },
      teamMember: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryAclService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(MemoryAclService);
  });

  describe('resolveContext', () => {
    it('returns fail-closed context when workspaceId is blank', async () => {
      const result = await service.resolveContext({
        workspaceId: '   ',
        userId: 'user-1',
      });

      expect(result).toEqual({
        workspaceId: '',
        userId: 'user-1',
        authorizedTeamIds: [],
        userInWorkspace: false,
      });
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('returns fail-closed context when userId is blank', async () => {
      const result = await service.resolveContext({
        workspaceId: 'ws-1',
        userId: '',
      });

      expect(result.userInWorkspace).toBe(false);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('returns fail-closed context when both ids are missing at runtime', async () => {
      const result = await service.resolveContext({
        workspaceId: undefined as unknown as string,
        userId: undefined as unknown as string,
      });

      expect(result).toEqual({
        workspaceId: '',
        userId: '',
        authorizedTeamIds: [],
        userInWorkspace: false,
      });
    });

    it('returns fail-closed context when user is not in workspace', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await service.resolveContext({
        workspaceId: '  ws-1  ',
        userId: '  user-9  ',
      });

      expect(result).toEqual({
        workspaceId: 'ws-1',
        userId: 'user-9',
        authorizedTeamIds: [],
        userInWorkspace: false,
      });
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-9', workspaceId: 'ws-1' },
        select: { id: true },
      });
      expect(prisma.teamMember.findMany).not.toHaveBeenCalled();
    });

    it('returns deduplicated authorized team ids for active memberships', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
      prisma.teamMember.findMany.mockResolvedValue([
        { teamId: 'team-a' },
        { teamId: 'team-a' },
        { teamId: 'team-b' },
      ]);

      const result = await service.resolveContext({
        workspaceId: 'ws-1',
        userId: 'user-1',
      });

      expect(result).toEqual({
        workspaceId: 'ws-1',
        userId: 'user-1',
        authorizedTeamIds: ['team-a', 'team-b'],
        userInWorkspace: true,
      });
      expect(prisma.teamMember.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          optedOut: false,
          team: { workspaceId: 'ws-1' },
        },
        select: { teamId: true },
      });
    });

    it('returns empty team ids when user exists but has no memberships', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
      prisma.teamMember.findMany.mockResolvedValue([]);

      const result = await service.resolveContext({
        workspaceId: 'ws-1',
        userId: 'user-1',
      });

      expect(result.authorizedTeamIds).toEqual([]);
      expect(result.userInWorkspace).toBe(true);
    });
  });

  describe('buildAclSql', () => {
    it('builds workspace/private SQL when no authorized teams', () => {
      const acl = makeAcl({ authorizedTeamIds: [] });

      const result = service.buildAclSql({ acl, startIndex: 2 });

      expect(result.values).toEqual(['user-1']);
      expect(result.sql).toContain(`"visibility" = 'WORKSPACE'`);
      expect(result.sql).toContain(`"ownerUserId" = $2`);
      expect(result.sql).not.toContain('TEAM');
    });

    it('builds team-aware SQL when authorized teams exist', () => {
      const acl = makeAcl({ authorizedTeamIds: ['team-a', 'team-b'] });

      const result = service.buildAclSql({ acl, startIndex: 5 });

      expect(result.values).toEqual(['user-1', ['team-a', 'team-b']]);
      expect(result.sql).toContain(`"visibility" = 'TEAM'`);
      expect(result.sql).toContain(`"teamId" = ANY($6::text[])`);
      expect(result.sql).toContain(`"ownerUserId" = $5`);
    });
  });

  describe('isChunkAuthorized', () => {
    const acl = makeAcl();

    it('denies when user is not in workspace', () => {
      expect(
        service.isChunkAuthorized(
          { visibility: 'WORKSPACE', teamId: null, ownerUserId: null },
          makeAcl({ userInWorkspace: false }),
        ),
      ).toBe(false);
    });

    it('denies when chunk workspace differs from acl workspace', () => {
      expect(
        service.isChunkAuthorized(
          {
            workspaceId: 'other-ws',
            visibility: 'WORKSPACE',
            teamId: null,
            ownerUserId: null,
          },
          acl,
        ),
      ).toBe(false);
    });

    it('allows WORKSPACE visibility chunks in the same workspace', () => {
      expect(
        service.isChunkAuthorized(
          {
            workspaceId: 'ws-1',
            visibility: 'WORKSPACE',
            teamId: null,
            ownerUserId: null,
          },
          acl,
        ),
      ).toBe(true);
    });

    it('allows WORKSPACE chunks when chunk workspace is omitted', () => {
      expect(
        service.isChunkAuthorized(
          { visibility: 'WORKSPACE', teamId: null, ownerUserId: null },
          acl,
        ),
      ).toBe(true);
    });

    it('denies TEAM chunks without teamId', () => {
      expect(
        service.isChunkAuthorized(
          { visibility: 'TEAM', teamId: null, ownerUserId: null },
          acl,
        ),
      ).toBe(false);
    });

    it('allows TEAM chunks when teamId is authorized', () => {
      expect(
        service.isChunkAuthorized(
          { visibility: 'TEAM', teamId: 'team-a', ownerUserId: null },
          acl,
        ),
      ).toBe(true);
    });

    it('denies TEAM chunks when teamId is not authorized', () => {
      expect(
        service.isChunkAuthorized(
          { visibility: 'TEAM', teamId: 'team-x', ownerUserId: null },
          acl,
        ),
      ).toBe(false);
    });

    it('denies PRIVATE chunks without ownerUserId', () => {
      expect(
        service.isChunkAuthorized(
          { visibility: 'PRIVATE', teamId: null, ownerUserId: null },
          acl,
        ),
      ).toBe(false);
    });

    it('allows PRIVATE chunks owned by the acl user', () => {
      expect(
        service.isChunkAuthorized(
          { visibility: 'PRIVATE', teamId: null, ownerUserId: 'user-1' },
          acl,
        ),
      ).toBe(true);
    });

    it('denies PRIVATE chunks owned by another user', () => {
      expect(
        service.isChunkAuthorized(
          { visibility: 'PRIVATE', teamId: null, ownerUserId: 'other' },
          acl,
        ),
      ).toBe(false);
    });

    it('denies unknown visibility values', () => {
      expect(
        service.isChunkAuthorized(
          { visibility: 'SECRET', teamId: null, ownerUserId: null },
          acl,
        ),
      ).toBe(false);
    });
  });
});
