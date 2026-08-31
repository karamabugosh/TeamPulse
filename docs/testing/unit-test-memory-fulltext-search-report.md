# Unit Test Report — MemoryFullTextSearchService

**Date:** August 31, 2026  
**Branch:** `karam-final1`  
**Spec:** `backend/src/memory/memory-fulltext-search.service.unit.spec.ts`

## Purpose

PostgreSQL full-text search over `MemoryChunk.text` with ACL filtering in SQL, issue-key boosting, temporal scoping, and post-query ACL defense.

## Dependencies

| Dependency | Role |
|------------|------|
| `PrismaService` | `$queryRawUnsafe` FTS query |
| `MemoryAclService` | `buildAclSql`, `isChunkAuthorized` |

## Mock Strategy

- Mock Prisma raw query and ACL helpers; never hit real DB.
- Verify SQL fragments and bound parameter values via mock call inspection.
- Spy logger for query failure paths.

## Test Cases (19)

- Early return: user not in workspace, blank/undefined query
- Success mapping: candidates, ranks, metadata, lexicalScore defaults
- ACL defense: unauthorized row exclusion + malformed count
- Limit clamping and default from config
- Filters: sourceTypes, issue keys, linkedIssueKey param, ownerUserId, runId, scopedSourceIds (combined and individual)
- ACL SQL integration (startIndex 3)
- Query failure: Error and non-Error rethrow

## Coverage

| Metric | Before | After |
|--------|--------|-------|
| Statements | 10.44% | **100%** |
| Branches | 0% | **100%** |
| Functions | 0% | **100%** |
| Lines | 7.81% | **100%** |

**Project impact (with pgvector):** 8.84% → **9.57%** statements

## Lessons Learned

1. Temporal filter has four mutually exclusive branches — each needs isolated SQL assertion.
2. Issue keys dedupe via `Set` from query text + optional `linkedIssueKey` param.
3. Post-query ACL re-filter renumbers `lexicalRank` after exclusions.
