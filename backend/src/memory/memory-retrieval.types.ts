import { MemoryVisibility } from '@prisma/client';
import { MemorySourceType } from './memory-source.constants';

/**
 * Trusted fields must be resolved server-side (workspaceId + userId from auth context).
 * teamIds from clients are IGNORED — membership is loaded from TeamMember.
 */
export type MemoryRetrievalRequest = {
  workspaceId: string;
  userId: string;
  query: string;
  linkedIssueKey?: string;
  sourceTypes?: MemorySourceType[];
  limit?: number;
  debug?: boolean;
  /**
   * Optional query embedding for tests (skips OpenAI).
   * Production callers leave undefined.
   */
  queryEmbeddingOverride?: number[];
  queryEmbeddingModelOverride?: string;
  /** Temporal scope — restrict to a specific standup run (metadata + source IDs). */
  runId?: string;
  ownerUserId?: string;
  scopedSourceIds?: string[];
};

export type MemoryAclContext = {
  workspaceId: string;
  userId: string;
  /** Teams the user may access inside this workspace (from TeamMember). */
  authorizedTeamIds: string[];
  /** False if user does not belong to the workspace. */
  userInWorkspace: boolean;
};

export type MemorySearchCandidate = {
  chunkId: string;
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  text: string;
  visibility: MemoryVisibility;
  teamId: string | null;
  ownerUserId: string | null;
  linkedIssueKey: string | null;
  lexicalRank?: number;
  lexicalScore?: number;
  vectorRank?: number;
  vectorSimilarity?: number;
  rrfScore?: number;
  metadata?: Record<string, unknown> | null;
};

export type MemoryEvidenceItem = {
  chunkId: string;
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  text: string;
  linkedIssueKey: string | null;
  teamId: string | null;
  ownerUserId: string | null;
  visibility: MemoryVisibility;
  retrieval: {
    lexicalRank?: number;
    lexicalScore?: number;
    vectorRank?: number;
    vectorSimilarity?: number;
    rrfScore: number;
  };
  citation: {
    sourceType: string;
    sourceId: string;
    chunkIndex: number;
  };
  metadata?: Record<string, unknown> | null;
};

export type MemoryRetrievalDiagnostics = {
  workspaceId: string;
  userId: string;
  authorizedTeamCount: number;
  userInWorkspace: boolean;
  lexicalCandidateCount: number;
  vectorCandidateCount: number;
  mergedCandidateCount: number;
  finalCount: number;
  vectorBackend: 'pgvector' | 'json_acl_bounded' | 'unavailable' | 'skipped';
  incompatibleEmbeddingCount: number;
  malformedExcludedCount: number;
  issueKeysDetected: string[];
  durationMs: number;
};

export type MemoryRetrievalResult = {
  query: string;
  workspaceId: string;
  evidence: MemoryEvidenceItem[];
  diagnostics?: MemoryRetrievalDiagnostics;
};
