# Coverage-Driven Roadmap (August 31, 2026)

**Project baseline:** 8.38% statements · 8.02% lines · 3.88% branches · 5.53% functions  
**Source:** `npm run test:coverage` on `karam-final1`

---

## Top 0% services by uncovered statement count

| Rank | Service | Stmts | Lines | Branches | Unit spec? |
|------|---------|------:|------:|---------:|:----------:|
| 1 | `collection.service.ts` | 575 | 540 | 823 | No |
| 2 | `admin.service.ts` | 575 | 540 | 823 | No |
| 3 | `check-in.service.ts` | ~500+ | 1769 | — | No |
| … | *(large services)* | | | | |
| **Selected** | **`jira-standup-hook.service.ts`** | **72** | **69** | **61** | **No** |

**Why `JiraStandupHookService` for this iteration:** Strict priority #1 (0% service), completable to 100% in one pass, +72 statements of real gain vs attempting 500+ statement services.

---

## Next queue (after approval)

1. `pgvector-support.service.ts` — 11% partial → 100%
2. `memory-fulltext-search.service.ts` — 10% partial → 100%
3. `memory-evidence-merge.service.ts` — 6% partial → 100%
4. Controllers (17 at 0%)

---

## Skipped for now

- `*.module.ts`, `main.ts`, config files
- Empty stubs: `notifications.service.ts`, `users.service.ts`
