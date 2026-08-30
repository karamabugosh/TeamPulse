import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { KnowledgeDocument, KnowledgeEntityType } from '../types/workspace-ai.types';
import { OpenAiEmbeddingProvider } from './openai-embedding.provider';
import { PgVectorSupportService } from './pgvector-support.service';
import {
  cosineSimilarity,
  DEFAULT_EMBEDDING_DIMENSIONS,
  hashContent,
  parseEmbeddingJson,
} from './embedding.util';

const EMBEDDABLE_ENTITIES: ReadonlySet<KnowledgeEntityType> = new Set([
  'jira_issue',
  'jira_audit',
  'standup_submission',
  'standup_thread', // Slack Threads
  'standup_run',
  'blocker',
  'blocker_update',
  'report', // AI Digests + generated reports
  'team_memory',
]);

export type SemanticHit = {
  documentId: string;
  sourceType: string;
  sourceId: string;
  entityType: string;
  title: string;
  similarity: number;
};

export type SemanticSearchMeta = {
  backend: 'pgvector' | 'json';
  durationMs: number;
  candidatesScanned: number;
  hits: number;
};

/**
 * Indexes workspace knowledge into KnowledgeEmbedding and runs semantic search.
 * Prefer pgvector ANN when available; otherwise cosine over JSON float arrays.
 */
@Injectable()
export class KnowledgeEmbeddingService {
  private readonly logger = new Logger(KnowledgeEmbeddingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: OpenAiEmbeddingProvider,
    private readonly pgvector: PgVectorSupportService,
  ) {}

  isEnabled(): boolean {
    return this.embeddings.isAvailable();
  }

  getVectorBackend(): 'pgvector' | 'json' {
    return this.pgvector.getBackend();
  }

  /**
   * Ensure embeddings exist for the given documents (skip unchanged hashes).
   * Batches OpenAI calls; scoped to workspace. Avoids duplicate rows via upsert.
   */
  async ensureIndexed(
    workspaceId: string,
    documents: KnowledgeDocument[],
  ): Promise<{ indexed: number; skipped: number }> {
    if (!this.isEnabled()) {
      return { indexed: 0, skipped: documents.length };
    }

    const candidates = documents.filter((doc) =>
      EMBEDDABLE_ENTITIES.has(doc.entity),
    );
    if (candidates.length === 0) {
      return { indexed: 0, skipped: 0 };
    }

    const existing = await this.prisma.knowledgeEmbedding.findMany({
      where: {
        workspaceId,
        OR: candidates.map((doc) => ({
          sourceType: doc.source,
          sourceId: doc.id,
        })),
      },
      select: {
        id: true,
        sourceType: true,
        sourceId: true,
        contentHash: true,
      },
    });
    const existingKey = new Map(
      existing.map((row) => [
        `${row.sourceType}::${row.sourceId}`,
        { id: row.id, contentHash: row.contentHash },
      ]),
    );

    const toEmbed: KnowledgeDocument[] = [];
    let skipped = 0;
    for (const doc of candidates) {
      const hash = hashContent(doc.title, doc.content);
      const prev = existingKey.get(`${doc.source}::${doc.id}`);
      if (prev?.contentHash === hash) {
        skipped += 1;
        continue;
      }
      toEmbed.push(doc);
    }

    if (toEmbed.length === 0) {
      return { indexed: 0, skipped };
    }

    const model = this.embeddings.model();
    const BATCH = 32;
    let indexed = 0;

    for (let i = 0; i < toEmbed.length; i += BATCH) {
      const batch = toEmbed.slice(i, i + BATCH);
      const texts = batch.map(
        (doc) => `${doc.title}\n${doc.content}`.slice(0, 8000),
      );
      const vectors = await this.embeddings.embedTexts(texts);

      for (let j = 0; j < batch.length; j += 1) {
        const doc = batch[j];
        const vector = vectors[j] ?? [];
        if (vector.length === 0) continue;
        const contentHash = hashContent(doc.title, doc.content);
        const row = await this.prisma.knowledgeEmbedding.upsert({
          where: {
            workspaceId_sourceType_sourceId: {
              workspaceId,
              sourceType: doc.source,
              sourceId: doc.id,
            },
          },
          create: {
            workspaceId,
            sourceType: doc.source,
            sourceId: doc.id,
            entityType: doc.entity,
            title: doc.title.slice(0, 500),
            contentHash,
            embedding: vector as Prisma.InputJsonValue,
            model,
            dimensions: vector.length || DEFAULT_EMBEDDING_DIMENSIONS,
          },
          update: {
            entityType: doc.entity,
            title: doc.title.slice(0, 500),
            contentHash,
            embedding: vector as Prisma.InputJsonValue,
            model,
            dimensions: vector.length || DEFAULT_EMBEDDING_DIMENSIONS,
            indexedAt: new Date(),
          },
        });

        await this.pgvector.syncNativeVector({ id: row.id, vector });

        indexed += 1;
        this.logger.log(
          `Embedding updated workspace=${workspaceId} entity=${doc.entity} sourceId=${doc.id} backend=${this.getVectorBackend()} title="${doc.title.slice(0, 60)}"`,
        );
      }
    }

    this.logger.log(
      `Embedding index workspace=${workspaceId} indexed=${indexed} skipped=${skipped} backend=${this.getVectorBackend()}`,
    );
    return { indexed, skipped };
  }

