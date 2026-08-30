import { MemoryVisibility, Prisma } from '@prisma/client';
import { MemorySourceType } from './memory-source.constants';

export type NormalizedMemorySection = {
  /** Stable section key for deterministic ordering (reports). */
  key: string;
  title?: string;
  text: string;
};

/**
 * Intermediate representation between Prisma source models and the chunker.
 * Chunker must not depend on Prisma entity shapes.
 */
export type NormalizedMemorySource = {
  workspaceId: string;
  sourceType: MemorySourceType;
  sourceId: string;
  title: string;
  /** Primary body when no sections (standup/blocker/resolution). */
  text: string;
  ownerUserId: string | null;
  teamId: string | null;
  linkedIssueKey: string | null;
  visibility: MemoryVisibility;
  metadata: Prisma.InputJsonValue;
  /** When present, chunker prefers section-aware splitting (reports). */
  sections?: NormalizedMemorySection[];
};

export type PreparedMemoryChunk = {
  chunkIndex: number;
  text: string;
  contentHash: string;
  title: string;
};

export class MemorySourceMissingError extends Error {
  constructor(
    public readonly sourceType: string,
    public readonly sourceId: string,
  ) {
    super(`Memory source missing: ${sourceType}:${sourceId}`);
    this.name = 'MemorySourceMissingError';
  }
}

export class MemoryWorkspaceMismatchError extends Error {
  constructor(
    public readonly eventWorkspaceId: string,
    public readonly sourceWorkspaceId: string,
    public readonly sourceType: string,
    public readonly sourceId: string,
  ) {
    super(
      `Memory workspace mismatch: event=${eventWorkspaceId} source=${sourceWorkspaceId} ${sourceType}:${sourceId}`,
    );
    this.name = 'MemoryWorkspaceMismatchError';
  }
}

export class MemoryUnsupportedSourceError extends Error {
  constructor(public readonly sourceType: string) {
    super(`Unsupported memory sourceType: ${sourceType}`);
    this.name = 'MemoryUnsupportedSourceError';
  }
}

export class MemoryEmbeddingTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryEmbeddingTransientError';
  }
}
