import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { WorkspaceRetrievalService } from '../retrieval/workspace-retrieval.service';
import {
  WorkspaceSearchFilters,
  WorkspaceSearchResult,
} from '../types/workspace-ai.types';
import { WorkspaceSearchService } from './workspace-search.service';

type RetrievalMock = {
  retrieve: jest.MockedFunction<
    (params: {
      workspaceId: string;
      query: string;
      filters?: WorkspaceSearchFilters;
      limit?: number;
    }) => Promise<WorkspaceSearchResult>
  >;
  mergeQueryIntoFilters: jest.MockedFunction<
    (query: string, base: WorkspaceSearchFilters) => WorkspaceSearchFilters
  >;
};

function makeSearchResult(
  overrides: Partial<WorkspaceSearchResult> = {},
): WorkspaceSearchResult {
  return {
    query: 'status of SCRUM-1',
    filters: {},
    hits: [],
    bySource: {},
    references: [],
    diagnostics: {
      sources: [],
      summary: 'ok',
    },
    ...overrides,
  };
}

describe('WorkspaceSearchService', () => {
  let service: WorkspaceSearchService;
  let retrieval: RetrievalMock;

  beforeEach(async () => {
    retrieval = {
      retrieve: jest.fn(),
      mergeQueryIntoFilters: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceSearchService,
        { provide: WorkspaceRetrievalService, useValue: retrieval },
      ],
    }).compile();

    service = module.get(WorkspaceSearchService);
  });

  describe('search', () => {
    it('delegates to retrieval.retrieve with the same params and returns its result', async () => {
      const params = {
        workspaceId: 'ws-1',
        query: 'blockers this week',
        filters: { keyword: 'blockers' } as WorkspaceSearchFilters,
        limit: 10,
      };
      const expected = makeSearchResult({ query: params.query });
      retrieval.retrieve.mockResolvedValue(expected);

      const result = await service.search(params);

      expect(result).toBe(expected);
      expect(retrieval.retrieve).toHaveBeenCalledTimes(1);
      expect(retrieval.retrieve).toHaveBeenCalledWith(params);
    });

    it('forwards optional filters and limit as undefined when omitted', async () => {
      const params = { workspaceId: 'ws-2', query: 'sprint goals' };
      const expected = makeSearchResult({ query: params.query });
      retrieval.retrieve.mockResolvedValue(expected);

      const result = await service.search(params);

      expect(result).toEqual(expected);
      expect(retrieval.retrieve).toHaveBeenCalledWith(params);
    });

    it('propagates retrieval failures', async () => {
      retrieval.retrieve.mockRejectedValue(new Error('retrieval down'));

      await expect(
        service.search({ workspaceId: 'ws-1', query: 'x' }),
      ).rejects.toThrow('retrieval down');
    });
  });

  describe('mergeQueryIntoFilters', () => {
    it('delegates to retrieval.mergeQueryIntoFilters and returns its value', () => {
      const base: WorkspaceSearchFilters = { issueKey: 'SCRUM-9' };
      const merged: WorkspaceSearchFilters = {
        issueKey: 'SCRUM-9',
        keyword: null,
      };
      retrieval.mergeQueryIntoFilters.mockReturnValue(merged);

      const result = service.mergeQueryIntoFilters('SCRUM-9 status', base);

      expect(result).toBe(merged);
      expect(retrieval.mergeQueryIntoFilters).toHaveBeenCalledWith(
        'SCRUM-9 status',
        base,
      );
    });

    it('passes through an empty base filters object', () => {
      const merged: WorkspaceSearchFilters = { keyword: null };
      retrieval.mergeQueryIntoFilters.mockReturnValue(merged);

      const result = service.mergeQueryIntoFilters('hello', {});

      expect(result).toEqual(merged);
      expect(retrieval.mergeQueryIntoFilters).toHaveBeenCalledWith('hello', {});
    });
  });
});
