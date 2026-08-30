# Pulse V2 Phase 2A — Transactional Memory Ingestion / Outbox Writers

**Date:** 2026-08-21  
**Depends on:** Phase 1 (`MemoryChunk`, `MemoryOutboxEvent`, enums)  
**Status:** Complete — outbox writers only (no worker / chunks / embeddings / RAG)

---

## 1. Summary

Phase 2A wires **write-side** `MemoryOutboxEvent` creation when supported source-of-truth records change. Events are `PENDING` / `UPSERT` or `DELETE` and are **not processed**.

Supported sources:

| sourceType | Trigger |
|------------|---------|
| `STANDUP_ANSWER` | Eligible `Answer` upsert in `CollectionService.submitAnswer` |
| `BLOCKER` | `PulseBlocker` create; non-resolution follow-ups; Jira link update on blocker |
| `BLOCKER_RESOLUTION` | Follow-up choice `resolved` → uses `PulseBlockerUpdate.id` |
| `REPORT` | Eligible `AiDigest` upsert (`AiService.saveDigest`, `CheckInReportService.persistReportForRun`) |

Deletes enqueue `DELETE` for answers/reports when a check-in or run is deleted.

---

## 2. Files Changed

### Created

| Path |
|------|
| `backend/src/memory/memory.module.ts` |
| `backend/src/memory/memory-outbox.service.ts` |
| `backend/src/memory/memory-source.constants.ts` |
| `backend/src/memory/memory-ingestion.policy.ts` |
| `backend/src/memory/memory-phase2a.spec.ts` |
| `docs/PULSE_V2_PHASE2A_TRANSACTIONAL_INGESTION.md` |

### Modified

| Path | Why |
|------|-----|
| `backend/src/app.module.ts` | Import global `MemoryModule` |
| `backend/src/collection/collection.service.ts` | Answer outbox in submit transaction |
| `backend/src/jira/jira-blocker.service.ts` | Blocker create transactional outbox |
| `backend/src/jira/blocker-follow-up.service.ts` | Resolution vs update outbox |
| `backend/src/jira/jira-action.service.ts` | Blocker link update outbox |
| `backend/src/ai/ai.service.ts` | Digest save transactional REPORT outbox |
| `backend/src/check-in/check-in-report.service.ts` | Canonical report transactional REPORT outbox |
| `backend/src/check-in/check-in.service.ts` | DELETE outbox on check-in/run delete |
| `backend/src/ai/evaluation/run-evaluation.ts` | Constructor wiring for `MemoryOutboxService` |
| `backend/package.json` | `test:memory-phase2a` script |

---

## 3. Supported Memory Sources

Constants in `memory-source.constants.ts`:

- `STANDUP_ANSWER`
- `BLOCKER`
- `BLOCKER_RESOLUTION`
- `REPORT`

**Not supported (Phase 2A):** `AI_CONVERSATION`, arbitrary Slack messages, Live/cache Jira field refreshes as memory sources.

**Answer eligibility:** all `QuestionType` except `ISSUE_REF` (`memory-ingestion.policy.ts`). ISSUE_REF is structured Jira identity; links remain on `AnswerJiraIssueLink` for a future worker.

**Digest eligibility:** skip `source === 'failed'`; require useful summary (or `ai` / `rules_fallback` sources with content policy).

---

## 4. MemoryOutboxService

**File:** `backend/src/memory/memory-outbox.service.ts`  
**Module:** global `MemoryModule` (avoids circular Nest imports)

### API

```ts
enqueueUpsert({ workspaceId, sourceType, sourceId, tx? })
enqueueDelete({ workspaceId, sourceType, sourceId, tx? })
```

### Responsibility

- Create `MemoryOutboxEvent` with:
  - `operation` UPSERT or DELETE
  - `status` PENDING
  - `attempts` 0
  - `availableAt` now
- Accept optional Prisma **transaction client** (`tx`) so callers stay atomic
- **Never** process events, write `MemoryChunk`, call OpenAI, or touch RAG

---

## 5. Standup Answer Flow

```
Slack / CollectionController
→ CollectionService.submitAnswer
→ validateAnswerForQuestion (+ optional ISSUE_REF enrich)
→ prisma.$transaction(tx)
     → tx.answer.upsert(...)
     → if isMemoryEligibleAnswerType(question.type)
          MemoryOutboxService.enqueueUpsert({
            tx,
            workspaceId: user.workspaceId,
            sourceType: STANDUP_ANSWER,
            sourceId: savedAnswer.id,
          })
     → conversation pointer updates
→ COMMIT
→ (outside tx) AnswerJiraLinkService.attachPendingLinksToAnswer  // unchanged; no Jira fields copied into outbox
```

