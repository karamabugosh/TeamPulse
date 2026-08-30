import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { PrismaService } from '../prisma/prisma.service';
import { JiraAuditService } from './jira-audit.service';

type PrismaMock = {
  user: {
    findUnique: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
  jiraAuditLog: {
    create: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
    findMany: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
};

describe('JiraAuditService', () => {
  let service: JiraAuditService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() },
      jiraAuditLog: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JiraAuditService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(JiraAuditService);
  });

  describe('record', () => {
    it('creates an audit log when the user has a workspace', async () => {
      const created = {
        id: 'audit-1',
        workspaceId: 'ws-1',
        userId: 'user-1',
        actionType: 'COMMENT',
        status: 'success',
      };
      prisma.user.findUnique.mockResolvedValue({ workspaceId: 'ws-1' });
      prisma.jiraAuditLog.create.mockResolvedValue(created);

      const result = await service.record({
        userId: 'user-1',
        proposedActionId: 'pa-1',
        actionType: 'COMMENT',
        jiraIssueKey: 'SCRUM-1',
        status: 'success',
        metadata: { note: 'ok' },
      });

      expect(result).toEqual(created);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { workspaceId: true },
      });
      expect(prisma.jiraAuditLog.create).toHaveBeenCalledWith({
        data: {
          workspaceId: 'ws-1',
          userId: 'user-1',
          proposedActionId: 'pa-1',
          actionType: 'COMMENT',
          jiraIssueKey: 'SCRUM-1',
          status: 'success',
          metadata: { note: 'ok' } as Prisma.InputJsonValue,
        },
      });
    });

    it('defaults optional fields to null/undefined when omitted', async () => {
      prisma.user.findUnique.mockResolvedValue({ workspaceId: 'ws-2' });
      prisma.jiraAuditLog.create.mockResolvedValue({ id: 'audit-2' });

      await service.record({
        userId: 'user-2',
        actionType: 'TRANSITION',
        status: 'failed',
      });

      expect(prisma.jiraAuditLog.create).toHaveBeenCalledWith({
        data: {
          workspaceId: 'ws-2',
          userId: 'user-2',
          proposedActionId: null,
          actionType: 'TRANSITION',
          jiraIssueKey: null,
          status: 'failed',
          metadata: undefined,
        },
      });
    });

    it('throws when the user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.record({
          userId: 'missing',
          actionType: 'COMMENT',
          status: 'success',
        }),
      ).rejects.toThrow(
        'Cannot record Jira audit — user missing has no workspace',
      );
      expect(prisma.jiraAuditLog.create).not.toHaveBeenCalled();
    });

    it('throws when the user has a null workspaceId', async () => {
      prisma.user.findUnique.mockResolvedValue({ workspaceId: null });

      await expect(
        service.record({
          userId: 'user-orphan',
          actionType: 'COMMENT',
          status: 'success',
        }),
      ).rejects.toThrow(
        'Cannot record Jira audit — user user-orphan has no workspace',
      );
      expect(prisma.jiraAuditLog.create).not.toHaveBeenCalled();
    });

    it('propagates prisma create failures after a successful user lookup', async () => {
      prisma.user.findUnique.mockResolvedValue({ workspaceId: 'ws-1' });
      prisma.jiraAuditLog.create.mockRejectedValue(new Error('db write failed'));

      await expect(
        service.record({
          userId: 'user-1',
          actionType: 'COMMENT',
          status: 'success',
        }),
      ).rejects.toThrow('db write failed');
    });
  });

  describe('listForUser', () => {
    it('lists audit logs for a user with the default limit of 50', async () => {
      const rows = [{ id: 'a1', actionType: 'COMMENT' }];
      prisma.jiraAuditLog.findMany.mockResolvedValue(rows);

      const result = await service.listForUser('user-1');

      expect(result).toEqual(rows);
      expect(prisma.jiraAuditLog.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          actionType: true,
          jiraIssueKey: true,
          status: true,
          metadata: true,
          createdAt: true,
          proposedActionId: true,
        },
      });
    });

    it('respects a custom limit', async () => {
      prisma.jiraAuditLog.findMany.mockResolvedValue([]);

      await service.listForUser('user-9', 10);

      expect(prisma.jiraAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, where: { userId: 'user-9' } }),
      );
    });

    it('returns an empty list when no rows exist', async () => {
      prisma.jiraAuditLog.findMany.mockResolvedValue([]);

      await expect(service.listForUser('user-empty')).resolves.toEqual([]);
    });
  });
});
