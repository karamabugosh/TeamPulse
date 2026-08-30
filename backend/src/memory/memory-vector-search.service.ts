import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MemoryVisibility } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  cosineSimilarity,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
  parseEmbeddingJson,
} from '../ai/workspace/retrieval/embedding.util';
import { toVectorLiteral } from '../ai/workspace/retrieval/pgvector-support.service';
import { MemoryAclService } from './memory-acl.service';
import { MEMORY_RETRIEVAL_CONFIG } from './memory-retrieval.config';
import {
  MemoryAclContext,
  MemorySearchCandidate,
} from './memory-retrieval.types';
import { MemorySourceType } from './memory-source.constants';
import { MemoryEmbeddingService } from './memory-embedding.service';

type VectorBackend = 'pgvector' | 'json_acl_bounded' | 'unavailable';

/**
 * Vector retrieval over MemoryChunk embeddings.
 * Prefers pgvector when the extension is available; otherwise ACL-bounded JSON cosine
 * (same interim pattern as KnowledgeEmbedding — documented, capped, not hidden).
 */
@Injectable()
export class MemoryVectorSearchService implements OnModuleInit {
  private readonly logger = new Logger(MemoryVectorSearchService.name);
  private backend: VectorBackend = 'unavailable';

  constructor(
    private readonly prisma: PrismaService,
    private readonly acl: MemoryAclService,
    private readonly embeddings: MemoryEmbeddingService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.detectBackend();
  }

  getBackend(): VectorBackend {
    return this.backend;
  }

  async detectBackend(): Promise<VectorBackend> {
    try {
      const installed = await this.prisma.$queryRawUnsafe<
        Array<{ extname: string }>
      >(`SELECT extname FROM pg_extension WHERE extname = 'vector'`);
      if (installed.length === 0) {
        try {
          await this.prisma.$executeRawUnsafe(
            'CREATE EXTENSION IF NOT EXISTS vector',
          );
        } catch {
          this.backend = MEMORY_RETRIEVAL_CONFIG.allowJsonVectorFallback
            ? 'json_acl_bounded'
            : 'unavailable';
          this.logger.warn(
            `[MemoryVector] pgvector not installed — backend=${this.backend}`,
          );
          return this.backend;
        }
      }
      await this.ensureNativeColumn();
      this.backend = 'pgvector';
      this.logger.log('[MemoryVector] pgvector enabled for MemoryChunk');
      return this.backend;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.backend = MEMORY_RETRIEVAL_CONFIG.allowJsonVectorFallback
        ? 'json_acl_bounded'
        : 'unavailable';
      this.logger.warn(
        `[MemoryVector] detect failed — backend=${this.backend} (${message.split('\n')[0]})`,
      );
      return this.backend;
    }
  }

