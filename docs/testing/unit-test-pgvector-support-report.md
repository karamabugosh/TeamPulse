# Unit Test Report — PgVectorSupportService

**Date:** August 31, 2026  
**Branch:** `karam-final1`  
**Spec:** `backend/src/ai/workspace/retrieval/pgvector-support.service.unit.spec.ts`

## Purpose

Detects pgvector availability at startup, ensures native `embedding_vec` column/index, syncs vectors after JSON upserts, and runs ANN cosine search with JSON fallback.

## Dependencies

| Dependency | Role |
|------------|------|
| `PrismaService` | Raw SQL via `$queryRawUnsafe` / `$executeRawUnsafe` |

## Mock Strategy

- Mock `PrismaService` raw query methods only.
- Spy on private `logger` for warn/log assertions.
- Call `detect()` directly to set backend state (no real Postgres).

## Test Cases (25)

- `toVectorLiteral`: finite, non-finite, empty
- `onModuleInit`: delegates to detect
- `detect`: installed extension, CREATE EXTENSION, failures (Error/non-Error), HNSW/IVFFlat index paths
- `syncNativeVector`: json no-op, empty vector, success, sync failure paths
- `searchAnn`: json/empty early return, similarity mapping, minSimilarity, limit clamping, query failure paths
- `isPgVectorAvailable` / `getBackend`: covered via detect flows

## Exception Cases

All catch blocks tested with both `Error` and non-Error throws; service never propagates failures.

## Coverage

| Metric | Before | After |
|--------|--------|-------|
| Statements | 11.47% | **100%** |
| Branches | 0% | **100%** |
| Functions | 0% | **100%** |
| Lines | 8.77% | **100%** |

**Project impact:** 8.84% → **9.18%** statements (+0.34 pp)

## Lessons Learned

1. `ensureNativeColumn` is private — exercise via `detect()` with sequential `$executeRawUnsafe` mock rejections.
2. HNSW failure triggers IVFFlat fallback in nested try/catch; both must be mocked independently.
3. `searchAnn` fetch limit is `min(limit * 3, 200)` after clamping limit to `[1, 100]`.
