import { Injectable, Logger } from '@nestjs/common';
import {
  MemoryOutboxOperation,
  MemoryOutboxStatus,
  QuestionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryOutboxService } from './memory-outbox.service';
import {
  MEMORY_SOURCE,
  MEMORY_SOURCE_TYPES,
  MemorySourceType,
} from './memory-source.constants';
import {
  isMemoryEligibleAnswerType,
  isMemoryEligibleBlockerResolutionUpdate,
  isMemoryEligibleDigest,
} from './memory-ingestion.policy';
import {
  BACKFILL_DEFAULT_BATCH_SIZE,
  BACKFILL_DEFAULT_PAGE_SIZE,
  BackfillAnalyzeOptions,
  BackfillDryRunReport,
  BackfillEnqueueOptions,
  BackfillEnqueueResult,
  MemoryChunkSample,
  MemorySourceIndexState,
  MemoryVerifyReport,
  SourceTypeCounters,
} from './memory-backfill.types';

type EligibleRef = { sourceType: MemorySourceType; sourceId: string };

/**
 * Pulse V2 Phase 2C — historical discovery + controlled outbox enqueue + verification.
 * Does NOT create MemoryChunk, call OpenAI, or normalize/chunk.
 * Indexing remains the Phase 2B worker's responsibility.
 */
@Injectable()
export class MemoryBackfillService {
  private readonly logger = new Logger(MemoryBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: MemoryOutboxService,
  ) {}

  async requireWorkspace(workspaceId: string): Promise<{
    id: string;
    slackWorkspaceName: string;
  }> {
    const id = workspaceId?.trim();
    if (!id) {
      throw new Error('workspaceId is required');
    }
    const workspace = await this.prisma.workspace.findUnique({
      where: { id },
      select: { id: true, slackWorkspaceName: true },
    });
    if (!workspace) {
      throw new Error(`Workspace not found: ${id}`);
    }
    return workspace;
  }

  /**
   * Read-only analysis. Never writes MemoryOutboxEvent / MemoryChunk / business tables.
   */
  async analyzeWorkspace(
    workspaceId: string,
    options: BackfillAnalyzeOptions = {},
  ): Promise<BackfillDryRunReport> {
    const workspace = await this.requireWorkspace(workspaceId);
    const sourceTypes = this.resolveSourceTypes(options.sourceTypes);
    const pageSize = options.pageSize ?? BACKFILL_DEFAULT_PAGE_SIZE;
    const onlyMissing = options.onlyMissing !== false;
    const retryFailed = options.retryFailed === true;
    const repairInconsistent = options.repairInconsistent === true;

    const bySourceType: SourceTypeCounters[] = [];

    for (const sourceType of sourceTypes) {
      const counters = emptyCounters(sourceType);
      let cursor: string | undefined;

      for (;;) {
        const page = await this.scanSourcePage({
          workspaceId: workspace.id,
          sourceType,
          cursor,
          pageSize,
        });
        if (page.rows.length === 0) break;

        counters.inspected += page.rows.length;
        const eligibleIds: string[] = [];
        for (const row of page.rows) {
          if (row.eligible) {
            counters.eligible += 1;
            eligibleIds.push(row.sourceId);
          } else {
            counters.skipped += 1;
          }
        }

        if (eligibleIds.length > 0) {
          const states = await this.classifyEligibleSources(
            workspace.id,
            sourceType,
            eligibleIds,
          );
          for (const state of states.values()) {
            this.bumpState(counters, state);
            if (
              this.shouldEnqueue(state, {
                onlyMissing,
                retryFailed,
                repairInconsistent,
              })
            ) {
              counters.wouldEnqueue += 1;
            }
          }
        }

        cursor = page.nextCursor;
        if (!cursor) break;
      }

      bySourceType.push(counters);
    }

    return {
      workspaceId: workspace.id,
      workspaceName: workspace.slackWorkspaceName,
      bySourceType,
      totals: sumCounters(bySourceType),
      databaseWrites: 0,
    };
  }

