import {
  KnowledgeDocument,
  KnowledgeEntityType,
  WorkspaceSourceType,
} from '../ai/workspace/types/workspace-ai.types';
import { MemoryEvidenceItem, MemoryRetrievalResult } from './memory-retrieval.types';
import { EvidenceAuthorityClass } from './memory-retrieval-policy';
import { MEMORY_SOURCE } from './memory-source.constants';

/**
 * Adapts Phase 3A MemoryEvidence into RAG KnowledgeDocument shape.
 * Preserves chunk/source identity for citations — does not flatten it away.
 */
export function adaptMemoryEvidenceToDocuments(
  result: MemoryRetrievalResult,
): KnowledgeDocument[] {
  return result.evidence.map((item) => adaptOne(item, result.workspaceId));
}

function adaptOne(
  item: MemoryEvidenceItem,
  workspaceId: string,
): KnowledgeDocument {
  const source = sourceForMemoryType(item.sourceType);
  const entity = entityForMemoryType(item.sourceType);
  const label = citationLabel(item);
  const authority: EvidenceAuthorityClass = 'TEAM_MEMORY_HISTORICAL';
  const metaTs =
    readMetadataTimestamp(item) ??
    null;

  return {
    id: `v2mem:${item.chunkId}`,
    workspaceId,
    source,
    entity,
    title: label,
    content: [
      `Authority: ${authority}`,
      `Original Pulse source: ${item.sourceType} / ${item.sourceId}`,
      `Chunk: ${item.chunkIndex}`,
      item.linkedIssueKey
        ? `Linked issue key (historical metadata): ${item.linkedIssueKey}`
        : null,
      '',
      item.text,
    ]
      .filter(Boolean)
      .join('\n'),
    timestamp: metaTs,
    url: null,
    reference: {
      source,
      entity,
      entityId: item.sourceId,
      timestamp: metaTs,
      workspaceId,
      url: null,
      label,
    },
    metadata: {
      authorityClass: authority,
      v2MemoryChunkId: item.chunkId,
      memorySourceType: item.sourceType,
      memorySourceId: item.sourceId,
      memoryChunkIndex: item.chunkIndex,
      linkedIssueKey: item.linkedIssueKey,
      visibility: item.visibility,
      teamId: item.teamId,
      ownerUserId: item.ownerUserId,
      userId: item.ownerUserId,
      runId: readMetadataString(item, 'runId'),
      submissionId: readMetadataString(item, 'submissionId'),
      sourceCreatedAt: readMetadataString(item, 'sourceCreatedAt'),
      rrfScore: item.retrieval.rrfScore,
      lexicalRank: item.retrieval.lexicalRank,
      vectorRank: item.retrieval.vectorRank,
      citationKind: 'v2_team_memory',
    },
    score: item.retrieval.rrfScore,
    keywordScore: item.retrieval.lexicalScore,
    semanticScore: item.retrieval.vectorSimilarity,
  };
}

function sourceForMemoryType(sourceType: string): WorkspaceSourceType {
  switch (sourceType) {
    case MEMORY_SOURCE.STANDUP_ANSWER:
      return 'standup_runs';
    case MEMORY_SOURCE.BLOCKER:
    case MEMORY_SOURCE.BLOCKER_RESOLUTION:
      return 'blockers';
    case MEMORY_SOURCE.REPORT:
      return 'reports';
    default:
      return 'team_memory';
  }
}

function entityForMemoryType(sourceType: string): KnowledgeEntityType {
  switch (sourceType) {
    case MEMORY_SOURCE.STANDUP_ANSWER:
      return 'standup_submission';
    case MEMORY_SOURCE.BLOCKER:
      return 'blocker';
    case MEMORY_SOURCE.BLOCKER_RESOLUTION:
      return 'blocker_update';
    case MEMORY_SOURCE.REPORT:
      return 'report';
    default:
      return 'team_memory';
  }
}

function readMetadataString(
  item: MemoryEvidenceItem,
  key: string,
): string | null {
  const raw = item.metadata?.[key];
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

function readMetadataTimestamp(item: MemoryEvidenceItem): string | null {
  return (
    readMetadataString(item, 'sourceCreatedAt') ??
    readMetadataString(item, 'completedAt') ??
    readMetadataString(item, 'createdAt')
  );
}

function citationLabel(item: MemoryEvidenceItem): string {
  const short = item.sourceId.length > 10
    ? `${item.sourceId.slice(0, 8)}…`
    : item.sourceId;
  switch (item.sourceType) {
    case MEMORY_SOURCE.STANDUP_ANSWER:
      return `Standup Answer ${short}`;
    case MEMORY_SOURCE.BLOCKER:
      return `Blocker ${short}`;
    case MEMORY_SOURCE.BLOCKER_RESOLUTION:
      return `Blocker Resolution ${short}`;
    case MEMORY_SOURCE.REPORT:
      return `Report ${short}`;
    default:
      return `Team Memory ${short}`;
  }
}

export function isV2MemoryDocument(doc: KnowledgeDocument): boolean {
  return Boolean(doc.metadata?.v2MemoryChunkId);
}

export function documentAuthorityClass(
  doc: KnowledgeDocument,
): EvidenceAuthorityClass {
  const raw = doc.metadata?.authorityClass;
  if (
    raw === 'LIVE_JIRA_CURRENT' ||
    raw === 'TEAM_MEMORY_HISTORICAL' ||
    raw === 'LEGACY_SUPPORTING'
  ) {
    return raw;
  }
  if (doc.entity === 'jira_issue' || doc.source === 'jira') {
    if (doc.metadata?.liveRefreshed === true) {
      return 'LIVE_JIRA_CURRENT';
    }
    return 'LEGACY_SUPPORTING';
  }
  if (isV2MemoryDocument(doc)) return 'TEAM_MEMORY_HISTORICAL';
  return 'LEGACY_SUPPORTING';
}

/** Canonical business identity for cross-layer dedupe. */
export function documentSourceIdentity(doc: KnowledgeDocument): string {
  const memType = doc.metadata?.memorySourceType;
  const memId = doc.metadata?.memorySourceId;
  if (typeof memType === 'string' && typeof memId === 'string') {
    return `${memType}:${memId}`;
  }
  return `${doc.entity}:${doc.reference.entityId}`;
}
