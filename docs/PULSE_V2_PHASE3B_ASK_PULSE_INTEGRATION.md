# Pulse V2 Phase 3B — Controlled Ask Pulse Integration + Narrative Memory Routing

**Date:** 2026-08-21  
**Depends on:** Phase 1–3A  
**Status:** Complete — controlled integration; default still legacy  
**Schema / migration:** NO  
**Default mode:** `LEGACY_ONLY`

---

## 1. Summary

Phase 3B wires `MemoryRetrievalService` into Ask Pulse behind an explicit retrieval policy and rollout flag `MEMORY_V2_ASK_MODE`.

- Pure current Jira field questions → Live Jira only; V2 never called  
- Historical/narrative → V2 eligible when mode allows  
- Composite → Live Jira + V2 historical  
- Authority classes prevent Memory from overwriting current Jira fields  

Legacy collectors / `TeamMemoryDocument` / `KnowledgeEmbedding` remain.

---

## 2. Files Created

| Path |
|------|
| `backend/src/memory/memory-ask.config.ts` |
| `backend/src/memory/memory-retrieval-policy.ts` |
| `backend/src/memory/memory-evidence.adapter.ts` |
| `backend/src/memory/memory-evidence-merge.service.ts` |
| `backend/src/memory/memory-phase3b.spec.ts` |
| `docs/PULSE_V2_PHASE3B_ASK_PULSE_INTEGRATION.md` |

## 3. Files Modified

| Path | Change |
|------|--------|
| `backend/src/ai/workspace/rag/rag-pipeline.service.ts` | Policy + V2 retrieve + authority merge |
| `backend/src/ai/workspace/prompts/workspace-prompt.builder.ts` | Authority rules + composite guidance |
| `backend/src/ai/workspace/context/context-builder.service.ts` | Historical section labels |
| `backend/src/ai/workspace/types/workspace-ai.types.ts` | `userId` on ask request; `v2Memory` diagnostics |
| `backend/src/memory/memory.module.ts` | Export merge service |
| `backend/package.json` | `test:memory-phase3b` |

---

## 4. Architecture Before Phase 3B

```
Ask → Intent → selectRelevantSources → WorkspaceRetrievalService
→ ContextBuilder → Prompt → OpenAI
```

Jira field questions already used `jiraFieldsOnly` → `['jira']`.

## 5. Architecture After Phase 3B

```
Ask → Intent → buildMemoryRetrievalPlan(MEMORY_V2_ASK_MODE)
→ Legacy WorkspaceRetrievalService (unchanged collectors)
→ optional MemoryRetrievalService (ACL inside Phase 3A)
→ MemoryEvidenceMergeService (authority-aware)
→ ContextBuilder → Prompt (authority rules) → OpenAI
```

---

## 6. Retrieval Policy

`buildMemoryRetrievalPlan()` returns:

- `mode`, `category`
- `useLiveJira`, `jiraFieldsOnly`
- `useV2Memory`, `v2AffectsAnswer`
- `useLegacyRetrieval`
- `reason[]`

Categories: `CURRENT_JIRA_FIELD` | `HISTORICAL_NARRATIVE` | `COMPOSITE_JIRA_MEMORY` | `OTHER`

---

## 7. Intent Routing

Reuses `IntentDetectionService` + `shouldUseJiraFieldsOnly` / narrative signals.

| Category | Behavior |
|----------|----------|
| CURRENT_JIRA_FIELD | `jiraFieldsOnly`; V2 off |
| HISTORICAL_NARRATIVE | V2 per mode |
| COMPOSITE_JIRA_MEMORY | V2 + Live Jira |
| OTHER (members/reports/vacation) | existing paths; V2 off |

---

## 8. Rollout Modes

| Mode | V2 invoked | V2 in answer | Notes |
|------|------------|--------------|-------|
| LEGACY_ONLY | No | No | Default |
| V2_SHADOW | Yes (narrative) | No | Diagnostics only; errors never fail Ask |
| HYBRID | Yes | Yes | Merge legacy + V2 |
| V2_PRIMARY | Yes | Yes | Prefer V2 for overlapping identities; keep Live Jira |

