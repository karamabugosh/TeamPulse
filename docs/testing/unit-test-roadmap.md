# Backend Unit Test Roadmap

**Generated:** August 31, 2026  
**Branch:** `karam-final1`  
**Goal:** Maximize real Jest coverage toward 100% statements/branches/functions/lines project-wide.

---

## Current state

| Metric | Value |
|--------|-------|
| `*.unit.spec.ts` suites | **21** |
| Services with unit specs | **21 / 72** |
| Services remaining | **51** (2 empty stubs skipped) |
| Controllers without unit specs | **17** |
| Guards / interceptors / pipes | **0** in `src/` |

---

## Priority 1 — Services (smallest → largest)

| # | Service | Lines | Status |
|---|---------|------:|--------|
| 1 | `memory/memory-retrieval.service.ts` | 163 | **Next** |
| 2 | `jira/jira-member-cache.service.ts` | 163 | Pending |
| 3 | `ai/workspace/retrieval/pgvector-support.service.ts` | 182 | Pending |
| 4 | `memory/memory-fulltext-search.service.ts` | 182 | Pending |
| 5 | `jira/jira-standup-hook.service.ts` | 193 | Pending |
| 6 | `memory/memory-evidence-merge.service.ts` | 202 | Pending |
| 7 | `jira/jira-issue-picker.service.ts` | 209 | Pending |
| 8 | `jira/team-memory.service.ts` | 222 | Pending |
| 9 | `ai/workspace/memory/conversation-history.service.ts` | 224 | Pending |
| 10 | `demo/demo-workspace-generator.service.ts` | 228 | Pending |
| … | *(42 more services)* | 234–3044 | Pending |

**Skipped (empty files):** `notifications.service.ts`, `users.service.ts`

**Completed services (21):** Digest, MemoryChunker, Questions, Team, TimelineBuilder, WorkspaceSearch, JiraAudit, Auth, MemoryOutbox, ResponseRenderer, WorkspaceAi, LatestStandupResolver, AnalysisOrchestrator, MemoryHybridRanking, JiraIssueRef, MemoryEmbedding, EmbeddingReindex, MemoryAcl, Prisma, AiEvalDataset, AiEvalExport

---

## Priority 2 — Controllers (17)

`auth`, `questions`, `team`, `digest`, `reports`, `collection`, `check-in`, `scheduler`, `admin`, `ai`, `demo`, `jira` (+ hub/api/blocker), `workspace-ai`, `ai-eval`

---

## Priority 3 — Guards / Interceptors / Pipes

None detected under `src/` at scan time.

---

## Priority 4 — Helpers / Utils / Validators

Ad-hoc `*.spec.ts` (ts-node scripts) exist under `src/**` — separate from Jest `*.unit.spec.ts` discovery. Will inventory after service + controller phases.

---

## Per-file workflow

1. Analyze public API + dependencies  
2. Write `*.unit.spec.ts` with full mocking  
3. `npm run build` → `npm test` → `npm run test:coverage`  
4. Reach 100% on target file or document unreachable lines  
5. Report → commit → push → wait for Backend CI green  
6. Next file

---

## Notes

- Project-wide coverage summary requires full `npm run test:coverage` (not scoped runs).  
- Production code changes require explicit approval.  
- Empty service stubs have no testable logic.
