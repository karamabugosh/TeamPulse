import { Test, TestingModule } from '@nestjs/testing';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { PrismaService } from '../../../prisma/prisma.service';
import { WorkspaceKnowledgeService } from '../knowledge/workspace-knowledge.service';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import { EmbeddingReindexService } from './embedding-reindex.service';

describe('EmbeddingReindexService', () => {
  let service: EmbeddingReindexService;
  let prisma: {
    workspace: {
      findMany: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
    };
  };
  let knowledge: {
    collectSnapshot: jest.MockedFunction<
      (
        workspaceId: string,
        filters: unknown,
        limit: number,
      ) => Promise<{ documents: unknown[] }>
    >;
  };
  let embeddings: {
    isEnabled: jest.MockedFunction<() => boolean>;
    ensureIndexed: jest.MockedFunction<
      (
        workspaceId: string,
        documents: unknown[],
      ) => Promise<{ indexed: number; skipped: number }>
    >;
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    prisma = {
      workspace: { findMany: jest.fn() },
    };
    knowledge = {
      collectSnapshot: jest.fn(),
    };
    embeddings = {
      isEnabled: jest.fn<() => boolean>(),
      ensureIndexed: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmbeddingReindexService,
        { provide: PrismaService, useValue: prisma },
        { provide: WorkspaceKnowledgeService, useValue: knowledge },
        { provide: KnowledgeEmbeddingService, useValue: embeddings },
      ],
    }).compile();

    service = module.get(EmbeddingReindexService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('onKnowledgeChanged / scheduleReindex', () => {
    it('ignores empty or unknown workspace ids', () => {
      embeddings.isEnabled.mockReturnValue(true);
      service.scheduleReindex('', 'x');
      service.scheduleReindex('unknown', 'x');
      service.scheduleReindex(undefined as unknown as string);
      expect(embeddings.isEnabled).not.toHaveBeenCalled();
    });

    it('skips scheduling when embeddings are disabled', () => {
      embeddings.isEnabled.mockReturnValue(false);
      service.scheduleReindex('ws-1', 'write');
      jest.advanceTimersByTime(8_000);
      expect(knowledge.collectSnapshot).not.toHaveBeenCalled();
    });

    it('debounces and then reindexes after 8 seconds', async () => {
      embeddings.isEnabled.mockReturnValue(true);
      knowledge.collectSnapshot.mockResolvedValue({
        documents: [{ id: 'd1' }],
      });
      embeddings.ensureIndexed.mockResolvedValue({ indexed: 1, skipped: 0 });

      service.onKnowledgeChanged({
        workspaceId: 'ws-1',
        reason: 'doc_write',
      } as never);
      service.scheduleReindex('ws-1', 'doc_write_again');

      expect(knowledge.collectSnapshot).not.toHaveBeenCalled();
      jest.advanceTimersByTime(8_000);
      await Promise.resolve();
      await Promise.resolve();

      expect(knowledge.collectSnapshot).toHaveBeenCalledWith('ws-1', {}, 80);
      expect(embeddings.ensureIndexed).toHaveBeenCalled();
    });
  });

  describe('reindexWorkspace', () => {
    it('returns zeros when embeddings disabled', async () => {
      embeddings.isEnabled.mockReturnValue(false);
      await expect(service.reindexWorkspace('ws-1')).resolves.toEqual({
        indexed: 0,
        skipped: 0,
        documents: 0,
      });
    });

    it('indexes a snapshot and returns counts', async () => {
      embeddings.isEnabled.mockReturnValue(true);
      knowledge.collectSnapshot.mockResolvedValue({
        documents: [{ id: 'a' }, { id: 'b' }],
      });
      embeddings.ensureIndexed.mockResolvedValue({ indexed: 2, skipped: 1 });

      await expect(service.reindexWorkspace('ws-9', 'manual')).resolves.toEqual({
        indexed: 2,
        skipped: 1,
        documents: 2,
      });
    });

    it('returns zeros when indexing throws an Error', async () => {
      embeddings.isEnabled.mockReturnValue(true);
      knowledge.collectSnapshot.mockRejectedValue(new Error('snapshot failed'));

      await expect(service.reindexWorkspace('ws-1')).resolves.toEqual({
        indexed: 0,
        skipped: 0,
        documents: 0,
      });
    });

    it('returns zeros when indexing throws a non-Error', async () => {
      embeddings.isEnabled.mockReturnValue(true);
      knowledge.collectSnapshot.mockResolvedValue({ documents: [] });
      embeddings.ensureIndexed.mockRejectedValue('fail');

      await expect(service.reindexWorkspace('ws-1')).resolves.toEqual({
        indexed: 0,
        skipped: 0,
        documents: 0,
      });
    });
  });

  describe('cronReindexAll', () => {
    it('skips when embeddings disabled', async () => {
      embeddings.isEnabled.mockReturnValue(false);
      await service.cronReindexAll();
      expect(prisma.workspace.findMany).not.toHaveBeenCalled();
    });

    it('skips when a previous run is still active', async () => {
      embeddings.isEnabled.mockReturnValue(true);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      knowledge.collectSnapshot.mockImplementation(async () => {
        await gate;
        return { documents: [] };
      });
      embeddings.ensureIndexed.mockResolvedValue({ indexed: 0, skipped: 0 });
      prisma.workspace.findMany.mockResolvedValue([{ id: 'ws-1' }]);

      const first = service.cronReindexAll();
      await Promise.resolve();
      await service.cronReindexAll();
      release();
      await first;

      expect(prisma.workspace.findMany).toHaveBeenCalledTimes(1);
    });

    it('reindexes every workspace from Prisma', async () => {
      embeddings.isEnabled.mockReturnValue(true);
      prisma.workspace.findMany.mockResolvedValue([
        { id: 'ws-1' },
        { id: 'ws-2' },
      ]);
      knowledge.collectSnapshot.mockResolvedValue({ documents: [] });
      embeddings.ensureIndexed.mockResolvedValue({ indexed: 0, skipped: 0 });

      await service.cronReindexAll();

      expect(knowledge.collectSnapshot).toHaveBeenCalledTimes(2);
      expect(prisma.workspace.findMany).toHaveBeenCalledWith({
        select: { id: true, slackWorkspaceName: true },
        orderBy: { installedAt: 'asc' },
      });
    });

    it('logs and clears running flag when findMany throws', async () => {
      embeddings.isEnabled.mockReturnValue(true);
      prisma.workspace.findMany.mockRejectedValue(new Error('db down'));

      await service.cronReindexAll();
      await service.cronReindexAll();

      expect(prisma.workspace.findMany).toHaveBeenCalledTimes(2);
    });

    it('stringifies non-Error cron failures', async () => {
      embeddings.isEnabled.mockReturnValue(true);
      prisma.workspace.findMany.mockRejectedValue('cron boom');

      await expect(service.cronReindexAll()).resolves.toBeUndefined();
    });
  });
});