  /**
   * Explicit mutation: enqueue bounded PENDING UPSERT events for missing (etc.) sources.
   * Does not call OpenAI or wait for the worker.
   */
  async enqueueWorkspace(
    workspaceId: string,
    options: BackfillEnqueueOptions = {},
  ): Promise<BackfillEnqueueResult> {
    const workspace = await this.requireWorkspace(workspaceId);
    const sourceTypes = this.resolveSourceTypes(options.sourceTypes);
    const pageSize = options.pageSize ?? BACKFILL_DEFAULT_PAGE_SIZE;
    const batchSize = options.batchSize ?? BACKFILL_DEFAULT_BATCH_SIZE;
    const limit = options.limit ?? batchSize;
    const onlyMissing = options.onlyMissing !== false;
    const retryFailed = options.retryFailed === true;
    const repairInconsistent = options.repairInconsistent === true;
    const onlySourceIds = options.onlySourceIds?.length
      ? new Set(options.onlySourceIds)
      : null;

    const result: BackfillEnqueueResult = {
      workspaceId: workspace.id,
      workspaceName: workspace.slackWorkspaceName,
      enqueued: 0,
      skippedInFlight: 0,
      skippedIndexed: 0,
      skippedFailed: 0,
      skippedInconsistent: 0,
      skippedOther: 0,
      bySourceType: {},
      eventIds: [],
    };

    for (const sourceType of sourceTypes) {
      if (result.enqueued >= limit) break;
      let cursor: string | undefined;

      for (;;) {
        if (result.enqueued >= limit) break;
        const page = await this.scanSourcePage({
          workspaceId: workspace.id,
          sourceType,
          cursor,
          pageSize,
        });
        if (page.rows.length === 0) break;

        const eligibleIds = page.rows
          .filter((r) => r.eligible)
          .map((r) => r.sourceId)
          .filter((id) => !onlySourceIds || onlySourceIds.has(id));
        const states = await this.classifyEligibleSources(
          workspace.id,
          sourceType,
          eligibleIds,
        );

        for (const sourceId of eligibleIds) {
          if (result.enqueued >= limit) break;
          const state = states.get(sourceId) ?? 'MISSING';

          // Live re-check for active events (race with worker / concurrent enqueue)
          if (await this.hasActiveEvent(workspace.id, sourceType, sourceId)) {
            result.skippedInFlight += 1;
            continue;
          }

          if (
            !this.shouldEnqueue(state, {
              onlyMissing,
              retryFailed,
              repairInconsistent,
            })
          ) {
            if (state === 'INDEXED') result.skippedIndexed += 1;
            else if (state === 'IN_FLIGHT') result.skippedInFlight += 1;
            else if (state === 'FAILED') result.skippedFailed += 1;
            else if (state === 'INCONSISTENT') result.skippedInconsistent += 1;
            else result.skippedOther += 1;
            continue;
          }

          const event = await this.outbox.enqueueUpsert({
            workspaceId: workspace.id,
            sourceType,
            sourceId,
          });
          result.enqueued += 1;
          result.eventIds.push(event.id);
          result.bySourceType[sourceType] =
            (result.bySourceType[sourceType] ?? 0) + 1;
        }

        cursor = page.nextCursor;
        if (!cursor) break;
      }
    }

    this.logger.log(
      `[MemoryBackfill] enqueue workspace=${workspace.id} enqueued=${result.enqueued} limit=${limit}`,
    );
    return result;
  }

