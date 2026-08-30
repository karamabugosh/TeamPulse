# AI Phase 1 Report — Background Embedding Reindex

**Date:** August 19, 2026  
**Module:** Pulse AI Workspace  
**Feature:** Automatic embedding updates for searchable knowledge

---

## Executive Summary

Phase 1 delivers **automatic, incremental embedding reindex**. When searchable workspace data changes, Pulse schedules a debounced background job that regenerates embeddings **only for changed records** (content-hash skip). Unchanged documents are never re-embedded. Every upsert is logged. A 10-minute cron covers any missed write paths.

Manual reindexing is **not required**. Ops can still call `POST /api/ai/workspace/embeddings/reindex`.

---

## Supported Entity Types

| Domain | Entity / source |
|--------|-----------------|
| Jira Issues | `jira_issue` |
| Jira Audit Logs | `jira_audit` |
| Standups | `standup_submission`, `standup_run` |
| Slack Threads | `standup_thread` |
| Blockers | `blocker` |
| Blocker Updates | `blocker_update` |
| Reports / AI Digests | `report` (from `AiDigest`) |
| Team Memory | `team_memory` |

---

## Architecture

```
Knowledge write (Jira / standup / blocker / team memory / AI digest)
        │
        ▼
EventEmitter2  →  WORKSPACE_KNOWLEDGE_CHANGED { workspaceId, reason }
        │
        ▼
EmbeddingReindexService.scheduleReindex (8s debounce per workspace)
        │
        ▼
WorkspaceKnowledgeService.collectSnapshot
        │
        ▼
KnowledgeEmbeddingService.ensureIndexed
  • contentHash match → skip (no duplicate / no API call)
  • changed or new → OpenAI embed → upsert KnowledgeEmbedding
  • sync native embedding_vec when pgvector available
  • log: Embedding updated workspace=… entity=… sourceId=…
```

**Also:** `@Cron(EVERY_10_MINUTES)` walks all workspaces with the same hash-skip logic.

---

## Duplicate Avoidance

- Unique key: `(workspaceId, sourceType, sourceId)`
- Upsert only when `contentHash` differs
- Hash = SHA-256 of `title + content`

---

## Event Emitters

| Writer | Emits on |
|--------|----------|
| `jira-cache.service` | Issue cache refresh |
| `jira-blocker.service` | Blocker create/update |
| `team-memory.service` | Memory write |
| `collection.service` | Standup / thread ingestion |
| `ai.service` | Digest generation |

---

## Files

| File | Role |
|------|------|
| `retrieval/embedding-reindex.service.ts` | Debounce + cron + reindex |
| `retrieval/knowledge-embedding.service.ts` | Hash-skip upsert + search |
| `retrieval/knowledge-events.ts` | Event name + payload |
| `retrieval/openai-embedding.provider.ts` | OpenAI embeddings API |
| `retrieval/embedding.util.ts` | Hash, cosine, RRF |

---

## Testing Notes

- Demo Workspace: reindex after seed → logs show indexed then skipped on second run
- Real Workspace: knowledge write → schedule log → upsert log for changed docs only
- Workspace isolation: embeddings always keyed by `workspaceId`

---

## Remaining Limitations

- Requires `PULSE_AI_ENABLED` + `OPENAI_API_KEY` for embedding generation
- Cron is every 10 minutes (not real-time for silent paths)
- Snapshot limit in background job is capped (80 docs) for cost control
