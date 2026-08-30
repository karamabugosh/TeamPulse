# PULSE — Latest Standup Memory Retrieval Fix

**Date:** 2026-08-22  
**Scope:** Ask Pulse HYBRID retrieval correctness for temporally scoped standup questions  
**Status:** Fixed and verified against real Pules workspace data

---

## 1. Real Failing Run

After a manual Slack standup on **Daily Standup (Pules untangle)**, Ask Pulse returned older historical memory when asked about the **latest** standup.

| Field | Value |
|-------|-------|
| workspaceId | `0e4985cc-3955-4af5-8cba-d72f25f1a8ee` (Pules project) |
| checkInId | `100ad622-479d-5133-9e08-1e9f344b5bd2` |
| runId | `f272e32d-e0a0-4fcc-aa64-325a880aa5bf` |
| run status | `collecting` (run not yet marked completed) |
| startedAt | `2026-08-22T15:05:27.814Z` |
| completedAt | `null` |
| teamId | `880e0ee4-5447-4c21-8f5c-0b57f45e40cc` |

**Important:** The top *completed* run by `run.completedAt` was an earlier run (`86d94bea-…`). Karam's newest submission completed at `2026-08-22T15:08:39.988Z` on the still-`collecting` run above. Resolving "latest" by run completion alone would miss this submission.

---

## 2. Persisted Answers (Karam)

**submissionId:** `9d4736c4-5e94-465e-a3eb-9af878aa6410`  
**userId:** `bae237ed-e53d-4c5f-88e5-6e69945103f3`  
**completedAt:** `2026-08-22T15:08:39.988Z`

| # | Question | Type | Answer (summary) |
|---|----------|------|------------------|
| Q1 | What did you complete since your last update? | FREE_TEXT | SCRUM-1: Start here… |
| Q2 | What are you working on now? | FREE_TEXT | SCRUM-4: Delegate this work item to Cursor |
| Q3 | Is anything blocking your progress? | BLOCKER | **Yes** — blocker saved |
| Q4 | What are you planning to work on next? | FREE_TEXT | SCRUM-4: Delegate this work item to Cursor |
| Q5 | Is there anything the team should know or help you with? | FREE_TEXT | SCRUM-9: Dashboard Analytics |

All five answers persisted with linked Jira keys where applicable.

---

## 3. Persisted Blocker

| Field | Value |
|-------|-------|
| id | `e5cd3560-2dc2-4fcc-ab6f-72598d585864` |
| title | `slack and jira conection` (typo in DB) |
| description | `no emdings for jira` |
| runId | `f272e32d-e0a0-4fcc-aa64-325a880aa5bf` |
| submissionId | `9d4736c4-5e94-465e-a3eb-9af878aa6410` |
| answerId | `83e8cbf9-384b-4c57-80fe-be93f19a0892` |
| linked Jira | SCRUM-11 |

**Confirmed:** Blocker exists and is linked to the correct run/submission/answer.

---

## 4. Memory Ingestion Verification

### A–G Summary

| Question | Answer |
|----------|--------|
| A. Latest run created MemoryChunks? | **YES** — 5 STANDUP_ANSWER + 1 BLOCKER |
| B. Karam's latest answers created chunks? | **YES** |
| C. New blocker created BLOCKER chunk? | **YES** (`sourceId=e5cd3560-…`) |
| D. Embeddings present? | **YES** (380/380 indexed) |
| E. embedding_vec present? | **YES** (380/380 pgvector) |
| F. Attribution correct? | **YES** — `ownerUserId=bae237ed-…`, `teamId` set |
| G. Traceable to Run/Submission? | **YES** for STANDUP_ANSWER (`metadata.runId`, etc.). BLOCKER chunk ingested **before** provenance enrichment — metadata had status/severity only; scoped by `sourceId` in retrieval |

Outbox events: all **COMPLETED**. No failed events.

**Contaminating historical chunk:** STANDUP_ANSWER from an older run with text `"None. Everything is on schedule."` — still stored (not deleted), but now excluded from LATEST_STANDUP scope.

---

## 5. Root Cause

**Combination: B + D + F + G/H**

