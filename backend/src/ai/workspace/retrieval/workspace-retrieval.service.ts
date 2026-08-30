import { Injectable, Logger } from '@nestjs/common';
import { WorkspaceKnowledgeService } from '../knowledge/workspace-knowledge.service';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import {
  expandQueryTokens,
  extractUserNameCandidates,
  meaningfulTokens,
} from './keyword.util';
import { documentMatchesLatestStandupFilters } from './temporal-retrieval.util';
import { reciprocalRankFusion } from './embedding.util';
import {
  selectRelevantSources,
  shouldForceBlockerMerge,
  RetrievalSourceKey,
} from './source-selection';
import {
  KnowledgeDocument,
  KnowledgeEntityType,
  RetrievalPipelineLog,
  SourceReference,
  SourceSearchDiagnostic,
  WorkspaceAiIntent,
  WorkspaceSearchFilters,
  WorkspaceSearchResult,
  WorkspaceSourceType,
} from '../types/workspace-ai.types';

/**
 * Multi-source Hybrid Retrieval Layer.
 *
 * Flow: Intent → Select Sources → Retrieve ALL → Merge → Deduplicate → Rerank
 *
 * Jira remains field authority (status/assignee/summary/…) via ranking + prompt rules.
 * Non-Jira sources are never hard-excluded for issue questions.
 */
@Injectable()
export class WorkspaceRetrievalService {
  private readonly logger = new Logger(WorkspaceRetrievalService.name);

  constructor(
    private readonly knowledge: WorkspaceKnowledgeService,
    private readonly embeddingStore: KnowledgeEmbeddingService,
  ) {}

