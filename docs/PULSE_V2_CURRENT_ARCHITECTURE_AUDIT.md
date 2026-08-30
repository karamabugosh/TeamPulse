# Pulse V2 — Current Architecture Audit

**Product:** Pulse AI Workspace  
**Audit date:** 2026-08-21  
**Scope:** CURRENT implementation only (evidence from repository code + Prisma schema)  
**Constraint honored:** This file is the only repository change; no application code, schema, or migrations were modified.

**Legend**

| Marker | Meaning |
|--------|---------|
| CURRENT IMPLEMENTATION | Behavior proven by code |
| NOT IMPLEMENTED | No matching model / service / call path found |
| NOT CONFIRMED FROM CURRENT CODE | Cannot prove from inspected sources |

If this document conflicts with older docs, **runtime code wins**.

---

## 1. Executive Summary

### Plain-English architecture (CURRENT)

Pulse AI Workspace is a NestJS backend that:

1. Resolves a **workspaceId** from `X-Workspace-Id` / request body.
2. Detects **intent** with regex/heuristic rules (`IntentDetectionService`) — not an OpenAI classifier.
3. Selects **which Prisma collectors to run** (`selectRelevantSources`).
4. Materializes ephemeral **`KnowledgeDocument[]`** from live tables (standups, blockers, digests, Jira cache/live, Team Memory rows, AI history, etc.) via `WorkspaceKnowledgeService.collectSnapshot`.
5. Ranks with **TypeScript keyword scoring**, optionally **hybrid-merges** with OpenAI embeddings (`KnowledgeEmbedding` + optional pgvector), then **heuristic rerank**.
6. Builds a structured prompt (`ContextBuilderService` + `WorkspacePromptBuilder`).
7. Calls **OpenAI chat completions** only through Nest (`OpenAiChatProvider`). OpenAI never talks to Postgres, Jira, or Slack.

### Direct answers

| Question | CURRENT answer | Evidence |
|----------|----------------|----------|
| What is Team Memory currently? | A Prisma table `TeamMemoryDocument` plus hub search API; RAG also has a `team_memory` collector. **Production writes are almost only Jira answer-links (+ Demo seed).** Standups/blockers/reports are **not** routinely upserted into Team Memory — they are retrieved from **source tables**. | `team-memory.service.ts`, `demo-workspace-builder.ts`, `collectTeamMemory` |
| What gets stored in `TeamMemoryDocument`? | `workspaceId`, optional `userId`, `sourceType`, `sourceId`, `title`, `content`, optional `issueKey` / `runId` / `submissionId`, `metadata`, timestamps | `schema.prisma` `TeamMemoryDocument` |
| What gets stored in `KnowledgeEmbedding`? | Per-workspace vectors for collected knowledge docs: `sourceType`, `sourceId`, `entityType`, `title`, `contentHash`, JSON `embedding`, `model`, `dimensions` (+ optional native `embedding_vec` via raw SQL) | `schema.prisma`, `knowledge-embedding.service.ts`, `pgvector-support.service.ts` |
| Are `TeamMemoryDocument` and `KnowledgeEmbedding` directly related? | **No FK.** Embeddings key off ephemeral `KnowledgeDocument.id` (`entity:entityId`) and `doc.source`, not `TeamMemoryDocument.id` exclusively. Team Memory rows become embeddings only when collected as `entity: 'team_memory'`. | `buildDocument`, `ensureIndexed` |
| What sources currently feed Team Memory? | **Proven writers:** (1) `AnswerJiraLinkService` → `TeamMemoryService.indexJiraLink` (`sourceType: 'jira_link'`), (2) Demo builder `createMany`. Hub `search()` can **read** Answers/Digests as fallback results without writing memory rows. | Grep of `upsertDocument` / `teamMemoryDocument.create*` |
| Is Slack part of Team Memory or retrieved separately? | **Separately.** Standup submissions / thread updates are collectors `slack_standups` / `slack_threads` over `StandupSubmission` / `StandupThreadUpdate`. Raw Slack channel history is **NOT** a persisted RAG corpus. | `collectStandups`, `collectStandupThreads` |
| Are AI conversations part of retrieval? | **Yes** for multi-source narrative: `ai_conversations` + `slack_ai_chat` collectors. Excluded for `jiraFieldsOnly`. | `source-selection.ts`, `collectAiConversations`, `collectSlackAiChats` |
| Are Jira cache records embedded? | **Indirectly.** Cache/live issues become `KnowledgeDocument` (`entity: jira_issue`) then may be indexed into `KnowledgeEmbedding` during retrieve/reindex. There is no dedicated “embed JiraIssueCacheEntry row” path distinct from collector docs. | `collectJiraIssues`, `EMBEDDABLE_ENTITIES` |
| Are blockers embedded? | **Yes when collected** (`entity: 'blocker'`, `'blocker_update'` in `EMBEDDABLE_ENTITIES`). Source of truth remains `PulseBlocker` / `PulseBlockerUpdate`, not Team Memory. | `knowledge-embedding.service.ts` |
| Are reports / `AiDigest` embedded? | **Yes when collected** as `entity: 'report'`. Content indexed from collector uses `summary` + JSON `themes` + JSON `blockers` — **not** `slackReportText` / `reportSections` in `collectReports`. | `collectReports` |
| Are standup answers embedded? | **As submission documents**, not per-answer Team Memory rows: one `standup_submission` KnowledgeDocument containing all Q/A lines; embeddable. Individual `Answer` rows are **not** written to `TeamMemoryDocument` in production write paths found. | `collectStandups`, Team Memory write grep |

### High-level CURRENT architecture diagram

```
┌──────────────┐     X-Workspace-Id + body.workspaceId
│ React / Vite │ ──────────────────────────────────────┐
└──────────────┘                                       ▼
                                              Nest middleware ALS
                                              resolveActiveWorkspaceId
                                                       │
                       POST /api/ai/workspace/chat     ▼
                                              AiChatService.chat
                                                       │
                         ┌─────────────────────────────┼─────────────────────────────┐
                         ▼                             ▼                             ▼
               IntentDetectionService          RagPipelineService.prepare      (reports/detective
               (heuristics, no LLM)                    │                        dedicated paths)
                                                       ▼
                                         selectRelevantSources
                                                       ▼
                                         WorkspaceRetrievalService.retrieve
                                                       ▼
                                         WorkspaceKnowledgeService.collectSnapshot
                              (Prisma collectors: jira/slack/blockers/reports/memory/…)
                                                       │
                              ┌────────────────────────┼────────────────────────┐
                              ▼                        ▼                        ▼
                        keyword rank              ensureIndexed            semantic search
                        (TS scoring)              KnowledgeEmbedding       (pgvector OR JSON cosine)
                              └────────── RRF merge ───┴────────────────────────┘
                                                       ▼
                                              merge → dedupe → heuristic rerank
                                                       ▼
                                         ContextBuilder → WorkspacePromptBuilder
                                                       ▼
                                              OpenAiChatProvider (chat.completions)
                                                       ▼
                                                    Response
```

