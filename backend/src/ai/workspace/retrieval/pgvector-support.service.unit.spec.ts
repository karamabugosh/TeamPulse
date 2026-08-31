import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  PgVectorSupportService,
  toVectorLiteral,
} from './pgvector-support.service';

describe('toVectorLiteral', () => {
  it('formats finite numbers as a Postgres vector literal', () => {
    expect(toVectorLiteral([0.1, 0.2, 1])).toBe('[0.1,0.2,1]');
  });

  it('replaces non-finite numbers with zero', () => {
    expect(toVectorLiteral([NaN, Infinity, -Infinity, 0.5])).toBe('[0,0,0,0.5]');
  });

  it('returns an empty vector literal for an empty array', () => {
    expect(toVectorLiteral([])).toBe('[]');
  });
});

describe('PgVectorSupportService', () => {
  let service: PgVectorSupportService;
  let prisma: {
    $queryRawUnsafe: jest.MockedFunction<
      (query: string, ...values: unknown[]) => Promise<unknown>
    >;
    $executeRawUnsafe: jest.MockedFunction<
      (query: string, ...values: unknown[]) => Promise<unknown>
    >;
  };

  beforeEach(async () => {
    prisma = {
      $queryRawUnsafe: jest.fn<
        (query: string, ...values: unknown[]) => Promise<unknown>
      >(),
      $executeRawUnsafe: jest.fn<
        (query: string, ...values: unknown[]) => Promise<unknown>
      >(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PgVectorSupportService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(PgVectorSupportService);
  });

  describe('onModuleInit', () => {
    it('delegates to detect on startup', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([{ extname: 'vector' }]);
      prisma.$executeRawUnsafe.mockResolvedValue(undefined);

      await service.onModuleInit();

      expect(service.isPgVectorAvailable()).toBe(true);
    });
  });

  describe('detect', () => {
    it('enables pgvector when extension is already installed', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([{ extname: 'vector' }]);
      prisma.$executeRawUnsafe.mockResolvedValue(undefined);

      await expect(service.detect()).resolves.toBe('pgvector');
      expect(service.getBackend()).toBe('pgvector');
      expect(service.isPgVectorAvailable()).toBe(true);
    });

    it('creates extension when missing then enables pgvector', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);
      prisma.$executeRawUnsafe.mockResolvedValue(undefined);

      await expect(service.detect()).resolves.toBe('pgvector');

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        'CREATE EXTENSION IF NOT EXISTS vector',
      );
    });

    it('falls back to json when CREATE EXTENSION fails', async () => {
      const warnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      prisma.$queryRawUnsafe.mockResolvedValue([]);
      prisma.$executeRawUnsafe.mockRejectedValue(new Error('permission denied'));

      await expect(service.detect()).resolves.toBe('json');
      expect(service.isPgVectorAvailable()).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('pgvector unavailable'),
      );

      warnSpy.mockRestore();
    });

    it('logs non-Error CREATE EXTENSION failures with String conversion', async () => {
      const warnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      prisma.$queryRawUnsafe.mockResolvedValue([]);
      prisma.$executeRawUnsafe.mockRejectedValue('plain failure');

      await expect(service.detect()).resolves.toBe('json');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('plain failure'),
      );

      warnSpy.mockRestore();
    });

    it('falls back to json when outer detection throws', async () => {
      const warnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      prisma.$queryRawUnsafe.mockRejectedValue(new Error('db down'));

      await expect(service.detect()).resolves.toBe('json');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('pgvector detection failed'),
      );

      warnSpy.mockRestore();
    });

    it('falls back to json when outer detection throws a non-Error value', async () => {
      const warnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      prisma.$queryRawUnsafe.mockRejectedValue('plain outer failure');

      await expect(service.detect()).resolves.toBe('json');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('plain outer failure'),
      );

      warnSpy.mockRestore();
    });

    it('falls back to ivfflat when HNSW index creation fails', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([{ extname: 'vector' }]);
      prisma.$executeRawUnsafe
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('hnsw unsupported'))
        .mockResolvedValueOnce(undefined);

      await expect(service.detect()).resolves.toBe('pgvector');
    });

    it('warns when both HNSW and IVFFlat index creation fail', async () => {
      const warnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      prisma.$queryRawUnsafe.mockResolvedValue([{ extname: 'vector' }]);
      prisma.$executeRawUnsafe
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('hnsw fail'))
        .mockRejectedValueOnce(new Error('ivfflat fail'));

      await expect(service.detect()).resolves.toBe('pgvector');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('pgvector ANN index not created'),
      );

      warnSpy.mockRestore();
    });

    it('warns with String conversion when IVFFlat index fails with non-Error', async () => {
      const warnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      prisma.$queryRawUnsafe.mockResolvedValue([{ extname: 'vector' }]);
      prisma.$executeRawUnsafe
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('hnsw fail'))
        .mockRejectedValueOnce('ivfflat plain');

      await service.detect();

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ivfflat plain'),
      );

      warnSpy.mockRestore();
    });
  });

  describe('syncNativeVector', () => {
    it('is a no-op when backend is json', async () => {
      await service.syncNativeVector({ id: 'emb-1', vector: [0.1, 0.2] });

      expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('is a no-op when vector is empty even on pgvector backend', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([{ extname: 'vector' }]);
      prisma.$executeRawUnsafe.mockResolvedValue(undefined);
      await service.detect();

      await service.syncNativeVector({ id: 'emb-1', vector: [] });

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    });

    it('updates embedding_vec when pgvector is available', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([{ extname: 'vector' }]);
      prisma.$executeRawUnsafe.mockResolvedValue(undefined);
      await service.detect();

      await service.syncNativeVector({ id: 'emb-1', vector: [0.1, 0.2] });

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "KnowledgeEmbedding"'),
        'emb-1',
      );
    });

    it('warns with String conversion when sync fails with non-Error', async () => {
      const warnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      prisma.$queryRawUnsafe.mockResolvedValue([{ extname: 'vector' }]);
      prisma.$executeRawUnsafe
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce('sync plain');
      await service.detect();

      await service.syncNativeVector({ id: 'emb-1', vector: [0.1] });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('sync plain'),
      );

      warnSpy.mockRestore();
    });

    it('warns and swallows sync failures', async () => {
      const warnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      prisma.$queryRawUnsafe.mockResolvedValue([{ extname: 'vector' }]);
      prisma.$executeRawUnsafe
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('update failed'));
      await service.detect();

      await service.syncNativeVector({ id: 'emb-1', vector: [0.1] });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to sync embedding_vec id=emb-1'),
      );

      warnSpy.mockRestore();
    });
  });

  describe('searchAnn', () => {
    it('returns empty results when backend is json', async () => {
      await expect(
        service.searchAnn({
          workspaceId: 'ws-1',
          queryVector: [0.1, 0.2],
          limit: 5,
        }),
      ).resolves.toEqual([]);
    });

    it('returns empty results when query vector is empty', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([{ extname: 'vector' }]);
      prisma.$executeRawUnsafe.mockResolvedValue(undefined);
      await service.detect();

      await expect(
        service.searchAnn({
          workspaceId: 'ws-1',
          queryVector: [],
          limit: 5,
        }),
      ).resolves.toEqual([]);
    });

    it('maps rows to similarity scores and applies default minSimilarity', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([{ extname: 'vector' }]);
      prisma.$executeRawUnsafe.mockResolvedValue(undefined);
      await service.detect();

      prisma.$queryRawUnsafe.mockResolvedValue([
        {
          sourceId: 'src-1',
          sourceType: 'STANDUP',
          entityType: 'answer',
          title: 'Update',
          distance: 0.1,
        },
        {
          sourceId: 'src-2',
          sourceType: 'STANDUP',
          entityType: 'answer',
          title: 'Low sim',
          distance: 0.9,
        },
      ]);

      const results = await service.searchAnn({
        workspaceId: 'ws-1',
        queryVector: [0.1, 0.2],
        limit: 5,
      });

      expect(results).toEqual([
        {
          sourceId: 'src-1',
          sourceType: 'STANDUP',
          entityType: 'answer',
          title: 'Update',
          similarity: 0.9,
        },
      ]);
    });

    it('respects custom minSimilarity and clamps limit bounds', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([{ extname: 'vector' }]);
      prisma.$executeRawUnsafe.mockResolvedValue(undefined);
      await service.detect();

      const rows = Array.from({ length: 5 }, (_, index) => ({
        sourceId: `src-${index}`,
        sourceType: 'STANDUP',
        entityType: 'answer',
        title: `Row ${index}`,
        distance: 0.05,
      }));
      prisma.$queryRawUnsafe.mockResolvedValue(rows);

      const results = await service.searchAnn({
        workspaceId: 'ws-1',
        queryVector: [0.1],
        limit: 0,
        minSimilarity: 0.5,
      });

      expect(results).toHaveLength(1);
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.any(String),
        'ws-1',
        3,
      );
    });

    it('caps limit at 100 and fetchLimit at 200', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([{ extname: 'vector' }]);
      prisma.$executeRawUnsafe.mockResolvedValue(undefined);
      await service.detect();
      prisma.$queryRawUnsafe.mockResolvedValue([]);

      await service.searchAnn({
        workspaceId: 'ws-1',
        queryVector: [0.1],
        limit: 500,
      });

      expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
        expect.any(String),
        'ws-1',
        200,
      );
    });

    it('returns empty array when ANN query throws', async () => {
      const warnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      prisma.$queryRawUnsafe.mockResolvedValue([{ extname: 'vector' }]);
      prisma.$executeRawUnsafe.mockResolvedValue(undefined);
      await service.detect();
      prisma.$queryRawUnsafe.mockRejectedValue(new Error('ann failed'));

      await expect(
        service.searchAnn({
          workspaceId: 'ws-1',
          queryVector: [0.1],
          limit: 5,
        }),
      ).resolves.toEqual([]);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('pgvector ANN search failed'),
      );

      warnSpy.mockRestore();
    });

    it('returns empty array when ANN query throws a non-Error value', async () => {
      const warnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      prisma.$queryRawUnsafe.mockResolvedValue([{ extname: 'vector' }]);
      prisma.$executeRawUnsafe.mockResolvedValue(undefined);
      await service.detect();
      prisma.$queryRawUnsafe.mockRejectedValue('ann plain');

      await expect(
        service.searchAnn({
          workspaceId: 'ws-1',
          queryVector: [0.1],
          limit: 5,
        }),
      ).resolves.toEqual([]);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('ann plain'),
      );

      warnSpy.mockRestore();
    });
  });
});
