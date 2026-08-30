# AI Phase 1 Report

**Date:** August 19, 2026  
**Module:** Pulse AI Workspace  
**Scope:** Background embedding reindex + conversation history (API + UI)

---

## Summary

Phase 1 delivers two production foundations for the AI Workspace:

1. **Automatic embedding reindex** — knowledge changes trigger a debounced background job; a 10-minute cron covers any missed paths. Unchanged documents are hash-skipped so embeddings are not duplicated or regenerated unnecessarily. Every upsert is logged.
2. **Persisted conversation history** — every AI chat turn is stored in PostgreSQL, listed and reopenable in the AI Workspace UI, and strictly scoped by `workspaceId` so tenants never mix.

Manual reindexing is **not required**. An optional `POST /api/ai/workspace/embeddings/reindex` endpoint remains for ops.

---

## Architecture

### Embedding reindex flow

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
  • log: Embedding updated workspace=… entity=… sourceId=…
```

**Also:** `@Cron(EVERY_10_MINUTES)` walks all workspaces and reindexes with the same hash-skip logic.

**Supported entity types (embeddable):**

| Domain | `KnowledgeEntityType` |
|--------|------------------------|
| Jira Issues | `jira_issue`, `jira_audit` |
| Standups | `standup_submission`, `standup_thread`, `standup_run` |
| Reports / AI Digests | `report` (from `AiDigest`) |
| Blockers | `blocker`, `blocker_update` |
| Team Memory | `team_memory` |

Embeddings remain **JSON float arrays** (pgvector unavailable on this Postgres).

### Conversation history flow

```
POST /ai/workspace/chat
        │
        ▼
AiChatService → ConversationMemoryService (L1 memory + Postgres)
        │
        ▼
AiConversation + AiConversationMessage  (workspaceId-scoped)
        │
        ├── title  ← first user message
        └── preview ← latest assistant reply

GET  /ai/workspace/conversations          → sidebar list
GET  /ai/workspace/conversations/:id      → reopen + warm memory
DELETE /ai/workspace/conversations/:id    → soft-scoped deleteMany
```

Frontend (`AiWorkspacePage` + `AiConversationHistory`):

- Loads history whenever `workspaceId` changes (clears open thread).
- **New chat** clears local state / starts a fresh `conversationId`.
- **Select** reloads messages + citations and continues that thread.
- Lists and opens are always filtered by active workspace.

---

## Database changes

### Migration `20260819140000_ai_conversation_history`

Adds to `AiConversation`:

| Column | Type | Purpose |
|--------|------|---------|
| `userId` | `TEXT` nullable | Optional owner (multi-user ready) |
| `title` | `TEXT` nullable | Sidebar title from first user turn |
| `preview` | `TEXT` nullable | Short assistant preview |

Indexes:

- `AiConversation_workspaceId_updatedAt_idx`
- `AiConversation_userId_idx`

### Existing (prior) tables used

- `KnowledgeEmbedding` — unique `(workspaceId, sourceType, sourceId)`; `contentHash` for change detection
- `AiConversation` / `AiConversationMessage` — chat persistence

Applied successfully via `npx prisma migrate deploy`.

---

## New services

| Service | Role |
|---------|------|
| `EmbeddingReindexService` | Cron + event-driven debounced reindex |
| `ConversationHistoryService` | List / get / delete conversations (workspace-isolated) |

Supporting pieces:

- `knowledge-events.ts` — `WORKSPACE_KNOWLEDGE_CHANGED` event contract
- `AiConversationHistory.tsx` — history sidebar UI

---

## Files modified / added

### Backend

| File | Change |
|------|--------|
| `src/ai/workspace/retrieval/embedding-reindex.service.ts` | **New** — cron + debounce reindex |
| `src/ai/workspace/retrieval/knowledge-events.ts` | **New** — event name + payload |
| `src/ai/workspace/memory/conversation-history.service.ts` | **New** — history API logic |
| `src/ai/workspace/retrieval/knowledge-embedding.service.ts` | Per-doc update logs; embed `standup_run` |
| `src/ai/workspace/memory/conversation-memory.service.ts` | Persist `title` / `preview` on turns |
| `src/ai/workspace/workspace-ai.controller.ts` | Conversations CRUD + reindex endpoint |
| `src/ai/ai.module.ts` | Register new services |
| `src/app.module.ts` | `EventEmitterModule.forRoot()` |
| `src/jira/jira-cache.service.ts` | Emit on issue cache upsert |
| `src/jira/jira-blocker.service.ts` | Emit on blocker writes |
| `src/jira/team-memory.service.ts` | Emit on memory upsert |
| `src/ai/ai.service.ts` | Emit on AI digest save |
| `src/collection/collection.service.ts` | Emit when standup submission completes |
| `src/ai/evaluation/run-evaluation.ts` | Pass `EventEmitter2` into `AiService` |
| `prisma/schema.prisma` | `userId` / `title` / `preview` on `AiConversation` |
| `prisma/migrations/20260819140000_ai_conversation_history/` | **New** migration |

### Frontend

| File | Change |
|------|--------|
| `src/components/ai-workspace/AiConversationHistory.tsx` | **New** — history panel |
| `src/pages/AiWorkspacePage.tsx` | Wire history list / reopen / new / delete |

---

## Event hooks (automatic reindex triggers)

| Source | Reason prefix |
|--------|----------------|
| Jira issue cache upsert | `jira_cache:` |
| Standup submission completed | `standup_submission:` |
| Blocker create/update | blocker-related |
| Team memory upsert | `team_memory:` |
| AI digest saved | `ai_digest:` |
| Cron (all workspaces) | `cron` |
| Manual API | `api` |

---

## Testing performed

| Check | Result |
|-------|--------|
| `npx prisma migrate deploy` | Applied `20260819140000_ai_conversation_history` |
| `npx prisma generate` | Client regenerated |
| Backend `npx tsc --noEmit` | **Pass** (exit 0) |
| Frontend `npx tsc --noEmit` | **Pass** (exit 0) |
| Workspace isolation | History queries always `where: { workspaceId }`; reopen uses `findFirst` with workspace match |
| Hash skip / no duplicates | `ensureIndexed` compares `contentHash`; unique constraint on `(workspaceId, sourceType, sourceId)` |
| Embedding update logging | `logger.log` on every embedding upsert |

Manual UI smoke (recommended after restart): open AI Workspace → ask a question → confirm History entry → New chat → reopen previous thread → switch workspace and confirm empty/other history.

---

## Remaining tasks (later phases)

- Persist / filter conversations by authenticated `userId` in the web session (column ready)
- Switch to **pgvector** + ANN indexes when production Postgres supports the extension
- Cap / prune `KnowledgeEmbedding` growth for very large tenants
- Wire **Send to Slack** for generated reports
- Live Demo Workspace eval harness with labeled answer quality
- Optional LLM-assisted intent when rule scores are ambiguous
- Confidence threshold calibration on production traces

---

## How to verify locally

1. Ensure `PULSE_AI_ENABLED=true` and OpenAI keys are set (embeddings + chat).
2. Restart Nest after this Phase 1 (`npm run start:dev` in `backend`).
3. `GET /api/ai/workspace/health` — should list `embedding_reindex` and `conversation_history` layers.
4. Complete a standup or refresh Jira cache → watch Nest logs for `Embedding reindex scheduled` / `Embedding updated`.
5. Chat in AI Workspace → History sidebar should show the thread; reopen should restore messages.
