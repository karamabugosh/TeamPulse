import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { MemoryVisibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryAclService } from './memory-acl.service';
import { MemoryFullTextSearchService } from './memory-fulltext-search.service';
import { MEMORY_RETRIEVAL_CONFIG } from './memory-retrieval.config';
import { MemoryAclContext } from './memory-retrieval.types';

describe('MemoryFullTextSearchService', () => {
  let service: MemoryFullTextSearchService;
  let prisma: {
    $queryRawUnsafe: jest.MockedFunction<
      (query: string, ...values: unknown[]) => Promise<unknown>
    >;
  };
  let acl: {
    buildAclSql: jest.MockedFunction<
      (params: { acl: MemoryAclContext; startIndex: number }) => {
        sql: string;
        values: unknown[];
      }
    >;
    isChunkAuthorized: jest.MockedFunction<
      (row: unknown, acl: MemoryAclContext) => boolean
    >;
  };

  const aclContext: MemoryAclContext = {
    workspaceId: 'ws-1',
    userId: 'user-1',
    authorizedTeamIds: ['team-a'],
    userInWorkspace: true,
  };

  const ftsRow = {
    id: 'chunk-1',
    sourceType: 'STANDUP_ANSWER',
    sourceId: 'src-1',
    chunkIndex: 0,
    text: 'Worked on SCRUM-1',
    visibility: MemoryVisibility.TEAM,
    teamId: 'team-a',
    ownerUserId: 'user-1',
    linkedIssueKey: 'SCRUM-1',
    lexicalScore: 0.85,
    metadata: { runId: 'run-1' },
  };

  beforeEach(async () => {
    prisma = {
      $queryRawUnsafe: jest.fn<
        (query: string, ...values: unknown[]) => Promise<unknown>
      >(),
    };
    acl = {
      buildAclSql: jest.fn<
        (params: { acl: MemoryAclContext; startIndex: number }) => {
          sql: string;
          values: unknown[];
        }
      >(),
      isChunkAuthorized: jest.fn<(row: unknown, acl: MemoryAclContext) => boolean>(),
    };

    acl.buildAclSql.mockReturnValue({
      sql: 'visibility = ANY($3::text[])',
      values: [['TEAM', 'WORKSPACE']],
    });
    acl.isChunkAuthorized.mockReturnValue(true);
    prisma.$queryRawUnsafe.mockResolvedValue([ftsRow]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryFullTextSearchService,
        { provide: PrismaService, useValue: prisma },
        { provide: MemoryAclService, useValue: acl },
      ],
    }).compile();

    service = module.get(MemoryFullTextSearchService);
  });

  it('returns empty results when user is not in workspace', async () => {
    const result = await service.search({
      acl: { ...aclContext, userInWorkspace: false },
      query: 'blocker',
    });

    expect(result).toEqual({ candidates: [], malformedExcludedCount: 0 });
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('returns empty results when query is blank after trim', async () => {
    const result = await service.search({
      acl: aclContext,
      query: '   ',
    });

    expect(result).toEqual({ candidates: [], malformedExcludedCount: 0 });
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('returns empty results when query is undefined', async () => {
    const result = await service.search({
      acl: aclContext,
      query: undefined as unknown as string,
    });

    expect(result).toEqual({ candidates: [], malformedExcludedCount: 0 });
  });

  it('maps authorized FTS rows to search candidates with renumbered ranks', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      ftsRow,
      {
        ...ftsRow,
        id: 'chunk-2',
        lexicalScore: 0.5,
      },
    ]);

    const result = await service.search({
      acl: aclContext,
      query: 'SCRUM-1 standup',
    });

    expect(result.malformedExcludedCount).toBe(0);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        chunkId: 'chunk-1',
        lexicalRank: 1,
        lexicalScore: 0.85,
        metadata: { runId: 'run-1' },
      }),
    );
    expect(result.candidates[1].lexicalRank).toBe(2);
  });

  it('excludes unauthorized rows and counts them as malformed', async () => {
    acl.isChunkAuthorized
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    prisma.$queryRawUnsafe.mockResolvedValue([
      ftsRow,
      { ...ftsRow, id: 'chunk-2' },
    ]);

    const result = await service.search({
      acl: aclContext,
      query: 'blocker',
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.malformedExcludedCount).toBe(1);
    expect(result.candidates[0].lexicalRank).toBe(1);
  });

  it('defaults lexicalScore to zero when row score is not numeric', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      { ...ftsRow, lexicalScore: NaN },
    ]);

    const result = await service.search({
      acl: aclContext,
      query: 'blocker',
    });

    expect(result.candidates[0].lexicalScore).toBe(0);
  });

  it('sets metadata to null when row metadata is not an object', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      { ...ftsRow, metadata: 'bad' },
    ]);

    const result = await service.search({
      acl: aclContext,
      query: 'blocker',
    });

    expect(result.candidates[0].metadata).toBeNull();
  });

  it('clamps limit between 1 and 100', async () => {
    await service.search({
      acl: aclContext,
      query: 'blocker',
      limit: 0,
    });

    expect(prisma.$queryRawUnsafe.mock.calls[0][0]).toContain('LIMIT 1');

    await service.search({
      acl: aclContext,
      query: 'blocker',
      limit: 500,
    });

    expect(prisma.$queryRawUnsafe.mock.calls[1][0]).toContain('LIMIT 100');
  });

  it('uses configured lexical candidate limit when limit is omitted', async () => {
    await service.search({
      acl: aclContext,
      query: 'blocker',
    });

    expect(prisma.$queryRawUnsafe.mock.calls[0][0]).toContain(
      `LIMIT ${MEMORY_RETRIEVAL_CONFIG.lexicalCandidateLimit}`,
    );
  });

  it('includes source type filter in SQL when sourceTypes provided', async () => {
    await service.search({
      acl: aclContext,
      query: 'blocker',
      sourceTypes: ['STANDUP_ANSWER'],
    });

    const sql = prisma.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('"sourceType" = ANY');
    expect(prisma.$queryRawUnsafe.mock.calls[0]).toContainEqual([
      'STANDUP_ANSWER',
    ]);
  });

  it('includes issue key OR clause when query contains issue keys', async () => {
    await service.search({
      acl: aclContext,
      query: 'progress on SCRUM-42',
    });

    const sql = prisma.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('"linkedIssueKey" = ANY');
    expect(sql).toContain('ILIKE ANY');
  });

  it('includes linkedIssueKey from params even when absent in query text', async () => {
    await service.search({
      acl: aclContext,
      query: 'deployment',
      linkedIssueKey: ' scrum-9 ',
    });

    const values = prisma.$queryRawUnsafe.mock.calls[0].slice(1);
    expect(values).toContainEqual(['SCRUM-9']);
  });

  it('adds ownerUserId temporal filter', async () => {
    await service.search({
      acl: aclContext,
      query: 'blocker',
      ownerUserId: 'user-42',
    });

    const sql = prisma.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('"ownerUserId" = $');
    expect(prisma.$queryRawUnsafe.mock.calls[0]).toContain('user-42');
  });

  it('adds combined runId and scopedSourceIds temporal filter', async () => {
    await service.search({
      acl: aclContext,
      query: 'blocker',
      runId: 'run-1',
      scopedSourceIds: ['src-a', 'src-b'],
    });

    const sql = prisma.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain("metadata->>'runId'");
    expect(sql).toContain('"sourceId" = ANY');
    expect(prisma.$queryRawUnsafe.mock.calls[0]).toContain('run-1');
    expect(prisma.$queryRawUnsafe.mock.calls[0]).toContainEqual([
      'src-a',
      'src-b',
    ]);
  });

  it('adds runId-only temporal filter', async () => {
    await service.search({
      acl: aclContext,
      query: 'blocker',
      runId: 'run-9',
    });

    const sql = prisma.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain("metadata->>'runId'");
    expect(sql).not.toContain('"sourceId" = ANY');
  });

  it('adds scopedSourceIds-only temporal filter', async () => {
    await service.search({
      acl: aclContext,
      query: 'blocker',
      scopedSourceIds: ['src-x'],
    });

    const sql = prisma.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('"sourceId" = ANY');
    expect(sql).not.toContain("metadata->>'runId'");
  });

  it('passes workspace and query values with ACL SQL parts', async () => {
    await service.search({
      acl: aclContext,
      query: 'blocker',
    });

    expect(acl.buildAclSql).toHaveBeenCalledWith({
      acl: aclContext,
      startIndex: 3,
    });
    expect(prisma.$queryRawUnsafe.mock.calls[0][1]).toBe('ws-1');
    expect(prisma.$queryRawUnsafe.mock.calls[0][2]).toBe('blocker');
  });

  it('logs and rethrows when FTS query fails', async () => {
    const errorSpy = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);
    prisma.$queryRawUnsafe.mockRejectedValue(new Error('syntax error at tsquery'));

    await expect(
      service.search({
        acl: aclContext,
        query: 'blocker',
      }),
    ).rejects.toThrow('syntax error at tsquery');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[MemoryFTS] query failed'),
    );

    errorSpy.mockRestore();
  });

  it('logs non-Error query failures with String conversion', async () => {
    const errorSpy = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => undefined);
    prisma.$queryRawUnsafe.mockRejectedValue('plain fts failure');

    await expect(
      service.search({
        acl: aclContext,
        query: 'blocker',
      }),
    ).rejects.toBe('plain fts failure');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('plain fts failure'),
    );

    errorSpy.mockRestore();
  });
});
