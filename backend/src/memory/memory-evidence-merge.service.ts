import { Injectable } from '@nestjs/common';
import { KnowledgeDocument } from '../ai/workspace/types/workspace-ai.types';
import { MEMORY_ASK_CONTEXT_BUDGET } from './memory-ask.config';
import {
  documentAuthorityClass,
  documentSourceIdentity,
  isV2MemoryDocument,
} from './memory-evidence.adapter';
import { MemoryRetrievalPlan } from './memory-retrieval-policy';

export type MemoryEvidenceMergeResult = {
  documents: KnowledgeDocument[];
  droppedLegacyDuplicates: number;
  droppedByBudget: number;
  v2Count: number;
  liveJiraCount: number;
  legacyCount: number;
};

/**
 * Authority-aware merge of Live Jira / V2 Memory / legacy RAG hits.
 * Relevance scores never override LIVE_JIRA_CURRENT for current fields.
 */
@Injectable()
export class MemoryEvidenceMergeService {
  merge(params: {
    plan: MemoryRetrievalPlan;
    legacyHits: KnowledgeDocument[];
    v2Documents: KnowledgeDocument[];
    /** When true, out-of-scope legacy duplicates must not re-enter via merge heuristics. */
    temporalScoped?: boolean;
  }): MemoryEvidenceMergeResult {
    const taggedLegacy = params.legacyHits.map((doc) =>
      tagLegacyAuthority(doc),
    );

    // Annotate Live Jira docs explicitly
    const legacyTagged = taggedLegacy.map((doc) => {
      if (doc.entity === 'jira_issue' || doc.source === 'jira') {
        return {
          ...doc,
          metadata: {
            ...(doc.metadata ?? {}),
            authorityClass: 'LIVE_JIRA_CURRENT' as const,
          },
          content: ensureAuthorityBanner(doc.content, 'LIVE_JIRA_CURRENT'),
        };
      }
      return doc;
    });

    let droppedLegacyDuplicates = 0;
    let working: KnowledgeDocument[] = [];

    if (params.plan.v2AffectsAnswer && params.v2Documents.length > 0) {
      const v2Ids = new Set(
        params.v2Documents.map((d) => documentSourceIdentity(d)),
      );
      const v2Capped = params.v2Documents.slice(
        0,
        MEMORY_ASK_CONTEXT_BUDGET.maxV2Documents,
      );

      if (params.plan.mode === 'V2_PRIMARY') {
        // Prefer V2 for overlapping original sources; keep Live Jira + non-overlapping legacy.
        for (const doc of legacyTagged) {
          const auth = documentAuthorityClass(doc);
          if (auth === 'LIVE_JIRA_CURRENT') {
            working.push(doc);
            continue;
          }
          const id = documentSourceIdentity(doc);
          if (v2Ids.has(id) && isLegacyTeamMemoryLike(doc)) {
            droppedLegacyDuplicates += 1;
            continue;
          }
          working.push(doc);
        }
        working = [...working, ...v2Capped];
      } else {
        // HYBRID: include both; drop exact identity duplicates preferring V2
        const seen = new Set<string>();
        for (const doc of v2Capped) {
          seen.add(documentSourceIdentity(doc));
          working.push(doc);
        }
        for (const doc of legacyTagged) {
          const id = documentSourceIdentity(doc);
          const auth = documentAuthorityClass(doc);
          if (
            params.temporalScoped &&
            auth !== 'LIVE_JIRA_CURRENT' &&
            !params.v2Documents.some((v2) => documentSourceIdentity(v2) === id)
          ) {
            droppedLegacyDuplicates += 1;
            continue;
          }
          if (
            auth !== 'LIVE_JIRA_CURRENT' &&
            seen.has(id) &&
            isLegacyTeamMemoryLike(doc)
          ) {
            droppedLegacyDuplicates += 1;
            continue;
          }
          working.push(doc);
        }
      }
    } else {
      working = legacyTagged;
    }

    // Authority sort: Live Jira first, then V2, then legacy — within groups by score
    working.sort((a, b) => {
      const ao = authorityOrder(documentAuthorityClass(a));
      const bo = authorityOrder(documentAuthorityClass(b));
      if (ao !== bo) return ao - bo;
      return (b.score ?? 0) - (a.score ?? 0);
    });

    // Soft diversity per source identity
    const diversified: KnowledgeDocument[] = [];
    const perSource = new Map<string, number>();
    const deferred: KnowledgeDocument[] = [];
    for (const doc of working) {
      const key = documentSourceIdentity(doc);
      const n = perSource.get(key) ?? 0;
      if (n < MEMORY_ASK_CONTEXT_BUDGET.maxPerSourceId) {
        diversified.push(doc);
        perSource.set(key, n + 1);
      } else {
        deferred.push(doc);
      }
    }
    for (const doc of deferred) {
      if (diversified.length >= MEMORY_ASK_CONTEXT_BUDGET.maxDocuments) break;
      diversified.push(doc);
    }

    const beforeBudget = diversified.length;
    const documents = diversified.slice(
      0,
      MEMORY_ASK_CONTEXT_BUDGET.maxDocuments,
    );

    // Guarantee Live Jira docs are not dropped by budget when present
    const live = working.filter(
      (d) => documentAuthorityClass(d) === 'LIVE_JIRA_CURRENT',
    );
    for (const doc of live) {
      if (!documents.some((d) => d.id === doc.id)) {
        documents.unshift(doc);
        if (documents.length > MEMORY_ASK_CONTEXT_BUDGET.maxDocuments) {
          // drop lowest-priority non-jira from end
          for (let i = documents.length - 1; i >= 0; i -= 1) {
            if (documentAuthorityClass(documents[i]) !== 'LIVE_JIRA_CURRENT') {
              documents.splice(i, 1);
              break;
            }
          }
        }
      }
    }

    return {
      documents: documents.slice(0, MEMORY_ASK_CONTEXT_BUDGET.maxDocuments),
      droppedLegacyDuplicates,
      droppedByBudget: Math.max(0, beforeBudget - documents.length),
      v2Count: documents.filter((d) => isV2MemoryDocument(d)).length,
      liveJiraCount: documents.filter(
        (d) => documentAuthorityClass(d) === 'LIVE_JIRA_CURRENT',
      ).length,
      legacyCount: documents.filter(
        (d) => documentAuthorityClass(d) === 'LEGACY_SUPPORTING',
      ).length,
    };
  }
}

