# Pulse V2 Phase 2B — Memory Worker + Chunking + Embeddings

**Date:** 2026-08-21  
**Depends on:** Phase 1 (schema) + Phase 2A (outbox writers)  
**Status:** Complete — write-side indexing only (Ask Pulse / RAG unchanged)

---

## 1. Summary

Phase 2B implements the durable outbox consumer:

`MemoryOutboxEvent` → claim → load → normalize → chunk → embed → idempotent `MemoryChunk` rebuild → COMPLETED / retry / FAILED.

Ask Pulse still uses legacy collectors / `KnowledgeEmbedding`. No retrieval migration.

---

## 2. Files Created

| Path |
|------|
| `backend/src/memory/memory.config.ts` |
| `backend/src/memory/memory-normalized.types.ts` |
| `backend/src/memory/memory-source.loader.ts` |
| `backend/src/memory/memory-chunker.service.ts` |
| `backend/src/memory/memory-embedding.service.ts` |
| `backend/src/memory/memory-index.worker.ts` |
| `backend/src/memory/memory-phase2b.spec.ts` |
| `docs/PULSE_V2_PHASE2B_MEMORY_WORKER.md` |

## 3. Files Modified

| Path | Change |
|------|--------|
| `backend/src/memory/memory.module.ts` | Register worker + loaders + embeddings |
| `backend/package.json` | `test:memory-phase2b` script |

---

## 4. Worker Architecture

```
@Cron(EVERY_MINUTE) MemoryIndexWorkerService.scheduledTick
        ↓
recoverStaleLocks()
        ↓
claimEligibleEvents(batchSize)   // conditional PENDING→PROCESSING
        ↓
for each event (isolated try/catch):
  DELETE → delete MemoryChunks by identity → COMPLETED
  UPSERT → pg_advisory_lock(source)
         → load + verify workspace
         → normalize → chunk → embed (reuse by hash)
         → txn: upsert chunks + delete obsolete + COMPLETED
         → unlock
```

Services:

- `MemorySourceLoader` / `MemoryNormalizerService`
- `MemoryChunkerService`
- `MemoryEmbeddingService` (wraps existing `OpenAiEmbeddingProvider`)
- `MemoryIndexWorkerService` (orchestration only)

Disable cron: `MEMORY_WORKER_ENABLED=false`.

Manual/test: `processPendingBatch(limit?, onlyEventIds?)`.

---

## 5. Event Claiming / Concurrency

**Guarantee:** `updateMany({ where: { id, status: PENDING }, data: { status: PROCESSING, lockedAt, attempts++ } })`.

Only one concurrent updater observes `count === 1`.

Claim path oversamples PENDING ordered by `availableAt`, then claims until batch filled.

**Same-source rebuild:** `pg_advisory_lock(hash(workspaceId|sourceType|sourceId))` for the duration of UPSERT processing so two workers cannot corrupt chunk replacement for the same source.

---

## 6. Stale Lock Recovery

`PROCESSING` with `lockedAt < now - lockTimeoutMs` (default **5 minutes**) → reset to `PENDING`, `availableAt=now`, `lastError=stale_lock_recovered`.

---

## 7. Retry Policy

| Config | Default | Env |
|--------|---------|-----|
| `maxAttempts` | 8 | `MEMORY_WORKER_MAX_ATTEMPTS` |
| `retryBaseMs` | 15s | `MEMORY_WORKER_RETRY_BASE_MS` |
| `retryMaxMs` | 30m | `MEMORY_WORKER_RETRY_MAX_MS` |
| `batchSize` | 8 | `MEMORY_WORKER_BATCH_SIZE` |
| `lockTimeoutMs` | 5m | `MEMORY_WORKER_LOCK_TIMEOUT_MS` |

Backoff: `min(retryMaxMs, retryBaseMs * 2^(attempts-1))`.

**Permanent FAIL immediately:** unsupported source type, workspace mismatch.

**Transient:** embedding API errors → PENDING + availableAt delay. Existing `MemoryChunk` rows **untouched**.

---

## 8. Supported Sources

`STANDUP_ANSWER` · `BLOCKER` · `BLOCKER_RESOLUTION` · `REPORT`

Rejected: `AI_CONVERSATION`, `SLACK_MESSAGE`, `JIRA_CACHE`, others.

---

## 9. Source Loaders

| Type | Loads | Workspace check |
|------|-------|-----------------|
| STANDUP_ANSWER | Answer + Question + User + Submission/Run/CheckIn + AnswerJiraIssueLink | `User.workspaceId` |
| BLOCKER | PulseBlocker | `PulseBlocker.workspaceId` |
| BLOCKER_RESOLUTION | PulseBlockerUpdate + Blocker | blocker.workspaceId |
| REPORT | AiDigest + Team + Run/CheckIn | `Team.workspaceId` |

Mismatch → `MemoryWorkspaceMismatchError` → FAILED (no chunks written to event workspace).

---

## 10. NormalizedMemorySource

Fields: `workspaceId`, `sourceType`, `sourceId`, `title`, `text`, `ownerUserId`, `teamId`, `linkedIssueKey`, `visibility`, `metadata`, optional `sections[]`.

Chunker never sees Prisma models.

---

## 11. Standup Normalization

Question + answer text + author + standup name + **issue keys only** from `AnswerJiraIssueLink`.

Does **not** copy linked issue status/assignee/priority into text.

Visibility: **TEAM** when `teamId` present, else WORKSPACE.

---

## 12. Blocker Normalization