  async retrieve(params: {
    workspaceId: string;
    query: string;
    intent?: WorkspaceAiIntent;
    filters?: WorkspaceSearchFilters;
    limit?: number;
    /** Pre-selected collector keys from RagPipeline (optional). */
    selectedSources?: RetrievalSourceKey[];
  }): Promise<WorkspaceSearchResult> {
    const filters = this.mergeQueryIntoFilters(
      params.query,
      params.filters ?? {},
    );
    filters.searchTokens = expandQueryTokens(params.query);

    if (!filters.userQuery) {
      const candidates = extractUserNameCandidates(params.query);
      const resolved = await this.knowledge.resolveUserQuery(
        params.workspaceId,
        candidates,
      );
      if (resolved) {
        filters.userQuery = resolved;
        this.logger.log(`Resolved userQuery=${resolved}`);
      }
    } else {
      const resolved = await this.knowledge.resolveUserQuery(
        params.workspaceId,
        [filters.userQuery],
      );
      if (resolved) filters.userQuery = resolved;
    }

    const sourcesSelected =
      params.selectedSources ??
      (params.intent
        ? selectRelevantSources({
            intent: params.intent,
            question: params.query,
            filters,
          })
        : selectRelevantSources({
            intent: WorkspaceAiIntent.GENERAL_QA,
            question: params.query,
            filters,
          }));

    filters.selectedSources = sourcesSelected;
    // Preserve jiraFieldsOnly from RAG refine — factual field Qs stay Jira-only.

    this.logger.log(
      [
        'Retrieval pipeline start',
        `intent=${params.intent ?? 'none'}`,
        `workspaceId=${params.workspaceId}`,
        `issueKey=${filters.issueKey ?? 'null'}`,
        `jiraFieldsOnly=${Boolean(filters.jiraFieldsOnly)}`,
        `sourcesSelected=${sourcesSelected.join(',')}`,
        `tokens=${(filters.searchTokens ?? []).slice(0, 12).join(',')}`,
      ].join(' | '),
    );

    const snapshot = await this.knowledge.collectSnapshot(
      params.workspaceId,
      filters,
      params.limit ?? 40,
    );

    let scopedDocuments = snapshot.documents;
    if (filters.temporalScope === 'LATEST_STANDUP' && filters.latestStandupRunId) {
      const before = scopedDocuments.length;
      scopedDocuments = scopedDocuments.filter((doc) =>
        documentMatchesLatestStandupFilters(doc, filters),
      );
      this.logger.log(
        `[TemporalScope] legacy snapshot filtered ${before - scopedDocuments.length}/${before} out-of-scope docs`,
      );
    }

    const sourcesQueried = snapshot.diagnostics
      .filter((d) => d.searched)
      .map((d) => d.sourceKey);

    const retrievedDocumentsCount = scopedDocuments.length;

    const diagnostics = this.annotateIntentScoping(
      snapshot.diagnostics,
      params.intent,
    );

    // 1) Keyword rank across all retrieved docs
    const keywordRanked = this.rankDocuments(
      scopedDocuments,
      params.query,
      filters,
      params.intent,
    );

    let semanticHits = 0;
    let embeddingsIndexed = 0;
    let mode: 'keyword_only' | 'hybrid' = 'keyword_only';
    let hits = keywordRanked;
    let vectorBackend: 'pgvector' | 'json' | 'none' = 'none';
    let semanticMs = 0;
    let semanticScanned = 0;

    // Field questions: never mix semantic hits from Team Memory / Reports embeddings.
    const allowSemantic = !filters.jiraFieldsOnly;

    if (
      allowSemantic &&
      this.embeddingStore.isEnabled() &&
      scopedDocuments.length > 0
    ) {
      const indexResult = await this.embeddingStore.ensureIndexed(
        params.workspaceId,
        scopedDocuments,
      );
      embeddingsIndexed = indexResult.indexed;

      const { hits: semantic, meta } =
        await this.embeddingStore.searchSimilarWithMeta({
          workspaceId: params.workspaceId,
          query: params.query,
          limit: 24,
        });
      semanticHits = semantic.length;
      vectorBackend = meta.backend;
      semanticMs = meta.durationMs;
      semanticScanned = meta.candidatesScanned;

      if (semantic.length > 0) {
        mode = 'hybrid';
        hits = this.mergeHybrid({
          documents: scopedDocuments,
          keywordRanked,
          semantic,
          intent: params.intent,
        });
      }
    }

    // 2) Merge: ensure force-include sources (blockers, jira) are present
    const afterMerge = this.mergeResults({
      ranked: hits,
      snapshotDocs: scopedDocuments,
      intent: params.intent,
      query: params.query,
      filters,
    });
    const documentsAfterMerge = afterMerge.length;

    // 3) Deduplicate
    const afterDedupe = this.deduplicateDocuments(afterMerge);
    const documentsAfterDeduplication = afterDedupe.length;

    // 4) Rerank with multi-source boosts + Jira field authority pin
    hits = this.rerankDocuments(afterDedupe, params.intent, filters, params.query);
    const documentsAfterReranking = hits.length;

    // Soft pin: Jira docs first for issue questions — keep supporting sources
    hits = this.pinJiraAuthority(hits, params.intent, filters, params.query);
    hits = this.enforceSlackMemberAuthority(
      hits,
      params.intent,
      filters,
      params.query,
    );
    hits = this.enforceJiraMemberAuthority(
      hits,
      params.intent,
      filters,
      params.query,
    );

    // Full blockers dashboard: never top-k truncate blocker docs
    if (filters.blockersFullList) {
      hits = this.preserveFullBlockerSet(hits, scopedDocuments);
    }

    const bySource: Partial<Record<WorkspaceSourceType, KnowledgeDocument[]>> =
      {};
    const byEntityCount: Partial<Record<KnowledgeEntityType, number>> = {};
    for (const hit of hits) {
      const bucket = bySource[hit.source] ?? [];
      bucket.push(hit);
      bySource[hit.source] = bucket;
      byEntityCount[hit.entity] = (byEntityCount[hit.entity] ?? 0) + 1;
    }

    const references: SourceReference[] = hits.map((hit) => hit.reference);
    const finalSourcesUsed = [...new Set(hits.map((h) => h.source))];
    const summary = this.buildDiagnosticsSummary(diagnostics, hits.length);

    const pipeline: RetrievalPipelineLog = {
      intent: params.intent ?? null,
      workspaceId: params.workspaceId,
      issueKey: filters.issueKey ?? null,
      sourcesSelected,
      sourcesQueried,
      retrievedDocumentsCount,
      documentsAfterMerge,
      documentsAfterDeduplication,
      documentsAfterReranking,
      finalSourcesUsed,
    };

    this.logPipeline(pipeline);
    this.logger.log(
      `Retrieval ranked mode=${mode} vectorBackend=${vectorBackend} intent=${params.intent ?? 'none'} hits=${hits.length} keyword=${keywordRanked.length} semantic=${semanticHits} indexed=${embeddingsIndexed} semanticMs=${semanticMs}`,
    );
    this.logger.log(summary);

    return {
      query: params.query.trim(),
      filters,
      hits,
      bySource,
      references,
      diagnostics: {
        sources: diagnostics,
        summary,
        pipeline,
        hybrid: {
          mode,
          keywordHits: keywordRanked.length,
          semanticHits,
          embeddingsIndexed,
          fusedHits: hits.length,
          vectorBackend,
          semanticMs,
          semanticScanned,
        },
      },
    };
  }

