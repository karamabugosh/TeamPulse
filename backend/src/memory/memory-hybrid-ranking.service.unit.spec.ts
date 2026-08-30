import { Test, TestingModule } from '@nestjs/testing';
import { MemoryVisibility } from '@prisma/client';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { MEMORY_RETRIEVAL_CONFIG } from './memory-retrieval.config';
import { MemorySearchCandidate } from './memory-retrieval.types';
import { MEMORY_SOURCE } from './memory-source.constants';
import { MemoryHybridRankingService } from './memory-hybrid-ranking.service';

jest.mock('../ai/workspace/retrieval/embedding.util', () => ({
  reciprocalRankFusion: jest.fn(),
}));

import { reciprocalRankFusion } from '../ai/workspace/retrieval/embedding.util';

const rrfMock = reciprocalRankFusion as jest.MockedFunction<
  typeof reciprocalRankFusion
>;

function makeCandidate(
  overrides: Partial<MemorySearchCandidate> &
    Pick<MemorySearchCandidate, 'chunkId'>,
): MemorySearchCandidate {
  return {
    sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
    sourceId: 'src-1',
    chunkIndex: 0,
    text: 'sample',
    visibility: MemoryVisibility.TEAM,
    teamId: 'team-1',
    ownerUserId: 'user-1',
    linkedIssueKey: null,
    ...overrides,
  };
}