  /**
   * Semantic nearest neighbors within a workspace.
   * Uses pgvector ANN when available; otherwise in-app cosine over JSON.
   */
  async searchSimilar(params: {
    workspaceId: string;
    query: string;
    limit?: number;
    minSimilarity?: number;
  }): Promise<SemanticHit[]> {
    const { hits } = await this.searchSimilarWithMeta(params);
    return hits;
  }

  async searchSimilarWithMeta(params: {
    workspaceId: string;
    query: string;
    limit?: number;
    minSimilarity?: number;
  }): Promise<{ hits: SemanticHit[]; meta: SemanticSearchMeta }> {
    const started = Date.now();
    const emptyMeta = (backend: 'pgvector' | 'json'): SemanticSearchMeta => ({
      backend,
      durationMs: Date.now() - started,
      candidatesScanned: 0,
      hits: 0,
    });

    if (!this.isEnabled()) {
      return { hits: [], meta: emptyMeta(this.getVectorBackend()) };
    }

    const queryVector = await this.embeddings.embedQuery(params.query);
    if (queryVector.length === 0) {
      return { hits: [], meta: emptyMeta(this.getVectorBackend()) };
    }

    const limit = params.limit ?? 24;
    const minSim = params.minSimilarity ?? 0.22;

    if (this.pgvector.isPgVectorAvailable()) {
      const ann = await this.pgvector.searchAnn({
        workspaceId: params.workspaceId,
        queryVector,
        limit,
        minSimilarity: minSim,
      });
      if (ann.length > 0) {
        const hits: SemanticHit[] = ann.map((row) => ({
          documentId: row.sourceId,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          entityType: row.entityType,
          title: row.title,
          similarity: row.similarity,
        }));
        const meta: SemanticSearchMeta = {
          backend: 'pgvector',
          durationMs: Date.now() - started,
          candidatesScanned: ann.length,
          hits: hits.length,
        };
        this.logger.log(
          `Semantic search backend=pgvector workspace=${params.workspaceId} hits=${hits.length} ms=${meta.durationMs}`,
        );
        return { hits, meta };
      }
      this.logger.debug(
        `pgvector returned 0 hits — falling back to JSON cosine workspace=${params.workspaceId}`,
      );
    }

    return this.searchJsonCosine({
      workspaceId: params.workspaceId,
      queryVector,
      limit,
      minSim,
      started,
    });
  }

  private async searchJsonCosine(params: {
    workspaceId: string;
    queryVector: number[];
    limit: number;
    minSim: number;
    started: number;
  }): Promise<{ hits: SemanticHit[]; meta: SemanticSearchMeta }> {
    const rows = await this.prisma.knowledgeEmbedding.findMany({
      where: { workspaceId: params.workspaceId },
      select: {
        sourceId: true,
        sourceType: true,
        entityType: true,
        title: true,
        embedding: true,
      },
      take: 2000,
    });

    const scored: SemanticHit[] = [];
    for (const row of rows) {
      const vector = parseEmbeddingJson(row.embedding);
      if (!vector) continue;
      const similarity = cosineSimilarity(params.queryVector, vector);
      if (similarity < params.minSim) continue;
      scored.push({
        documentId: row.sourceId,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        entityType: row.entityType,
        title: row.title,
        similarity,
      });
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    const hits = scored.slice(0, params.limit);
    const meta: SemanticSearchMeta = {
      backend: 'json',
      durationMs: Date.now() - params.started,
      candidatesScanned: rows.length,
      hits: hits.length,
    };
    this.logger.log(
      `Semantic search backend=json workspace=${params.workspaceId} scanned=${rows.length} hits=${hits.length} ms=${meta.durationMs}`,
    );
    return { hits, meta };
  }
}
