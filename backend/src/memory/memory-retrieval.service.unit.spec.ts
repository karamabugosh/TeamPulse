import { Test, TestingModule } from '@nestjs/testing';
import { MemoryVisibility } from '@prisma/client';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { MemoryAclService } from './memory-acl.service';
import { MemoryFullTextSearchService } from './memory-fulltext-search.service';
import { MemoryHybridRankingService } from './memory-hybrid-ranking.service';
import { MEMORY_RETRIEVAL_CONFIG } from './memory-retrieval.config';
import { MemoryRetrievalService } from './memory-retrieval.service';
import {
  MemoryAclContext,
  MemorySearchCandidate,
} from './memory-retrieval.types';
import { MemoryVectorSearchService } from './memory-vector-search.service';
import * as memoryRetrievalConfig from './memory-retrieval.config';

jest.mock('./memory-retrieval.config', () => {
  const actual = jest.requireActual<typeof import('./memory-retrieval.config')>(
    './memory-retrieval.config',
  );
  return {
    ...actual,
    MEMORY_RETRIEVAL_CONFIG: {
      ...actual.MEMORY_RETRIEVAL_CONFIG,
      shadowEnabled: false,
    },
  };
});

function makeAcl(overrides: Partial<MemoryAclContext> = {}): MemoryAclContext {
  return {
    workspaceId: 'ws-1',
    userId: 'user-1',
    authorizedTeamIds: ['team-a'],
    userInWorkspace: true,
    ...overrides,
  };
}

function makeCandidate(
  overrides: Partial<MemorySearchCandidate> = {},
): MemorySearchCandidate {
  return {
    chunkId: 'chunk-1',
    sourceType: 'STANDUP_ANSWER',
    sourceId: 'src-1',
    chunkIndex: 0,
    text: 'Worked on SCRUM-1',
    visibility: MemoryVisibility.TEAM,
    teamId: 'team-a',
    ownerUserId: 'user-1',
    linkedIssueKey: 'SCRUM-1',
    lexicalRank: 1,
    lexicalScore: 0.9,
    rrfScore: 0.75,
    ...overrides,
  };
}

