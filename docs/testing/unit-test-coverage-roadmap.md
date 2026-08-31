# Coverage-Driven Roadmap (Gain-Score Strategy)

**Updated:** August 31, 2026  
**Formula:** `Coverage Gain Score = uncovered statements + uncovered branches`

## Priority tiers

1. Largest **0%** services (highest gain score first)
2. Largest services **below 50%**
3. Controllers with significant business logic
4. Medium services
5. Small helpers
6. Tiny utilities/exports last

## Current project baseline

| Metric | Coverage |
|--------|----------|
| Statements | 10.21% |
| Branches | 5.09% |
| Functions | 7.19% |
| Lines | 9.89% |

## Top 10 services by gain score (untested / partial)

| Rank | Service | Score | Stmts % | Status |
|------|---------|------:|--------:|--------|
| 1 | `workspace-knowledge.service.ts` | 2199 | 2.79% | **Next after admin** |
| 2 | **`admin.service.ts`** | **1398** | **0%** | **IN PROGRESS** |
| 3 | `jira.service.ts` | 1238 | 2.37% | Queued |
| 4 | `check-in.service.ts` | 1093 | 0% | Queued |
| 5 | `workspace-retrieval.service.ts` | 1062 | 2.93% | Queued |
| 6 | `collection.service.ts` | 942 | 0% | Queued |
| 7 | `check-in-report.service.ts` | 768 | 0% | Queued |
| 8 | `jira-hub.service.ts` | 721 | 0% | Queued |
| 9 | `slack.service.ts` | 698 | 0% | Queued |
| 10 | `vacation-catchup.service.ts` | 686 | 0% | Queued |

## Completed (27 suites)

PgVectorSupport, MemoryFullTextSearch, MemoryEvidenceMerge, JiraStandupHook, JiraMemberCache, MemoryRetrieval, and 21 prior services — all at or near 100% file coverage.

## Skipped

- `*.module.ts`, config files, empty stubs, pure re-exports