---

## 2. Team Memory Ingestion

### Writers found (exhaustive from symbol search)

| Writer | Creates/updates `TeamMemoryDocument`? | Emits `WORKSPACE_KNOWLEDGE_CHANGED`? |
|--------|----------------------------------------|--------------------------------------|
| `TeamMemoryService.upsertDocument` | Yes (`upsert` on `sourceType_sourceId`) | Yes |
| `TeamMemoryService.indexJiraLink` | Yes via upsert | Yes (via upsert) |
| `AnswerJiraLinkService.linkIssueToQuestion` / replace flow | Calls `indexJiraLink` | Yes |
| `demo-workspace-builder` | `createMany` / `deleteMany` | Via generator emit after build |
| Standup answer save (`CollectionService`) | **No TeamMemoryDocument** | Emits knowledge-changed only |
| `AiService` digest save | **No TeamMemoryDocument** | Emits knowledge-changed only |
| `JiraBlockerService.create…` | **No TeamMemoryDocument** | Emits knowledge-changed only |
| `JiraCacheService` upsert | **No TeamMemoryDocument** | Emits knowledge-changed only |
| `BlockerFollowUpService.applyFollowUp` | **No TeamMemoryDocument** | **No emit found** |

### Per-source flows

#### Answer (standup text)

```
Answer saved (CollectionService / conversation completion)
  → Prisma Answer (+ StandupSubmission)
  → events.emit(WORKSPACE_KNOWLEDGE_CHANGED)   // collection.service.ts ~1574
  → EmbeddingReindexService.scheduleReindex (debounce 8s)
  → knowledge.collectSnapshot → collectStandups reads Answer via submission
  → KnowledgeEmbedding.ensureIndexed(entity=standup_submission)

TeamMemoryDocument created?  NO (NOT IMPLEMENTED for standup_answer in production writers)
KnowledgeEmbedding created?  YES (of submission KnowledgeDocument), async debounced / cron / on-retrieve
```

#### StandupSubmission / StandupThreadUpdate

Same pattern: **source-table retrieval**, not Team Memory upsert. Thread updates → `collectStandupThreads` → embeddable `standup_thread`.

#### PulseBlocker

```
JiraBlockerService create
  → prisma.pulseBlocker.create
  → prisma.pulseBlockerUpdate.create (open)
  → emit WORKSPACE_KNOWLEDGE_CHANGED
  → reindex → collectBlockers → KnowledgeEmbedding (entity=blocker)

TeamMemoryDocument?  NO
```

#### PulseBlockerUpdate / resolution

```
BlockerFollowUpService.applyFollowUp
  → pulseBlocker.update (resolutionNotes, resolutionType, status, resolvedAt)
  → pulseBlockerUpdate.create

TeamMemoryDocument?  NO
WORKSPACE_KNOWLEDGE_CHANGED?  NOT CONFIRMED / not present in applyFollowUp
Embedding refresh?  eventual via cron / next retrieve ensureIndexed
```

#### AiDigest / reports

```
AiService save digest
  → prisma.aiDigest.upsert/create
  → emit WORKSPACE_KNOWLEDGE_CHANGED
  → reindex → collectReports → KnowledgeEmbedding (entity=report)

TeamMemoryDocument?  NO in production (Demo seeds sourceType report/ai_summary)
```

#### JiraIssueCacheEntry

```
JiraCacheService / live refresh upsert
  → emit WORKSPACE_KNOWLEDGE_CHANGED
  → collectJiraIssues builds jira_issue KnowledgeDocuments
  → may embed

TeamMemoryDocument?  NO
```

#### AnswerJiraIssueLink

```
AnswerJiraLinkService.linkIssueToQuestion
  → prisma.answerJiraIssueLink.upsert
  → TeamMemoryService.indexJiraLink(link.id)
  → teamMemoryDocument.upsert(sourceType='jira_link', sourceId=link.id)
  → emit WORKSPACE_KNOWLEDGE_CHANGED
  → EmbeddingReindexService → collectTeamMemory may include row → embed entity=team_memory
```

**This is the primary production Team Memory write path.**

#### Slack messages (arbitrary)

**NOT IMPLEMENTED** as Team Memory or as a SlackMessage table for RAG. Only standup-related persisted content + Slack AI chat logs + member/channel caches.

#### AI conversations

Stored in `AiConversation` / `AiConversationMessage` / `SlackAiChatLog`. Retrieved as collectors. **Not** written into `TeamMemoryDocument`. **Not** in `EMBEDDABLE_ENTITIES` (`ai_chat` excluded) — keyword-only for those entities unless another entity wraps them.

---

## 3. Memory Chunking

| Question | CURRENT answer |
|----------|----------------|
| Is there a `MemoryChunk` model? | **NOT IMPLEMENTED** (absent from `schema.prisma`) |
| Is `TeamMemoryDocument` used as a chunk? | Effectively **one document per `(sourceType, sourceId)`** — document ≈ single chunk |
| Can one source record generate multiple memory documents? | Unique constraint **prevents** multiple docs per `(sourceType, sourceId)`. Demo/jira_link use one row per source id |
| Can one source record generate multiple embeddings? | Unique `KnowledgeEmbedding @@unique([workspaceId, sourceType, sourceId])` → **one embedding row per knowledge doc id** |
| Split by sentence/paragraph/token/section? | **NOT IMPLEMENTED** — full title+content (truncated to 8000 chars for embed API) |
| `chunkIndex` / `chunkId` / `parentDocumentId`? | No schema fields. Dedupe code *checks* `metadata.chunkId` if present, but collectors do not set real chunk families | `deduplicateDocuments` |
| What prevents multiple chunks? | The two unique constraints below |

### Constraint implications

```prisma
TeamMemoryDocument @@unique([sourceType, sourceId])
KnowledgeEmbedding @@unique([workspaceId, sourceType, sourceId])
```

- Updating the same standup answer / same digest / same jira_link **overwrites** the single memory/embedding identity.
- You **cannot** store “section 1..N” of a weekly report as separate indexed chunks under the same source id without changing identity scheme.