  /** @deprecated Prefer retrieve() — kept for callers using the old name. */
  async search(params: {
    workspaceId: string;
    query: string;
    filters?: WorkspaceSearchFilters;
    limit?: number;
  }): Promise<WorkspaceSearchResult> {
    return this.retrieve(params);
  }

  mergeQueryIntoFilters(
    query: string,
    base: WorkspaceSearchFilters,
  ): WorkspaceSearchFilters {
    const trimmed = query.trim();
    const filters: WorkspaceSearchFilters = { ...base };

    const issueMatch = trimmed.match(/\b([A-Z][A-Z0-9]+-\d+)\b/i);
    if (issueMatch && !filters.issueKey) {
      filters.issueKey = issueMatch[1].toUpperCase();
    }

    if (filters.keyword === undefined) {
      filters.keyword = null;
    }

    const lower = trimmed.toLowerCase();
    const now = new Date();

    if (!filters.dateFrom && !filters.dateTo) {
      if (/\btoday\b/.test(lower)) {
        filters.dateFrom = startOfDay(now);
        filters.dateTo = endOfDay(now);
      } else if (/\byesterday\b/.test(lower)) {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        filters.dateFrom = startOfDay(y);
        filters.dateTo = endOfDay(y);
      } else if (
        /\blast\s+7\s+days\b|\bpast\s+week\b|\blast\s+week\b|\bthis\s+week\b/.test(
          lower,
        )
      ) {
        const from = new Date(now);
        from.setDate(from.getDate() - 7);
        filters.dateFrom = startOfDay(from);
        filters.dateTo = endOfDay(now);
      }
    }

    if (!filters.userQuery) {
      const candidates = extractUserNameCandidates(trimmed);
      if (candidates.length > 0) {
        filters.userQuery = candidates[0];
      }
    }

    return filters;
  }

  /**
   * Merge ranked hits with force-included supporting docs (blockers, jira, etc.).
   * Ensures multi-source presence even when keyword score is low.
   */
  private mergeResults(params: {
    ranked: KnowledgeDocument[];
    snapshotDocs: KnowledgeDocument[];
    intent?: WorkspaceAiIntent;
    query: string;
    filters: WorkspaceSearchFilters;
  }): KnowledgeDocument[] {
    const byId = new Map<string, KnowledgeDocument>();
    for (const doc of params.ranked) {
      byId.set(doc.id, doc);
    }

    const issueKey = params.filters.issueKey?.trim()?.toUpperCase() ?? null;
    const fieldsOnly = Boolean(params.filters.jiraFieldsOnly);
    const forceBlockers = shouldForceBlockerMerge({
      intent: params.intent ?? WorkspaceAiIntent.GENERAL_QA,
      question: params.query,
      issueKey,
      jiraFieldsOnly: fieldsOnly,
    });

    for (const doc of params.snapshotDocs) {
      if (byId.has(doc.id)) continue;

      const key = String(
        doc.metadata?.issueKey ?? doc.metadata?.linkedIssueKey ?? '',
      ).toUpperCase();

      // Always merge matching Jira issue docs
      if (issueKey && doc.entity === 'jira_issue' && key === issueKey) {
        byId.set(doc.id, { ...doc, score: doc.score ?? 1 });
        continue;
      }

      if (fieldsOnly) continue;

      // Merge blockers when question/intent requires them
      if (
        forceBlockers &&
        (doc.entity === 'blocker' || doc.entity === 'blocker_update')
      ) {
        if (!issueKey || key === issueKey || !key) {
          byId.set(doc.id, { ...doc, score: doc.score ?? 1 });
        }
      }

      // Soft merge supporting narrative when issue key matches content
      if (
        issueKey &&
        (doc.entity === 'team_memory' ||
          doc.entity === 'report' ||
          doc.entity === 'standup_submission' ||
          doc.entity === 'standup_thread' ||
          doc.entity === 'ai_chat')
      ) {
        const hay = `${doc.title}\n${doc.content}`.toUpperCase();
        if (hay.includes(issueKey) || key === issueKey) {
          byId.set(doc.id, { ...doc, score: doc.score ?? 1 });
        }
      }
    }

    return [...byId.values()];
  }

