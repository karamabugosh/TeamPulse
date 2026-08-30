# Unit Test Report — MemoryRetrievalService

**Date:** August 31, 2026  
**File:** `src/memory/memory-retrieval.service.ts`  
**Suite:** `src/memory/memory-retrieval.service.unit.spec.ts`  
**Branch:** `karam-final1`

---

## Responsibilities

Pulse V2 Phase 3A ACL-safe hybrid MemoryChunk retrieval orchestrator: resolves ACL, runs lexical + vector search in parallel, merges via RRF hybrid ranking, maps to evidence items. Optional shadow mode when `MEMORY_V2_SHADOW_ENABLED=true`.

## Dependencies (all mocked)

| Dependency | Role |
|------------|------|
| `MemoryAclService` | Workspace/user ACL |
| `MemoryFullTextSearchService` | Lexical candidates |
| `MemoryVectorSearchService` | Vector candidates |
| `MemoryHybridRankingService` | RRF merge |
| `MEMORY_RETRIEVAL_CONFIG` | Limits + shadow flag (mocked module) |

## Test cases (19)

- Early exit: blank/undefined workspaceId, userId, query
- User not in workspace (with/without debug diagnostics)
- Full retrieve path with diagnostics, limit clamp 1–50, filter forwarding
- Evidence mapping: rrfScore default, metadata null vs object
- Shadow: disabled, enabled success, Error/non-Error failure

## Coverage

| Metric | Before | After |
|--------|--------|-------|
| Statements | 0% | **100%** |
| Branches | 0% | **100%** |
| Functions | 0% | **100%** |
| Lines | 0% | **100%** |

**Uncovered lines:** none

## Production changes

None.

## Project coverage note

Full-project `npm run test:coverage` pending after this commit (prior summary was scoped to single files).

## Lessons learned

Config `shadowEnabled` is toggled by mutating the mocked `MEMORY_RETRIEVAL_CONFIG` object — avoid hoisted `let` bindings inside `jest.mock` factories.