### Concrete examples

| Source | CURRENT behavior |
|--------|------------------|
| Short standup answer | One `standup_submission` KnowledgeDocument with all answers concatenated; one embedding id `standup_submission:{submissionId}` (when indexed). No `TeamMemoryDocument` for the Answer id. |
| Long weekly report (`AiDigest`) | One `report` KnowledgeDocument from summary/themes/blockers JSON strings; single embedding. `reportSections` / `slackReportText` **not** included in collector content. |
| Blocker + resolution notes | Resolution lives on `PulseBlocker.resolutionNotes` + `PulseBlockerUpdate` rows. Collector builds separate docs for blocker vs updates. Still **one embedding per entity id**, not multi-chunk notes. |

**Verdict:** Pulse does **not** have V2-style real chunking. Uniques encode **1 source → 1 memory row / 1 embedding row**.

---

## 4. Outbox / Background Processing

### Search results

| Term | Found? | What it actually is |
|------|--------|---------------------|
| outbox / Memory Outbox | **NOT IMPLEMENTED** | — |
| Bull / BullMQ | **NOT IMPLEMENTED** | — |
| worker / queue (job) | No dedicated embedding worker process | — |
| cron | **Yes** | `@Cron(EVERY_10_MINUTES)` in `EmbeddingReindexService.cronReindexAll` |
| event-driven indexing | **Partial** | Nest `EventEmitter2` + `@OnEvent(WORKSPACE_KNOWLEDGE_CHANGED)` |
| InboundEvent | **Yes** | Slack **idempotency** for inbound Slack events (`slack.listener.ts` `claimInboundEvent`) — **not** a Team Memory outbox |
| retry logic | Soft | Failed reindex logs + returns zeros; cron retries later. No outbox retry table |

### Embeddings timing

1. **On retrieve (synchronous with chat path):** `WorkspaceRetrievalService.retrieve` → `ensureIndexed(snapshot.documents)` before semantic search (unless `jiraFieldsOnly`).
2. **Debounced background:** knowledge-changed → 8s debounce → `reindexWorkspace` → `collectSnapshot(limit=80)` → `ensureIndexed`.
3. **Cron every 10 minutes:** all workspaces.

### Failure semantics

| Failure | Standup/Blocker/Report still saved? | Indexing |
|---------|--------------------------------------|----------|
| OpenAI embedding fail during ensureIndexed | Yes (source write already committed) | That batch may skip vectors (`vector.length === 0` continue); error can abort reindexWorkspace catch |
| OpenAI chat fail | N/A to standup | Chat throws / unavailable |
| Knowledge-changed emit missing (e.g. blocker follow-up) | Yes | May lag until cron/next retrieve |

### CURRENT vs V2

```
CURRENT:
Record saved (Answer / Blocker / Digest / Jira link / …)
  → (optional) TeamMemoryDocument ONLY for jira_link (+ demo)
  → emit workspace.knowledge.changed (often)
  → debounce/cron OR inline ensureIndexed on next chat
  → KnowledgeEmbedding upsert (1:1 doc)

V2 TARGET:
Record saved → Memory Outbox → Worker → Chunk → Embedding → Indexed

Gap:
No outbox table, no durable indexing jobs, no multi-chunk pipeline,
Team Memory not the universal corpus, embeddings tied to ephemeral KnowledgeDocuments.
```

---

## 5. Embedding Architecture

| Item | CURRENT |
|------|---------|
| Service | `KnowledgeEmbeddingService` (`knowledge-embedding.service.ts`) |
| Provider | `OpenAiEmbeddingProvider` |
| Model | `process.env.OPENAI_EMBEDDING_MODEL` or **`text-embedding-3-small`** (`DEFAULT_EMBEDDING_MODEL`) |
| Dimensions | Default **1536** (`DEFAULT_EMBEDDING_DIMENSIONS`); stored as returned length |
| Input text | `` `${title}\n${content}` `` sliced to 8000; whitespace normalized in provider |
| contentHash | SHA-256 of `title\ncontent` (`hashContent`); skip if unchanged |
| Duplicate prevention | Upsert on `(workspaceId, sourceType, sourceId)` + hash skip |
| Batching | Batches of **32** texts per OpenAI call |
| Failure | Empty vectors skipped; reindex catches and logs |

### `embedding` Json vs `embedding_vec`

| Aspect | Evidence |
|--------|----------|
| Prisma field | `KnowledgeEmbedding.embedding Json` — portable store |
| Native column | **Not in Prisma schema**; created at runtime by `PgVectorSupportService.ensureSchema` via raw SQL `ADD COLUMN IF NOT EXISTS embedding_vec vector(dims)` |
| Migration | `20260819170000_ai_message_confidence_pgvector` is a **no-op** (`SELECT 1`) — explicitly does not require pgvector |
| Earlier note | `20260819120000_ai_embeddings_conversations` comment: pgvector NOT available on that install |
| Extension | Detected at startup; if available → backend=`pgvector` |
| Index | Prefer **HNSW** `vector_cosine_ops`; fallback **IVFFlat** |
| Distance | `<=>` cosine distance operator |
| When JSON used | Always written; used for search when pgvector unavailable or ANN returns 0 hits |
| When pgvector used | `searchAnn` when `isPgVectorAvailable()` |

Relevant SQL (runtime, not migration-guaranteed):

```sql
ALTER TABLE "KnowledgeEmbedding"
  ADD COLUMN IF NOT EXISTS embedding_vec vector(1536);

CREATE INDEX IF NOT EXISTS "KnowledgeEmbedding_embedding_vec_hnsw_idx"
  ON "KnowledgeEmbedding"
  USING hnsw (embedding_vec vector_cosine_ops);
```

---

## 6. Full-Text Search

**PostgreSQL Full-Text Search is NOT IMPLEMENTED.**

| Mechanism | Present? |
|-----------|----------|
| `to_tsvector` / `plainto_tsquery` / `websearch_to_tsquery` / `ts_rank` | **No** (repo search) |
| GIN FTS index | **No** |
| Prisma `contains` + `mode: 'insensitive'` | **Yes** — primary DB filter in collectors |
| TypeScript keyword scoring | **Yes** — `rankDocuments` / token expand in `keyword.util.ts` |
| ILIKE via Prisma | Effectively via `contains` insensitive |

Do **not** describe current Pulse as “PostgreSQL FTS.”

---

## 7. Hybrid Retrieval

### Complete call chain (CURRENT)