describe('MemoryHybridRankingService', () => {
  let service: MemoryHybridRankingService;

  beforeEach(async () => {
    rrfMock.mockReset();
    rrfMock.mockImplementation((lists: string[][]) => {
      const map = new Map<string, number>();
      let score = 1;
      for (const list of lists) {
        for (const id of list) {
          if (!map.has(id)) {
            map.set(id, score);
            score -= 0.1;
          }
        }
      }
      return map;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [MemoryHybridRankingService],
    }).compile();

    service = module.get(MemoryHybridRankingService);
  });

  describe('merge', () => {
    it('fuses lexical-only candidates and respects finalLimit', () => {
      const lexical = [
        makeCandidate({ chunkId: 'a', lexicalRank: 1 }),
        makeCandidate({ chunkId: 'b', lexicalRank: 2 }),
        makeCandidate({ chunkId: 'c', lexicalRank: 3 }),
      ];

      const result = service.merge({
        lexical,
        vector: [],
        query: 'standup update',
        finalLimit: 2,
      });

      expect(result).toHaveLength(2);
      expect(result[0].chunkId).toBe('a');
      expect(result.every((c) => typeof c.rrfScore === 'number')).toBe(true);
    });

    it('merges overlapping vector ranks into existing lexical candidates', () => {
      const lexical = [
        makeCandidate({ chunkId: 'shared', lexicalRank: 1, lexicalScore: 0.8 }),
      ];
      const vector = [
        makeCandidate({
          chunkId: 'shared',
          vectorRank: 1,
          vectorSimilarity: 0.91,
        }),
        makeCandidate({ chunkId: 'vector-only', vectorRank: 2 }),
      ];

      const result = service.merge({
        lexical,
        vector,
        query: 'status',
        finalLimit: 10,
      });

      const shared = result.find((c) => c.chunkId === 'shared');
      expect(shared?.lexicalRank).toBe(1);
      expect(shared?.vectorRank).toBe(1);
      expect(shared?.vectorSimilarity).toBe(0.91);
      expect(result.some((c) => c.chunkId === 'vector-only')).toBe(true);
    });

    it('boosts candidates whose linkedIssueKey matches the query issue', () => {
      const lexical = [
        makeCandidate({
          chunkId: 'match',
          linkedIssueKey: 'SCRUM-1',
          lexicalRank: 2,
        }),
        makeCandidate({
          chunkId: 'other',
          linkedIssueKey: 'SCRUM-9',
          lexicalRank: 1,
        }),
      ];

      const result = service.merge({
        lexical,
        vector: [],
        query: 'status of SCRUM-1',
        finalLimit: 10,
      });

      expect(result[0].chunkId).toBe('match');
      expect(result[0].rrfScore).toBeGreaterThan(result[1].rrfScore ?? 0);
    });

    it('boosts via linkedIssueKey param when provided', () => {
      const lexical = [
        makeCandidate({
          chunkId: 'linked',
          linkedIssueKey: 'abc-2',
          lexicalRank: 2,
        }),
        makeCandidate({ chunkId: 'plain', lexicalRank: 1 }),
      ];

      const result = service.merge({
        lexical,
        vector: [],
        query: 'progress',
        linkedIssueKey: '  abc-2  ',
        finalLimit: 10,
      });

      expect(result[0].chunkId).toBe('linked');
    });

    it('applies resolution source boost for resolution queries', () => {
      const lexical = [
        makeCandidate({
          chunkId: 'res',
          sourceType: MEMORY_SOURCE.BLOCKER_RESOLUTION,
          sourceId: 'r1',
          lexicalRank: 2,
        }),
        makeCandidate({
          chunkId: 'ans',
          sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
          sourceId: 'a1',
          lexicalRank: 1,
        }),
      ];

      const result = service.merge({
        lexical,
        vector: [],
        query: 'how was the blocker resolved?',
        finalLimit: 10,
      });

      const res = result.find((c) => c.chunkId === 'res');
      const ans = result.find((c) => c.chunkId === 'ans');
      expect((res?.rrfScore ?? 0) - (ans?.rrfScore ?? 0)).toBeGreaterThanOrEqual(
        MEMORY_RETRIEVAL_CONFIG.resolutionSourceBoost - 0.001,
      );
    });

    it('applies blocker source boost for blocker queries without resolution intent', () => {
      const lexical = [
        makeCandidate({
          chunkId: 'blk',
          sourceType: MEMORY_SOURCE.BLOCKER,
          sourceId: 'b1',
          lexicalRank: 2,
        }),
        makeCandidate({
          chunkId: 'ans',
          sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
          sourceId: 'a1',
          lexicalRank: 1,
        }),
      ];

      const result = service.merge({
        lexical,
        vector: [],
        query: 'current blockers',
        finalLimit: 10,
      });

      expect(result[0].chunkId).toBe('blk');
    });

    it('returns an empty list when both sides are empty', () => {
      expect(
        service.merge({
          lexical: [],
          vector: [],
          query: 'anything',
          finalLimit: 5,
        }),
      ).toEqual([]);
    });

    it('skips fused ids that are missing from the candidate map', () => {
      rrfMock.mockReturnValue(new Map([['ghost', 1], ['real', 0.5]]));
      const lexical = [makeCandidate({ chunkId: 'real', lexicalRank: 1 })];

      const result = service.merge({
        lexical,
        vector: [],
        query: 'x',
        finalLimit: 10,
      });

      expect(result.map((c) => c.chunkId)).toEqual(['real']);
    });

    it('includes byId candidates that RRF omitted with rrfScore 0', () => {
      rrfMock.mockReturnValue(new Map());
      const lexical = [makeCandidate({ chunkId: 'orphan', lexicalRank: 1 })];

      const result = service.merge({
        lexical,
        vector: [],
        query: 'x',
        finalLimit: 10,
      });

      expect(result).toEqual([
        expect.objectContaining({ chunkId: 'orphan', rrfScore: 0 }),
      ]);
    });
  });

  describe('applySourceDiversity', () => {
    it('caps chunks per source then fills from deferred when under limit', () => {
      const ranked = [
        makeCandidate({ chunkId: '1', sourceType: MEMORY_SOURCE.BLOCKER, sourceId: 'same' }),
        makeCandidate({ chunkId: '2', sourceType: MEMORY_SOURCE.BLOCKER, sourceId: 'same' }),
        makeCandidate({ chunkId: '3', sourceType: MEMORY_SOURCE.BLOCKER, sourceId: 'same' }),
        makeCandidate({ chunkId: '4', sourceType: MEMORY_SOURCE.REPORT, sourceId: 'other' }),
      ];

      const result = service.applySourceDiversity(ranked, 3, 1);

      expect(result.map((c) => c.chunkId)).toEqual(['1', '4', '2']);
    });

    it('stops once finalLimit is reached during primary selection', () => {
      const ranked = [
        makeCandidate({ chunkId: 'a', sourceId: 's1' }),
        makeCandidate({ chunkId: 'b', sourceId: 's2' }),
        makeCandidate({ chunkId: 'c', sourceId: 's3' }),
      ];

      const result = service.applySourceDiversity(ranked, 2, 5);

      expect(result.map((c) => c.chunkId)).toEqual(['a', 'b']);
    });

    it('returns an empty array for empty ranked input', () => {
      expect(service.applySourceDiversity([], 5, 2)).toEqual([]);
    });
  });
});
