# Pulse V2 Phase 2C — Controlled Historical Backfill + Verification

**Date:** 2026-08-21  
**Depends on:** Phase 1 (schema) + Phase 2A (outbox writers) + Phase 2B (worker)  
**Status:** Complete — dry-run / bounded enqueue / verify only  
**Schema / migration:** NO

---

## 1. Summary

Phase 2C discovers historical Pulse business records that predate outbox writers and safely plans/enqueues `MemoryOutboxEvent` UPSERTs. The **only** path to `MemoryChunk` remains the Phase 2B worker.

Ask Pulse / RAG is unchanged.

---

## 2. Files Created

| Path |
|------|
| `backend/src/memory/memory-backfill.types.ts` |
| `backend/src/memory/memory-backfill.service.ts` |
| `backend/src/memory/memory-phase2c.spec.ts` |
| `backend/scripts/memory-backfill.ts` |
| `backend/scripts/memory-verify.ts` |
| `docs/PULSE_V2_PHASE2C_HISTORICAL_BACKFILL.md` |

## 3. Files Modified

| Path | Change |
|------|--------|
| `backend/src/memory/memory-ingestion.policy.ts` | Shared `isMemoryEligibleBlockerResolutionUpdate` |
| `backend/src/memory/memory.module.ts` | Register / export `MemoryBackfillService` |
| `backend/src/memory/memory-phase2a.spec.ts` | Policy coverage for resolution update helper |
| `backend/package.json` | `test:memory-phase2c`, `memory:backfill`, `memory:verify` |

---

## 4. Backfill Architecture

```
Historical Business Tables
        ↓
Eligibility Scanner (cursor pages)
        ↓
State Classification (MemoryChunk + MemoryOutboxEvent)
        ↓
Dry Run (read-only)  OR  Controlled Enqueue
        ↓
MemoryOutboxEvent (PENDING UPSERT)
        ↓
Existing Phase 2B Worker
        ↓
MemoryChunk
```

Backfill **never** writes `MemoryChunk` and **never** calls OpenAI.

---

## 5. Supported Historical Sources

| sourceType | Business table | sourceId |
|------------|----------------|----------|
| STANDUP_ANSWER | Answer | Answer.id |
| BLOCKER | PulseBlocker | PulseBlocker.id |
| BLOCKER_RESOLUTION | PulseBlockerUpdate | PulseBlockerUpdate.id |
| REPORT | AiDigest | AiDigest.id |

**Not supported:** AI conversations, Slack messages, JiraIssueCacheEntry, JiraMemberCache, TeamMemoryDocument, KnowledgeEmbedding.

---

## 6. Eligibility Rules

Shared via `memory-ingestion.policy.ts` (same as Phase 2A):

| Source | Rule |
|--------|------|
| STANDUP_ANSWER | `isMemoryEligibleAnswerType` — skip `ISSUE_REF` |
| BLOCKER | All workspace PulseBlocker rows |
| BLOCKER_RESOLUTION | `isMemoryEligibleBlockerResolutionUpdate` — `newStatus === 'resolved'` only |
| REPORT | `isMemoryEligibleDigest` — skip `source=failed` / empty+error |

Workspace resolution:

- Answer → `User.workspaceId`
- Blocker → `PulseBlocker.workspaceId`
- Resolution → parent blocker workspace
- Report → `AiDigest.team.workspaceId`

---

## 7. State Classification

| State | Meaning |
|-------|---------|
| INDEXED | ≥1 MemoryChunk for identity |
| IN_FLIGHT | PENDING or PROCESSING outbox exists |
| MISSING | Eligible; no chunks; no active event |
| FAILED | FAILED event(s); no chunks |
| INCONSISTENT | COMPLETED UPSERT exists but zero chunks |
| SKIPPED | Inspected but not eligible |

Priority: INDEXED > IN_FLIGHT > INCONSISTENT > FAILED > MISSING.

---

## 8. Workspace Isolation

Every API requires explicit `workspaceId` (verified against `Workspace` table).

No `backfillAllWorkspaces()`. No name/Demo heuristics.

Enqueue only creates events for that workspace id.

---

## 9. Dry Run

```bash
npm run memory:backfill -- --workspaceId=<uuid> --dry-run
```

Example shape:

```
Workspace: <name> (<uuid>)

STANDUP_ANSWER
  inspected:     …
  eligible:      …
  indexed:       …
  inFlight:      …
  missing:       …
  failed:        …
  inconsistent:  …
  skipped:       …
  wouldEnqueue:  …

TOTALS
  wouldEnqueue:  …
  databaseWrites:0
```

Tests assert dry-run does not change counts of MemoryOutboxEvent, MemoryChunk, Answer, PulseBlocker, PulseBlockerUpdate, AiDigest.

---

## 10. Controlled Enqueue

```bash
npm run memory:backfill -- --workspaceId=<uuid> --enqueue --limit=50
```

Options:

- `--sourceTypes=BLOCKER,REPORT`
- `--retryFailed` — enqueue FAILED (default: skip)
- `--repairInconsistent` — enqueue INCONSISTENT (default: skip)

Defaults enqueue **MISSING only**.