  async verifyWorkspace(workspaceId: string): Promise<MemoryVerifyReport> {
    const dry = await this.analyzeWorkspace(workspaceId, {
      onlyMissing: true,
    });

    const chunkWhere = { workspaceId: dry.workspaceId };
    const [chunkAgg, visibilityAgg, totalChunks, linkTeam, linkOwner, linkKey, outboxAgg] =
      await Promise.all([
        this.prisma.memoryChunk.groupBy({
          by: ['sourceType'],
          where: chunkWhere,
          _count: { _all: true },
        }),
        this.prisma.memoryChunk.groupBy({
          by: ['visibility'],
          where: chunkWhere,
          _count: { _all: true },
        }),
        this.prisma.memoryChunk.count({ where: chunkWhere }),
        this.prisma.memoryChunk.count({
          where: { ...chunkWhere, teamId: { not: null } },
        }),
        this.prisma.memoryChunk.count({
          where: { ...chunkWhere, ownerUserId: { not: null } },
        }),
        this.prisma.memoryChunk.count({
          where: { ...chunkWhere, linkedIssueKey: { not: null } },
        }),
        this.prisma.memoryOutboxEvent.groupBy({
          by: ['status'],
          where: chunkWhere,
          _count: { _all: true },
        }),
      ]);

    let withEmbedding = 0;
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.memoryChunk.findMany({
        where: chunkWhere,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: { id: 'asc' },
        take: 500,
        select: { id: true, embedding: true },
      });
      if (page.length === 0) break;
      for (const row of page) {
        if (Array.isArray(row.embedding) && row.embedding.length > 0) {
          withEmbedding += 1;
        }
      }
      cursor = page[page.length - 1]?.id;
      if (page.length < 500) break;
    }
    const withoutEmbedding = totalChunks - withEmbedding;

    const bySourceType: Record<string, number> = {};
    for (const row of chunkAgg) {
      bySourceType[row.sourceType] = row._count._all;
    }
    const byVisibility: Record<string, number> = {
      WORKSPACE: 0,
      TEAM: 0,
      PRIVATE: 0,
    };
    for (const row of visibilityAgg) {
      byVisibility[row.visibility] = row._count._all;
    }

    const outbox = {
      PENDING: 0,
      PROCESSING: 0,
      COMPLETED: 0,
      FAILED: 0,
    };
    for (const row of outboxAgg) {
      if (row.status in outbox) {
        outbox[row.status as keyof typeof outbox] = row._count._all;
      }
    }

