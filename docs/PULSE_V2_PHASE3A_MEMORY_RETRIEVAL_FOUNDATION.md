# Pulse V2 Phase 3A — ACL-Safe Hybrid Memory Retrieval Foundation

**Date:** 2026-08-21  
**Depends on:** Phase 1–2C  
**Status:** Complete — retrieval infrastructure only (Ask Pulse NOT cut over)  
**Existing Ask Pulse changed:** NO  
**Jira authority changed:** NO

---

## 1. Summary

Phase 3A adds a dedicated V2 read path for `MemoryChunk`:

```
Query → trusted workspace/user → ACL (SQL) → FTS + Vector → dedupe → RRF
→ optional issue boost → source diversity → EvidenceResult
```

Production Ask Pulse still uses legacy collectors / `KnowledgeEmbedding`.  
`MEMORY_V2_SHADOW_ENABLED` defaults **OFF**.

---

## 2. Files Created

| Path |
|------|
| `backend/src/memory/memory-retrieval.config.ts` |
| `backend/src/memory/memory-retrieval.types.ts` |
| `backend/src/memory/memory-acl.service.ts` |
| `backend/src/memory/memory-fulltext-search.service.ts` |
| `backend/src/memory/memory-vector-search.service.ts` |
| `backend/src/memory/memory-hybrid-ranking.service.ts` |
| `backend/src/memory/memory-retrieval.service.ts` |
| `backend/src/memory/memory-phase3a.spec.ts` |
| `backend/scripts/memory-search.ts` |
| `backend/prisma/migrations/20260821210000_pulse_v2_memory_fts_index/migration.sql` |
| `docs/PULSE_V2_PHASE3A_MEMORY_RETRIEVAL_FOUNDATION.md` |

## 3. Files Modified

| Path | Why |
|------|-----|
| `backend/src/memory/memory.module.ts` | Register retrieval services |
| `backend/src/memory/memory-embedding.service.ts` | `embedQuery()` for query vectors |
| `backend/src/memory/memory-index.worker.ts` | Sync optional `embedding_vec` after upsert |
| `backend/src/memory/memory-phase2b.spec.ts` | Worker ctor stub for vector sync |
| `backend/src/memory/memory-phase2c.spec.ts` | Same |
| `backend/prisma/schema.prisma` | Comments for FTS / optional pgvector |
| `backend/package.json` | `test:memory-phase3a`, `memory:search` |

---

## 4. Schema / Migration Changes

**YES — additive FTS index only.**

```sql
CREATE INDEX IF NOT EXISTS "MemoryChunk_text_fts_gin_idx"
ON "MemoryChunk"
USING gin (to_tsvector('english', coalesce(text, '')));
```

- No data rewrite
- JSON `embedding` preserved
- No destructive conversion
- Native `embedding_vec` **not** in Prisma schema (same as KnowledgeEmbedding)

**pgvector:** This Postgres install cannot `CREATE EXTENSION vector` (`0A000`). Documented below.

---

## 5. Retrieval Architecture

```
MemoryRetrievalService
  ├─ MemoryAclService          (TeamMember / User)
  ├─ MemoryFullTextSearchService  (ACL in SQL + ts_rank)
  ├─ MemoryVectorSearchService    (ACL in SQL + cosine / pgvector)
  └─ MemoryHybridRankingService   (RRF + issue boost + diversity)
```

---

## 6. Request Contract

```ts
MemoryRetrievalRequest {
  workspaceId: string   // trusted
  userId: string        // trusted
  query: string
  linkedIssueKey?: string
  sourceTypes?: MemorySourceType[]
  limit?: number
  debug?: boolean
  queryEmbeddingOverride?: number[] // tests only
}
```

CLI rejects `--teamIds`. Membership always from `TeamMember`.

---

## 7. Workspace Isolation

Every query: `"workspaceId" = $1` first. No cross-workspace fallback. Demo is just another id.

---

## 8. ACL Architecture

| Visibility | Rule |
|------------|------|
| WORKSPACE | Same workspace + user in workspace |
| TEAM | `teamId IS NOT NULL` AND user in `TeamMember` for that team (`optedOut=false`) |
| PRIVATE | `ownerUserId IS NOT NULL` AND `ownerUserId = userId` |

**Fail-closed:**

- TEAM + `teamId=null` → excluded  
- PRIVATE + `ownerUserId=null` → excluded  
- Unknown visibility → excluded  
- User not in workspace → empty result  

ACL applied **in SQL before** ranking; defense-in-depth re-check in Node.

---

## 9. Full-Text Search

- `to_tsvector('english', text) @@ plainto_tsquery('english', $query)`
- `ts_rank(...)` ordering
- GIN expression index (`MemoryChunk_text_fts_gin_idx`)
- Extra OR for detected issue keys via `linkedIssueKey` / `ILIKE`
- Candidate default limit: **30**

---

## 10. Vector Search

### pgvector status

**NOT installed** on local Postgres (`extension "vector" is not available`).

### Production target

When extension exists, runtime creates nullable `embedding_vec vector(1536)` + HNSW/IVFFlat (same pattern as `PgVectorSupportService` for KnowledgeEmbedding). Worker syncs JSON → `embedding_vec` after upsert.

### Interim backend (explicit, capped)

`json_acl_bounded`:

