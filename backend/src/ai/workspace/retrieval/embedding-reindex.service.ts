import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { WorkspaceKnowledgeService } from '../knowledge/workspace-knowledge.service';
import { KnowledgeEmbeddingService } from '../retrieval/knowledge-embedding.service';
import {
  WORKSPACE_KNOWLEDGE_CHANGED,
  WorkspaceKnowledgeChangedEvent,
} from './knowledge-events';

/**
 * Background embedding reindex.
 * - Cron: periodically reindex all workspaces (hash-skip unchanged docs)
 * - On-demand: scheduleReindex(workspaceId) after knowledge writes
 */
@Injectable()
export class EmbeddingReindexService {
  private readonly logger = new Logger(EmbeddingReindexService.name);
  private readonly pending = new Set<string>();
  private running = false;
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: WorkspaceKnowledgeService,
    private readonly embeddings: KnowledgeEmbeddingService,
  ) {}

  @OnEvent(WORKSPACE_KNOWLEDGE_CHANGED)
  onKnowledgeChanged(event: WorkspaceKnowledgeChangedEvent): void {
    this.scheduleReindex(event.workspaceId, event.reason);
  }

  /**
   * Debounced per-workspace reindex (fires ~8s after last schedule call).
   */
  scheduleReindex(workspaceId: string, reason = 'knowledge_changed'): void {
    if (!workspaceId || workspaceId === 'unknown') return;
    if (!this.embeddings.isEnabled()) {
      this.logger.debug(
        `Embedding reindex skipped (AI embeddings disabled) workspace=${workspaceId} reason=${reason}`,
      );
      return;
    }

    this.pending.add(workspaceId);
    const existing = this.debounceTimers.get(workspaceId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(workspaceId);
      void this.reindexWorkspace(workspaceId, reason);
    }, 8_000);
    this.debounceTimers.set(workspaceId, timer);

    this.logger.log(
      `Embedding reindex scheduled workspace=${workspaceId} reason=${reason}`,
    );
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async cronReindexAll(): Promise<void> {
    if (!this.embeddings.isEnabled()) {
      this.logger.debug('Cron embedding reindex skipped — embeddings disabled');
      return;
    }
    if (this.running) {
      this.logger.warn('Cron embedding reindex skipped — previous run still active');
      return;
    }

    this.running = true;
    try {
      const workspaces = await this.prisma.workspace.findMany({
        select: { id: true, slackWorkspaceName: true },
        orderBy: { installedAt: 'asc' },
      });
      this.logger.log(
        `Cron embedding reindex start workspaces=${workspaces.length}`,
      );

      for (const ws of workspaces) {
        await this.reindexWorkspace(ws.id, 'cron');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Cron embedding reindex failed: ${message}`);
    } finally {
      this.running = false;
    }
  }

  async reindexWorkspace(
    workspaceId: string,
    reason = 'manual',
  ): Promise<{ indexed: number; skipped: number; documents: number }> {
    if (!this.embeddings.isEnabled()) {
      return { indexed: 0, skipped: 0, documents: 0 };
    }

    this.logger.log(
      `Embedding reindex start workspace=${workspaceId} reason=${reason}`,
    );

    try {
      // Higher limit than chat retrieval so background job covers more knowledge.
      const snapshot = await this.knowledge.collectSnapshot(
        workspaceId,
        {},
        80,
      );
      const result = await this.embeddings.ensureIndexed(
        workspaceId,
        snapshot.documents,
      );

      this.pending.delete(workspaceId);
      this.logger.log(
        `Embedding reindex complete workspace=${workspaceId} reason=${reason} docs=${snapshot.documents.length} indexed=${result.indexed} skipped=${result.skipped}`,
      );
      return {
        indexed: result.indexed,
        skipped: result.skipped,
        documents: snapshot.documents.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Embedding reindex failed workspace=${workspaceId} reason=${reason}: ${message}`,
      );
      return { indexed: 0, skipped: 0, documents: 0 };
    }
  }
}
