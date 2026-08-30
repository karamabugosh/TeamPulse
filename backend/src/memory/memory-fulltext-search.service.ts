import { Injectable, Logger } from '@nestjs/common';
import { MemoryVisibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryAclService } from './memory-acl.service';
import {
  MEMORY_RETRIEVAL_CONFIG,
  extractIssueKeys,
} from './memory-retrieval.config';
import {
  MemoryAclContext,
  MemorySearchCandidate,
} from './memory-retrieval.types';
import { MemorySourceType } from './memory-source.constants';

type FtsRow = {
  id: string;
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  text: string;
  visibility: MemoryVisibility;
  teamId: string | null;
  ownerUserId: string | null;
  linkedIssueKey: string | null;
  lexicalScore: number;
  metadata?: Record<string, unknown> | null;
};

/**
 * PostgreSQL full-text retrieval over MemoryChunk.text (ACL-filtered in SQL).
 */
@Injectable()
export class MemoryFullTextSearchService {
  private readonly logger = new Logger(MemoryFullTextSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly acl: MemoryAclService,
  ) {}

  async search(params: {
    acl: MemoryAclContext;
    query: string;
    limit?: number;
    sourceTypes?: MemorySourceType[];
    linkedIssueKey?: string;
    runId?: string;
    ownerUserId?: string;
    scopedSourceIds?: string[];
  }): Promise<{
    candidates: MemorySearchCandidate[];
    malformedExcludedCount: number;
  }> {
    if (!params.acl.userInWorkspace) {
      return { candidates: [], malformedExcludedCount: 0 };
    }

    const limit = Math.min(
      Math.max(
        params.limit ?? MEMORY_RETRIEVAL_CONFIG.lexicalCandidateLimit,
        1,
      ),
      100,
    );
    const query = params.query?.trim();
    if (!query) return { candidates: [], malformedExcludedCount: 0 };

    const issueKeys = [
      ...new Set([
        ...extractIssueKeys(query),
        ...(params.linkedIssueKey
          ? [params.linkedIssueKey.trim().toUpperCase()]
          : []),
      ]),
    ].filter(Boolean);

    const aclPart = this.acl.buildAclSql({ acl: params.acl, startIndex: 3 });
    // $1 workspaceId, $2 query text for tsquery, then acl values...
    const values: unknown[] = [params.acl.workspaceId, query, ...aclPart.values];
    let next = 3 + aclPart.values.length;

    let sourceFilter = '';
    if (params.sourceTypes?.length) {
      values.push(params.sourceTypes);
      sourceFilter = `AND "sourceType" = ANY($${next}::text[])`;
      next += 1;
    }

    // plainto_tsquery + optional exact issue-key OR for hyphenated identifiers
    let issueOr = '';
    if (issueKeys.length > 0) {
      values.push(issueKeys);
      const issueParam = next;
      next += 1;
      issueOr = `OR "linkedIssueKey" = ANY($${issueParam}::text[]) OR "text" ILIKE ANY(
        ARRAY(SELECT '%' || k || '%' FROM unnest($${issueParam}::text[]) AS k)
      )`;
    }

    let temporalFilter = '';
    if (params.runId || params.scopedSourceIds?.length || params.ownerUserId) {
      if (params.ownerUserId) {
        values.push(params.ownerUserId);
        temporalFilter += ` AND "ownerUserId" = $${next}`;
        next += 1;
      }
      if (params.runId && params.scopedSourceIds?.length) {
        values.push(params.runId);
        values.push(params.scopedSourceIds);
        temporalFilter += ` AND (
          metadata->>'runId' = $${next}
          OR "sourceId" = ANY($${next + 1}::text[])
        )`;
        next += 2;
      } else if (params.runId) {
        values.push(params.runId);
        temporalFilter += ` AND metadata->>'runId' = $${next}`;
        next += 1;
      } else if (params.scopedSourceIds?.length) {
        values.push(params.scopedSourceIds);
        temporalFilter += ` AND "sourceId" = ANY($${next}::text[])`;
        next += 1;
      }
    }

    const sql = `
      SELECT
        id,
        "sourceType",
        "sourceId",
        "chunkIndex",
        text,
        visibility,
        "teamId",
        "ownerUserId",
        "linkedIssueKey",
        metadata,
        ts_rank(
          to_tsvector('english', coalesce(text, '')),
          plainto_tsquery('english', $2)
        )::float8 AS "lexicalScore"
      FROM "MemoryChunk"
      WHERE "workspaceId" = $1
        AND ${aclPart.sql}
        ${sourceFilter}
        ${temporalFilter}
        AND (
          to_tsvector('english', coalesce(text, '')) @@ plainto_tsquery('english', $2)
          ${issueOr}
        )
      ORDER BY "lexicalScore" DESC, id ASC
      LIMIT ${limit}
    `;

    let rows: FtsRow[] = [];
    try {
      rows = await this.prisma.$queryRawUnsafe<FtsRow[]>(sql, ...values);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[MemoryFTS] query failed: ${message.slice(0, 300)}`);
      throw error;
    }

    const candidates: MemorySearchCandidate[] = [];
    let malformedExcludedCount = 0;
    rows.forEach((row, index) => {
      if (!this.acl.isChunkAuthorized(row, params.acl)) {
        malformedExcludedCount += 1;
        return;
      }
      candidates.push({
        chunkId: row.id,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        chunkIndex: row.chunkIndex,
        text: row.text,
        visibility: row.visibility,
        teamId: row.teamId,
        ownerUserId: row.ownerUserId,
        linkedIssueKey: row.linkedIssueKey,
        lexicalRank: index + 1,
        lexicalScore: Number(row.lexicalScore) || 0,
        metadata:
          row.metadata && typeof row.metadata === 'object'
            ? (row.metadata as Record<string, unknown>)
            : null,
      });
    });

    // Re-number ranks after ACL defense filter
    candidates.forEach((c, i) => {
      c.lexicalRank = i + 1;
    });

    return { candidates, malformedExcludedCount };
  }
}