---

## 6. Blocker Flow

```
JiraBlockerService.createFromAnswer
→ resolve user.workspaceId
→ prisma.$transaction(tx)
     → tx.pulseBlocker.create(...)
     → tx.pulseBlockerUpdate.create(open audit)
     → enqueueUpsert BLOCKER (sourceId = blocker.id)
→ COMMIT
→ emit WORKSPACE_KNOWLEDGE_CHANGED (legacy embedding reindex; unchanged)
```

Non-resolution follow-up (`working` / `blocked`):

```
BlockerFollowUpService.applyFollowUp
→ $transaction
     → pulseBlocker.update
     → pulseBlockerUpdate.create
     → enqueueUpsert BLOCKER (blocker.id)
```

Jira issue created and linked:

```
JiraActionService.executeApprovedAction
→ (Jira API outside DB txn — gap)
→ $transaction
     → pulseBlocker.update(linkedIssue*)
     → enqueueUpsert BLOCKER
```

---

## 7. Blocker Resolution Flow

**Design choice:** `PulseBlockerUpdate` is the durable resolution **event** (notes, previous→new status). `PulseBlocker` also stores current `resolutionNotes` / `resolvedAt`.

```
choice === 'resolved'
→ $transaction
     → pulseBlocker.update(status=resolved, resolutionNotes, …)
     → pulseBlockerUpdate.create(...)
     → enqueueUpsert BLOCKER_RESOLUTION (sourceId = PulseBlockerUpdate.id)
```

Ordinary non-resolution edits do **not** create `BLOCKER_RESOLUTION`.

---

## 8. Report / AiDigest Flow

### AiService.saveDigest

```
resolve Team.workspaceId (required)
→ $transaction
     → aiDigest.upsert
     → if isMemoryEligibleDigest → enqueueUpsert REPORT (digest.id)
→ emit WORKSPACE_KNOWLEDGE_CHANGED
```

Persistence failures still swallow errors so the AI result can return to the caller (pre-existing behavior). When the transaction is used, outbox failure rolls back the digest write **inside that transaction**.

### CheckInReportService.persistReportForRun

Same pattern: upsert + eligible REPORT outbox in one transaction; workspace via `Team.workspaceId`.

### persistFailedReport

**No** outbox enqueue.

---

## 9. Transaction Boundaries

| Source path | Boundary |
|-------------|----------|
| Answer submit | `BEGIN` → answer upsert → outbox → conversation updates → `COMMIT` |
| Blocker create | `BEGIN` → blocker + audit update + outbox → `COMMIT` |
| Blocker follow-up | `BEGIN` → blocker update + PulseBlockerUpdate + outbox → `COMMIT` |
| Blocker Jira link | After external Jira API: `BEGIN` → blocker update + outbox → `COMMIT` |
| AiDigest (AiService) | `BEGIN` → upsert + outbox → `COMMIT` |
| AiDigest (canonical report) | `BEGIN` → upsert + outbox → `COMMIT` |
| Check-in / run delete | `BEGIN` → enqueue DELETE(s) → deleteMany → `COMMIT` |

### Non-transactional / partial gaps

1. **Jira API then blocker link** — Atlassian call cannot share a Postgres transaction. DB update + outbox are transactional with each other; if the process crashes after Jira create but before DB update, no outbox (same as pre-existing missing link state).
2. **AnswerJiraLink attach** — still after answer commit (pre-existing). Outbox for STANDUP_ANSWER is inside the answer transaction; link indexing remains Phase 2B concern via AnswerJiraIssueLink / future JIRA_LINK if added.
3. **Demo seed / demo-workspace-builder** — not wired (no backfill / seed ingestion in Phase 2A).
4. **AiService.saveDigest outer try/catch** — if team lookup fails before txn, digest is not saved (throws into catch). Inside txn, outbox failure rolls back digest.

---

## 10. Workspace Resolution