    return {
      workspaceId: dry.workspaceId,
      workspaceName: dry.workspaceName,
      sources: dry.bySourceType,
      chunks: {
        total: totalChunks,
        bySourceType,
        byVisibility,
        withEmbedding,
        withoutEmbedding,
        withLinkedIssueKey: linkKey,
        withTeamId: linkTeam,
        withOwnerUserId: linkOwner,
      },
      outbox,
    };
  }

  async sampleWorkspaceChunks(
    workspaceId: string,
    limit = 10,
  ): Promise<MemoryChunkSample[]> {
    const workspace = await this.requireWorkspace(workspaceId);
    const take = Math.min(Math.max(limit, 1), 50);
    const rows = await this.prisma.memoryChunk.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ sourceType: 'asc' }, { sourceId: 'asc' }, { chunkIndex: 'asc' }],
      take,
      select: {
        id: true,
        sourceType: true,
        sourceId: true,
        chunkIndex: true,
        text: true,
        visibility: true,
        teamId: true,
        ownerUserId: true,
        linkedIssueKey: true,
        embedding: true,
        embeddingModel: true,
        contentHash: true,
      },
    });

    return rows.map((row) => ({
      id: row.id,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      chunkIndex: row.chunkIndex,
      textPreview: row.text.slice(0, 240),
      visibility: row.visibility,
      teamId: row.teamId,
      ownerUserId: row.ownerUserId,
      linkedIssueKey: row.linkedIssueKey,
      hasEmbedding: Array.isArray(row.embedding) && row.embedding.length > 0,
      embeddingModel: row.embeddingModel,
      contentHash: row.contentHash,
    }));
  }

  /** Classify a batch of eligible source ids for one type. */
  async classifyEligibleSources(
    workspaceId: string,
    sourceType: MemorySourceType,
    sourceIds: string[],
  ): Promise<Map<string, MemorySourceIndexState>> {
    const map = new Map<string, MemorySourceIndexState>();
    if (sourceIds.length === 0) return map;

    const [chunks, events] = await Promise.all([
      this.prisma.memoryChunk.findMany({
        where: {
          workspaceId,
          sourceType,
          sourceId: { in: sourceIds },
        },
        select: { sourceId: true },
        distinct: ['sourceId'],
      }),
      this.prisma.memoryOutboxEvent.findMany({
        where: {
          workspaceId,
          sourceType,
          sourceId: { in: sourceIds },
        },
        select: {
          sourceId: true,
          status: true,
          operation: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const withChunks = new Set(chunks.map((c) => c.sourceId));
    const bySource = new Map<string, typeof events>();
    for (const ev of events) {
      const list = bySource.get(ev.sourceId) ?? [];
      list.push(ev);
      bySource.set(ev.sourceId, list);
    }

    for (const sourceId of sourceIds) {
      if (withChunks.has(sourceId)) {
        map.set(sourceId, 'INDEXED');
        continue;
      }
      const list = bySource.get(sourceId) ?? [];
      const active = list.some(
        (e) =>
          e.status === MemoryOutboxStatus.PENDING ||
          e.status === MemoryOutboxStatus.PROCESSING,
      );
      if (active) {
        map.set(sourceId, 'IN_FLIGHT');
        continue;
      }
      const completedUpsert = list.some(
        (e) =>
          e.status === MemoryOutboxStatus.COMPLETED &&
          e.operation === MemoryOutboxOperation.UPSERT,
      );
      if (completedUpsert) {
        map.set(sourceId, 'INCONSISTENT');
        continue;
      }
      const failed = list.some((e) => e.status === MemoryOutboxStatus.FAILED);
      if (failed) {
        map.set(sourceId, 'FAILED');
        continue;
      }
      map.set(sourceId, 'MISSING');
    }

    return map;
  }

  private shouldEnqueue(
    state: MemorySourceIndexState,
    opts: {
      onlyMissing: boolean;
      retryFailed: boolean;
      repairInconsistent: boolean;
    },
  ): boolean {
    if (state === 'MISSING') return true;
    if (state === 'FAILED') return opts.retryFailed;
    if (state === 'INCONSISTENT') return opts.repairInconsistent;
    // INDEXED / IN_FLIGHT / SKIPPED never enqueue from backfill by default
    void opts.onlyMissing;
    return false;
  }

  private async hasActiveEvent(
    workspaceId: string,
    sourceType: MemorySourceType,
    sourceId: string,
  ): Promise<boolean> {
    const count = await this.prisma.memoryOutboxEvent.count({
      where: {
        workspaceId,
        sourceType,
        sourceId,
        status: {
          in: [MemoryOutboxStatus.PENDING, MemoryOutboxStatus.PROCESSING],
        },
      },
    });
    return count > 0;
  }

  private resolveSourceTypes(
    requested?: MemorySourceType[],
  ): MemorySourceType[] {
    if (!requested?.length) return [...MEMORY_SOURCE_TYPES];
    for (const t of requested) {
      if (!MEMORY_SOURCE_TYPES.includes(t)) {
        throw new Error(`Unsupported source type for backfill: ${t}`);
      }
    }
    return requested;
  }

  private bumpState(
    counters: SourceTypeCounters,
    state: MemorySourceIndexState,
  ): void {
    switch (state) {
      case 'INDEXED':
        counters.indexed += 1;
        break;
      case 'IN_FLIGHT':
        counters.inFlight += 1;
        break;
      case 'MISSING':
        counters.missing += 1;
        break;
      case 'FAILED':
        counters.failed += 1;
        break;
      case 'INCONSISTENT':
        counters.inconsistent += 1;
        break;
      case 'SKIPPED':
        counters.skipped += 1;
        break;
    }
  }

  private async scanSourcePage(params: {
    workspaceId: string;
    sourceType: MemorySourceType;
    cursor?: string;
    pageSize: number;
  }): Promise<{
    rows: Array<{ sourceId: string; eligible: boolean }>;
    nextCursor?: string;
  }> {
    switch (params.sourceType) {
      case MEMORY_SOURCE.STANDUP_ANSWER:
        return this.scanAnswers(params);
      case MEMORY_SOURCE.BLOCKER:
        return this.scanBlockers(params);
      case MEMORY_SOURCE.BLOCKER_RESOLUTION:
        return this.scanResolutions(params);
      case MEMORY_SOURCE.REPORT:
        return this.scanReports(params);
      default:
        return { rows: [] };
    }
  }

  private async scanAnswers(params: {
    workspaceId: string;
    cursor?: string;
    pageSize: number;
  }) {
    const rows = await this.prisma.answer.findMany({
      where: {
        user: { workspaceId: params.workspaceId },
        ...(params.cursor ? { id: { gt: params.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: params.pageSize,
      select: {
        id: true,
        question: { select: { type: true } },
      },
    });
    return {
      rows: rows.map((r) => ({
        sourceId: r.id,
        eligible: isMemoryEligibleAnswerType(r.question.type as QuestionType),
      })),
      nextCursor:
        rows.length === params.pageSize ? rows[rows.length - 1]?.id : undefined,
    };
  }

  private async scanBlockers(params: {
    workspaceId: string;
    cursor?: string;
    pageSize: number;
  }) {
    const rows = await this.prisma.pulseBlocker.findMany({
      where: {
        workspaceId: params.workspaceId,
        ...(params.cursor ? { id: { gt: params.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: params.pageSize,
      select: { id: true },
    });
    return {
      rows: rows.map((r) => ({ sourceId: r.id, eligible: true })),
      nextCursor:
        rows.length === params.pageSize ? rows[rows.length - 1]?.id : undefined,
    };
  }

  private async scanResolutions(params: {
    workspaceId: string;
    cursor?: string;
    pageSize: number;
  }) {
    const rows = await this.prisma.pulseBlockerUpdate.findMany({
      where: {
        blocker: { workspaceId: params.workspaceId },
        ...(params.cursor ? { id: { gt: params.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: params.pageSize,
      select: { id: true, newStatus: true },
    });
    return {
      rows: rows.map((r) => ({
        sourceId: r.id,
        eligible: isMemoryEligibleBlockerResolutionUpdate({
          newStatus: r.newStatus,
        }),
      })),
      nextCursor:
        rows.length === params.pageSize ? rows[rows.length - 1]?.id : undefined,
    };
  }

  private async scanReports(params: {
    workspaceId: string;
    cursor?: string;
    pageSize: number;
  }) {
    const rows = await this.prisma.aiDigest.findMany({
      where: {
        team: { workspaceId: params.workspaceId },
        ...(params.cursor ? { id: { gt: params.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: params.pageSize,
      select: {
        id: true,
        source: true,
        summary: true,
        generationError: true,
      },
    });
    return {
      rows: rows.map((r) => ({
        sourceId: r.id,
        eligible: isMemoryEligibleDigest({
          source: r.source,
          summary: r.summary,
          generationError: r.generationError,
        }),
      })),
      nextCursor:
        rows.length === params.pageSize ? rows[rows.length - 1]?.id : undefined,
    };
  }
}

function emptyCounters(sourceType: MemorySourceType): SourceTypeCounters {
  return {
    sourceType,
    inspected: 0,
    eligible: 0,
    indexed: 0,
    inFlight: 0,
    missing: 0,
    failed: 0,
    inconsistent: 0,
    skipped: 0,
    wouldEnqueue: 0,
  };
}

function sumCounters(list: SourceTypeCounters[]): BackfillDryRunReport['totals'] {
  return list.reduce(
    (acc, c) => {
      acc.inspected += c.inspected;
      acc.eligible += c.eligible;
      acc.indexed += c.indexed;
      acc.inFlight += c.inFlight;
      acc.missing += c.missing;
      acc.failed += c.failed;
      acc.inconsistent += c.inconsistent;
      acc.skipped += c.skipped;
      acc.wouldEnqueue += c.wouldEnqueue;
      return acc;
    },
    {
      inspected: 0,
      eligible: 0,
      indexed: 0,
      inFlight: 0,
      missing: 0,
      failed: 0,
      inconsistent: 0,
      skipped: 0,
      wouldEnqueue: 0,
    },
  );
}

/** Format dry-run for CLI / logs. */
export function formatBackfillDryRun(report: BackfillDryRunReport): string {
  const lines: string[] = [
    `Workspace: ${report.workspaceName} (${report.workspaceId})`,
    '',
  ];
  for (const c of report.bySourceType) {
    lines.push(c.sourceType);
    lines.push(`  inspected:     ${c.inspected}`);
    lines.push(`  eligible:      ${c.eligible}`);
    lines.push(`  indexed:       ${c.indexed}`);
    lines.push(`  inFlight:      ${c.inFlight}`);
    lines.push(`  missing:       ${c.missing}`);
    lines.push(`  failed:        ${c.failed}`);
    lines.push(`  inconsistent:  ${c.inconsistent}`);
    lines.push(`  skipped:       ${c.skipped}`);
    lines.push(`  wouldEnqueue:  ${c.wouldEnqueue}`);
    lines.push('');
  }
  lines.push('TOTALS');
  lines.push(`  eligible:      ${report.totals.eligible}`);
  lines.push(`  missing:       ${report.totals.missing}`);
  lines.push(`  indexed:       ${report.totals.indexed}`);
  lines.push(`  inFlight:      ${report.totals.inFlight}`);
  lines.push(`  failed:        ${report.totals.failed}`);
  lines.push(`  inconsistent:  ${report.totals.inconsistent}`);
  lines.push(`  skipped:       ${report.totals.skipped}`);
  lines.push(`  wouldEnqueue:  ${report.totals.wouldEnqueue}`);
  lines.push(`  databaseWrites:${report.databaseWrites}`);
  return lines.join('\n');
}

export function formatVerifyReport(report: MemoryVerifyReport): string {
  const lines: string[] = [
    `Workspace: ${report.workspaceName} (${report.workspaceId})`,
    '',
    'Source classification:',
  ];
  for (const c of report.sources) {
    lines.push(
      `  ${c.sourceType}: eligible=${c.eligible} indexed=${c.indexed} inFlight=${c.inFlight} missing=${c.missing} failed=${c.failed} inconsistent=${c.inconsistent} skipped=${c.skipped}`,
    );
  }
  lines.push('');
  lines.push('MemoryChunks:');
  lines.push(`  total: ${report.chunks.total}`);
  lines.push(`  withEmbedding: ${report.chunks.withEmbedding}`);
  lines.push(`  withoutEmbedding (INDEXED_TEXT_ONLY): ${report.chunks.withoutEmbedding}`);
  lines.push(`  withLinkedIssueKey: ${report.chunks.withLinkedIssueKey}`);
  lines.push(`  withTeamId: ${report.chunks.withTeamId}`);
  lines.push(`  withOwnerUserId: ${report.chunks.withOwnerUserId}`);
  lines.push(`  bySourceType: ${JSON.stringify(report.chunks.bySourceType)}`);
  lines.push(`  byVisibility: ${JSON.stringify(report.chunks.byVisibility)}`);
  lines.push('');
  lines.push('Outbox:');
  lines.push(`  PENDING=${report.outbox.PENDING} PROCESSING=${report.outbox.PROCESSING} COMPLETED=${report.outbox.COMPLETED} FAILED=${report.outbox.FAILED}`);
  lines.push('');
  lines.push(
    'Note: PRIVATE visibility is currently unsupported in Phase 2B derivation (expected PRIVATE=0).',
  );
  return lines.join('\n');
}

// silence unused type export in some TS configs
export type { EligibleRef };