```
User question (UI)
→ frontend apiFetch (+ X-Workspace-Id)  [frontend/src/lib/api.ts]
→ POST /api/ai/workspace/chat           [workspace-ai.controller.ts]
→ AiChatService.chat                    [ai-chat.service.ts]
→ IntentDetectionService.detect         [intent-detection.service.ts]
→ RagPipelineService.prepare            [rag-pipeline.service.ts]
   → refineFiltersForIntent (+ jiraFieldsOnly)
   → selectRelevantSources              [source-selection.ts]
→ WorkspaceRetrievalService.retrieve    [workspace-retrieval.service.ts]
   → WorkspaceKnowledgeService.collectSnapshot
   → rankDocuments (keyword)
   → ensureIndexed + searchSimilar (optional hybrid)
   → mergeHybrid (RRF) / mergeResults
   → deduplicateDocuments
   → rerankDocuments
   → pinJiraAuthority / member authority helpers
→ ContextBuilderService.build           [context-builder.service.ts]
→ WorkspacePromptBuilder.build          [workspace-prompt.builder.ts]
→ OpenAiChatProvider.complete           [openai-chat.provider.ts]
→ ChatResponseFormatter + ConversationMemoryService persist
→ Response
```

### Stage cards

| Stage | INPUT | PROCESS | OUTPUT | FILE / METHOD |
|-------|-------|---------|--------|---------------|
| Intent | question string | Heuristic scores / issue key regex | `WorkspaceAiIntent` + filters | `IntentDetectionService.detect` |
| Source selection | intent, question, filters | Rules incl. jira-only / members-only / CORE_MULTI_SOURCES | `RetrievalSourceKey[]` | `selectRelevantSources` |
| Collect | workspaceId, filters, limit | Prisma collectors filtered by selectedSources | `KnowledgeDocument[]` + diagnostics | `WorkspaceKnowledgeService.collectSnapshot` |
| Keyword | documents + query | TS token scoring | ranked docs | `rankDocuments` |
| Vector | query + indexed docs | embed query; ANN or JSON cosine | semantic hits | `KnowledgeEmbeddingService.searchSimilarWithMeta` |
| Merge | keyword + semantic lists | **RRF** k=60 + score blend | merged ≤28 | `mergeHybrid` + `reciprocalRankFusion` |
| Force merge | ranked + snapshot | ensure blockers/jira pinned soft | docs | `mergeResults` |
| Dedupe | docs | by issueKey / chunkId / entityId | unique docs | `deduplicateDocuments` |
| Rerank | docs | heuristic boosts | sorted ≤32 | `rerankDocuments` |
| Context | hits | max 22 chunks / 14k chars (more for full blockers) | sections | `ContextBuilderService.build` |
| Prompt | context | authority rules | system+user messages | `WorkspacePromptBuilder.build` |
| LLM | messages | chat.completions | answer text | `OpenAiChatProvider.complete` |

### Q&A

| Question | Answer |
|----------|--------|
| Selectable sources | `jira`, `jira_audit`, `slack_standups`, `slack_threads`, `standup_runs`, `check_ins`, `blockers`, `blocker_updates`, `reports`, `team_memory`, `ai_conversations`, `slack_ai_chat`, `slack_members`, `jira_members`, `slack_channels` |
| What decides selection? | `selectRelevantSources` + intent refine (`jiraFieldsOnly`, members-only, blocker full list) |
| Candidate counts | Collect limit often **20** from RAG (`retrieve({ limit: 20 })`); knowledge default **40**; reindex snapshot **80**; keyword rank keep; hybrid merge **28**; rerank slice **32**; context **22** chunks |
| Keyword search? | Yes (TS + Prisma contains) |
| Vector search? | Yes when embeddings enabled and not jiraFieldsOnly |
| Merged? | Yes — RRF + extras |
| RRF? | **Yes** — `reciprocalRankFusion` |
| Dedup? | Yes |
| Rerank? | Heuristic (not Cohere/OpenAI rerank model) |
| Real **20 → 5**? | **NOT IMPLEMENTED** as a fixed 20→5 pipeline. Closest: retrieve ~20, context max 22, citation formatter may `.slice(0, 5)` for display only |
| Final context size? | `MAX_CHUNKS=22`, `MAX_CONTEXT_CHARS=14000`, `MAX_PER_SECTION=6` (raised for `blockersFullList`) |

---

## 8. Reranking

| Question | CURRENT |
|----------|---------|
| Dedicated reranker service? | **No** — private method `rerankDocuments` |
| OpenAI / Cohere rerank API? | **NOT IMPLEMENTED** |
| Local / heuristic? | **Yes** |
| Weighted formula? | Start from prior score; +issue key; +intent entity boost; +Live Jira (+120); +recency by source; −40 soft demote memory/reports on issue questions; token +1 |

**20 → 5:** **NOT IMPLEMENTED** as retrieval reduction. Context takes top hits until chunk/char caps. UI/formatter may show top 5 sources.

---

## 9. Workspace Isolation

### Trace

```
Frontend useWorkspace() / getStoredWorkspaceId()
→ apiFetch sets header X-Workspace-Id          [frontend/src/lib/api.ts]
→ main.ts middleware runWithWorkspaceId(...)   [AsyncLocalStorage]
→ resolveActiveWorkspaceId(prisma, preferred)  [workspace-context.ts]
   preference: ALS header → preferred arg → earliest workspace fallback
→ services pass workspaceId into Prisma WHERE
```

### Source filter table

| Source | workspaceId filtered? | Where? | Risk |
|--------|----------------------|--------|------|
| TeamMemoryDocument | Yes | `where: { workspaceId }` in `collectTeamMemory` | Low if header correct |
| KnowledgeEmbedding | Yes | search/upsert by workspaceId | Low |
| JiraIssueCacheEntry | Yes | cache + collector | Medium if OAuth bound wrong workspace historically |
| JiraConnection | Yes (`findLiveConnectionForWorkspace`) | JiraService | Was broken when OAuth lacked workspace — routing fix exists |
| PulseBlocker | Yes | `workspaceId` column | Low |
| Standups | Yes | `user: { workspaceId }` / `run.team.workspaceId` | Low |
| AiDigest | Yes via | `team: { workspaceId }` | Medium if team mis-assigned |
| Slack members/channels | Yes | workspace-scoped caches | Bot may see private channels it is in (Slack ACL ≠ Pulse ACL) |
| AiConversation | Yes | `workspaceId` | Low |
| SlackAiChatLog | Yes | `workspaceId` | Low |
| Fallback `resolveActiveWorkspaceId` → first workspace | N/A | Dev hazard if header missing | **Cross-tenant risk if client omits header** |