| Source | workspaceId from |
|--------|------------------|
| STANDUP_ANSWER | `User.workspaceId` of answering user |
| BLOCKER | `User.workspaceId` at create; `PulseBlocker.workspaceId` on follow-up/link |
| BLOCKER_RESOLUTION | `PulseBlocker.workspaceId` |
| REPORT | `Team.workspaceId` via `AiDigest.teamId` |
| DELETE (answers/reports) | `CheckIn.team.workspaceId` or `StandupRun.team.workspaceId` |

Never uses earliest-workspace fallback, Demo hardcoding, or Jira connection reuse for outbox tenant id.

---

## 11. Duplicate / Re-index Behavior

Multiple PENDING UPSERT rows for the same `(sourceType, sourceId)` are **allowed** (Phase 1 design). No coalescing. Phase 2B worker must rebuild idempotently.

---

## 12. Delete Behavior

| Application delete | Outbox |
|--------------------|--------|
| `CheckInService.remove` / `deleteCheckInWithRuns` | DELETE for eligible answers + REPORT digests in same txn before row deletes |
| `CheckInService.deleteRun` | Same for that run |

No invented delete APIs. Blocker hard-delete path was not found as a first-class user flow beyond demo rebuild — not wired.

---

## 13. Failure Behavior

- Where transactional: source write + outbox succeed or fail together → no silent “source saved, memory request lost” for those paths.
- No OpenAI / embedding / chunking in these transactions → AI outages cannot break standup answer / blocker create via Phase 2A.
- Outbox service throws if `workspaceId` or `sourceId` missing.

---

## 14. Tests

`npm run test:memory-phase2a` (`src/memory/memory-phase2a.spec.ts`):

- Policy: ISSUE_REF excluded; resolution vs working/blocked; failed digest excluded
- Outbox PENDING UPSERT for STANDUP_ANSWER / BLOCKER / BLOCKER_RESOLUTION / REPORT
- Cross-workspace isolation (Pules project vs TeamPulse)
- Duplicate UPSERT allowed
- Forced txn failure → outbox rolled back
- Prohibited source constants absent

---

## 15. Legacy Regression Verification

| Suite | Result |
|-------|--------|
| `npm run test:memory-phase2a` | Pass |
| `npm run test:ai-retrieval` | Pass (Jira fields-only, multi-source, members, blockers, vacation, depth) |
| `npx tsc --noEmit` | Pass |

RAG / Jira live authority / retrieval services were **not** modified for behavior.

---

## 16. Gaps / Risks

- Demo seed does not enqueue outbox (intentional — no backfill).
- ISSUE_REF answers skipped; narrative memory depends on FREE_TEXT and other types + future worker reading links.
- `JiraActionService` Jira→DB gap (external system).
- `AiService.saveDigest` still catches persistence errors so callers get AI result even if DB fails (pre-existing product choice).
- Nest backend may need restart after deploy so new DI providers load.

---

## 17. What Was Intentionally NOT Implemented

- No memory worker
- No chunk generation
- No embedding generation
- No `MemoryChunk` writes
- No new RAG retrieval
- No ACL enforcement
- No production backfill
- No AI conversation ingestion
- No arbitrary Slack message ingestion
- No legacy `TeamMemoryDocument` / `KnowledgeEmbedding` removal
- No changes to Live Jira field authority

---

## 18. Exact Phase 2B Input Contract

Phase 2B worker can poll `MemoryOutboxEvent` rows with:

| Field | Meaning |
|-------|---------|
| `id` | Event id (claim key) |
| `workspaceId` | Tenant |
| `sourceType` | `STANDUP_ANSWER` \| `BLOCKER` \| `BLOCKER_RESOLUTION` \| `REPORT` |
| `sourceId` | Original record id (`Answer.id`, `PulseBlocker.id`, `PulseBlockerUpdate.id`, `AiDigest.id`) |
| `operation` | `UPSERT` \| `DELETE` |
| `status` | Start from `PENDING` → claim `PROCESSING` |
| `attempts` | Retry counter |
| `availableAt` | Eligible claim time |
| `lockedAt` / `processedAt` / `lastError` | Claim / completion / failure |
| `createdAt` / `updatedAt` | Audit |

Worker must:

1. Load source by `sourceType` + `sourceId` within `workspaceId`
2. For UPSERT: rebuild all `MemoryChunk` for that source (multi-chunk)
3. For DELETE: delete all `MemoryChunk` where `(workspaceId, sourceType, sourceId)`
4. Mark event COMPLETED / FAILED with retry via `availableAt`

**Do not implement Phase 2B in this change set.**
