# Pulse V2 Phase 1 — Team Memory Database Foundation

**Date:** 2026-08-21  
**Scope:** Database foundation only  
**Status:** Complete — no RAG / worker / chunking / backfill / ACL enforcement

---

## 1. Summary

Phase 1 adds the Prisma enums and tables required for future Pulse V2 Team Memory:

- `MemoryVisibility` — WORKSPACE / TEAM / PRIVATE metadata
- `MemoryChunk` — searchable **derived** multi-chunk units with optional JSON embeddings and ACL fields
- `MemoryOutboxEvent` — dedicated indexing outbox (not `InboundEvent`)

**Legacy runtime is unchanged:** `TeamMemoryDocument`, `KnowledgeEmbedding`, Jira, Slack, and all AI retrieval services remain as-is. Nothing in Phase 1 wires these new tables into RAG.

---

## 2. Files Changed

| Path | Action |
|------|--------|
| `backend/prisma/schema.prisma` | Modified — enums + models + relations |
| `backend/prisma/migrations/20260821190000_pulse_v2_memory_foundation/migration.sql` | Created |
| `docs/PULSE_V2_PHASE1_MEMORY_FOUNDATION.md` | Created (this file) |

No application TypeScript under `src/` was modified.

---

## 3. New Prisma Models

### `MemoryChunk`

Derived retrieval representation. Supports **multiple chunks per source** via:

```prisma
@@unique([workspaceId, sourceType, sourceId, chunkIndex])
```

### `MemoryOutboxEvent`

Dedicated asynchronous indexing queue for future workers. Append-oriented; no unique constraint that blocks re-index UPSERTs.

---

## 4. New Enums

| Enum | Values |
|------|--------|
| `MemoryVisibility` | `WORKSPACE`, `TEAM`, `PRIVATE` |
| `MemoryOutboxOperation` | `UPSERT`, `DELETE` |
| `MemoryOutboxStatus` | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` |

Naming matches existing Prisma enums (e.g. `QuestionType`).

---

## 5. MemoryChunk Explanation

| Field | Meaning |
|-------|---------|
| `id` | UUID primary key |
| `workspaceId` | Tenant scope (required); FK → `Workspace` ON DELETE CASCADE |
| `sourceType` | Logical source kind (string). Expected: `STANDUP_ANSWER`, `BLOCKER`, `BLOCKER_RESOLUTION`, `REPORT`, `JIRA_LINK`, `STANDUP_THREAD`. **Not** `AI_CONVERSATION` |
| `sourceId` | Original record id (e.g. `Answer.id`, `PulseBlocker.id`, `AiDigest.id`) |
| `chunkIndex` | Zero-based index within the source (enables multi-chunk reports) |
| `text` | Chunk body used for future FTS / embedding |
| `contentHash` | Hash of chunk text for skip-unchanged indexing |
| `visibility` | ACL metadata; default `WORKSPACE` |
| `ownerUserId` | Optional owner (PRIVATE / attribution); FK → `User` ON DELETE SET NULL |
| `teamId` | Optional team scope (TEAM visibility); FK → `Team` ON DELETE SET NULL |
| `linkedIssueKey` | Optional Jira key for **historical context only** — never Live field authority |
| `metadata` | Optional JSON bag for future citation extras |
| `embedding` | Nullable JSON float[] (portable store, Approach A) |
| `embeddingModel` | Nullable model name when embedded |
| `embeddingDimensions` | Nullable dimension count when embedded |
| `indexedAt` | When embedding was written (nullable until worker runs) |
| `createdAt` / `updatedAt` | Audit timestamps |

**Semantics:** Original Pulse tables remain business truth. Rebuilding `MemoryChunk` must never delete Answers, Blockers, Digests, etc.

---

## 6. MemoryOutboxEvent Explanation

| Field | Meaning |
|-------|---------|
| `id` | UUID primary key |
| `workspaceId` | Tenant scope; FK → `Workspace` CASCADE |
| `sourceType` / `sourceId` | Which original record to index/delete |
| `operation` | `UPSERT` or `DELETE` |
| `status` | `PENDING` → `PROCESSING` → `COMPLETED` / `FAILED` |
| `attempts` | Claim/retry counter (default 0) |
| `lastError` | Last failure message |
| `availableAt` | Eligible-for-claim time (delayed retry) |
| `lockedAt` | Worker claim timestamp |
| `processedAt` | Completion timestamp |
| `createdAt` / `updatedAt` | Audit timestamps |

`InboundEvent` is **not** reused — it remains Slack provider-event idempotency.

---

## 7. Visibility Model

| Value | Intended future rule | Phase 1 storage |
|-------|----------------------|-----------------|
| `WORKSPACE` | Readable by authorized workspace members | `workspaceId` required |
| `TEAM` | Readable by members of `teamId` | `workspaceId` + `teamId` |
| `PRIVATE` | Readable by `ownerUserId` (+ future ACL) | `workspaceId` + `ownerUserId` |

**No permission checking is implemented in Phase 1.** Indexes are shaped for future pre-filter ACL before vector/FTS.

---

## 8. Source of Truth Rules

| Layer | Authority |
|-------|-----------|
| Original Pulse tables (`Answer`, `PulseBlocker`, `AiDigest`, …) | Business truth |
| `MemoryChunk` | Derived searchable representation only |
| Live Jira API (existing runtime) | Current status / assignee / priority / summary / reporter |
| `MemoryChunk.linkedIssueKey` | Historical/context linkage only |

Example allowed memory text:

> “SCRUM-9 was blocked by the backend API contract last sprint.”

Example **forbidden** as Memory authority:

> “SCRUM-9 status is In Progress.” ← Live Jira only

---

## 9. Multiple Chunk Support

```
AiDigest id=REP-7
  ├── MemoryChunk (workspaceId, sourceType=REPORT, sourceId=REP-7, chunkIndex=0)
  ├── MemoryChunk (…, chunkIndex=1)
  ├── MemoryChunk (…, chunkIndex=2)
  └── MemoryChunk (…, chunkIndex=3)