---

## 10. ACL / Visibility / Permissions

| Capability | Status |
|------------|--------|
| `TeamMemoryDocument.visibility` | **NOT IMPLEMENTED** (no field) |
| Retrieval filter by visibility | **NOT IMPLEMENTED** |
| Retrieval filter by TeamMember role | **NOT IMPLEMENTED** for RAG |
| Same-workspace peer data visible to AI? | **Yes** — collectors return all workspace records matching filters |
| Private Slack channels | Bot lists `public_channel,private_channel` where invited; **no per-user channel membership filter in RAG** |
| Permissions before retrieval | Workspace id only |
| Permissions after retrieval | Prompt rules / source selection — not ACL |

### Proven leakage-shaped example (workspace-scoped, not cross-tenant)

Any workspace member asking AI can retrieve **another member’s standup answers, blockers, digests, and prior AI chats** in that workspace if keyword/vector match — there is **no viewer ACL** inside `WorkspaceRetrievalService`.

Cross-workspace leakage is guarded by `workspaceId` filters **when the active workspace is correctly set**. Missing header falls back to earliest workspace (`resolveActiveWorkspaceId`) — **security risk**.

---

## 11. Jira Current-State Authority

### Detection

- `shouldUseJiraFieldsOnly` / `isJiraFieldQuestion` in `jira-field-question.ts`
- Set on filters in `RagPipelineService.refineFiltersForIntent`
- Forces `selectRelevantSources` → `['jira']` only

### Call chain (field Q)

```
Question with issue key + field signal
→ IntentDetectionService (often ISSUE_STATUS)
→ jiraFieldsOnly=true
→ collectors: jira only
→ WorkspaceKnowledgeService.collectJiraIssues
   → refreshIssueFromLiveJira → JiraService.lookupIssueForUser
   → JiraCacheService.upsertFromSnapshot
   → if live connected && live miss → ISSUE_NOT_FOUND doc (cache NOT used)
   → if live OK → document fields from LIVE only
   → if no live (Demo/offline) → cache for that workspace
→ retrieval skips semantic mix for fieldsOnly
→ prompt HARD Live Jira rules
→ OpenAI
```

| Question | Answer |
|----------|--------|
| Live mandatory when connected? | **Yes for field questions** (`mustUseLive && !liveUsable` → miss, no stale cache) |
| Can stale cache override live? | **No** when live usable / fields-only path |
| Slack/Reports/Memory excluded? | **Yes** via source selection |
| Live connected + lookup fails? | Not-found guidance; do not invent |
| No connection? | JIRA_NOT_CONNECTED message; Demo uses cache |
| Demo | Seeded `JiraIssueCacheEntry` / demo tokens — no real live Atlassian |

### CURRENT Jira factual flow

```
Field Q + issueKey
    → sources=['jira']
    → Live GET /rest/api/3/issue/{key} (if connection)
    → upsert cache
    → single jira_issue KnowledgeDocument
    → prompt: Answer Source Live Jira
```

---

## 12. Jira + Team Memory Relationship

| Question | CURRENT |
|----------|---------|
| Answer references Jira — what stored? | `AnswerJiraIssueLink` snapshot fields (key, summary, status, assignee, … at capture time) + Team Memory `jira_link` doc |
| Memory inherits issueKey? | Yes — `TeamMemoryDocument.issueKey` set from link |
| Is current Jira status embedded in memory? | Memory stores **captured** status text at link time; live status is separate via collectors |
| Can historical memory be stale? | **Yes** — link/memory content is point-in-time |
| Historical Q merge Live + memory? | Narrative multi-source: Live/cache jira_issue + team_memory/slack/reports; prompt says Jira owns fields |
| Distinguish current vs historical? | Prompt rules + ranking (Live boost, memory demote on issue key) — **not** a separate “as-of” temporal model |

---

## 13. Blockers + Resolutions

### Lifecycle (CURRENT)

```
Standup answer / Slack flow
→ JiraBlockerService creates PulseBlocker + PulseBlockerUpdate(open)
→ emit knowledge-changed → (re)embed blocker KnowledgeDocument

Later Slack follow-up
→ BlockerFollowUpService.applyFollowUp
→ PulseBlocker.status/resolutionNotes/resolutionType/resolvedAt
→ PulseBlockerUpdate row with notes

Retrieval
→ collectBlockers / collectBlockerUpdates (workspaceId)
→ keyword + optional vector
→ blockersFullList path uses dashboard service (parity with Blockers UI)

Team Memory upsert for blockers?  NO
```

| Topic | CURRENT |
|-------|---------|
| Resolution storage | Columns on `PulseBlocker` + history in `PulseBlockerUpdate` |
| Enter Team Memory? | **No** |
| Resolved searchable? | **Yes** via Prisma collectors (not status-excluded by default in general collect) |
| Embeddings after resolution? | On next ensureIndexed/cron (no emit in follow-up) |
| `linkedIssueKey` in retrieval | Yes — filters and content lines |

---

## 14. Reports / Digests

| Question | CURRENT |
|----------|---------|
| Is `AiDigest` the report entity? | **Yes** for standup AI digests |
| Indexed fields in RAG collector | `summary`, `themes` (JSON stringified), `blockers` (JSON stringified) |
| `slackReportText` / `reportSections` in collector? | **Not included** in `collectReports` content |
| Entire report embedded as one doc? | **Yes** (single KnowledgeDocument) |
| Section chunking? | **NOT IMPLEMENTED** |
| Searchable via Team Memory? | Only if Demo seeded memory; production digests via **reports collector**, not Team Memory upsert |
| Workspace isolation | `team: { workspaceId }` join |

---

## 15. Slack

| Topic | CURRENT |
|-------|---------|
| Persisted for RAG | StandupSubmission/Answers, StandupThreadUpdate, SlackMemberCache, Slack channel cache rows, SlackAiChatLog |
| Live fetch | Member sync (`SlackMemberCacheService.syncFromLive`), messaging via Bolt/Web API |
| Raw Slack messages corpus? | **NOT IMPLEMENTED** as a general message store for RAG |
| Embedded? | Standup/thread knowledge docs yes; arbitrary channel messages no |
| Standup thread updates indexed? | Collected + embeddable `standup_thread` |
| Separate from Team Memory? | **Yes** |
| Private channels | Visible to bot if member; **no user ACL in RAG** |
| Permissions | Slack scopes / bot membership — not Pulse visibility metadata |

**Do not conflate:** standup answers ≠ arbitrary Slack messages in this codebase.