| Code | Finding |
|------|---------|
| A | **Not** the cause — ingestion succeeded |
| B | Chunks exist but unscoped semantic search ranked older "no blockers" text higher |
| C | Partial — STANDUP_ANSWER had run metadata; BLOCKER lacked run/submission in metadata at ingest time |
| D | `"latest standup"` was not detected as a temporal **scope constraint** |
| E | User attribution worked; scope was the failure |
| F | Run/submission not enforced during retrieval |
| G/H | HYBRID merge could inject unscoped legacy team memory alongside V2 hits |

**Secondary:** Latest-run resolution by `run.completedAt` alone would select the wrong run because Slack collection can leave the run in `collecting` while individual submissions complete.

---

## 6. Temporal Provenance

STANDUP_ANSWER `MemoryChunk.metadata` (existing + enriched on re-ingest):

```json
{
  "questionId": "...",
  "answerId": "...",
  "checkInId": "...",
  "submissionId": "...",
  "runId": "...",
  "sourceCreatedAt": "...",
  "runStartedAt": "...",
  "runCompletedAt": "...",
  "questionType": "...",
  "linkedIssueKeys": []
}
```

BLOCKER metadata enriched in `memory-source.loader.ts` (new ingests + re-ingest):

```json
{
  "runId": "...",
  "submissionId": "...",
  "checkInId": "...",
  "answerId": "...",
  "sourceCreatedAt": "...",
  "status": "open",
  "severity": "medium"
}
```

No schema migration required — provenance lives in existing JSON `metadata` column per Phase 1/2 architecture.

---

## 7. Latest-Run Resolution Algorithm

`LatestStandupResolverService.resolve()`:

1. Workspace-scoped query on `StandupSubmission` where `status = completed`
2. Optional filter: `subjectUserId` (from workspace member name resolution)
3. Optional filter: `checkInId`
4. Order by `submission.completedAt DESC` (not `run.completedAt`)
5. Load answer IDs + PulseBlocker IDs for that submission/run/user
6. Return `scopedSourceIds = answerIds + blockerIds`

This scope is applied **before** vector/fulltext ranking — not as a post-hoc score boost.

---

## 8. User Attribution

- `"Karam"` resolved via `WorkspaceKnowledgeService.resolveSubjectUserId()` using workspace membership (`slackDisplayName`, email candidates)
- Workspace-scoped only — no cross-workspace fuzzy match
- Single Karam in Pules workspace: `bae237ed-e53d-4c5f-88e5-6e69945103f3`
- Ambiguity handling preserved: if multiple matches, resolver does not guess

---

## 9. HYBRID Merge Behavior

When `temporalScope = LATEST_STANDUP`:

1. Legacy collectors receive run/submission filters (`workspace-knowledge.service.ts`)
2. Post-retrieval filter: `documentMatchesLatestStandupFilters()` on legacy + V2 docs
3. `MemoryEvidenceMergeService.merge({ temporalScoped: true })` drops legacy team-memory hits that are **not** also present in scoped V2 evidence identities
4. Live Jira (`LIVE_JIRA_CURRENT`) is never dropped by temporal scope

Historical queries without `"latest"` remain unscoped.

---

## 10. Jira Authority

Unchanged from Phase 3B. Composite queries:

> "What did Karam report about SCRUM-11 in the latest standup, and what is SCRUM-11's current Jira status now?"

- Historical portion → LATEST_STANDUP scoped team memory only
- Current status → Live Jira only

Verified in `memory-latest-standup-queries.spec.ts`.

---

## 11. Backfill / Rebuild

**Not required for correctness.** Existing BLOCKER chunk matches via `sourceId ∈ scopedSourceIds` even without `metadata.runId`.

Optional: re-enqueue BLOCKER outbox events to enrich metadata on existing chunks (idempotent Phase 2 rebuild). Not executed in this fix to avoid unnecessary churn — 100% embedding coverage maintained.

---

## 12. Before / After Retrieval Evidence

### Before

| Query | Result |
|-------|--------|
| What blocker did Karam report in the latest standup? | "No blockers" / "None. Everything is on schedule." (old run) |
| What did Karam say in the latest standup? | Older standup collection content |

### After (RAG pipeline merged hits)