function authorityOrder(a: string): number {
  if (a === 'LIVE_JIRA_CURRENT') return 0;
  if (a === 'TEAM_MEMORY_HISTORICAL') return 1;
  return 2;
}

function tagLegacyAuthority(doc: KnowledgeDocument): KnowledgeDocument {
  if (doc.metadata?.authorityClass) return doc;
  if (doc.entity === 'jira_issue' || doc.source === 'jira') {
    return {
      ...doc,
      metadata: { ...(doc.metadata ?? {}), authorityClass: 'LIVE_JIRA_CURRENT' },
    };
  }
  return {
    ...doc,
    metadata: {
      ...(doc.metadata ?? {}),
      authorityClass: 'LEGACY_SUPPORTING',
    },
  };
}

function isLegacyTeamMemoryLike(doc: KnowledgeDocument): boolean {
  return (
    doc.entity === 'team_memory' ||
    doc.source === 'team_memory' ||
    doc.entity === 'blocker' ||
    doc.entity === 'blocker_update' ||
    doc.entity === 'report' ||
    doc.entity === 'standup_submission'
  );
}

function ensureAuthorityBanner(content: string, authority: string): string {
  if (content.includes(`Authority: ${authority}`)) return content;
  return `Authority: ${authority}\n${content}`;
}
