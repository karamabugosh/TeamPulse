import { Injectable, Logger } from '@nestjs/common';
import { MemoryAclService } from './memory-acl.service';
import { MemoryFullTextSearchService } from './memory-fulltext-search.service';
import { MemoryVectorSearchService } from './memory-vector-search.service';
import { MemoryHybridRankingService } from './memory-hybrid-ranking.service';
import {
  MEMORY_RETRIEVAL_CONFIG,
  extractIssueKeys,
} from './memory-retrieval.config';
import {
  MemoryEvidenceItem,
  MemoryRetrievalRequest,
  MemoryRetrievalResult,
} from './memory-retrieval.types';

/**
 * Pulse V2 Phase 3A — ACL-safe hybrid MemoryChunk retrieval.
 * Does NOT call OpenAI chat. Does NOT replace Ask Pulse production path.
 */
@Injectable()
export class MemoryRetrievalService {
  private readonly logger = new Logger(MemoryRetrievalService.name);

  constructor(
    private readonly aclService: MemoryAclService,
    private readonly fullText: MemoryFullTextSearchService,
    private readonly vector: MemoryVectorSearchService,
    private readonly hybrid: MemoryHybridRankingService,
  ) {}

  async retrieve(
    request: MemoryRetrievalRequest,
  ): Promise<MemoryRetrievalResult> {
    const started = Date.now();
    const workspaceId = request.workspaceId?.trim();
    const userId = request.userId?.trim();
    const query = request.query?.trim() ?? '';

    if (!workspaceId || !userId || !query) {
      return { query, workspaceId: workspaceId || '', evidence: [] };
    }

    const acl = await this.aclService.resolveContext({ workspaceId, userId });
    if (!acl.userInWorkspace) {
      return {
        query,
        workspaceId,
        evidence: [],
        diagnostics: request.debug
          ? {
              workspaceId,
              userId,
              authorizedTeamCount: 0,
              userInWorkspace: false,
              lexicalCandidateCount: 0,
              vectorCandidateCount: 0,
              mergedCandidateCount: 0,
              finalCount: 0,
              vectorBackend: 'skipped',
              incompatibleEmbeddingCount: 0,
              malformedExcludedCount: 0,
              issueKeysDetected: extractIssueKeys(query),
              durationMs: Date.now() - started,
            }
          : undefined,
      };
    }

    const finalLimit = Math.min(
      Math.max(request.limit ?? MEMORY_RETRIEVAL_CONFIG.finalLimit, 1),
      50,
    );

    const [lexicalResult, vectorResult] = await Promise.all([
      this.fullText.search({
        acl,
        query,
        limit: MEMORY_RETRIEVAL_CONFIG.lexicalCandidateLimit,
        sourceTypes: request.sourceTypes,
        linkedIssueKey: request.linkedIssueKey,
        runId: request.runId,
        ownerUserId: request.ownerUserId,
        scopedSourceIds: request.scopedSourceIds,
      }),
      this.vector.search({
        acl,
        query,
        limit: MEMORY_RETRIEVAL_CONFIG.vectorCandidateLimit,
        sourceTypes: request.sourceTypes,
        queryEmbeddingOverride: request.queryEmbeddingOverride,
        queryEmbeddingModelOverride: request.queryEmbeddingModelOverride,
        runId: request.runId,
        ownerUserId: request.ownerUserId,
        scopedSourceIds: request.scopedSourceIds,
      }),
    ]);

    const merged = this.hybrid.merge({
      lexical: lexicalResult.candidates,
      vector: vectorResult.candidates,
      query,
      linkedIssueKey: request.linkedIssueKey,
      finalLimit,
    });

    const evidence: MemoryEvidenceItem[] = merged.map((c) => ({
      chunkId: c.chunkId,
      sourceType: c.sourceType,
      sourceId: c.sourceId,
      chunkIndex: c.chunkIndex,
      text: c.text,
      linkedIssueKey: c.linkedIssueKey,
      teamId: c.teamId,
      ownerUserId: c.ownerUserId,
      visibility: c.visibility,
      retrieval: {
        lexicalRank: c.lexicalRank,
        lexicalScore: c.lexicalScore,
        vectorRank: c.vectorRank,
        vectorSimilarity: c.vectorSimilarity,
        rrfScore: c.rrfScore ?? 0,
      },
      citation: {
        sourceType: c.sourceType,
        sourceId: c.sourceId,
        chunkIndex: c.chunkIndex,
      },
      metadata: c.metadata ?? null,
    }));

    if (request.debug) {
      this.logger.log(
        `[MemoryRetrieval] workspace=${workspaceId} user=${userId} lexical=${lexicalResult.candidates.length} vector=${vectorResult.candidates.length} final=${evidence.length} backend=${vectorResult.backend}`,
      );
    }

    return {
      query,
      workspaceId,
      evidence,
      diagnostics: request.debug
        ? {
            workspaceId,
            userId,
            authorizedTeamCount: acl.authorizedTeamIds.length,
            userInWorkspace: true,
            lexicalCandidateCount: lexicalResult.candidates.length,
            vectorCandidateCount: vectorResult.candidates.length,
            mergedCandidateCount:
              lexicalResult.candidates.length + vectorResult.candidates.length,
            finalCount: evidence.length,
            vectorBackend: vectorResult.backend,
            incompatibleEmbeddingCount: vectorResult.incompatibleEmbeddingCount,
            malformedExcludedCount: lexicalResult.malformedExcludedCount,
            issueKeysDetected: extractIssueKeys(query),
            durationMs: Date.now() - started,
          }
        : undefined,
    };
  }

  /** Shadow helper — only runs when MEMORY_V2_SHADOW_ENABLED=true. */
  async shadowRetrieveIfEnabled(
    request: MemoryRetrievalRequest,
  ): Promise<MemoryRetrievalResult | null> {
    if (!MEMORY_RETRIEVAL_CONFIG.shadowEnabled) return null;
    try {
      return await this.retrieve({ ...request, debug: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[MemoryRetrieval] shadow failed: ${message.slice(0, 200)}`);
      return null;
    }
  }
}
