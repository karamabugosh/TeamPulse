import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  MemoryOutboxEvent,
  MemoryOutboxOperation,
  MemoryOutboxStatus,
  MemoryVisibility,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MEMORY_WORKER_CONFIG, memoryRetryDelayMs } from './memory.config';
import { MemoryChunkerService } from './memory-chunker.service';
import {
  MemoryEmbeddingService,
  memorySourceAdvisoryLockKey,
} from './memory-embedding.service';
import { MemoryVectorSearchService } from './memory-vector-search.service';
import {
  MemorySourceMissingError,
  MemoryUnsupportedSourceError,
  MemoryWorkspaceMismatchError,
  NormalizedMemorySource,
  PreparedMemoryChunk,
} from './memory-normalized.types';
import {
  MemoryNormalizerService,
  MemorySourceLoader,
} from './memory-source.loader';
import { MEMORY_SOURCE } from './memory-source.constants';

@Injectable()
export class MemoryIndexWorkerService {
  private readonly logger = new Logger(MemoryIndexWorkerService.name);
  private tickRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly loader: MemorySourceLoader,
    private readonly normalizer: MemoryNormalizerService,
    private readonly chunker: MemoryChunkerService,
    private readonly embeddings: MemoryEmbeddingService,
    private readonly vectorSync: MemoryVectorSearchService,
  ) {}

  /** Cron tick — bounded batch; does not block bootstrap on backlog. */
  @Cron(CronExpression.EVERY_MINUTE)
  async scheduledTick(): Promise<void> {
    if (process.env.MEMORY_WORKER_ENABLED === 'false') {
      return;
    }
    await this.processPendingBatch();
  }

  /**
   * Deterministic entry for tests / local ops.
   * Returns counts for observability.
   * @param limit max events to claim
   * @param onlyEventIds when set, only claim/process these ids (tests)
   */
  async processPendingBatch(
    limit = MEMORY_WORKER_CONFIG.batchSize,
    onlyEventIds?: string[],
  ): Promise<{
    claimed: number;
    completed: number;
    failed: number;
    retried: number;
  }> {
    if (this.tickRunning && !onlyEventIds) {
      this.logger.debug('Memory worker tick skipped — previous still running');
      return { claimed: 0, completed: 0, failed: 0, retried: 0 };
    }
    if (!onlyEventIds) this.tickRunning = true;
    try {
      if (!onlyEventIds) {
        await this.recoverStaleLocks();
      }
      const events = onlyEventIds?.length
        ? await this.claimSpecificEvents(onlyEventIds)
        : await this.claimEligibleEvents(limit);
      let completed = 0;
      let failed = 0;
      let retried = 0;

      for (const event of events) {
        try {
          await this.processClaimedEvent(event);
          completed += 1;
        } catch (error) {
          const outcome = await this.handleProcessingFailure(event, error);
          if (outcome === 'failed') failed += 1;
          else retried += 1;
        }
      }

      if (events.length > 0) {
        this.logger.log(
          `[MemoryWorker] batch claimed=${events.length} completed=${completed} retried=${retried} failed=${failed}`,
        );
      }

      return { claimed: events.length, completed, failed, retried };
    } finally {
      if (!onlyEventIds) this.tickRunning = false;
    }
  }

  /** Claim specific PENDING event ids (atomic per id). Used by tests. */
  async claimSpecificEvents(eventIds: string[]): Promise<MemoryOutboxEvent[]> {
    const now = new Date();
    const claimed: MemoryOutboxEvent[] = [];
    for (const id of eventIds) {
      const result = await this.prisma.memoryOutboxEvent.updateMany({
        where: { id, status: MemoryOutboxStatus.PENDING },
        data: {
          status: MemoryOutboxStatus.PROCESSING,
          lockedAt: now,
          attempts: { increment: 1 },
        },
      });
      if (result.count !== 1) continue;
      const row = await this.prisma.memoryOutboxEvent.findUnique({
        where: { id },
      });
      if (row) claimed.push(row);
    }
    return claimed;
  }

  /**
   * Atomic claim: conditional updateMany PENDING → PROCESSING per row.
   * Concurrent workers cannot both observe count===1 for the same id.
   */
  async claimEligibleEvents(limit: number): Promise<MemoryOutboxEvent[]> {
    const now = new Date();
    const oversample = Math.max(limit * 3, limit);
    const candidates = await this.prisma.memoryOutboxEvent.findMany({
      where: {
        status: MemoryOutboxStatus.PENDING,
        availableAt: { lte: now },
      },
      orderBy: { availableAt: 'asc' },
      take: oversample,
    });

    const claimed: MemoryOutboxEvent[] = [];
    for (const candidate of candidates) {
      if (claimed.length >= limit) break;
      const result = await this.prisma.memoryOutboxEvent.updateMany({
        where: {
          id: candidate.id,
          status: MemoryOutboxStatus.PENDING,
        },
        data: {
          status: MemoryOutboxStatus.PROCESSING,
          lockedAt: now,
          attempts: { increment: 1 },
        },
      });
      if (result.count !== 1) continue;
      const row = await this.prisma.memoryOutboxEvent.findUnique({
        where: { id: candidate.id },
      });
      if (row) {
        claimed.push(row);
        this.logger.log(
          `[MemoryWorker] eventId=${row.id} workspaceId=${row.workspaceId} sourceType=${row.sourceType} sourceId=${row.sourceId} attempt=${row.attempts} status=PROCESSING`,
        );
      }
    }
    return claimed;
  }

  async recoverStaleLocks(): Promise<number> {
    const cutoff = new Date(Date.now() - MEMORY_WORKER_CONFIG.lockTimeoutMs);
    const result = await this.prisma.memoryOutboxEvent.updateMany({
      where: {
        status: MemoryOutboxStatus.PROCESSING,
        lockedAt: { lt: cutoff },
      },
      data: {
        status: MemoryOutboxStatus.PENDING,
        availableAt: new Date(),
        lastError: 'stale_lock_recovered',
        lockedAt: null,
      },
    });
    if (result.count > 0) {
      this.logger.warn(
        `[MemoryWorker] recovered stale PROCESSING events count=${result.count}`,
      );
    }
    return result.count;
  }

  async processClaimedEvent(event: MemoryOutboxEvent): Promise<void> {
    const started = Date.now();

    if (event.operation === MemoryOutboxOperation.DELETE) {
      await this.processDelete(event);
      this.logger.log(
        `[MemoryWorker] eventId=${event.id} status=COMPLETED op=DELETE durationMs=${Date.now() - started}`,
      );
      return;
    }

    if (event.operation !== MemoryOutboxOperation.UPSERT) {
      throw new MemoryUnsupportedSourceError(`operation:${event.operation}`);
    }

    const lockKey = memorySourceAdvisoryLockKey(
      event.workspaceId,
      event.sourceType,
      event.sourceId,
    );

    // Serialize rebuilds for the same source across Nest instances.
    await this.prisma.$executeRaw`SELECT pg_advisory_lock(${lockKey})`;
    try {
      let loaded;
      try {
        loaded = await this.loader.load({
          workspaceId: event.workspaceId,
          sourceType: event.sourceType,
          sourceId: event.sourceId,
        });
      } catch (error) {
        if (error instanceof MemorySourceMissingError) {
          await this.cleanupMissingSource(event);
          this.logger.log(
            `[MemoryWorker] eventId=${event.id} status=COMPLETED reason=source_missing_cleanup durationMs=${Date.now() - started}`,
          );
          return;
        }
        throw error;
      }

      const normalized = await this.sanitizeTeamScope(
        this.normalizer.normalize(loaded),
      );
      const prepared = this.chunker.prepareChunks(normalized);

      const existing = await this.prisma.memoryChunk.findMany({
        where: {
          workspaceId: event.workspaceId,
          sourceType: event.sourceType,
          sourceId: event.sourceId,
        },
      });
      const existingByIndex = new Map(existing.map((c) => [c.chunkIndex, c]));

      const embedded: Array<{
        prepared: PreparedMemoryChunk;
        embedding: number[] | null;
        model: string | null;
        dimensions: number | null;
      }> = [];

      let created = 0;
      let reused = 0;

      for (const chunk of prepared) {
        const prev = existingByIndex.get(chunk.chunkIndex) ?? null;
        const emb = await this.embeddings.embedChunk({
          text: chunk.text,
          contentHash: chunk.contentHash,
          existing: prev
            ? {
                contentHash: prev.contentHash,
                embedding: prev.embedding,
                embeddingModel: prev.embeddingModel,
                embeddingDimensions: prev.embeddingDimensions,
              }
            : null,
        });

        if (emb?.reused) reused += 1;
        else if (emb) created += 1;

        // AI disabled → null embedding allowed; AI enabled failures throw transient.
        embedded.push({
          prepared: chunk,
          embedding: emb?.embedding ?? null,
          model: emb?.model ?? null,
          dimensions: emb?.dimensions ?? null,
        });
      }

      await this.replaceChunksTransaction({
        event,
        normalized,
        embedded,
      });

      // Phase 3A: keep optional native pgvector column in sync when available.
      for (const item of embedded) {
        const row = await this.prisma.memoryChunk.findUnique({
          where: {
            workspaceId_sourceType_sourceId_chunkIndex: {
              workspaceId: normalized.workspaceId,
              sourceType: normalized.sourceType,
              sourceId: normalized.sourceId,
              chunkIndex: item.prepared.chunkIndex,
            },
          },
          select: { id: true },
        });
        if (row) {
          await this.vectorSync.syncNativeVector({
            chunkId: row.id,
            vector: item.embedding,
          });
        }
      }

      this.logger.log(
        `[MemoryWorker] source=${event.sourceType}/${event.sourceId} chunksGenerated=${prepared.length} embeddingsCreated=${created} embeddingsReused=${reused}`,
      );
      this.logger.log(
        `[MemoryWorker] eventId=${event.id} status=COMPLETED durationMs=${Date.now() - started}`,
      );
    } finally {
      await this.prisma.$executeRaw`SELECT pg_advisory_unlock(${lockKey})`;
    }
  }

  private async replaceChunksTransaction(params: {
    event: MemoryOutboxEvent;
    normalized: NormalizedMemorySource;
    embedded: Array<{
      prepared: PreparedMemoryChunk;
      embedding: number[] | null;
      model: string | null;
      dimensions: number | null;
    }>;
  }): Promise<void> {
    const { event, normalized, embedded } = params;
    const keepIndexes = embedded.map((e) => e.prepared.chunkIndex);

    await this.prisma.$transaction(async (tx) => {
      for (const item of embedded) {
        const chunk = item.prepared;
        await tx.memoryChunk.upsert({
          where: {
            workspaceId_sourceType_sourceId_chunkIndex: {
              workspaceId: normalized.workspaceId,
              sourceType: normalized.sourceType,
              sourceId: normalized.sourceId,
              chunkIndex: chunk.chunkIndex,
            },
          },
          create: {
            workspaceId: normalized.workspaceId,
            sourceType: normalized.sourceType,
            sourceId: normalized.sourceId,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
            contentHash: chunk.contentHash,
            visibility: normalized.visibility,
            ownerUserId: normalized.ownerUserId,
            teamId: normalized.teamId,
            linkedIssueKey: normalized.linkedIssueKey,
            metadata: normalized.metadata,
            embedding:
              item.embedding === null
                ? Prisma.JsonNull
                : (item.embedding as Prisma.InputJsonValue),
            embeddingModel: item.model,
            embeddingDimensions: item.dimensions,
            indexedAt: item.embedding ? new Date() : null,
          },
          update: {
            text: chunk.text,
            contentHash: chunk.contentHash,
            visibility: normalized.visibility,
            ownerUserId: normalized.ownerUserId,
            teamId: normalized.teamId,
            linkedIssueKey: normalized.linkedIssueKey,
            metadata: normalized.metadata,
            embedding:
              item.embedding === null
                ? Prisma.JsonNull
                : (item.embedding as Prisma.InputJsonValue),
            embeddingModel: item.model,
            embeddingDimensions: item.dimensions,
            indexedAt: item.embedding ? new Date() : null,
          },
        });
      }

      await tx.memoryChunk.deleteMany({
        where: {
          workspaceId: normalized.workspaceId,
          sourceType: normalized.sourceType,
          sourceId: normalized.sourceId,
          chunkIndex: { notIn: keepIndexes },
        },
      });

      await tx.memoryOutboxEvent.update({
        where: { id: event.id },
        data: {
          status: MemoryOutboxStatus.COMPLETED,
          processedAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });
    });
  }

  private async processDelete(event: MemoryOutboxEvent): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.memoryChunk.deleteMany({
        where: {
          workspaceId: event.workspaceId,
          sourceType: event.sourceType,
          sourceId: event.sourceId,
        },
      });
      await tx.memoryOutboxEvent.update({
        where: { id: event.id },
        data: {
          status: MemoryOutboxStatus.COMPLETED,
          processedAt: new Date(),
          lockedAt: null,
          lastError: null,
        },
      });
    });
  }

  /**
   * TEAM visibility requires a teamId that belongs to the same workspace.
   * Cross-workspace / orphan teamIds:
   * - Prefer remapping to the workspace's oldest team (preserve TEAM ACL)
   * - Else fall back to WORKSPACE (teamId null)
   */
  private async sanitizeTeamScope(
    normalized: NormalizedMemorySource,
  ): Promise<NormalizedMemorySource> {
    const teamId = normalized.teamId?.trim() || null;
    if (!teamId) {
      return {
        ...normalized,
        teamId: null,
        visibility:
          normalized.visibility === MemoryVisibility.PRIVATE
            ? MemoryVisibility.PRIVATE
            : MemoryVisibility.WORKSPACE,
      };
    }

    const team = await this.prisma.team.findFirst({
      where: { id: teamId, workspaceId: normalized.workspaceId },
      select: { id: true },
    });
    if (team) return normalized;

    const fallbackTeam = await this.prisma.team.findFirst({
      where: { workspaceId: normalized.workspaceId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (fallbackTeam) {
      this.logger.warn(
        `[MemoryWorker] orphan teamId=${teamId} for workspace=${normalized.workspaceId} source=${normalized.sourceType}/${normalized.sourceId} → team=${fallbackTeam.id}`,
      );
      return {
        ...normalized,
        teamId: fallbackTeam.id,
        visibility:
          normalized.visibility === MemoryVisibility.PRIVATE
            ? MemoryVisibility.PRIVATE
            : MemoryVisibility.TEAM,
      };
    }

    this.logger.warn(
      `[MemoryWorker] orphan teamId=${teamId} for workspace=${normalized.workspaceId} source=${normalized.sourceType}/${normalized.sourceId} → WORKSPACE`,
    );
    return {
      ...normalized,
      teamId: null,
      visibility:
        normalized.visibility === MemoryVisibility.PRIVATE
          ? MemoryVisibility.PRIVATE
          : MemoryVisibility.WORKSPACE,
    };
  }

  private async cleanupMissingSource(event: MemoryOutboxEvent): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.memoryChunk.deleteMany({
        where: {
          workspaceId: event.workspaceId,
          sourceType: event.sourceType,
          sourceId: event.sourceId,
        },
      });
      await tx.memoryOutboxEvent.update({
        where: { id: event.id },
        data: {
          status: MemoryOutboxStatus.COMPLETED,
          processedAt: new Date(),
          lockedAt: null,
          lastError: 'source_missing_cleaned',
        },
      });
    });
  }

  private async handleProcessingFailure(
    event: MemoryOutboxEvent,
    error: unknown,
  ): Promise<'failed' | 'retried'> {
    const message = error instanceof Error ? error.message : String(error);
    const safe = message.slice(0, 500);
    const permanent =
      error instanceof MemoryUnsupportedSourceError ||
      error instanceof MemoryWorkspaceMismatchError;

    this.logger.error(
      `[MemoryWorker] eventId=${event.id} source=${event.sourceType}/${event.sourceId} attempt=${event.attempts} error=${safe}`,
    );

    // Do not delete existing MemoryChunks on failure (embeddings fail mid-flight).
    if (permanent || event.attempts >= MEMORY_WORKER_CONFIG.maxAttempts) {
      await this.prisma.memoryOutboxEvent.update({
        where: { id: event.id },
        data: {
          status: MemoryOutboxStatus.FAILED,
          lastError: safe,
          lockedAt: null,
          processedAt: new Date(),
        },
      });
      return 'failed';
    }

    const delay = memoryRetryDelayMs(event.attempts);
    await this.prisma.memoryOutboxEvent.update({
      where: { id: event.id },
      data: {
        status: MemoryOutboxStatus.PENDING,
        lastError: safe,
        lockedAt: null,
        availableAt: new Date(Date.now() + delay),
      },
    });
    return 'retried';
  }
}

/** Exported for tests — known supported types. */
export function isSupportedMemoryWorkerSource(sourceType: string): boolean {
  return (
    sourceType === MEMORY_SOURCE.STANDUP_ANSWER ||
    sourceType === MEMORY_SOURCE.BLOCKER ||
    sourceType === MEMORY_SOURCE.BLOCKER_RESOLUTION ||
    sourceType === MEMORY_SOURCE.REPORT
  );
}