describe('MemoryRetrievalService', () => {
  let service: MemoryRetrievalService;
  let aclService: {
    resolveContext: jest.MockedFunction<
      (params: { workspaceId: string; userId: string }) => Promise<MemoryAclContext>
    >;
  };
  let fullText: {
    search: jest.MockedFunction<(args: unknown) => Promise<unknown>>;
  };
  let vector: {
    search: jest.MockedFunction<(args: unknown) => Promise<unknown>>;
  };
  let hybrid: {
    merge: jest.MockedFunction<(args: unknown) => MemorySearchCandidate[]>;
  };

  beforeEach(async () => {
    (
      memoryRetrievalConfig.MEMORY_RETRIEVAL_CONFIG as { shadowEnabled: boolean }
    ).shadowEnabled = false;
    aclService = {
      resolveContext: jest.fn<
        (params: { workspaceId: string; userId: string }) => Promise<MemoryAclContext>
      >(),
    };
    fullText = {
      search: jest.fn<(args: unknown) => Promise<unknown>>(),
    };
    vector = {
      search: jest.fn<(args: unknown) => Promise<unknown>>(),
    };
    hybrid = {
      merge: jest.fn<(args: unknown) => MemorySearchCandidate[]>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryRetrievalService,
        { provide: MemoryAclService, useValue: aclService },
        { provide: MemoryFullTextSearchService, useValue: fullText },
        { provide: MemoryVectorSearchService, useValue: vector },
        { provide: MemoryHybridRankingService, useValue: hybrid },
      ],
    }).compile();

    service = module.get(MemoryRetrievalService);
  });

  afterEach(() => {
    (
      memoryRetrievalConfig.MEMORY_RETRIEVAL_CONFIG as { shadowEnabled: boolean }
    ).shadowEnabled = false;
  });

  describe('retrieve', () => {
    it('returns empty evidence when workspaceId is undefined at runtime', async () => {
      const result = await service.retrieve({
        workspaceId: undefined as unknown as string,
        userId: 'user-1',
        query: 'x',
      });

      expect(result.workspaceId).toBe('');
      expect(result.evidence).toEqual([]);
    });

    it('returns empty evidence when userId is undefined at runtime', async () => {
      const result = await service.retrieve({
        workspaceId: 'ws-1',
        userId: undefined as unknown as string,
        query: 'x',
      });

      expect(result.evidence).toEqual([]);
    });

    it('treats undefined query as empty string', async () => {
      const result = await service.retrieve({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: undefined as unknown as string,
      });

      expect(result.query).toBe('');
      expect(result.evidence).toEqual([]);
    });

    it('returns empty evidence when workspaceId is blank', async () => {
      const result = await service.retrieve({
        workspaceId: '  ',
        userId: 'user-1',
        query: 'blockers',
      });

      expect(result).toEqual({
        query: 'blockers',
        workspaceId: '',
        evidence: [],
      });
      expect(aclService.resolveContext).not.toHaveBeenCalled();
    });

    it('returns empty evidence when userId is blank', async () => {
      const result = await service.retrieve({
        workspaceId: 'ws-1',
        userId: '',
        query: 'blockers',
      });

      expect(result.evidence).toEqual([]);
      expect(aclService.resolveContext).not.toHaveBeenCalled();
    });

    it('returns empty evidence when query is blank', async () => {
      const result = await service.retrieve({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: '   ',
      });

      expect(result).toEqual({
        query: '',
        workspaceId: 'ws-1',
        evidence: [],
      });
    });

    it('returns empty evidence without diagnostics when user is not in workspace', async () => {
      aclService.resolveContext.mockResolvedValue(
        makeAcl({ userInWorkspace: false, authorizedTeamIds: [] }),
      );

      const result = await service.retrieve({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: 'SCRUM-1 status',
      });

      expect(result.evidence).toEqual([]);
      expect(result.diagnostics).toBeUndefined();
      expect(fullText.search).not.toHaveBeenCalled();
    });

    it('includes diagnostics when user is not in workspace and debug is true', async () => {
      aclService.resolveContext.mockResolvedValue(
        makeAcl({ userInWorkspace: false }),
      );

      const result = await service.retrieve({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: 'SCRUM-1 blocker',
        debug: true,
      });

      expect(result.diagnostics).toEqual(
        expect.objectContaining({
          workspaceId: 'ws-1',
          userId: 'user-1',
          authorizedTeamCount: 0,
          userInWorkspace: false,
          vectorBackend: 'skipped',
          issueKeysDetected: ['SCRUM-1'],
          finalCount: 0,
        }),
      );
      expect(result.diagnostics?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('merges lexical and vector candidates into evidence items', async () => {
      aclService.resolveContext.mockResolvedValue(makeAcl());
      const candidate = makeCandidate();
      fullText.search.mockResolvedValue({
        candidates: [candidate],
        malformedExcludedCount: 2,
      });
      vector.search.mockResolvedValue({
        candidates: [],
        backend: 'pgvector',
        incompatibleEmbeddingCount: 1,
      });
      hybrid.merge.mockReturnValue([candidate]);

      const result = await service.retrieve({
        workspaceId: '  ws-1  ',
        userId: '  user-1  ',
        query: '  SCRUM-1 update  ',
        linkedIssueKey: 'SCRUM-1',
        debug: true,
        limit: 5,
      });

      expect(result.query).toBe('SCRUM-1 update');
      expect(result.workspaceId).toBe('ws-1');
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0]).toEqual(
        expect.objectContaining({
          chunkId: 'chunk-1',
          text: 'Worked on SCRUM-1',
          retrieval: expect.objectContaining({ rrfScore: 0.75 }),
          citation: {
            sourceType: 'STANDUP_ANSWER',
            sourceId: 'src-1',
            chunkIndex: 0,
          },
        }),
      );
      expect(result.diagnostics).toEqual(
        expect.objectContaining({
          authorizedTeamCount: 1,
          userInWorkspace: true,
          lexicalCandidateCount: 1,
          vectorCandidateCount: 0,
          mergedCandidateCount: 1,
          finalCount: 1,
          vectorBackend: 'pgvector',
          incompatibleEmbeddingCount: 1,
          malformedExcludedCount: 2,
          issueKeysDetected: ['SCRUM-1'],
        }),
      );
      expect(hybrid.merge).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'SCRUM-1 update',
          linkedIssueKey: 'SCRUM-1',
          finalLimit: 5,
        }),
      );
    });

    it('maps undefined candidate metadata to null', async () => {
      aclService.resolveContext.mockResolvedValue(makeAcl());
      const candidate = makeCandidate({ metadata: undefined });
      fullText.search.mockResolvedValue({
        candidates: [],
        malformedExcludedCount: 0,
      });
      vector.search.mockResolvedValue({
        candidates: [],
        backend: 'json',
        incompatibleEmbeddingCount: 0,
      });
      hybrid.merge.mockReturnValue([candidate]);

      const result = await service.retrieve({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: 'meta',
      });

      expect(result.evidence[0].metadata).toBeNull();
    });

    it('preserves candidate metadata object when present', async () => {
      aclService.resolveContext.mockResolvedValue(makeAcl());
      const meta = { runId: 'run-1' };
      const candidate = makeCandidate({ metadata: meta });
      fullText.search.mockResolvedValue({
        candidates: [],
        malformedExcludedCount: 0,
      });
      vector.search.mockResolvedValue({
        candidates: [],
        backend: 'json',
        incompatibleEmbeddingCount: 0,
      });
      hybrid.merge.mockReturnValue([candidate]);

      const result = await service.retrieve({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: 'meta',
      });

      expect(result.evidence[0].metadata).toEqual(meta);
    });

    it('defaults rrfScore to 0 when hybrid omits it', async () => {
      aclService.resolveContext.mockResolvedValue(makeAcl());
      const candidate = makeCandidate({ rrfScore: undefined });
      fullText.search.mockResolvedValue({
        candidates: [],
        malformedExcludedCount: 0,
      });
      vector.search.mockResolvedValue({
        candidates: [],
        backend: 'json',
        incompatibleEmbeddingCount: 0,
      });
      hybrid.merge.mockReturnValue([candidate]);

      const result = await service.retrieve({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: 'test',
      });

      expect(result.evidence[0].retrieval.rrfScore).toBe(0);
    });

    it('clamps limit to minimum 1 and maximum 50', async () => {
      aclService.resolveContext.mockResolvedValue(makeAcl());
      fullText.search.mockResolvedValue({
        candidates: [],
        malformedExcludedCount: 0,
      });
      vector.search.mockResolvedValue({
        candidates: [],
        backend: 'none',
        incompatibleEmbeddingCount: 0,
      });
      hybrid.merge.mockReturnValue([]);

      await service.retrieve({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: 'x',
        limit: 0,
      });
      expect(hybrid.merge).toHaveBeenCalledWith(
        expect.objectContaining({ finalLimit: 1 }),
      );

      hybrid.merge.mockClear();
      await service.retrieve({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: 'x',
        limit: 999,
      });
      expect(hybrid.merge).toHaveBeenCalledWith(
        expect.objectContaining({ finalLimit: 50 }),
      );
    });

    it('uses default finalLimit from config when limit is omitted', async () => {
      aclService.resolveContext.mockResolvedValue(makeAcl());
      fullText.search.mockResolvedValue({
        candidates: [],
        malformedExcludedCount: 0,
      });
      vector.search.mockResolvedValue({
        candidates: [],
        backend: 'none',
        incompatibleEmbeddingCount: 0,
      });
      hybrid.merge.mockReturnValue([]);

      await service.retrieve({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: 'x',
      });

      expect(hybrid.merge).toHaveBeenCalledWith(
        expect.objectContaining({
          finalLimit: MEMORY_RETRIEVAL_CONFIG.finalLimit,
        }),
      );
    });

    it('forwards optional filters to lexical and vector search', async () => {
      aclService.resolveContext.mockResolvedValue(makeAcl());
      fullText.search.mockResolvedValue({
        candidates: [],
        malformedExcludedCount: 0,
      });
      vector.search.mockResolvedValue({
        candidates: [],
        backend: 'json',
        incompatibleEmbeddingCount: 0,
      });
      hybrid.merge.mockReturnValue([]);

      await service.retrieve({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: 'q',
        sourceTypes: ['BLOCKER' as never],
        runId: 'run-1',
        ownerUserId: 'owner-1',
        scopedSourceIds: ['a1'],
        queryEmbeddingOverride: [0.1],
        queryEmbeddingModelOverride: 'test-model',
      });

      expect(fullText.search).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: 'run-1',
          ownerUserId: 'owner-1',
          scopedSourceIds: ['a1'],
        }),
      );
      expect(vector.search).toHaveBeenCalledWith(
        expect.objectContaining({
          queryEmbeddingOverride: [0.1],
          queryEmbeddingModelOverride: 'test-model',
        }),
      );
    });
  });

  describe('shadowRetrieveIfEnabled', () => {
    it('returns null when shadow mode is disabled', async () => {
      (
        memoryRetrievalConfig.MEMORY_RETRIEVAL_CONFIG as { shadowEnabled: boolean }
      ).shadowEnabled = false;

      const result = await service.shadowRetrieveIfEnabled({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: 'test',
      });

      expect(result).toBeNull();
      expect(aclService.resolveContext).not.toHaveBeenCalled();
    });

    it('delegates to retrieve with debug when shadow is enabled', async () => {
      (
        memoryRetrievalConfig.MEMORY_RETRIEVAL_CONFIG as { shadowEnabled: boolean }
      ).shadowEnabled = true;
      aclService.resolveContext.mockResolvedValue(makeAcl());
      fullText.search.mockResolvedValue({
        candidates: [],
        malformedExcludedCount: 0,
      });
      vector.search.mockResolvedValue({
        candidates: [],
        backend: 'json',
        incompatibleEmbeddingCount: 0,
      });
      hybrid.merge.mockReturnValue([]);

      const result = await service.shadowRetrieveIfEnabled({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: 'shadow query',
      });

      expect(result?.diagnostics).toBeDefined();
      expect(result?.query).toBe('shadow query');
    });

    it('returns null when shadow retrieve throws', async () => {
      (
        memoryRetrievalConfig.MEMORY_RETRIEVAL_CONFIG as { shadowEnabled: boolean }
      ).shadowEnabled = true;
      aclService.resolveContext.mockRejectedValue(new Error('acl down'));

      const result = await service.shadowRetrieveIfEnabled({
        workspaceId: 'ws-1',
        userId: 'user-1',
        query: 'fail',
      });

      expect(result).toBeNull();
    });

    it('returns null when shadow retrieve throws a non-Error', async () => {
      (
        memoryRetrievalConfig.MEMORY_RETRIEVAL_CONFIG as { shadowEnabled: boolean }
      ).shadowEnabled = true;
      aclService.resolveContext.mockRejectedValue('boom');

      await expect(
        service.shadowRetrieveIfEnabled({
          workspaceId: 'ws-1',
          userId: 'user-1',
          query: 'fail',
        }),
      ).resolves.toBeNull();
    });
  });
});