Human-readable lines for description, status, severity, category, dependency, expected resolution, owner, needsHelp/escalation, linkedIssueKey.

Visibility: TEAM if `teamId`, else WORKSPACE.

---

## 13. Blocker Resolution Normalization

Problem (blocker description) + resolution notes/type + status transition + linkedIssueKey.

`sourceId` = `PulseBlockerUpdate.id` (Phase 2A contract).

---

## 14. Report Normalization

Section-aware from summary / themes / blockers / selected `reportSections` keys (skips stats/profiles noise). Falls back to `slackReportText` only if otherwise empty.

Visibility: **TEAM** (digest is team-scoped).

---

## 15. Visibility Derivation

| Source | Visibility | Notes |
|--------|------------|-------|
| Standup answer | TEAM if team else WORKSPACE | ownerUserId set |
| Blocker / resolution | TEAM if team else WORKSPACE | owner set |
| Report | TEAM | no owner |

PRIVATE not derived yet — Pulse sources lack a clear private-only signal in Phase 2B. Documented gap.

---

## 16. Chunking Strategy

- Deterministic, **no LLM**
- Max **1800** chars (`MEMORY_CHUNK_MAX_CHARS`)
- Overlap **120** chars on long splits
- Prefer `\n\n` / `\n` / `. ` / space breaks
- Standup / blocker / resolution: usually 1 chunk
- Report: one unit per section; oversized sections split with stable `chunkIndex 0..N`

---

## 17. Content Hashing

SHA-256 of full chunk `text` (`hashChunkContent`).

---

## 18. Embedding Architecture

| Item | Value |
|------|-------|
| Provider | Existing `OpenAiEmbeddingProvider` |
| Model | `OPENAI_EMBEDDING_MODEL` or `text-embedding-3-small` |
| Store | `MemoryChunk.embedding` JSON (+ model/dimensions/indexedAt) |
| Reuse | same contentHash + model + non-empty vector |
| AI disabled | chunks written with null embedding; event COMPLETED |
| AI enabled + failure | no COMPLETED; no chunk delete; retry |

---

## 19. Idempotent Rebuild

```
OLD REP-7: chunks 0,1,2,3
NEW REP-7: chunks 0,1
After success: only 0,1 remain (2,3 deleted in same txn as upserts + COMPLETED)
```

---

## 20. Safe Replacement Transaction

Embed **before** DB mutation. On embed failure → abort; old chunks remain.

On success:

```
BEGIN
  upsert each new chunk
  deleteMany chunkIndex NOT IN keepIndexes
  mark event COMPLETED
COMMIT
```

---

## 21. DELETE Processing

`deleteMany` by `(workspaceId, sourceType, sourceId)` then COMPLETED. Zero rows still success. Idempotent.

---

## 22. Source Missing Behavior

UPSERT + missing source → delete any leftover chunks for that identity in event workspace → COMPLETED (`source_missing_cleaned`). No infinite retry.

---

## 23. Workspace Isolation

Event workspace must equal loaded source workspace. Cross-tenant indexing refused (FAILED).

---

## 24. Jira Authority Protection

No loader for `JiraIssueCacheEntry`. Link metadata is key-only. Live Jira field path untouched.

---

## 25. AI Conversation / Slack Exclusions

Not supported. Unsupported types FAILED. Standup Answers that originated via Slack are OK because source-of-truth is `Answer`.

---

## 26. Observability

Structured logs: claim, source stats (`chunksGenerated`, `embeddingsCreated/Reused`), COMPLETED duration, safe error summaries. No tokens / vectors / OAuth secrets.

---

## 27. Tests

`npm run test:memory-phase2b`:

- Concurrent claim exclusivity + stale recovery
- Standup / blocker / resolution chunks + linkedIssueKey without Jira status
- Report multi-chunk, hash reuse, obsolete removal
- Embed failure preserves chunks
- Workspace mismatch
- Idempotent DELETE
- Prohibited sources

---

## 28. Regression Results

| Suite | Result |
|-------|--------|
| `tsc --noEmit` | Pass (after Phase 2B) |
| `test:memory-phase2a` | Pass |
| `test:memory-phase2b` | Pass |
| `test:ai-retrieval` | Pass |

---

## 29. Known Gaps / Risks

- Large PENDING backlog from Phase 2A REPORT writes may process slowly on cron (batch=8/min).
- AI disabled → chunks without embeddings until reprocess with AI on.
- PRIVATE visibility not derived.
- Advisory locks require PostgreSQL (project already uses Postgres).
- Worker cron runs in every Nest instance — claim + advisory lock keep correctness.

---

## 30. What Was Intentionally NOT Implemented

- No Ask Pulse / MemoryChunk retrieval migration
- No ACL enforcement in retrieval
- No historical backfill of all past Answers/Blockers/Reports
- No arbitrary Slack ingestion
- No AI conversation ingestion
- No legacy TeamMemoryDocument / KnowledgeEmbedding removal
- No Jira factual authority changes

---

## 31. Exact Next Phase

**Recommended: Phase 2C — controlled historical backfill + verification**

1. Dry-run counters of eligible sources without MemoryChunks
2. Enqueue UPSERT in workspace-scoped batches with rate limits
3. Verify chunk counts / workspace isolation / no Live Jira pollution
4. Only then **Phase 3** — ACL-filtered MemoryChunk hybrid retrieval alongside (then replacing) collectors

Do **not** start Phase 3 until backfill + worker stability are confirmed.
