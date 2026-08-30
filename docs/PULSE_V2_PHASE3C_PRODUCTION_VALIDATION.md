# Pulse V2 Phase 3C — Production Validation + Shadow Evaluation + Cutover Gates

**Date:** 2026-08-21  
**Depends on:** Phase 1–3B  
**Status:** Complete — evaluation/readiness only  
**Schema / migration:** NO  
**Mode mutation:** NONE (never changes `MEMORY_V2_ASK_MODE`)  
**Default Ask mode:** still `LEGACY_ONLY`

---

## 1. Summary

Phase 3C answers: *Is V2 Team Memory safe and good enough to become the primary historical retrieval architecture?*

On the local evaluation workspace the answer is:

- **Security / Jira authority / citations / failure isolation:** PASS  
- **Retrieval quality (fixture suite):** strong (Hit@5 ≈ 1.0 on scored historical cases)  
- **Vector production readiness:** **BLOCKED** (`json_acl_bounded`, pgvector unavailable)  
- **Recommended operator mode:** `V2_SHADOW` (not V2_PRIMARY)  
- **No automatic cutover**

---

## 2. Files Created

| Path |
|------|
| `backend/src/memory/memory-eval.config.ts` |
| `backend/src/memory/memory-eval.types.ts` |
| `backend/src/memory/memory-eval.metrics.ts` |
| `backend/src/memory/memory-eval.dataset.ts` |
| `backend/src/memory/memory-v2-evaluation.service.ts` |
| `backend/src/memory/memory-v2-readiness.service.ts` |
| `backend/src/memory/memory-phase3c.spec.ts` |
| `backend/scripts/memory-evaluate.ts` |
| `backend/scripts/memory-readiness.ts` |
| `docs/PULSE_V2_PHASE3C_PRODUCTION_VALIDATION.md` |

## 3. Files Modified

| Path | Change |
|------|--------|
| `backend/src/memory/memory.module.ts` | Register evaluation + readiness services |
| `backend/package.json` | `test:memory-phase3c`, `memory:evaluate`, `memory:readiness` |

---

## 4. Validation Architecture

```
Operator CLI / tests
        ↓
seed deterministic fixtures (ACL-real)
        ↓
MemoryV2EvaluationService
  ├── policy classification
  ├── MemoryRetrievalService (Phase 3A)
  ├── evidence merge + ContextBuilder (authority)
  └── security / quality / citation checks
        ↓
MemoryV2ReadinessService
  ├── gates (PASS / WARN / BLOCKED)
  ├── coverage via Phase 2C verify
  └── recommendedMode (NO env mutation)
```

Evaluation is **separate** from production `RagPipelineService` answer generation.

---

## 5. Evaluation Dataset

Kinds: CURRENT_JIRA_FIELD, HISTORICAL_NARRATIVE, COMPOSITE, BLOCKER/RESOLUTION/REPORT/STANDUP, EXACT_ISSUE_KEY, WORKSPACE/TEAM/PRIVATE/MALFORMED ACL, NO_EVIDENCE, TEMPORAL_CONFLICT, LEGACY/V2 duplicate, MULTI_SOURCE, POISONED_AUTHORITY, FAILURE_INJECTION.

Fixtures use real `visibility` / `teamId` / `ownerUserId`. Ephemeral cleanup after each run.

---

## 6. Legacy vs V2 Comparison

Success is **not** “match legacy.” Ground truth is expected identities, ACL absence, and Live Jira authority. Legacy remains for rollback and HYBRID merge.

---

## 7. Retrieval Quality Metrics

**Formulas**

- **Hit@K** = 1 if any expected `sourceType:sourceId` appears in top-K, else 0  
- **MRR** = 1/rank of first expected identity (0 if absent)  
- **Recall@K** = |expected ∩ top-K| / |expected|

**Local fixture run (representative)**

| Metric | Value |
|--------|-------|
| Hit@1 | ~0.80 |
| Hit@3 | ~1.00 |
| Hit@5 | ~1.00 |
| MRR | ~0.87 |
| Recall@5 | ~0.95 |

Defaults: `MEMORY_EVAL_MIN_HIT5=0.7`, `MEMORY_EVAL_MIN_MRR=0.5`.

---

## 8. Source-Specific Quality

Reported per `STANDUP_ANSWER`, `BLOCKER`, `BLOCKER_RESOLUTION`, `REPORT` in readiness output (`bySourceType`). Avoids hiding weak sources behind one average.

---

## 9. Security Gates

| Gate | Result (local) |
|------|----------------|
| Workspace isolation | PASS — release blocker if fail |
| TEAM ACL | PASS |
| PRIVATE ACL | PASS |
| Malformed ACL fail-closed | PASS |

---

## 10. Jira Authority Gate

Poisoned memory (`CANCELLED` / `WRONG_MEMORY_ASSIGNEE`) must not override Live Jira fixtures. Field questions keep `useV2Memory=false`. **PASS** locally — failure is a **RELEASE BLOCKER**.

---

## 11. Temporal Conflict Tests