```

Unlike legacy:

- `TeamMemoryDocument @@unique([sourceType, sourceId])` → one doc per source
- `KnowledgeEmbedding @@unique([workspaceId, sourceType, sourceId])` → one embedding per source

`MemoryChunk` unique includes **`chunkIndex`**, so one source may produce many searchable units.

---

## 10. Idempotency Strategy

**Chosen approach: append-oriented outbox + idempotent chunk rebuild.**

1. Enqueue may insert **multiple** `MemoryOutboxEvent` rows for the same `(workspaceId, sourceType, sourceId)` over time (legitimate updates).
2. There is **no** unique constraint on `(sourceType, sourceId)` for the outbox — that would block re-index UPSERTs.
3. Future worker claims `PENDING` where `availableAt <= now`, sets `PROCESSING` + `lockedAt`.
4. Worker rebuilds **all** chunks for that source using upserts on  
   `@@unique([workspaceId, sourceType, sourceId, chunkIndex])`, deleting obsolete higher indexes as needed.
5. Marks `COMPLETED` (or `FAILED` with `attempts++` and future `availableAt`).
6. Duplicate PENDING events are safe: rebuild is idempotent.

---

## 11. Index Strategy

### MemoryChunk

| Index | Purpose |
|-------|---------|
| unique `(workspaceId, sourceType, sourceId, chunkIndex)` | Multi-chunk idempotent upsert |
| `(workspaceId)` | Tenant scans |
| `(workspaceId, visibility)` | Future ACL pre-filter |
| `(workspaceId, sourceType)` | Source-kind filters |
| `(workspaceId, linkedIssueKey)` | Issue-key historical retrieval |
| `(workspaceId, teamId)` | TEAM ACL filter |
| `(workspaceId, ownerUserId)` | PRIVATE ACL filter |
| `(sourceType, sourceId)` | Rebuild / delete-by-source |
| `(contentHash)` | Skip-unchanged checks |

### MemoryOutboxEvent

| Index | Purpose |
|-------|---------|
| `(status, availableAt)` | Worker claim poll |
| `(workspaceId)` | Tenant ops |
| `(workspaceId, status, availableAt)` | Per-workspace worker poll |
| `(sourceType, sourceId)` | Source lookup |
| `(workspaceId, sourceType, sourceId)` | Coalesce / inspect pending for a source |

---

## 12. pgvector / Embedding Compatibility

**Choice: Approach A — nullable `embedding Json?` on `MemoryChunk`.**

Reasons:

- Matches portable `KnowledgeEmbedding.embedding Json` pattern already used when pgvector is absent.
- Each chunk needs its **own** vector; legacy `KnowledgeEmbedding` uniqueness cannot represent multi-chunk.
- Separate chunk-embedding table would add join complexity without benefit before a worker exists.
- Native `embedding_vec` is **not** created in Phase 1 SQL (same as KnowledgeEmbedding’s migration history: avoid hard-failing hosts without `vector`). Future Phase can add optional runtime sync like `PgVectorSupportService` without breaking JSON fallback.

`embedding`, `embeddingModel`, `embeddingDimensions`, `indexedAt` are nullable so Phase 1 needs no backfill.

---

## 13. Migration Safety

Migration: `20260821190000_pulse_v2_memory_foundation`

SQL is **additive only**:

- `CREATE TYPE` (idempotent `DO $$ … EXCEPTION duplicate_object`)
- `CREATE TABLE IF NOT EXISTS` for `MemoryChunk` and `MemoryOutboxEvent`
- Indexes + FKs
- **No** `DROP TABLE` on `TeamMemoryDocument` / `KnowledgeEmbedding`
- **No** Jira/Slack data rewrites
- **No** embedding deletes
- **No** required backfill

Applied successfully via `prisma migrate deploy` against local `teampulse`.

---

## 14. Validation Results

| Check | Result |
|-------|--------|
| `prisma format` | Pass |
| `prisma validate` | Pass (`The schema at prisma\schema.prisma is valid`) |
| `prisma generate` | Pass (after briefly stopping Nest watch that locked the Windows query engine DLL) |
| `prisma migrate deploy` | Pass — migration applied |
| `tsc --noEmit` | Pass (exit 0) |
| `npm run test:ai-retrieval` | Pass — all keyword / multi-source RAG / Jira members / blockers / vacation / response-depth specs |

---

## 15. What Was Intentionally NOT Implemented

- No memory worker
- No chunking / normalize service
- No new retrieval path using `MemoryChunk`
- No ACL enforcement at query time
- No production data backfill / migration of `TeamMemoryDocument` → `MemoryChunk`
- No AI conversation ingestion into Team Memory
- No removal or refactor of `TeamMemoryDocument` / `KnowledgeEmbedding`
- No changes to `WorkspaceRetrievalService`, `WorkspaceKnowledgeService`, `AiChatService`, Jira, or Slack behavior
- No Phase 2 outbox writers on Answer/Blocker/Digest save paths

---

## 16. Exact Next Step

**Phase 2 (not started):**

Memory ingestion + transactional outbox writes + background worker + chunk generation.

Do not implement Phase 2 in this change set.
