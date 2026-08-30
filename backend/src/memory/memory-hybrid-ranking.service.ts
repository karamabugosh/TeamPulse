import { Injectable } from '@nestjs/common';
import { reciprocalRankFusion } from '../ai/workspace/retrieval/embedding.util';
import {
  MEMORY_RETRIEVAL_CONFIG,
  extractIssueKeys,
} from './memory-retrieval.config';
import { MemorySearchCandidate } from './memory-retrieval.types';
import { MEMORY_SOURCE } from './memory-source.constants';

const BLOCKER_QUERY_SIGNAL =
  /\b(blocker|blockers|blocked|blocking|impediment|dependency)\b/i;
const RESOLUTION_QUERY_SIGNAL =
  /\b(resolved|resolution|how\s+was\s+.+resolved|fixed)\b/i;

/**
 * Merge lexical + vector candidates via RRF, then optional issue boost + source diversity.
 */
@Injectable()
export class MemoryHybridRankingService {
  merge(params: {
    lexical: MemorySearchCandidate[];
    vector: MemorySearchCandidate[];
    query: string;
    linkedIssueKey?: string;
    finalLimit: number;
  }): MemorySearchCandidate[] {
    const byId = new Map<string, MemorySearchCandidate>();

    for (const c of params.lexical) {
      byId.set(c.chunkId, { ...c });
    }
    for (const c of params.vector) {
      const existing = byId.get(c.chunkId);
      if (existing) {
        existing.vectorRank = c.vectorRank;
        existing.vectorSimilarity = c.vectorSimilarity;
      } else {
        byId.set(c.chunkId, { ...c });
      }
    }

    const lexicalIds = params.lexical.map((c) => c.chunkId);
    const vectorIds = params.vector.map((c) => c.chunkId);
    const fused = reciprocalRankFusion(
      [lexicalIds, vectorIds],
      MEMORY_RETRIEVAL_CONFIG.rrfK,
    );

    const issueKeys = new Set([
      ...extractIssueKeys(params.query),
      ...(params.linkedIssueKey
        ? [params.linkedIssueKey.trim().toUpperCase()]
        : []),
    ]);

    const wantsBlocker = BLOCKER_QUERY_SIGNAL.test(params.query);
    const wantsResolution = RESOLUTION_QUERY_SIGNAL.test(params.query);

    const merged: MemorySearchCandidate[] = [];
    for (const [id, rrf] of fused.entries()) {
      const c = byId.get(id);
      if (!c) continue;
      let score = rrf;
      if (
        c.linkedIssueKey &&
        issueKeys.has(c.linkedIssueKey.toUpperCase())
      ) {
        score += MEMORY_RETRIEVAL_CONFIG.linkedIssueBoost;
      }
      if (wantsResolution && c.sourceType === MEMORY_SOURCE.BLOCKER_RESOLUTION) {
        score += MEMORY_RETRIEVAL_CONFIG.resolutionSourceBoost;
      } else if (
        wantsBlocker &&
        (c.sourceType === MEMORY_SOURCE.BLOCKER ||
          c.sourceType === MEMORY_SOURCE.BLOCKER_RESOLUTION)
      ) {
        score += MEMORY_RETRIEVAL_CONFIG.blockerSourceBoost;
      }
      merged.push({ ...c, rrfScore: score });
    }

    // Include candidates that somehow missed fusion map (shouldn't happen)
    for (const c of byId.values()) {
      if (merged.some((m) => m.chunkId === c.chunkId)) continue;
      merged.push({ ...c, rrfScore: 0 });
    }

    merged.sort((a, b) => (b.rrfScore ?? 0) - (a.rrfScore ?? 0));

    return this.applySourceDiversity(
      merged,
      params.finalLimit,
      MEMORY_RETRIEVAL_CONFIG.maxPerSourceId,
    );
  }

  /**
   * Soft cap: after primary ranking, keep at most N chunks per sourceId
   * while filling the final limit (deterministic).
   */
  applySourceDiversity(
    ranked: MemorySearchCandidate[],
    finalLimit: number,
    maxPerSource: number,
  ): MemorySearchCandidate[] {
    const selected: MemorySearchCandidate[] = [];
    const perSource = new Map<string, number>();
    const deferred: MemorySearchCandidate[] = [];

    for (const c of ranked) {
      const key = `${c.sourceType}:${c.sourceId}`;
      const count = perSource.get(key) ?? 0;
      if (count < maxPerSource) {
        selected.push(c);
        perSource.set(key, count + 1);
      } else {
        deferred.push(c);
      }
      if (selected.length >= finalLimit) break;
    }

    for (const c of deferred) {
      if (selected.length >= finalLimit) break;
      selected.push(c);
    }

    return selected.slice(0, finalLimit);
  }
}