---

## 16. AI Conversations

| Store | Role in RAG |
|-------|-------------|
| `AiConversation` / `AiConversationMessage` | Collector `ai_conversations` — prior Q/A as evidence |
| `SlackAiChatLog` | Collector `slack_ai_chat` |
| Embedded? | `ai_chat` **not** in `EMBEDDABLE_ENTITIES` — keyword path |
| UI history? | Also used by `ConversationMemoryService` for session continuity |
| Circular evidence risk? | **Yes, by design today for multi-source** — prior AI answers can re-enter context. Field questions exclude these sources. Prompt does not fully ban AI history as evidence for narrative. |

---

## 17. OpenAI Usage

| Purpose | Service | Method | Model | Input | Output |
|---------|---------|--------|-------|-------|--------|
| Workspace chat | `OpenAiChatProvider` | `complete` → `chat.completions.create` | `OPENAI_MODEL` or `gpt-4o-mini` | system/user (+ history) | answer text |
| Standup digest generation | `AiService` | `chat.completions.create` | via `getOpenAiModel()` | digest prompt | summary JSON-ish |
| Embeddings | `OpenAiEmbeddingProvider` | `embeddings.create` | `text-embedding-3-small` (or env) | title+content texts | float[] |
| Intent detection | `IntentDetectionService` | heuristics | **none** | question | intent |
| Reranking | `rerankDocuments` | heuristics | **none** | docs | ranked docs |
| Reports / vacation / detective | report/vacation/analysis services | `OpenAiChatProvider.complete` | chat model | grounded prompts | markdown/text |

**Does OpenAI connect to PostgreSQL / Jira / Slack?**  
**No.** Boundary:

```
Backend retrieves data → builds context/prompt → OpenAI generates text → Backend stores/formats
```

---

## 18. Current Source Priority

### ACTUAL CURRENT PRIORITY (narrative / multi-source)

Not a strict waterfall. Actual behavior:

1. **Source selection** chooses collectors (often many in parallel).
2. **Keyword + optional vector RRF** merge.
3. **Heuristic rerank** with strong **Jira field boosts** when issue key present; soft **demote** team_memory/reports (−40).
4. **pinJiraAuthority** places Live/cache jira_issue first; for `jiraFieldsOnly` **drops non-jira**.
5. Prompt section order: JIRA → SLACK → STANDUPS → BLOCKERS → REPORTS → TEAM MEMORY → AI HISTORY.

Documented waterfall “Live → Cache → Slack → Reports → Memory → Blockers → AI” is **⚠️ IMPLEMENTED DIFFERENTLY** (parallel collect + score), not a sequential fallback chain.

### CURRENT JIRA FIELD AUTHORITY

```
Live Jira (mandatory if connected)
  → else workspace cache (Demo / offline)
  → never Slack / Reports / Memory / AI history for fieldsOnly
```

### CURRENT HISTORICAL / NARRATIVE RETRIEVAL

```
Multi-source collectors (CORE_MULTI_SOURCES ± extras)
  → hybrid rank
  → Jira still field-authoritative in prompt
  → Slack/standups/reports/memory/blockers/AI history as supporting context
```

---

## 19. Failure / Degradation Behavior

| Dependency | Behavior | Blocks standup save? | Indexing lost? | Retry? |
|------------|----------|----------------------|----------------|--------|
| OpenAI chat | Chat fails / feature disabled | No | N/A | Client retry |
| OpenAI embeddings | Hybrid → keyword_only; ensureIndexed may skip | No | Partial until cron | Cron + next retrieve |
| Jira live | Field Q → not found; narrative may use cache if allowed | No | Cache may be stale | Per-request live call |
| Slack socket | Backgrounded; messaging may fail | Usually no | N/A | Socket reconnect |
| pgvector | JSON cosine fallback | No | N/A | N/A |
| PostgreSQL FTS | N/A (unused) | — | — | — |
| Team Memory indexing | jira_link index failure is `.catch` logged | No | That link may miss memory | Manual/reindex |

**Graceful degradation:** partial yes (keyword-only RAG, per-collector try/catch).  
**Not** durable outbox-grade indexing reliability.

---

## 20. Current Database Map (AI / Jira / Memory relevant)

```
Workspace
 ├── User
 ├── Team ── TeamMember ── User
 │    └── CheckIn ── StandupRun ── StandupSubmission ── Answer
 │                        │              ├── StandupThreadUpdate
 │                        │              └── AnswerJiraIssueLink ──► TeamMemoryDocument (jira_link)
 │                        └── AiDigest (teamId)
 ├── JiraConnection (per user, workspace-scoped usage)
 ├── JiraIssueCacheEntry
 ├── JiraAuditLog
 ├── PulseBlocker ── PulseBlockerUpdate
 ├── JiraProposedAction ── JiraAuditLog
 ├── TeamMemoryDocument          (sparse corpus)
 ├── KnowledgeEmbedding          (no FK to TeamMemoryDocument)
 ├── AiConversation ── AiConversationMessage
 ├── SlackAiChatLog
 └── InboundEvent               (Slack idempotency, not memory outbox)
```

---

## 21. CURRENT vs Pulse V2 Gap Analysis

