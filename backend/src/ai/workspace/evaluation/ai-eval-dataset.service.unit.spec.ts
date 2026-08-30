import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { PrismaService } from '../../../prisma/prisma.service';
import { DEMO_SLACK_WORKSPACE_ID } from '../../../demo/demo.constants';
import {
  GOLD_EVAL_DATASET,
  listGoldCategories,
} from './gold-dataset';
import { AiEvalDatasetService } from './ai-eval-dataset.service';

jest.mock('../../../common/workspace-context', () => ({
  resolveActiveWorkspaceId: jest.fn(),
}));

import { resolveActiveWorkspaceId } from '../../../common/workspace-context';

const resolveWorkspaceIdMock = resolveActiveWorkspaceId as jest.MockedFunction<
  typeof resolveActiveWorkspaceId
>;

type PrismaMock = {
  aiEvalCase: {
    findMany: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
    upsert: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
  workspace: {
    findUnique: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
};

describe('AiEvalDatasetService', () => {
  let service: AiEvalDatasetService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    resolveWorkspaceIdMock.mockReset();
    prisma = {
      aiEvalCase: {
        findMany: jest.fn<(args: unknown) => Promise<unknown>>(),
        upsert: jest.fn<(args: unknown) => Promise<unknown>>().mockResolvedValue({}),
      },
      workspace: {
        findUnique: jest.fn<(args: unknown) => Promise<unknown>>(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiEvalDatasetService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AiEvalDatasetService);
  });

  describe('listTemplates / categories', () => {
    it('returns the gold dataset templates', () => {
      expect(service.listTemplates()).toBe(GOLD_EVAL_DATASET);
      expect(service.listTemplates().length).toBeGreaterThan(0);
    });

    it('returns gold categories', () => {
      expect(service.categories()).toEqual(listGoldCategories());
    });
  });

  describe('listCases', () => {
    it('lists enabled cases for a resolved workspace', async () => {
      resolveWorkspaceIdMock.mockResolvedValue('ws-1');
      const rows = [{ id: 'case-1', caseKey: 'jira-1' }];
      prisma.aiEvalCase.findMany.mockResolvedValue(rows);

      const result = await service.listCases({ workspaceId: 'ws-1' });

      expect(result).toEqual({
        workspaceId: 'ws-1',
        cases: rows,
        total: 1,
      });
      expect(prisma.aiEvalCase.findMany).toHaveBeenCalledWith({
        where: { workspaceId: 'ws-1', enabled: true },
        orderBy: [{ category: 'asc' }, { caseKey: 'asc' }],
      });
    });

    it('filters by category when provided', async () => {
      resolveWorkspaceIdMock.mockResolvedValue('ws-1');
      prisma.aiEvalCase.findMany.mockResolvedValue([]);

      await service.listCases({
        workspaceId: 'ws-1',
        category: 'Jira',
      });

      expect(prisma.aiEvalCase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: 'ws-1', category: 'Jira', enabled: true },
        }),
      );
    });

    it('includes disabled cases when enabledOnly is false', async () => {
      resolveWorkspaceIdMock.mockResolvedValue('ws-1');
      prisma.aiEvalCase.findMany.mockResolvedValue([]);

      await service.listCases({ workspaceId: 'ws-1', enabledOnly: false });

      expect(prisma.aiEvalCase.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: 'ws-1' },
        }),
      );
    });

    it('throws when no active workspace can be resolved', async () => {
      resolveWorkspaceIdMock.mockResolvedValue(null);

      await expect(service.listCases({})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.listCases({})).rejects.toThrow('No active workspace');
    });
  });

  describe('resolveWorkspace', () => {
    it('returns demo workspace when preferDemo is true', async () => {
      const demo = {
        id: 'demo-ws',
        slackWorkspaceName: 'Demo',
        slackWorkspaceId: DEMO_SLACK_WORKSPACE_ID,
      };
      prisma.workspace.findUnique.mockResolvedValue(demo);

      const result = await service.resolveWorkspace({ preferDemo: true });

      expect(result).toEqual(demo);
      expect(prisma.workspace.findUnique).toHaveBeenCalledWith({
        where: { slackWorkspaceId: DEMO_SLACK_WORKSPACE_ID },
        select: {
          id: true,
          slackWorkspaceName: true,
          slackWorkspaceId: true,
        },
      });
    });

    it('throws when demo workspace is missing', async () => {
      prisma.workspace.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveWorkspace({ preferDemo: true }),
      ).rejects.toThrow('Demo Workspace not found');
    });

    it('returns workspace by id when preferDemo is false', async () => {
      resolveWorkspaceIdMock.mockResolvedValue('ws-9');
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-9',
        slackWorkspaceName: 'Acme',
        slackWorkspaceId: 'T123',
      });

      const result = await service.resolveWorkspace({ workspaceId: 'ws-9' });

      expect(result.id).toBe('ws-9');
    });

    it('throws when explicit workspace id does not exist', async () => {
      resolveWorkspaceIdMock.mockResolvedValue('missing');
      prisma.workspace.findUnique.mockResolvedValue(null);

      await expect(
        service.resolveWorkspace({ workspaceId: 'missing' }),
      ).rejects.toThrow('Workspace not found');
    });
  });

  describe('seedForWorkspace', () => {
    it('upserts every gold template for the resolved workspace', async () => {
      resolveWorkspaceIdMock.mockResolvedValue('ws-1');
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        slackWorkspaceName: 'Acme',
        slackWorkspaceId: 'T1',
      });

      const result = await service.seedForWorkspace({ workspaceId: 'ws-1' });

      expect(prisma.aiEvalCase.upsert).toHaveBeenCalledTimes(
        GOLD_EVAL_DATASET.length,
      );
      expect(result).toEqual({
        workspaceId: 'ws-1',
        workspaceName: 'Acme',
        slackWorkspaceId: 'T1',
        upserted: GOLD_EVAL_DATASET.length,
        categories: listGoldCategories(),
      });
    });

    it('includes mustInclude tags in upsert payload', async () => {
      resolveWorkspaceIdMock.mockResolvedValue('ws-1');
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'ws-1',
        slackWorkspaceName: 'Acme',
        slackWorkspaceId: 'T1',
      });
      const withMust = GOLD_EVAL_DATASET.find((t) => t.mustInclude?.length);
      expect(withMust).toBeDefined();

      await service.seedForWorkspace({ workspaceId: 'ws-1' });

      const upsertCall = prisma.aiEvalCase.upsert.mock.calls.find(
        (call) =>
          (call[0] as { where: { workspaceId_caseKey: { caseKey: string } } })
            .where.workspaceId_caseKey.caseKey === withMust!.id,
      );
      expect(upsertCall).toBeDefined();
      const createTags = (
        upsertCall![0] as { create: { tags: string[] } }
      ).create.tags;
      expect(createTags).toEqual(
        expect.arrayContaining([
          ...withMust!.tags,
          ...withMust!.mustInclude!.map((item) => `must:${item}`),
        ]),
      );
    });

    it('seeds demo workspace when preferDemo is true', async () => {
      prisma.workspace.findUnique.mockResolvedValue({
        id: 'demo-ws',
        slackWorkspaceName: 'Demo',
        slackWorkspaceId: DEMO_SLACK_WORKSPACE_ID,
      });

      const result = await service.seedForWorkspace({ preferDemo: true });

      expect(result.workspaceId).toBe('demo-ws');
      expect(prisma.aiEvalCase.upsert).toHaveBeenCalledTimes(
        GOLD_EVAL_DATASET.length,
      );
    });
  });
});