Historical “blocked” + current Live Jira `Done` treated as temporal separation. **PASS**.

---

## 12. Composite Question Tests

Historical evidence + Live Jira status in context; memory must not supply current status. **PASS**.

---

## 13. Citation Gate

V2 evidence retains `chunkId`, `sourceType`, `sourceId`, `chunkIndex`; user-facing labels prefer Blocker/Report/Standup/Resolution (not MemoryChunk UUID). **PASS**.

---

## 14. Memory Coverage Gate

Uses Phase 2C `verifyWorkspace`: eligible/indexed/missing/failed/inconsistent + outbox counts. Thresholds configurable (`MEMORY_EVAL_MIN_INDEXED_RATIO` default 0.5).

---

## 15. Embedding Coverage

`withEmbedding / total` vs `MEMORY_EVAL_MIN_EMBED_COVERAGE` (default 0.5). Below → WARN (or BLOCKED if critically low).

---

## 16. Vector Backend Readiness

| Status | Meaning |
|--------|---------|
| PGVECTOR_READY | Production-scale vector OK |
| BOUNDED_JSON_ONLY | Interim `json_acl_bounded` (cap 2000) |
| VECTOR_DISABLED | No vector path |

Default `MEMORY_EVAL_REQUIRE_PGVECTOR=true` → **V2_PRIMARY blocked** without pgvector. Local: **BOUNDED_JSON_ONLY / BLOCKED**.

---

## 17. Performance

Collects V2 latency samples; reports mean, p50, p95 (p95 only with ≥5 samples). Soft WARN above `MEMORY_EVAL_WARN_P95_MS` (default 3000).

---

## 18. Context Quality

Merge budget from Phase 3B; Live Jira preserved under budget. Eval reports duplicate rate + diversity score.

---

## 19. Duplicate Rate

Exact identity `sourceType:sourceId` only. V2 preferred over legacy copy in HYBRID/V2_PRIMARY merge (Phase 3B).

---

## 20. Source Diversity

Unique source types vs domination by one report’s many chunks (Phase 3A diversity + Phase 3B per-source caps).

---

## 21. Failure Injection

V2_SHADOW does not affect answer; HYBRID falls back to legacy when V2 empty/fails; rollback ladder is config-only. **PASS**.

---

## 22. Shadow Evaluation

Uses Phase 3B semantics: V2 may run; `v2AffectsAnswer=false`. Diagnostics avoid private text (counts, identities, backend, latency).

---

## 23. Rollback Strategy

```
V2_PRIMARY → HYBRID → V2_SHADOW → LEGACY_ONLY
```

Config only (`MEMORY_V2_ASK_MODE`). No schema/data rollback. V2 chunks stay for later re-enable.

---

## 24. Quality Gates

Each gate: **PASS | WARN | BLOCKED**.

Hard **BLOCKED** for V2_PRIMARY (and typically LEGACY_ONLY recommend): security leak, Jira authority fail, untraceable citations, critical regressions.

**WARN** examples: moderate Hit@5 below target, JSON vector in local, coverage soft miss, elevated latency, low PRIVATE volume.

---

## 25. Readiness Report

`MemoryV2ReadinessReport` with overall, gates, metrics, `recommendedMode`, `modeMutation: 'NONE'`.

CLIs:

```bash
npm run memory:evaluate -- --workspaceId=<uuid>
npm run memory:readiness -- --workspaceId=<uuid>
```

---

## 26. Recommended Rollout Mode

**Local / current env:** `V2_SHADOW`

Not `V2_PRIMARY_ELIGIBLE` until pgvector + coverage gates pass.

---

## 27. pgvector Production Requirement

Do **not** auto-install OS packages. Production V2_PRIMARY should require validated pgvector (or proven bounded scale with explicit waiver via `MEMORY_EVAL_REQUIRE_PGVECTOR=false` — not recommended).

---

## 28. Regression Results

See final status block (Phase 2/3A/3B + `test:ai-retrieval` + `tsc`).

---

## 29. Risks

- Fixture Hit@K ≠ live traffic quality  
- JSON vector scan cap remains interim  
- Coverage depends on Phase 2C backfill completeness  
- Ask still needs trusted `userId` for V2 ACL  

---

## 30. What Was Intentionally NOT Implemented

- No automatic `V2_PRIMARY` enablement  
- No legacy retirement / TeamMemoryDocument / KnowledgeEmbedding / collector deletion  
- No database migration / persistent eval tables  
- No Slack / AI conversation / Jira cache ingestion  
- No Jira authority change  
- No Phase 3D  

---

## 31. Exact Next Phase

**If readiness healthy (pgvector + coverage + shadow traffic):**

`PHASE 3D — CONTROLLED V2 PRIMARY ROLLOUT + LEGACY DEPRECATION PREPARATION`

(Not deletion. Not auto-enable.)

**If blocked (current local):** keep `LEGACY_ONLY` or advance only to operator-controlled `V2_SHADOW`; install/validate pgvector before V2_PRIMARY eligibility.

**Do not implement Phase 3D in this task.**
