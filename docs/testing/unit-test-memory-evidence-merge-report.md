# Unit Test Report — MemoryEvidenceMergeService

**Date:** August 31, 2026  
**Branch:** `karam-final1`  
**Spec:** `backend/src/memory/memory-evidence-merge.service.unit.spec.ts`

## Purpose

Authority-aware merge of Live Jira, V2 memory, and legacy RAG documents with deduplication, sorting, diversity caps, budget limits, and Live Jira preservation.

## Dependencies

None injected — pure merge logic using `MEMORY_ASK_CONTEXT_BUDGET` and adapter helpers.

## Mock Strategy

- Mock `memory-ask.config` with small budgets (`maxDocuments: 3`, `maxV2Documents: 2`, `maxPerSourceId: 1`) for deterministic assertions.
- `makeDoc()` factory builds typed `KnowledgeDocument` fixtures.

## Test Cases (20)

- Legacy-only path when V2 inactive
- Jira authority tagging and banner preservation
- V2_PRIMARY / HYBRID dedupe and temporal scoping
- Authority sort, diversity deferral, budget truncation
- Live Jira reinsertion with splice when over budget
- V2 cap, entity-type dedupe (blocker, report, team_memory, blocker_update)
- Counts: v2Count, liveJiraCount, legacyCount, droppedLegacyDuplicates, droppedByBudget

## Coverage

| Metric | Before | After |
|--------|--------|-------|
| Statements | 6.12% | **100%** |
| Branches | 0% | **89.85%** |
| Functions | 0% | **100%** |
| Lines | 4.54% | **100%** |

Remaining branches are defensive nullish arms in metadata spread and score fallback (lines 43, 118, 197-205).

**Project impact (all 3 services):** 8.84% → **10.21%** statements

## Lessons Learned

1. Live Jira guarantee loop requires duplicate source identity + full budget to trigger splice path.
2. `MemoryRetrievalPlan` needs full typed fields — not a partial stub.
3. HYBRID temporal scoping drops legacy docs not present in V2 identity set.