  /**
   * Keep native vector in sync after Phase 2B JSON upsert (no-op without pgvector).
   */
  async syncNativeVector(params: {
    chunkId: string;
    vector: number[] | null;
  }): Promise<void> {
    if (this.backend !== 'pgvector') return;
    if (!params.vector || params.vector.length === 0) {
      try {
        await this.prisma.$executeRawUnsafe(
          `UPDATE "MemoryChunk" SET embedding_vec = NULL WHERE id = $1`,
          params.chunkId,
        );
      } catch {
        /* column may not exist yet */
      }
      return;
    }
    const literal = toVectorLiteral(params.vector);
    try {
      await this.prisma.$executeRawUnsafe(
        `UPDATE "MemoryChunk"
         SET embedding_vec = '${literal}'::vector
         WHERE id = $1`,
        params.chunkId,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[MemoryVector] sync failed id=${params.chunkId}: ${message.split('\n')[0]}`,
      );
    }
  }

  async search(params: {
    acl: MemoryAclContext;
    query: string;
    limit?: number;
    sourceTypes?: MemorySourceType[];
    queryEmbeddingOverride?: number[];
    queryEmbeddingModelOverride?: string;
    runId?: string;
    ownerUserId?: string;
    scopedSourceIds?: string[];
  }): Promise<{
    candidates: MemorySearchCandidate[];
    backend: VectorBackend | 'skipped';
    incompatibleEmbeddingCount: number;
  }> {
    if (!params.acl.userInWorkspace) {
      return {
        candidates: [],
        backend: 'skipped',
        incompatibleEmbeddingCount: 0,
      };
    }

    const model =
      params.queryEmbeddingModelOverride ||
      this.embeddings.model() ||
      DEFAULT_EMBEDDING_MODEL;
    const queryVector =
      params.queryEmbeddingOverride ??
      (await this.embeddingsEmbedQuery(params.query));

    if (!queryVector || queryVector.length === 0) {
      return {
        candidates: [],
        backend: 'skipped',
        incompatibleEmbeddingCount: 0,
      };
    }

    const dims = queryVector.length;
    const limit = Math.min(
      Math.max(params.limit ?? MEMORY_RETRIEVAL_CONFIG.vectorCandidateLimit, 1),
      100,
    );

    if (this.backend === 'pgvector') {
      return this.searchPgvector({
        acl: params.acl,
        queryVector,
        model,
        dims,
        limit,
        sourceTypes: params.sourceTypes,
        runId: params.runId,
        ownerUserId: params.ownerUserId,
        scopedSourceIds: params.scopedSourceIds,
      });
    }

    if (this.backend === 'json_acl_bounded') {
      return this.searchJsonAclBounded({
        acl: params.acl,
        queryVector,
        model,
        dims,
        limit,
        sourceTypes: params.sourceTypes,
        runId: params.runId,
        ownerUserId: params.ownerUserId,
        scopedSourceIds: params.scopedSourceIds,
      });
    }

    return {
      candidates: [],
      backend: 'unavailable',
      incompatibleEmbeddingCount: 0,
    };
  }

  private async embeddingsEmbedQuery(query: string): Promise<number[]> {
    try {
      const result = await this.embeddings.embedQuery(query);
      return result?.embedding ?? [];
    } catch {
      return [];
    }
  }

  private buildTemporalSqlFilter(params: {
    runId?: string;
    ownerUserId?: string;
    scopedSourceIds?: string[];
    values: unknown[];
    next: number;
  }): { sql: string; next: number } {
    let sql = '';
    let next = params.next;
    const values = params.values;

    if (params.ownerUserId) {
      values.push(params.ownerUserId);
      sql += ` AND "ownerUserId" = $${next}`;
      next += 1;
    }
    if (params.runId && params.scopedSourceIds?.length) {
      values.push(params.runId);
      values.push(params.scopedSourceIds);
      sql += ` AND (
        metadata->>'runId' = $${next}
        OR "sourceId" = ANY($${next + 1}::text[])
      )`;
      next += 2;
    } else if (params.runId) {
      values.push(params.runId);
      sql += ` AND metadata->>'runId' = $${next}`;
      next += 1;
    } else if (params.scopedSourceIds?.length) {
      values.push(params.scopedSourceIds);
      sql += ` AND "sourceId" = ANY($${next}::text[])`;
      next += 1;
    }

    return { sql, next };
  }

  private async searchPgvector(params: {
    acl: MemoryAclContext;
    queryVector: number[];
    model: string;
    dims: number;
    limit: number;
    sourceTypes?: MemorySourceType[];
    runId?: string;
    ownerUserId?: string;
    scopedSourceIds?: string[];
  }): Promise<{
    candidates: MemorySearchCandidate[];
    backend: 'pgvector';
    incompatibleEmbeddingCount: number;
  }> {
    const literal = toVectorLiteral(params.queryVector);
    const aclPart = this.acl.buildAclSql({ acl: params.acl, startIndex: 2 });
    const values: unknown[] = [params.acl.workspaceId, ...aclPart.values];
    let next = 2 + aclPart.values.length;

    values.push(params.model);
    const modelParam = next;
    next += 1;
    values.push(params.dims);
    const dimsParam = next;
    next += 1;

    let sourceFilter = '';
    if (params.sourceTypes?.length) {
      values.push(params.sourceTypes);
      sourceFilter = `AND "sourceType" = ANY($${next}::text[])`;
      next += 1;
    }

    const temporal = this.buildTemporalSqlFilter({
      runId: params.runId,
      ownerUserId: params.ownerUserId,
      scopedSourceIds: params.scopedSourceIds,
      values,
      next,
    });
    next = temporal.next;

    const fetchLimit = Math.min(params.limit * 3, 200);
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
        (1 - (embedding_vec <=> '${literal}'::vector))::float8 AS similarity
      FROM "MemoryChunk"
      WHERE "workspaceId" = $1
        AND ${aclPart.sql}
        AND embedding_vec IS NOT NULL
        AND "embeddingModel" = $${modelParam}
        AND "embeddingDimensions" = $${dimsParam}
        ${sourceFilter}
        ${temporal.sql}
      ORDER BY embedding_vec <=> '${literal}'::vector
      LIMIT ${fetchLimit}
    `;

    try {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{
          id: string;
          sourceType: string;
          sourceId: string;
          chunkIndex: number;
          text: string;
          visibility: MemoryVisibility;
          teamId: string | null;
          ownerUserId: string | null;
          linkedIssueKey: string | null;
          similarity: number;
          metadata: unknown;
        }>
      >(sql, ...values);

      // Diagnostic: ACL-visible native vectors that fail model/dims filter
      let incompatibleEmbeddingCount = 0;
      try {
        const mismatchSql = `
          SELECT COUNT(*)::int AS n
          FROM "MemoryChunk"
          WHERE "workspaceId" = $1
            AND ${aclPart.sql}
            AND embedding_vec IS NOT NULL
            AND (
              "embeddingModel" IS DISTINCT FROM $${modelParam}
              OR "embeddingDimensions" IS DISTINCT FROM $${dimsParam}
            )
            ${sourceFilter}
        `;
        const mismatch = await this.prisma.$queryRawUnsafe<
          Array<{ n: number }>
        >(mismatchSql, ...values);
        incompatibleEmbeddingCount = Number(mismatch[0]?.n ?? 0);
      } catch {
        incompatibleEmbeddingCount = 0;
      }

      const candidates: MemorySearchCandidate[] = [];
      for (const row of rows) {
        if (!this.acl.isChunkAuthorized(row, params.acl)) continue;
        const sim = Number(row.similarity);
        if (sim < MEMORY_RETRIEVAL_CONFIG.minVectorSimilarity) continue;
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
          vectorSimilarity: sim,
          metadata:
            row.metadata && typeof row.metadata === 'object'
              ? (row.metadata as Record<string, unknown>)
              : null,
        });
        if (candidates.length >= params.limit) break;
      }
      candidates.forEach((c, i) => {
        c.vectorRank = i + 1;
      });
      return {
        candidates,
        backend: 'pgvector',
        incompatibleEmbeddingCount,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[MemoryVector] pgvector search failed — falling back to JSON: ${message.split('\n')[0]}`,
      );
      const fallback = await this.searchJsonAclBounded(params);
      return {
        ...fallback,
        backend: 'pgvector', // attempted pgvector; results from JSON fallback path
      };
    }
  }

  private async searchJsonAclBounded(params: {
    acl: MemoryAclContext;
    queryVector: number[];
    model: string;
    dims: number;
    limit: number;
    sourceTypes?: MemorySourceType[];
    runId?: string;
    ownerUserId?: string;
    scopedSourceIds?: string[];
  }): Promise<{
    candidates: MemorySearchCandidate[];
    backend: 'json_acl_bounded';
    incompatibleEmbeddingCount: number;
  }> {
    const aclPart = this.acl.buildAclSql({ acl: params.acl, startIndex: 2 });
    const values: unknown[] = [params.acl.workspaceId, ...aclPart.values];
    let next = 2 + aclPart.values.length;

    let sourceFilter = '';
    if (params.sourceTypes?.length) {
      values.push(params.sourceTypes);
      sourceFilter = `AND "sourceType" = ANY($${next}::text[])`;
      next += 1;
    }

    const temporal = this.buildTemporalSqlFilter({
      runId: params.runId,
      ownerUserId: params.ownerUserId,
      scopedSourceIds: params.scopedSourceIds,
      values,
      next,
    });

    const cap = MEMORY_RETRIEVAL_CONFIG.jsonVectorScanCap;
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
        embedding,
        "embeddingModel",
        "embeddingDimensions",
        metadata
      FROM "MemoryChunk"
      WHERE "workspaceId" = $1
        AND ${aclPart.sql}
        AND embedding IS NOT NULL
        ${sourceFilter}
        ${temporal.sql}
      ORDER BY "indexedAt" DESC NULLS LAST, id ASC
      LIMIT ${cap}
    `;

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        sourceType: string;
        sourceId: string;
        chunkIndex: number;
        text: string;
        visibility: MemoryVisibility;
        teamId: string | null;
        ownerUserId: string | null;
        linkedIssueKey: string | null;
        embedding: unknown;
        embeddingModel: string | null;
        embeddingDimensions: number | null;
        metadata: unknown;
      }>
    >(sql, ...values);

    let incompatibleEmbeddingCount = 0;
    const scored: MemorySearchCandidate[] = [];

    for (const row of rows) {
      if (!this.acl.isChunkAuthorized(row, params.acl)) continue;
      if (
        row.embeddingModel !== params.model ||
        row.embeddingDimensions !== params.dims
      ) {
        incompatibleEmbeddingCount += 1;
        continue;
      }
      const vector = parseEmbeddingJson(row.embedding);
      if (!vector || vector.length !== params.dims) {
        incompatibleEmbeddingCount += 1;
        continue;
      }
      const similarity = cosineSimilarity(params.queryVector, vector);
      if (similarity < MEMORY_RETRIEVAL_CONFIG.minVectorSimilarity) continue;
      scored.push({
        chunkId: row.id,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        chunkIndex: row.chunkIndex,
        text: row.text,
        visibility: row.visibility,
        teamId: row.teamId,
        ownerUserId: row.ownerUserId,
        linkedIssueKey: row.linkedIssueKey,
        vectorSimilarity: similarity,
        metadata:
          row.metadata && typeof row.metadata === 'object'
            ? (row.metadata as Record<string, unknown>)
            : null,
      });
    }

    scored.sort(
      (a, b) => (b.vectorSimilarity ?? 0) - (a.vectorSimilarity ?? 0),
    );
    const candidates = scored.slice(0, params.limit);
    candidates.forEach((c, i) => {
      c.vectorRank = i + 1;
    });

    return {
      candidates,
      backend: 'json_acl_bounded',
      incompatibleEmbeddingCount,
    };
  }

  private async ensureNativeColumn(): Promise<void> {
    const dims = DEFAULT_EMBEDDING_DIMENSIONS;
    await this.prisma.$executeRawUnsafe(
      `ALTER TABLE "MemoryChunk"
       ADD COLUMN IF NOT EXISTS embedding_vec vector(${dims})`,
    );
    try {
      await this.prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "MemoryChunk_embedding_vec_hnsw_idx"
         ON "MemoryChunk"
         USING hnsw (embedding_vec vector_cosine_ops)`,
      );
    } catch {
      try {
        await this.prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS "MemoryChunk_embedding_vec_ivfflat_idx"
           ON "MemoryChunk"
           USING ivfflat (embedding_vec vector_cosine_ops)
           WITH (lists = 100)`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `[MemoryVector] ANN index skipped: ${message.split('\n')[0]}`,
        );
      }
    }
  }
}
