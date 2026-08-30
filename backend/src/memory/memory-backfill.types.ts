import { MemorySourceType } from './memory-source.constants';

/** Classification of an eligible historical source relative to V2 memory state. */
export type MemorySourceIndexState =
  | 'INDEXED'
  | 'IN_FLIGHT'
  | 'MISSING'
  | 'FAILED'
  | 'INCONSISTENT'
  | 'SKIPPED';

export type SourceTypeCounters = {
  sourceType: MemorySourceType;
  inspected: number;
  eligible: number;
  indexed: number;
  inFlight: number;
  missing: number;
  failed: number;
  inconsistent: number;
  skipped: number;
  /** Sources that would receive a new PENDING UPSERT under current options. */
  wouldEnqueue: number;
};

export type BackfillDryRunReport = {
  workspaceId: string;
  workspaceName: string;
  bySourceType: SourceTypeCounters[];
  totals: {
    inspected: number;
    eligible: number;
    indexed: number;
    inFlight: number;
    missing: number;
    failed: number;
    inconsistent: number;
    skipped: number;
    wouldEnqueue: number;
  };
  /** Always 0 for dry-run (documented for operators). */
  databaseWrites: 0;
};

export type BackfillEnqueueResult = {
  workspaceId: string;
  workspaceName: string;
  enqueued: number;
  skippedInFlight: number;
  skippedIndexed: number;
  skippedFailed: number;
  skippedInconsistent: number;
  skippedOther: number;
  bySourceType: Record<string, number>;
  eventIds: string[];
};

export type MemoryVerifyReport = {
  workspaceId: string;
  workspaceName: string;
  sources: SourceTypeCounters[];
  chunks: {
    total: number;
    bySourceType: Record<string, number>;
    byVisibility: Record<string, number>;
    withEmbedding: number;
    withoutEmbedding: number;
    withLinkedIssueKey: number;
    withTeamId: number;
    withOwnerUserId: number;
  };
  outbox: {
    PENDING: number;
    PROCESSING: number;
    COMPLETED: number;
    FAILED: number;
  };
};

export type MemoryChunkSample = {
  id: string;
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  textPreview: string;
  visibility: string;
  teamId: string | null;
  ownerUserId: string | null;
  linkedIssueKey: string | null;
  hasEmbedding: boolean;
  embeddingModel: string | null;
  contentHash: string;
};

export type BackfillAnalyzeOptions = {
  sourceTypes?: MemorySourceType[];
  /** Page size for historical scans (cursor pagination). */
  pageSize?: number;
  /**
   * When true (default for enqueue planning in dry-run), wouldEnqueue
   * counts MISSING only. FAILED/INCONSISTENT need explicit flags.
   */
  onlyMissing?: boolean;
  retryFailed?: boolean;
  repairInconsistent?: boolean;
};

export type BackfillEnqueueOptions = BackfillAnalyzeOptions & {
  /** Max events to create this invocation. */
  limit?: number;
  batchSize?: number;
  /**
   * When set, only consider these sourceIds (still workspace-scoped + eligibility).
   * Used for targeted repair / tests; does not bypass workspace isolation.
   */
  onlySourceIds?: string[];
};

export const BACKFILL_DEFAULT_BATCH_SIZE =
  Number(process.env.BACKFILL_BATCH_SIZE ?? 50) || 50;

export const BACKFILL_DEFAULT_PAGE_SIZE = 200;