| Query | Evidence |
|-------|----------|
| Latest standup summary | 5 scoped hits from run `f272e32d-…`; no "on schedule" text |
| Latest blocker | Blocker chunk + Q3 answer; includes "slack and jira" + "emdings" |
| Latest Q2 | SCRUM-4 working-on answer |
| Historical (no latest) | 24 unscoped hits — history preserved |

Diagnostics now include: `temporalIntent`, `resolvedUserId`, `resolvedRunId`, `resolvedSubmissionId`, `scopedSourceCount`, `legacyFilteredOut`, `v2FilteredOut`.

---

## 13. Tests

| Script | Purpose |
|--------|---------|
| `npm run test:temporal-retrieval` | Intent detection + document scope matching |
| `npm run test:memory-latest-standup` | Resolver + scoped V2 retrieval vs unscoped control |
| `npm run test:memory-latest-standup-queries` | Full RAG pipeline — 8 query scenarios |

Coverage includes:

- Latest standup resolves newest **completed submission**
- User-specific latest scope
- Older semantic chunk excluded from latest scope
- Latest blocker YES beats historical NO
- Historical query without "latest" searches history
- Latest + Jira issue key composite
- HYBRID legacy cannot inject contradictory older evidence (when temporalScoped)
- No hardcoded user/run/check-in IDs in production code (IDs only in integration tests against real DB)

---

## 14. Risks

| Risk | Mitigation |
|------|------------|
| Run completes before all submissions | Submission-based resolution handles partial collection |
| BLOCKER metadata missing runId on old chunks | `scopedSourceIds` OR filter; optional re-ingest |
| Multiple users named similarly | Ambiguity guard — no guess |
| `"latest"` false positives on non-standup phrases | Regex patterns limited to standup/check-in vocabulary |
| Re-ingest not run for old BLOCKER chunks | Metadata enrichment applies on next natural outbox event |

---

## Files Modified

| File | Change |
|------|--------|
| `src/ai/workspace/retrieval/temporal-retrieval.util.ts` | **NEW** — intent + scope matching |
| `src/ai/workspace/retrieval/latest-standup-resolver.service.ts` | **NEW** — submission-based latest resolution |
| `src/ai/workspace/retrieval/temporal-retrieval.util.spec.ts` | **NEW** — unit tests |
| `src/ai/workspace/intent/intent-detection.service.ts` | Detect LATEST_STANDUP |
| `src/ai/workspace/types/workspace-ai.types.ts` | Temporal filter + diagnostics types |
| `src/ai/workspace/rag/rag-pipeline.service.ts` | Resolve scope, filter, diagnostics |
| `src/ai/workspace/retrieval/workspace-retrieval.service.ts` | Post-snapshot temporal filter |
| `src/ai/workspace/knowledge/workspace-knowledge.service.ts` | Legacy collector scoping + user resolution |
| `src/memory/memory-retrieval.types.ts` | runId, ownerUserId, scopedSourceIds |
| `src/memory/memory-retrieval.service.ts` | Pass temporal params to search |
| `src/memory/memory-fulltext-search.service.ts` | SQL temporal filters |
| `src/memory/memory-vector-search.service.ts` | SQL temporal filters |
| `src/memory/memory-evidence-merge.service.ts` | temporalScoped HYBRID guard |
| `src/memory/memory-evidence.adapter.ts` | Timestamps + provenance in doc metadata |
| `src/memory/memory-source.loader.ts` | BLOCKER + resolution provenance |
| `src/memory/memory-latest-standup.spec.ts` | **NEW** — integration test |
| `src/memory/memory-latest-standup-queries.spec.ts` | **NEW** — RAG query test |
| `src/ai/ai.module.ts` | Register LatestStandupResolverService |
| `scripts/diagnose-latest-standup-memory.js` | **NEW** — read-only DB diagnostic |
| `scripts/memory-coverage-stats.js` | **NEW** — coverage helper |
| `package.json` | Test scripts |

**Schema changed:** NO (this fix)  
**Migration:** None

---

## Memory Coverage After Fix

Pules workspace (`0e4985cc-…`):

| Metric | Count |
|--------|-------|
| Total chunks | 380 |
| Indexed | 380 (100%) |
| With embedding JSON | 380 |
| With embedding_vec | 380 |
| Failed outbox | 0 |
