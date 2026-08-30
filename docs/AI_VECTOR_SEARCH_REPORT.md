# AI Vector Search Report

**Date:** August 19, 2026  
**Module:** Pulse AI Workspace Retrieval  
**Feature:** Native pgvector with automatic JSON fallback

---

## Executive Summary

Retrieval is upgraded to **hybrid keyword + semantic search**. The system **detects pgvector automatically** at startup:

- If pgvector is available → native `embedding_vec` + ANN (HNSW/IVFFlat) cosine distance  
- If not → **JSON float arrays** + in-process cosine similarity (current local Postgres)

No existing functionality breaks when the extension is missing. Vectors update automatically when knowledge changes (Phase 1 reindex).

---

## Detection

`PgVectorSupportService` on module init:

1. Check `pg_extension` for `vector`  
2. Try `CREATE EXTENSION IF NOT EXISTS vector`  
3. On success: `ALTER TABLE ... ADD COLUMN embedding_vec vector(1536)` + ANN index  
4. On failure: log warning and keep `backend=json`

Health exposes:

```json
"vectorSearch": {
  "embeddingsEnabled": true,
  "backend": "json",
  "pgvectorAvailable": false
}
```

**Local status (Aug 19, 2026):** pgvector binaries not installed (`ERROR: extension "vector" is not available`). JSON fallback active.

---

## Supported Sources

Semantic indexing covers: Jira, Standups, Blockers (+ updates), Reports/Digests, Team Memory, Slack Threads (standup threads), AI Digests.

---

## Retrieval Features

| Feature | Implementation |
|---------|----------------|
| Hybrid Retrieval | Keyword rank + semantic rank → Reciprocal Rank Fusion |
| ANN Search | pgvector `<=>` when available |
| Top-K | Configurable limit (default 24 semantic / fused list) |
| Ranking | Intent soft boosts + RRF |
| Auto vector update | Embedding reindex on knowledge change |
| Performance measure | `semanticMs`, `semanticScanned`, `vectorBackend` in diagnostics |

---

## Flow

```
Query
  → keyword rank (WorkspaceRetrievalService)
  → ensureIndexed (hash-skip)
  → searchSimilarWithMeta
       ├─ pgvector ANN (preferred)
       └─ JSON cosine fallback
  → RRF merge → Top-K hits → context builder
```

---

## Files

| File | Role |
|------|------|
| `retrieval/pgvector-support.service.ts` | Detect + ANN + sync |
| `retrieval/knowledge-embedding.service.ts` | Index + dual-path search |
| `retrieval/workspace-retrieval.service.ts` | Hybrid merge + perf logs |
| `retrieval/embedding-reindex.service.ts` | Background updates |
| `scripts/check-pgvector.ts` | Ops check |

---

## Enabling pgvector in Production

1. Install pgvector on the Postgres host  
2. Restart Pulse backend (auto-detect + column/index create)  
3. Reindex: `POST /ai/workspace/embeddings/reindex` or wait for cron  
4. Confirm `GET /ai/workspace/health` → `vectorSearch.backend = "pgvector"`

---

## Testing Notes

- With JSON fallback: hybrid mode still works when embeddings enabled  
- Workspace isolation on `KnowledgeEmbedding.workspaceId`  
- Diagnostics include retrieval timing  

---

## Remaining Limitations

- Local/dev Postgres lacks pgvector binaries today  
- ANN index creation may be deferred until enough rows exist (IVFFlat)  
- Embedding cost/latency depends on OpenAI  
