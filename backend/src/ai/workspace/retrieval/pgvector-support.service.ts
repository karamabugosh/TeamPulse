import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DEFAULT_EMBEDDING_DIMENSIONS } from './embedding.util';

export type VectorBackend = 'pgvector' | 'json';

/**
 * Detects native pgvector support at startup.
 * If available: ensures embedding_vec column + ANN index exist.
 * If not: callers keep using JSON embeddings (no breakage).
 */
@Injectable()
export class PgVectorSupportService implements OnModuleInit {
  private readonly logger = new Logger(PgVectorSupportService.name);
  private backend: VectorBackend = 'json';

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.detect();
  }

  isPgVectorAvailable(): boolean {
    return this.backend === 'pgvector';
  }

  getBackend(): VectorBackend {
    return this.backend;
  }

  /**
   * Re-run detection (ops / health). Safe to call repeatedly.
   */
  async detect(): Promise<VectorBackend> {
    try {
      const installed = await this.prisma.$queryRawUnsafe<
        Array<{ extname: string }>
      >(`SELECT extname FROM pg_extension WHERE extname = 'vector'`);

      if (installed.length === 0) {
        try {
          await this.prisma.$executeRawUnsafe(
            'CREATE EXTENSION IF NOT EXISTS vector',
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `pgvector unavailable — using JSON embedding fallback (${message.split('\n')[0]})`,
          );
          this.backend = 'json';
          return this.backend;
        }
      }

      await this.ensureNativeColumn();
      this.backend = 'pgvector';
      this.logger.log(
        `pgvector detected — native ANN search enabled (dims=${DEFAULT_EMBEDDING_DIMENSIONS})`,
      );
      return this.backend;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `pgvector detection failed — JSON fallback (${message.split('\n')[0]})`,
      );
      this.backend = 'json';
      return this.backend;
    }
  }

  /**
   * Sync a row's native vector after JSON upsert (no-op when pgvector absent).
   */
  async syncNativeVector(params: {
    id: string;
    vector: number[];
  }): Promise<void> {
    if (this.backend !== 'pgvector' || params.vector.length === 0) return;

    const literal = toVectorLiteral(params.vector);
    try {
      // Literal is floats-only (safe). Bound id avoids injection.
      await this.prisma.$executeRawUnsafe(
        `UPDATE "KnowledgeEmbedding"
         SET embedding_vec = '${literal}'::vector
         WHERE id = $1`,
        params.id,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Failed to sync embedding_vec id=${params.id}: ${message.split('\n')[0]}`,
      );
    }
  }

  /**
   * ANN / exact cosine distance search via pgvector.
   * Returns rows ordered by similarity (highest first).
   */
  async searchAnn(params: {
    workspaceId: string;
    queryVector: number[];
    limit: number;
    minSimilarity?: number;
  }): Promise<
    Array<{
      sourceId: string;
      sourceType: string;
      entityType: string;
      title: string;
      similarity: number;
    }>
  > {
    if (this.backend !== 'pgvector' || params.queryVector.length === 0) {
      return [];
    }

    const literal = toVectorLiteral(params.queryVector);
    const minSim = params.minSimilarity ?? 0.22;
    const limit = Math.min(Math.max(params.limit, 1), 100);
    const fetchLimit = Math.min(limit * 3, 200);

    try {
      // cosine distance operator <=> ; similarity = 1 - distance
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{
          sourceId: string;
          sourceType: string;
          entityType: string;
          title: string;
          distance: number;
        }>
      >(
        `SELECT "sourceId", "sourceType", "entityType", "title",
                (embedding_vec <=> '${literal}'::vector) AS distance
         FROM "KnowledgeEmbedding"
         WHERE "workspaceId" = $1
           AND embedding_vec IS NOT NULL
         ORDER BY embedding_vec <=> '${literal}'::vector
         LIMIT $2`,
        params.workspaceId,
        fetchLimit,
      );

      return rows
        .map((row) => ({
          sourceId: row.sourceId,
          sourceType: row.sourceType,
          entityType: row.entityType,
          title: row.title,
          similarity: 1 - Number(row.distance),
        }))
        .filter((row) => row.similarity >= minSim)
        .slice(0, limit);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `pgvector ANN search failed — caller should fall back to JSON (${message.split('\n')[0]})`,
      );
      return [];
    }
  }

  private async ensureNativeColumn(): Promise<void> {
    const dims = DEFAULT_EMBEDDING_DIMENSIONS;
    await this.prisma.$executeRawUnsafe(
      `ALTER TABLE "KnowledgeEmbedding"
       ADD COLUMN IF NOT EXISTS embedding_vec vector(${dims})`,
    );

    // HNSW preferred when available; fall back to IVFFlat; finally skip index.
    try {
      await this.prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "KnowledgeEmbedding_embedding_vec_hnsw_idx"
         ON "KnowledgeEmbedding"
         USING hnsw (embedding_vec vector_cosine_ops)`,
      );
    } catch {
      try {
        await this.prisma.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS "KnowledgeEmbedding_embedding_vec_ivfflat_idx"
           ON "KnowledgeEmbedding"
           USING ivfflat (embedding_vec vector_cosine_ops)
           WITH (lists = 100)`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `pgvector ANN index not created (exact search still works): ${message.split('\n')[0]}`,
        );
      }
    }
  }
}

/** Postgres vector literal: '[0.1,0.2,...]' — floats only. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.map((n) => (Number.isFinite(n) ? n : 0)).join(',')}]`;
}