| # | Requirement | Current Implementation | Status | Evidence | Recommended Direction |
|---|-------------|------------------------|--------|----------|----------------------|
| 1 | Jira structured issue identity | `issueKey` + cache/live snapshots | 🟡 PARTIAL | `JiraIssueCacheEntry`, links | Keep; formalize ISSUE identity types |
| 2 | ISSUE_REF answers | Picker + `AnswerJiraIssueLink` | 🟡 PARTIAL | `answer-jira-link.service.ts` | Keep; expand structured answer types |
| 3 | Live Jira authority for current fields | `jiraFieldsOnly` + live refresh | ✅ IMPLEMENTED | `jira-field-question.ts`, `collectJiraIssues` | Keep |
| 4 | Workspace-scoped Jira connections | `findLiveConnectionForWorkspace` + OAuth workspaceId | ✅ IMPLEMENTED | `jira.service.ts`, oauth helpers | Keep |
| 5 | Team Memory corpus | Sparse; mainly jira_link + demo | 🟡 PARTIAL | TeamMemory writers grep | Broaden ingestion OR redefine Memory = collectors |
| 6 | Standup indexing | Via collectors + embeddings; not TeamMemory upsert | ⚠️ DIFFERENTLY | `collectStandups`, reindex | Align on single corpus model |
| 7 | Blocker indexing | Collectors + embeddings | ⚠️ DIFFERENTLY | `collectBlockers` | Same |
| 8 | Resolution indexing | Updates collected; no memory upsert; weak event | 🟡 PARTIAL | `blocker-follow-up.service.ts` | Emit + optional memory docs |
| 9 | Report indexing | AiDigest collector (partial fields) | 🟡 PARTIAL | `collectReports` | Include sections/text; chunk |
| 10 | Linked Jira metadata | AnswerJiraIssueLink + memory jira_link | ✅ IMPLEMENTED | `indexJiraLink` | Keep; stamp as historical |
| 11 | Memory chunks | None | ❌ NOT IMPLEMENTED | No MemoryChunk | Add chunk model + strategy |
| 12 | Multiple chunks per source | Blocked by uniques | ❌ NOT IMPLEMENTED | schema uniques | Change identity to include chunkIndex |
| 13 | Outbox pattern | None | ❌ NOT IMPLEMENTED | search | Add MemoryOutbox |
| 14 | Background embedding worker | Debounce + cron in-process | 🟡 PARTIAL | `EmbeddingReindexService` | Dedicated worker + outbox |
| 15 | pgvector | Optional runtime | 🟡 PARTIAL | `PgVectorSupportService` | Make required in V2 envs |
| 16 | PostgreSQL FTS | Not used | ❌ NOT IMPLEMENTED | no tsvector | Add FTS alongside vector |
| 17 | Hybrid retrieval | Keyword + vector + RRF | ✅ IMPLEMENTED | `mergeHybrid` | Keep; add FTS leg |
| 18 | RRF | Yes | ✅ IMPLEMENTED | `reciprocalRankFusion` | Keep |
| 19 | Reranking | Heuristic only | 🟡 PARTIAL | `rerankDocuments` | Optional model reranker |
| 20 | 20 → 5 reduction | Not as specified | ❌ NOT IMPLEMENTED | context 22 / slice 32 | Define explicit candidate policy |
| 21 | workspaceId isolation | Pervasive WHERE + ALS | ✅ IMPLEMENTED | `workspace-context.ts` | Remove silent first-workspace fallback |
| 22 | ACL inside retrieval | None | ❌ NOT IMPLEMENTED | ACL grep | Filter by visibility/membership |
| 23 | visibility metadata | None on TeamMemory | ❌ NOT IMPLEMENTED | schema | Add visibility fields |
| 24 | citations | Formatter + references | 🟡 PARTIAL | `chat-response.formatter.ts` | Structured citation contract |
| 25 | source traceability | SourceReference on docs | 🟡 PARTIAL | `buildDocument` | Persist citation provenance |
| 26 | graceful degradation | Partial | 🟡 PARTIAL | collectors try/catch | Formalize SLOs |
| 27 | retryable indexing | Soft cron only | 🟡 PARTIAL | EmbeddingReindexService | Outbox retries |
| 28 | human-approved Jira writes | `JiraActionService.approveAction` | ✅ IMPLEMENTED | `jira-action.service.ts` | Keep |
| 29 | Jira audit logging | `JiraAuditLog` | ✅ IMPLEMENTED | schema + service | Keep |
| 30 | Prevent AI circular evidence | Excluded only for field Qs | 🟡 PARTIAL / ⚠️ RISK | `CORE_MULTI_SOURCES` includes AI history | Product decision + hard exclude option |

---

## 22. KEEP / MODIFY / REMOVE / ADD

### KEEP ✅

- Live Jira field authority path (`jira-field-question`, live refresh, fields-only collectors)
- Workspace-scoped Jira connection resolution
- Multi-source collectors + diagnostics
- Hybrid keyword + embedding + RRF
- Human-approved Jira proposed actions + audit logs
- `KnowledgeDocument` / `SourceReference` abstraction
- Prompt Jira authority rules

### MODIFY 🟡

- **Team Memory** — either become the universal historical corpus **or** rename/docs to match “collectors are the corpus”
- **Embedding reindex** — stop relying on chat-path `ensureIndexed` for correctness; strengthen events (blocker follow-up)
- **Report collector** — include `reportSections` / `slackReportText` if they are product truth
- **resolveActiveWorkspaceId fallback** — too dangerous for multi-tenant
- **AI history in CORE_MULTI_SOURCES** — gate behind product policy
- Unique keys — unblock multi-chunk

### REMOVE / DEPRECATE ❌ (only conflicts / duplicates)

- Do **not** casually remove collectors — they are the real RAG corpus today
- Consider deprecating **misleading** “Team Memory = all knowledge” product language if code stays sparse
- JSON-only vector path should remain as fallback until pgvector is mandatory — not remove

### ADD ➕

- Memory outbox + worker
- Real chunking model (`chunkIndex`, parent source id)
- PostgreSQL FTS
- ACL/visibility in retrieval
- Explicit candidate reduction policy (if V2 requires 20→5)
- Optional cross-encoder / provider rerank
- Decision: exclude AI-generated evidence from RAG by default

---

## 23. File-by-File Responsibility Map

| File / symbol | CURRENT responsibility |
|---------------|------------------------|
| `DemoWorkspaceGeneratorService` | Builds/regenerates Demo tenant data; emits knowledge-changed after generation |
| `demo-workspace-builder.ts` | Seeds Demo standups, blockers, digests, **TeamMemoryDocuments**, Jira cache |
| `WorkspaceKnowledgeService` | **Source-of-truth collectors** → `KnowledgeDocument[]`; live Jira refresh; member directories |
| `WorkspaceRetrievalService` | Hybrid retrieve: keyword, embed, RRF, merge, dedupe, heuristic rerank, authority pins |
| `AiChatService` | Chat orchestration: intent branches, RAG prepare, OpenAI, memory turns, reports/detective |
| `RagPipelineService` | Intent refine + source selection + retrieve + context + prompt package |
| `IntentDetectionService` | Heuristic intent + issueKey extraction (no LLM) |
| `WorkspacePromptBuilder` | System/user prompt + Jira/Slack authority rules |
| `ContextBuilderService` | Sectioned context packing / size limits |
| `JiraService` | OAuth connections, live REST, `lookupIssueForUser`, workspace connection binding |
| `JiraCacheService` | Cache upsert/search; emits knowledge-changed |
| `KnowledgeEmbeddingService` | Index + semantic search (JSON / pgvector) |
| `OpenAiEmbeddingProvider` | OpenAI embeddings API |
| `PgVectorSupportService` | Detect extension; `embedding_vec`; ANN |
| `EmbeddingReindexService` | Event debounce + cron reindex |
| `TeamMemoryService` | Upsert/search TeamMemoryDocument; `indexJiraLink` |
| `AnswerJiraLinkService` | Persist ISSUE links; trigger memory index |
| `source-selection.ts` | Collector selection rules |
| `jira-field-question.ts` | Detect factual field questions |
| `JiraBlockerService` / `BlockerFollowUpService` | Blocker CRUD / resolution |
| `AiService` | Standup digest LLM + AiDigest persistence |
| `InboundEvent` + `slack.listener.ts` | Slack event idempotency |
| `schema.prisma` | Canonical data model |
| `workspace-context.ts` | ALS + resolveActiveWorkspaceId + filter helpers |
| `openai-chat.provider.ts` / `openai-client.ts` | Chat completions boundary |