Set via `MEMORY_V2_ASK_MODE` only (not client-controlled).

---

## 9. Live Jira Authority

Unchanged: field questions → `selectedSources=['jira']` + Live path.  
Documents tagged `LIVE_JIRA_CURRENT`. Prompt forbids memory overwrite.

## 10. Team Memory Authority

V2 evidence tagged `TEAM_MEMORY_HISTORICAL`. Historical context only.

## 11. Composite Questions

Detected when narrative + current-field signals (e.g. “why … and status now”).  
Both Live Jira and V2 (when mode allows) contribute; prompt separates past vs now.

## 12. Evidence Adapter

`adaptMemoryEvidenceToDocuments` → `KnowledgeDocument` with:

- `metadata.v2MemoryChunkId`, `memorySourceType`, `memorySourceId`, `memoryChunkIndex`
- User-facing title like `Blocker …` (not MemoryChunk UUID)

## 13. Authority Matrix

| Fact | Authority |
|------|-----------|
| Current status/assignee/priority/reporter/summary | LIVE_JIRA_CURRENT |
| Historical blocker/standup/resolution/report | TEAM_MEMORY_HISTORICAL |
| Legacy collectors | LEGACY_SUPPORTING |
| OpenAI | Never source of truth |

## 14. Evidence Merge

`MemoryEvidenceMergeService`: authority sort, identity dedupe, diversity, budget; Live Jira never dropped by budget.

## 15. Deduplication

Canonical `sourceType:sourceId`. V2 preferred over legacy copy of same original source (HYBRID/V2_PRIMARY).

## 16. Context Builder

Existing sections; historical labels clarify TEAM_MEMORY_HISTORICAL.

## 17. Context Budget

Defaults: max 24 docs, max 10 V2, max 3 per source identity (`MEMORY_ASK_*` env).

## 18. Prompt Rules

Rules 15–20: LIVE vs HISTORICAL, temporal conflict, no MemoryChunk-as-truth.

## 19. OpenAI Boundary

Backend retrieves/filters/builds context; OpenAI receives text only. No DB/Jira credentials to the model.

## 20. Citations

Internal: chunkId. User-facing: Standup/Blocker/Resolution/Report + sourceId.

## 21–24. ACL Isolation

Phase 3A ACL remains in SQL before ranking. Tests verify final ContextBuilder text has no cross-workspace / private / malformed leakage.

## 25. Failure / Fallback

- V2_SHADOW error → ignored; legacy answer unchanged  
- HYBRID / V2_PRIMARY error → legacy continues  
- Missing `userId` → V2 skipped (fail closed)

## 26. Shadow Metrics

`diagnostics.v2Memory`: mode, category, invoked, evidenceCount, vectorBackend, durationMs, error, reason (no private text).

## 27. pgvector Limitation

Still unavailable locally → `json_acl_bounded`. Do not raise 2000 scan cap. Production V2_PRIMARY should validate pgvector.

## 28. Tests

`npm run test:memory-phase3b` — policy, modes, authority, merge/budget, citations, prompt, ACL→context, malformed, shadow, V2_PRIMARY fallback.

## 29. Regression Results

See validation run (Phase 2/3A + `test:ai-retrieval` + `tsc`).

## 30. Risks

- Without trusted `userId`, V2 stays off  
- Default LEGACY_ONLY means no production behavior change until ops sets mode  
- JSON vector backend remains interim  

## 31. What Was Intentionally NOT Implemented

- No legacy retrieval removal  
- No TeamMemoryDocument / KnowledgeEmbedding removal  
- No Slack / AI conversation / Jira cache ingestion  
- No Jira authority change  
- No DB migration  
- No Phase 3C cutover/cleanup  

## 32. Production Rollout Recommendation

0. LEGACY_ONLY (current default)  
1. V2_SHADOW + metrics  
2. HYBRID for narrative traffic  
3. V2_PRIMARY after quality/security gates + pgvector readiness  
4. Legacy retirement only later (Phase 3C+)  

## 33. Exact Phase 3C Recommendation

**Do not implement now.** Likely: production cutover validation, shadow quality gates, optional collector deprecation plan, pgvector hard requirement for V2_PRIMARY at scale.