1. ACL filter in SQL  
2. Load embeddings only for authorized rows (`LIMIT` default **2000**)  
3. Cosine in Node for compatible `embeddingModel` + `embeddingDimensions`  
4. Diagnostic `vectorBackend=json_acl_bounded`

Disable with `MEMORY_V2_VECTOR_JSON_FALLBACK=false` (vector returns empty; FTS still works).

This mirrors existing KnowledgeEmbedding JSON fallback — **not hidden**, **not unbounded workspace dump**.

Similarity direction: **higher cosine = better**. Min similarity default **0.18**.

---

## 11. Query Embeddings

Same family as Phase 2B: `MemoryEmbeddingService` → `OpenAiEmbeddingProvider`  
(`text-embedding-3-small` / env override). Tests use `queryEmbeddingOverride`.

---

## 12. Text-Only Chunk Behavior

`embedding = null` → eligible for FTS only; skipped by vector. Hybrid merge still surfaces them.

---

## 13. Hybrid Retrieval

Parallel FTS + vector (ACL already applied) → merge.

---

## 14. Deduplication

By `MemoryChunk.id`. Preserve lexical + vector ranks on the merged candidate.

---

## 15. RRF

```
RRF(d) = Σ 1 / (k + rank_i(d))
k = MEMORY_RETRIEVAL_RRF_K (default 60)
```

Reuse `reciprocalRankFusion` from `embedding.util.ts`.

---

## 16. Linked Issue Key Behavior

- Detect `KEY-123` in query  
- FTS OR + modest RRF boost (`linkedIssueBoost` default 0.015) **after** ACL  
- Metadata only — not Live Jira field authority  

---

## 17. Source Diversity

Soft cap: max **3** chunks per `sourceType:sourceId` while filling final limit; overflow allowed only to fill remaining slots.

---

## 18. Optional Reranking

Existing Ask Pulse uses heuristic rerank inside `WorkspaceRetrievalService`.  
Phase 3A does **not** add an LLM reranker. RRF is the ranking foundation. Recommend Phase 3B optionally reuse heuristic / later LLM rerank on authorized evidence only.

---

## 19. Evidence / Citation Contract

Each item includes `chunkId`, `sourceType`, `sourceId`, `chunkIndex`, text, visibility fields, retrieval ranks, and `citation{sourceType,sourceId,chunkIndex}`. No embedding vectors exposed.

---

## 20. Shadow Mode

`MEMORY_V2_SHADOW_ENABLED=true` enables `shadowRetrieveIfEnabled()` for diagnostics only. Default **false**. Not wired into Ask Pulse request path in 3A.

---

## 21. Performance / Query Plans

| Path | Shape |
|------|-------|
| FTS | workspace + ACL + GIN tsvector + LIMIT 30 |
| Vector JSON | workspace + ACL + embedding NOT NULL + LIMIT 2000 scan |
| Vector pgvector | `<=>` order + model/dims filter + LIMIT |
| Final | RRF → diversity → LIMIT 12 |

Avoids: load all workspace chunks then filter in Node for FTS.

---

## 22. Security Tests

Covered in `test:memory-phase3a`: workspace, TEAM, PRIVATE, malformed fail-closed.

---

## 23. Retrieval Tests

FTS exact terms, vector semantic (mocked vectors), hybrid/RRF, text-only, model mismatch, citations.

---

## 24. Evaluation Dataset

Five deterministic cases (SCRUM-MEM3A fixtures): delay / dashboard / resolution / report / exact key.

---

## 25. Quality Metrics

Observed in suite: **Hit@5 = 1.00**, **MRR ≈ 0.72** (fixture-based).

---

## 26. Regression Results

| Suite | Result |
|-------|--------|
| `tsc --noEmit` | Pass |
| `test:memory-phase3a` | Pass |
| Phase 2A/2B/2C | (validation run) |
| `test:ai-retrieval` | (validation run) |

---

## 27. Jira Authority Protection

No Live Jira / cache reads in retrieval. Issue keys are memory metadata. Field questions remain Live Jira in Ask Pulse (unchanged).

---

## 28. Known Gaps / Risks

- pgvector unavailable → JSON ACL-bounded vector path (capped; install extension for ANN)
- PRIVATE rarely produced by Phase 2B (fixtures validate policy)
- Shadow not auto-wired to production Ask Pulse
- No LLM answer generation from V2 evidence yet

---

## 29. What Was Intentionally NOT Implemented

- No production Ask Pulse cutover  
- No OpenAI chat answers from V2 memory  
- No legacy collector / TeamMemoryDocument / KnowledgeEmbedding removal  
- No AI conversation / arbitrary Slack MemoryChunk ingestion  
- No Jira factual authority changes  
- No Phase 3B  

---

## 30. Exact Phase 3B Recommendation

1. Install pgvector in production Postgres; verify `embedding_vec` sync  
2. Shadow-compare legacy vs V2 on real queries (`MEMORY_V2_SHADOW_ENABLED`)  
3. Integrate V2 evidence into RAG **alongside** collectors for narrative intents only  
4. Keep `jiraFieldsOnly` / Live Jira for current status/assignee/priority  
5. Enforce ACL in the merged context builder  
6. Cut over gradually; remove legacy collectors only after quality gates  

**Do not implement Phase 3B in this change.**

### Operator commands

```bash
npm run memory:search -- --workspaceId=... --userId=... --query="Why was SCRUM-9 delayed?" --debug
```