---

## 24. FINAL CURRENT Architecture Diagram

```
                         ┌─────────────────────────────────────────┐
                         │              FRONTEND (Vite)             │
                         │  activeWorkspace → X-Workspace-Id header │
                         └────────────────────┬────────────────────┘
                                              │
                         ┌────────────────────▼────────────────────┐
                         │ NestJS main.ts ALS middleware            │
                         │ WorkspaceAiController POST .../chat      │
                         └────────────────────┬────────────────────┘
                                              │
                         ┌────────────────────▼────────────────────┐
                         │ AiChatService.chat                       │
                         │  ├─ IntentDetectionService.detect        │
                         │  ├─ (optional) Report/Vacation/Detective │
                         │  └─ RagPipelineService.prepare           │
                         └────────────────────┬────────────────────┘
                                              │
              ┌───────────────────────────────┼───────────────────────────────┐
              │                               │                               │
              ▼                               ▼                               ▼
     selectRelevantSources          WorkspaceRetrievalService        jiraFieldsOnly?
     (source-selection.ts)          .retrieve(limit≈20)              → jira only
                                              │
              ┌───────────────────────────────┼───────────────────────────────┐
              ▼                               ▼                               ▼
     WorkspaceKnowledgeService      keyword rankDocuments           ensureIndexed
     collectSnapshot:               (TS scoring)                    KnowledgeEmbedding
       • Live Jira / Cache                                                  │
       • Slack standups/threads                                       embed query
       • Blockers / updates                                           pgvector|JSON
       • AiDigest reports                                                   │
       • TeamMemoryDocument rows                              reciprocalRankFusion
       • AI conversations / SlackAiChatLog                                  │
       • Members / channels / audits                          merge→dedupe→rerank
                                                                              │
                                              ┌───────────────────────────────┘
                                              ▼
                                   ContextBuilder (≤22 chunks)
                                   WorkspacePromptBuilder
                                              │
                                              ▼
                                   OpenAiChatProvider.chat.completions
                                              │
                                              ▼
                                   Formatter + AiConversation persist
                                              │
                                              ▼
                                           RESPONSE
```

---

## 25. Recommended Pulse V2 Target Diagram

**PROPOSED — NOT CURRENT IMPLEMENTATION**

```
                    ┌──────────────────────────┐
                    │ Structured Jira CURRENT  │
                    │ Live API (workspace conn)│
                    │ Field Q → Live only      │
                    └────────────┬─────────────┘
                                 │ (never mixed into historical corpus as truth)
                                 ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Historical Team Memory                                                      │
│ Standup/Answer/Blocker/Resolution/Report/ISSUE_REF snapshots                │
│        │                                                                    │
│        ▼                                                                    │
│   Memory Outbox (durable, retryable, idempotent)                            │
│        │                                                                    │
│        ▼                                                                    │
│   Background Worker → Chunker (N chunks/source) → Embeddings                │
│        │                                                                    │
│        ▼                                                                    │
│   PostgreSQL FTS  +  pgvector  (+ metadata: visibility, teamId, issueKey)   │
│        │                                                                    │
│        ▼                                                                    │
│   ACL-filtered hybrid retrieval → RRF → rerank → topK (e.g. 20→5)           │
│        │                                                                    │
│        ▼                                                                    │
│   Context + citations → OpenAI → answer (no circular AI evidence by default)│
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 26. Questions That Still Require Human Decisions

These **cannot** be answered from the repository alone:

1. Desired **chunk size/strategy** (tokens vs semantic sections vs per-answer).
2. **Visibility model** (workspace-wide vs team vs private channel vs author-only).
3. Team vs workspace access for AI (should TeamMember constrain RAG?).
4. **Retention** / deletion policy for memory + embeddings.
5. Whether **AI conversations should ever** enter Team Memory / RAG evidence.
6. Reranker provider (none / Cohere / OpenAI / local cross-encoder).
7. Embedding model + dimension lock for production.
8. Whether `AiDigest.reportSections` / `slackReportText` are canonical report truth for indexing.
9. Exact **20→5** (or other) candidate policy for V2.
10. Whether Demo must share identical ingestion pipelines as Real workspaces.
11. SLA for indexing lag (acceptable seconds/minutes after standup).
12. Whether silent `resolveActiveWorkspaceId` fallback to first workspace is acceptable in production.

---

## AUDIT CONFIDENCE

### Fully verified

- Prisma models for Team Memory, embeddings, blockers, digests, conversations, InboundEvent
- Team Memory production write path dominated by `AnswerJiraLinkService` → `indexJiraLink`
- RAG call chain AiChat → RagPipeline → Retrieval → Knowledge → Prompt → OpenAI
- Hybrid RRF + heuristic rerank; no model reranker; no PG FTS
- No MemoryChunk / Bull / Memory Outbox
- Jira fields-only live authority path
- Embedding JSON + optional runtime pgvector
- AI history included in CORE multi-source (circular evidence possible)
- No visibility ACL in retrieval
- OpenAI boundary (no direct DB/Jira/Slack from OpenAI client)

### Partially verified

- Exact production volume of TeamMemoryDocument rows per workspace (would need DB query)
- Whether every blocker resolution path emits knowledge-changed (follow-up path does **not**)
- pgvector presence on the user’s running Postgres (runtime detection; migrations are no-op)
- All Slack private-channel edge cases across listeners
- Full IntentDetection score tables (sampled; heuristics confirmed)

### Could not verify

- Runtime OpenAI model/env overrides on the user’s machine without reading secrets
- Historical production data quality / orphaned embeddings after id scheme changes
- Whether any out-of-repo scripts write TeamMemoryDocument (only in-repo writers audited)
- End-to-end Demo vs Real behavioral parity for every collector under load

---

*End of audit. Code is source of truth; this document describes CURRENT Pulse as of the inspection date.*