Does **not** wait for worker/embeddings.

---

## 11. Batch / Pagination Strategy

- Scan: deterministic `ORDER BY id ASC` + `id > cursor`, page size default **200**
- Enqueue: `limit` / `BACKFILL_BATCH_SIZE` (default **50**)
- Optional `onlySourceIds` for targeted repair/tests

Worker cron defaults unchanged (batch=8/min).

---

## 12. Duplicate Prevention

Before create, skip if PENDING/PROCESSING already exists for `(workspaceId, sourceType, sourceId)`.

No new unique constraint.

---

## 13. Failed Event Policy

Default: report as FAILED; do not enqueue.

`--retryFailed` / `retryFailed: true`: create a fresh PENDING UPSERT (worker will re-index).

---

## 14. Inconsistent State Policy

COMPLETED UPSERT + zero chunks + source still present → INCONSISTENT.

Default: do not enqueue.

`--repairInconsistent`: enqueue UPSERT for rebuild.

---

## 15. Worker Integration

Backfill ends at outbox. Phase 2B `processPendingBatch` / cron produces chunks. Tests call the real worker after enqueue.

---

## 16. Verification Architecture

```bash
npm run memory:verify -- --workspaceId=<uuid> [--sample=10]
```

Reports:

- Per-source classification counters
- Chunk totals by sourceType / visibility
- Embedding coverage (with / without)
- linkedIssueKey / teamId / ownerUserId counts
- Outbox PENDING/PROCESSING/COMPLETED/FAILED
- Optional safe chunk samples (preview, no vectors)

---

## 17. Embedding Coverage

Verification distinguishes:

- `withEmbedding` — INDEXED_WITH_EMBEDDING
- `withoutEmbedding` — INDEXED_TEXT_ONLY (e.g. AI disabled during worker)

Backfill “done” ≠ embeddings complete.

---

## 18. Visibility Coverage

Counts WORKSPACE / TEAM / PRIVATE.

Phase 2B derives no PRIVATE → typically PRIVATE=0 (documented, not an error).

---

## 19. Linked Jira Metadata Verification

`chunks.withLinkedIssueKey` from MemoryChunk only. No Live Jira calls.

---

## 20. Demo Workspace Behavior

Demo is a normal workspace id. Backfill Demo only writes Demo outbox/chunks. No Demo↔real leakage (tested when ≥2 workspaces exist).

---

## 21. Jira Authority Protection

No scan of JiraIssueCacheEntry. Pulse sources may carry `linkedIssueKey`; Phase 2B still does not copy cache status/assignee/priority into chunk text (tested).

---

## 22. Tests

`npm run test:memory-phase2c`:

- Policy reuse
- Dry-run read-only
- Classification fixtures (MISSING/INDEXED/IN_FLIGHT/FAILED/INCONSISTENT)
- Enqueue + no duplicate active
- Worker integration
- Batch limits 3+3+1
- Report Team→Workspace isolation
- Resolution selectivity
- Jira cache protection
- Multi-workspace isolation
- Verify + no OpenAI from backfill

---

## 23. Regression Results

| Suite | Result |
|-------|--------|
| `tsc --noEmit` | (run in validation) |
| `test:memory-phase2a` | Pass |
| `test:memory-phase2b` | Pass |
| `test:memory-phase2c` | Pass |
| `test:ai-retrieval` | (run in validation) |

---

## 24. Risks / Gaps

- Large workspaces: dry-run scans all pages (read-only but can be slow)
- Enqueue without worker leaves PENDING backlog
- Text-only chunks if AI disabled when worker runs
- Historical ISSUE_REF answers remain skipped (by design)
- No production unbounded backfill was executed in this phase

---

## 25. What Was Intentionally NOT Implemented

- No direct MemoryChunk writes from backfill
- No direct embedding / OpenAI calls from backfill
- No Ask Pulse retrieval migration
- No ACL retrieval
- No vector / FTS / RRF / reranker
- No AI conversation ingestion
- No arbitrary Slack ingestion
- No Jira cache backfill
- No legacy TeamMemoryDocument / KnowledgeEmbedding removal
- No schema migration
- No Phase 3

---

## 26. Production Backfill Runbook

1. Select target `workspaceId` explicitly  
2. `npm run memory:backfill -- --workspaceId=... --dry-run`  
3. Inspect wouldEnqueue / failed / inconsistent  
4. `npm run memory:backfill -- --workspaceId=... --enqueue --limit=50`  
5. Ensure Nest app worker is running (Phase 2B cron)  
6. `npm run memory:verify -- --workspaceId=... --sample=10`  
7. Inspect sample quality (no Jira cache pollution)  
8. Repeat enqueue batches until dry-run missing≈0  
9. Final verify (embedding coverage + visibility)

**This document does not claim a full production backfill was run.**

---

## 27. Exact Next Phase Recommendation

Worker + backfill + verification are healthy for operator-controlled use.

**Recommended next:** Phase 3 — ACL-filtered MemoryChunk retrieval migration (alongside, then replacing, legacy collectors).

Do **not** start Phase 3 until at least one real workspace has been dry-run → small enqueue → verify’d successfully in the operator’s environment.