  /**
   * Deduplicate by issue key / chunk id / document id / database id.
   * Prefer newer documents and Live Jira over cache duplicates.
   */
  private deduplicateDocuments(docs: KnowledgeDocument[]): KnowledgeDocument[] {
    const byKey = new Map<string, KnowledgeDocument>();

    const dedupeKey = (doc: KnowledgeDocument): string => {
      const issueKey = String(
        doc.metadata?.issueKey ?? '',
      ).toUpperCase();
      if (doc.entity === 'jira_issue' && issueKey) {
        return `jira_issue:${issueKey}`;
      }
      const chunkId = doc.metadata?.chunkId;
      if (chunkId) return `chunk:${chunkId}`;
      const dbId = doc.metadata?.databaseId ?? doc.reference.entityId;
      if (dbId) return `${doc.entity}:${dbId}`;
      return doc.id;
    };

    const prefer = (a: KnowledgeDocument, b: KnowledgeDocument): KnowledgeDocument => {
      // Live Jira beats cache
      const aLive = Boolean(a.metadata?.liveRefreshed);
      const bLive = Boolean(b.metadata?.liveRefreshed);
      if (aLive !== bLive) return aLive ? a : b;

      const aScore = a.score ?? 0;
      const bScore = b.score ?? 0;
      if (aScore !== bScore) return aScore >= bScore ? a : b;

      const aTs = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const bTs = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return aTs >= bTs ? a : b;
    };

    for (const doc of docs) {
      const key = dedupeKey(doc);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, doc);
      } else {
        byKey.set(key, prefer(existing, doc));
      }
    }

    return [...byKey.values()];
  }

  /**
   * Rerank with boosts: exact issue key, Live Jira, fresh cache,
   * recent Slack / standups / reports / blockers.
   */
  private rerankDocuments(
    docs: KnowledgeDocument[],
    intent: WorkspaceAiIntent | undefined,
    filters: WorkspaceSearchFilters,
    query: string,
  ): KnowledgeDocument[] {
    const issueKey = filters.issueKey?.toUpperCase() ?? null;
    const preferred = intent ? INTENT_ENTITY_BOOST[intent] ?? [] : [];
    const tokens =
      filters.searchTokens?.length && filters.searchTokens.length > 0
        ? filters.searchTokens
        : expandQueryTokens(query);

    const scored = docs.map((doc) => {
      let score = doc.score ?? 0;
      const haystack = `${doc.title}\n${doc.content}`.toLowerCase();

      if (issueKey) {
        if (haystack.includes(issueKey.toLowerCase())) score += 50;
        const metaKey = String(
          doc.metadata?.issueKey ?? doc.metadata?.linkedIssueKey ?? '',
        );
        if (metaKey.toUpperCase() === issueKey) score += 40;
      }

      const boostIdx = preferred.indexOf(doc.entity);
      if (boostIdx >= 0) score += Math.max(2, 12 - boostIdx);

      // Exact issue key + Live / fresh Jira boosts
      if (doc.entity === 'jira_issue' && issueKey) {
        score += 200;
        if (doc.metadata?.liveRefreshed) score += 120;
        else if (
          doc.metadata?.authoritativeJiraFields &&
          doc.metadata?.hasLiveJiraConnection === false
        ) {
          score += 80;
        }
        if (doc.metadata?.jiraSource === 'Live Jira') score += 40;
      }

      // Recency boosts by source family
      if (doc.timestamp) {
        const ageDays =
          (Date.now() - new Date(doc.timestamp).getTime()) /
          (1000 * 60 * 60 * 24);
        const recentBoost =
          ageDays <= 1 ? 8 : ageDays <= 7 ? 4 : ageDays <= 30 ? 2 : 0;
        if (
          doc.source === 'slack' ||
          doc.entity === 'standup_submission' ||
          doc.entity === 'standup_thread' ||
          doc.entity === 'standup_run'
        ) {
          score += recentBoost + 2;
        }
        if (doc.entity === 'report' || doc.source === 'reports') {
          score += recentBoost + 1;
        }
        if (doc.entity === 'blocker' || doc.entity === 'blocker_update') {
          score += recentBoost + 3;
        }
      }

      // Soft demote memory/reports vs jira for field conflicts — keep them for context
      if (
        issueKey &&
        (doc.entity === 'team_memory' ||
          doc.entity === 'report' ||
          doc.source === 'reports' ||
          doc.source === 'team_memory')
      ) {
        score -= 40;
      }

      for (const token of tokens) {
        if (token.length < 2) continue;
        if (haystack.includes(token)) score += 1;
      }

      return { ...doc, score };
    });

    scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return scored.slice(0, 32);
  }

  /**
   * Pin matching Live Jira docs first.
   * For jiraFieldsOnly: DROP all non-jira_issue docs.
   * Otherwise keep supporting sources after the authoritative Jira row.
   */
  private pinJiraAuthority(
    hits: KnowledgeDocument[],
    intent: WorkspaceAiIntent | undefined,
    filters: WorkspaceSearchFilters,
    query: string,
  ): KnowledgeDocument[] {
    const issueKey = filters.issueKey?.trim().toUpperCase();
    if (!issueKey) return hits;

    const pinned: KnowledgeDocument[] = [];
    const rest: KnowledgeDocument[] = [];

    for (const hit of hits) {
      const key = String(
        hit.metadata?.issueKey ?? hit.reference.entityId,
      ).toUpperCase();
      if (hit.entity === 'jira_issue' && key === issueKey) {
        pinned.push(hit);
      } else {
        rest.push(hit);
      }
    }

    const liveConnected = pinned.some(
      (p) => p.metadata?.hasLiveJiraConnection === true,
    );
    const authoritativePinned: KnowledgeDocument[] = [];
    for (const doc of pinned) {
      if (liveConnected && doc.metadata?.liveRefreshed !== true) {
        rest.push(doc);
        continue;
      }
      authoritativePinned.push(doc);
    }

    authoritativePinned.sort((a, b) => {
      const al = a.metadata?.liveRefreshed === true ? 1 : 0;
      const bl = b.metadata?.liveRefreshed === true ? 1 : 0;
      return bl - al;
    });

    const top = authoritativePinned[0];
    const sourceUsed =
      (top?.metadata?.jiraSource as string | undefined) ??
      (top?.metadata?.liveRefreshed ? 'Live Jira' : top ? 'Cache' : 'none');
    const value =
      (top?.metadata?.assigneeName as string | undefined) ?? 'n/a';

    if (filters.jiraFieldsOnly) {
      this.logger.log(
        [
          'Jira field authority (LIVE-ONLY):',
          `Question: ${query.trim()}`,
          `Intent: ${intent ?? 'none'}`,
          `Answer Source: ${sourceUsed}`,
          `Assignee: ${value}`,
          `Status: ${(top?.metadata?.status as string | undefined) ?? 'n/a'}`,
          `Dropped non-Jira docs: ${rest.length}`,
        ].join('\n'),
      );
      return authoritativePinned.slice(0, 4);
    }

    this.logger.log(
      [
        'Jira field authority (multi-source pin):',
        `Question: ${query.trim()}`,
        `Intent: ${intent ?? 'none'}`,
        `Source used for Jira fields: ${sourceUsed}`,
        `Assignee: ${value}`,
        `Supporting docs kept: ${rest.length}`,
        liveConnected ? 'Live connection: stale cache excluded from pin' : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );

    return [...authoritativePinned, ...rest].slice(0, 28);
  }

  /**
   * For SLACK_MEMBERS: keep only authoritative user/member docs.
   * Never answer member roster from Team Memory, Reports, Standups, or AI chats.
   */
  private enforceSlackMemberAuthority(
    hits: KnowledgeDocument[],
    intent: WorkspaceAiIntent | undefined,
    filters: WorkspaceSearchFilters,
    query: string,
  ): KnowledgeDocument[] {
    const isMembersIntent =
      intent === WorkspaceAiIntent.SLACK_MEMBERS ||
      intent === WorkspaceAiIntent.LIST_MEMBERS ||
      Boolean(filters.slackMembersOnly);
    if (!isMembersIntent) return hits;

    const memberHits = hits.filter((h) => h.entity === 'user');
    const sourceUsed =
      (memberHits[0]?.metadata?.slackMemberSource as string | undefined) ??
      (memberHits.length ? 'Cache' : 'none');
    const names = memberHits
      .map((h) => h.title)
      .filter(Boolean)
      .slice(0, 40);

    this.logger.log(
      [
        'Slack members debug (retrieval):',
        `Question: ${query.trim()}`,
        `Source used: ${sourceUsed}`,
        `Members returned: ${names.length ? names.join(', ') : '(none)'}`,
      ].join('\n'),
    );

    return memberHits.length > 0 ? memberHits : [];
  }

  /**
   * For JIRA_MEMBERS: keep only authoritative jira_member docs.
   * Never answer from Slack, Team Memory, Reports, Standups, or AI chats.
   */
  private enforceJiraMemberAuthority(
    hits: KnowledgeDocument[],
    intent: WorkspaceAiIntent | undefined,
    filters: WorkspaceSearchFilters,
    query: string,
  ): KnowledgeDocument[] {
    const isJiraMembersIntent =
      intent === WorkspaceAiIntent.JIRA_MEMBERS ||
      Boolean(filters.jiraMembersOnly);
    if (!isJiraMembersIntent) return hits;

    const memberHits = hits.filter((h) => h.entity === 'jira_member');
    const sourceUsed =
      (memberHits[0]?.metadata?.jiraMemberSource as string | undefined) ??
      (memberHits.length ? 'Cache' : 'none');
    const names = memberHits
      .map((h) => h.title)
      .filter(Boolean)
      .slice(0, 40);

    this.logger.log(
      [
        'Jira members debug (retrieval):',
        `Question: ${query.trim()}`,
        `Detected Intent: ${intent ?? 'JIRA_MEMBERS'}`,
        `Source used: ${sourceUsed}`,
        `Members retrieved: ${names.length ? names.join(', ') : '(none)'}`,
      ].join('\n'),
    );

    return memberHits.length > 0 ? memberHits : [];
  }

  /**
   * For blocker count/list questions: keep every dashboard blocker doc + stats.
   * Do not apply top-k truncation that would change counts vs Blockers page.
   */
  private preserveFullBlockerSet(
    hits: KnowledgeDocument[],
    snapshotDocs: KnowledgeDocument[],
  ): KnowledgeDocument[] {
    const blockerDocs = snapshotDocs.filter((d) => d.entity === 'blocker');
    const byId = new Map<string, KnowledgeDocument>();
    for (const doc of blockerDocs) byId.set(doc.id, doc);
    for (const hit of hits) {
      if (hit.entity === 'blocker') byId.set(hit.id, hit);
      else if (!byId.has(hit.id)) {
        // Keep a few non-blocker supporting hits after blockers
        byId.set(hit.id, hit);
      }
    }
    const blockers = [...byId.values()].filter((d) => d.entity === 'blocker');
    const rest = [...byId.values()]
      .filter((d) => d.entity !== 'blocker')
      .slice(0, 6);
    // Stats doc first if present
    blockers.sort((a, b) => {
      const as = a.metadata?.authoritativeBlockerStats ? 0 : 1;
      const bs = b.metadata?.authoritativeBlockerStats ? 0 : 1;
      return as - bs;
    });
    return [...blockers, ...rest];
  }

  private mergeHybrid(params: {
    documents: KnowledgeDocument[];
    keywordRanked: KnowledgeDocument[];
    semantic: Array<{ documentId: string; similarity: number }>;
    intent?: WorkspaceAiIntent;
  }): KnowledgeDocument[] {
    const byId = new Map(params.documents.map((doc) => [doc.id, doc]));
    const keywordIds = params.keywordRanked.map((doc) => doc.id);
    const semanticIds = params.semantic.map((row) => row.documentId);
    const fused = reciprocalRankFusion([keywordIds, semanticIds], 60);

    const keywordScoreById = new Map<string, number>();
    params.keywordRanked.forEach((doc, index) => {
      const max = params.keywordRanked[0]?.score ?? 1;
      keywordScoreById.set(
        doc.id,
        max > 0 ? (doc.score ?? 0) / max : 1 / (index + 1),
      );
    });
    const semanticScoreById = new Map(
      params.semantic.map((row) => [row.documentId, row.similarity]),
    );

    const preferred = params.intent
      ? INTENT_ENTITY_BOOST[params.intent] ?? []
      : [];

    const merged: KnowledgeDocument[] = [];
    const sortedIds = [...fused.entries()].sort((a, b) => b[1] - a[1]);
    for (const [id, rrf] of sortedIds) {
      const doc = byId.get(id);
      if (!doc) continue;
      const keywordScore = keywordScoreById.get(id) ?? 0;
      const semanticScore = semanticScoreById.get(id) ?? 0;
      let score = rrf * 100 + keywordScore * 20 + semanticScore * 30;
      const boostIdx = preferred.indexOf(doc.entity);
      if (boostIdx >= 0) score += Math.max(2, 10 - boostIdx);
      merged.push({
        ...doc,
        score,
        keywordScore,
        semanticScore,
      });
    }

    for (const doc of params.keywordRanked.slice(0, 12)) {
      if (merged.some((m) => m.id === doc.id)) continue;
      merged.push({
        ...doc,
        keywordScore: keywordScoreById.get(doc.id) ?? 0,
        semanticScore: 0,
      });
    }

    merged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return merged.slice(0, 28);
  }

  private annotateIntentScoping(
    diagnostics: SourceSearchDiagnostic[],
    intent: WorkspaceAiIntent | undefined,
  ): SourceSearchDiagnostic[] {
    if (!intent) return diagnostics;
    return diagnostics.map((diag) => ({
      ...diag,
      reason:
        diag.found > 0
          ? `${diag.reason} (intent=${intent} multi-source RAG — soft boosts, not exclusion)`
          : diag.reason,
    }));
  }

  private buildDiagnosticsSummary(
    diagnostics: SourceSearchDiagnostic[],
    hitCount: number,
  ): string {
    const parts = diagnostics.map(
      (source) => `${source.label}=${source.found}/${source.totalInWorkspace}`,
    );
    return `Retrieval summary hits=${hitCount} | ${parts.join(' | ')}`;
  }

  private logPipeline(pipeline: RetrievalPipelineLog): void {
    this.logger.log(
      [
        '=== Multi-source RAG pipeline ===',
        `Intent: ${pipeline.intent ?? 'none'}`,
        `Workspace ID: ${pipeline.workspaceId}`,
        `Issue Key: ${pipeline.issueKey ?? 'none'}`,
        `Sources Selected: ${pipeline.sourcesSelected.join(', ') || '(none)'}`,
        `Sources Queried: ${pipeline.sourcesQueried.join(', ') || '(none)'}`,
        `Retrieved Documents Count: ${pipeline.retrievedDocumentsCount}`,
        `Documents After Merge: ${pipeline.documentsAfterMerge}`,
        `Documents After Deduplication: ${pipeline.documentsAfterDeduplication}`,
        `Documents After Reranking: ${pipeline.documentsAfterReranking}`,
        `Final Sources Used: ${pipeline.finalSourcesUsed.join(', ') || '(none)'}`,
      ].join('\n'),
    );
  }

  private rankDocuments(
    docs: KnowledgeDocument[],
    query: string,
    filters: WorkspaceSearchFilters,
    intent?: WorkspaceAiIntent,
  ): KnowledgeDocument[] {
    const tokens =
      filters.searchTokens?.length && filters.searchTokens.length > 0
        ? filters.searchTokens
        : expandQueryTokens(query);
    const baseTokens = meaningfulTokens(query);
    const issueKey = filters.issueKey?.toUpperCase() ?? null;
    const userQ = filters.userQuery?.toLowerCase() ?? null;
    const preferred = intent ? INTENT_ENTITY_BOOST[intent] ?? [] : [];

    const scored = docs.map((doc) => {
      let score = 0;
      const haystack = `${doc.title}\n${doc.content}`.toLowerCase();

      if (issueKey) {
        if (haystack.includes(issueKey.toLowerCase())) score += 50;
        const metaKey = String(
          doc.metadata?.issueKey ?? doc.metadata?.linkedIssueKey ?? '',
        );
        if (metaKey.toUpperCase() === issueKey) score += 40;
      }

      if (userQ) {
        if (haystack.includes(userQ)) score += 35;
        const metaUser = String(
          doc.metadata?.userName ?? doc.title ?? '',
        ).toLowerCase();
        if (metaUser.includes(userQ)) score += 25;
      }

      for (const token of tokens) {
        if (token.length < 2) continue;
        const inTitle = doc.title.toLowerCase().includes(token);
        const inBody = haystack.includes(token);
        if (!inTitle && !inBody) continue;
        const weight = baseTokens.includes(token) ? 1 : 0.55;
        if (inTitle) score += 8 * weight;
        if (inBody) score += 2 * weight;
      }

      const boostIdx = preferred.indexOf(doc.entity);
      if (boostIdx >= 0) {
        score += Math.max(2, 12 - boostIdx);
      }

      if (doc.entity === 'jira_issue' && issueKey) {
        score += 200;
        if (doc.metadata?.liveRefreshed) {
          score += 100;
        } else if (
          doc.metadata?.authoritativeJiraFields &&
          doc.metadata?.hasLiveJiraConnection === false
        ) {
          score += 60;
        }
      }

      // Soft demote — never exclude
      if (
        issueKey &&
        (doc.entity === 'team_memory' ||
          doc.entity === 'report' ||
          doc.source === 'reports' ||
          doc.source === 'team_memory')
      ) {
        score -= 40;
      }

      if (doc.entity === 'user') score += 2;
      if (doc.entity === 'standup_submission') score += 2;
      if (doc.entity === 'jira_audit') score += 3;
      if (doc.entity === 'team_memory' && !issueKey) score += 2;
      if (doc.entity === 'blocker') score += 3;
      if (doc.entity === 'ai_chat') score += 1;

      if (doc.timestamp) {
        const ageDays =
          (Date.now() - new Date(doc.timestamp).getTime()) /
          (1000 * 60 * 60 * 24);
        if (ageDays <= 1) score += 5;
        else if (ageDays <= 7) score += 2;
        else if (ageDays <= 30) score += 1;
      }

      return { ...doc, score, keywordScore: score, semanticScore: 0 };
    });

    const ranked = scored
      .filter((doc) => (doc.score ?? 0) > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const finalHits =
      ranked.length > 0
        ? ranked
        : [...docs]
            .sort((a, b) => {
              const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
              const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
              return tb - ta;
            })
            .slice(0, 16)
            .map((doc) => ({
              ...doc,
              score: 1,
              keywordScore: 1,
              semanticScore: 0,
            }));

    this.logger.log(
      `Keyword rank top=${finalHits
        .slice(0, 5)
        .map((h) => `${h.entity}:${h.score?.toFixed?.(1) ?? h.score}`)
        .join(', ')}`,
    );

    return finalHits.slice(0, 28);
  }
}

/**
 * Soft preference order for ranking — never used to drop sources.
 * ISSUE_STATUS / ISSUE_ANALYSIS include supporting sources after jira_issue.
 */
const INTENT_ENTITY_BOOST: Record<WorkspaceAiIntent, KnowledgeEntityType[]> = {
  [WorkspaceAiIntent.GET_BLOCKERS]: [
    'blocker',
    'blocker_update',
    'jira_issue',
    'standup_submission',
    'team_memory',
    'report',
  ],
  [WorkspaceAiIntent.GET_USER_ACTIVITY]: [
    'user',
    'standup_submission',
    'jira_issue',
    'team_memory',
    'blocker',
  ],
  [WorkspaceAiIntent.LIST_MEMBERS]: ['user'],
  [WorkspaceAiIntent.SLACK_MEMBERS]: ['user'],
  [WorkspaceAiIntent.JIRA_MEMBERS]: ['jira_member'],
  [WorkspaceAiIntent.SUMMARIZE_STANDUP]: [
    'standup_submission',
    'standup_run',
    'standup_thread',
    'report',
    'blocker',
    'jira_issue',
  ],
  [WorkspaceAiIntent.ISSUE_STATUS]: [
    'jira_issue',
    'jira_audit',
    'standup_submission',
    'standup_thread',
    'blocker',
    'report',
    'team_memory',
    'ai_chat',
  ],
  [WorkspaceAiIntent.ISSUE_ANALYSIS]: [
    'jira_issue',
    'jira_audit',
    'blocker',
    'standup_submission',
    'team_memory',
    'report',
    'ai_chat',
  ],
  [WorkspaceAiIntent.SPRINT_REPORT]: [
    'report',
    'jira_issue',
    'blocker',
    'standup_run',
    'team_memory',
  ],
  [WorkspaceAiIntent.EXECUTIVE_REPORT]: [
    'report',
    'jira_issue',
    'blocker',
    'standup_submission',
    'user',
  ],
  [WorkspaceAiIntent.GENERATE_REPORT]: [
    'report',
    'standup_submission',
    'jira_issue',
    'blocker',
    'user',
  ],
  [WorkspaceAiIntent.VACATION_CATCHUP]: [
    'standup_submission',
    'report',
    'jira_issue',
    'blocker',
    'team_memory',
    'jira_audit',
  ],
  [WorkspaceAiIntent.PROJECT_DETECTIVE]: [
    'jira_audit',
    'jira_issue',
    'blocker',
    'standup_submission',
    'team_memory',
    'report',
  ],
  [WorkspaceAiIntent.ROOT_CAUSE_ANALYSIS]: [
    'jira_audit',
    'blocker',
    'jira_issue',
    'standup_submission',
    'team_memory',
  ],
  [WorkspaceAiIntent.DECISION_REPLAY]: [
    'team_memory',
    'report',
    'jira_audit',
    'blocker',
    'standup_submission',
    'jira_issue',
  ],
  [WorkspaceAiIntent.SPRINT_REPLAY]: [
    'report',
    'jira_audit',
    'jira_issue',
    'standup_submission',
    'blocker',
    'team_memory',
  ],
  [WorkspaceAiIntent.TEAM_MEMORY_SEARCH]: [
    'team_memory',
    'ai_chat',
    'standup_thread',
    'jira_issue',
    'blocker',
    'report',
  ],
  [WorkspaceAiIntent.GENERAL_QA]: [
    'jira_issue',
    'standup_submission',
    'blocker',
    'team_memory',
    'report',
    'jira_audit',
    'ai_chat',
    'user',
  ],
};

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}
