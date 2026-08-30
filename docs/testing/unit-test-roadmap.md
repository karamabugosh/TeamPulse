# Unit Testing Roadmap

**Date:** August 30, 2026  
**Status:** Assessment only — no new tests implemented  
**Source:** `npm run test:coverage` (Jest `*.unit.spec.ts` only)

---

> **Phase 4 recommendation:** `IntentDetectionService` — largest remaining **pure-logic** surface that is both easy to unit-test and critical to RAG routing.

---

## Current project coverage

Command:

```bash
cd pulse/backend
npm run test:coverage
```

**Real Jest run:**

```
Test Suites: 3 passed, 3 total
Tests:       87 passed, 87 total
Time:        75.199 s
```

**Totals from `coverage/coverage-summary.json`:**

| Metric | Covered / Total | **%** |
|--------|----------------:|------:|
| **Statements** | 144 / 15,620 | **0.92%** |
| **Branches** | 86 / 17,971 | **0.47%** |
| **Functions** | 27 / 2,528 | **1.06%** |
| **Lines** | 128 / 14,595 | **0.87%** |

These percentages are low because Jest `collectCoverageFrom` includes **almost all of `src/`** (controllers, modules, AI, Slack, Jira, scheduler). Only three services have dedicated unit suites.

---

## Covered services

| Service | Unit suite | Lines (instrumented) | Coverage |
|---------|------------|---------------------:|----------|
| `DigestService` | `digest.service.unit.spec.ts` | 37 | **100%** all metrics |
| `MemoryChunkerService` | `memory-chunker.service.unit.spec.ts` | 46 | **100%** all metrics |
| `QuestionsService` | `questions.service.unit.spec.ts` | 38 | **100%** all metrics |

**Incidental (not a dedicated suite):** `PrismaService` ~60–71% because Nest instantiates it in Questions tests without calling `$connect`.

**Not counted as unit-tested:** controllers, modules, utils covered only by legacy `ts-node` `*.spec.ts` scripts (excluded from Jest).

---

## Coverage by module

From the Jest coverage table (`% Lines` unless noted):

| Module path | Approx. line % | Notes |
|-------------|----------------:|-------|
| `src/digest` | 78.72 | Service 100%; controller/module 0% |
| `src/questions` | 62.29 | Service 100%; controller/module 0% |
| `src/prisma` | 37.5 | Incidental `PrismaService` |
| `src/memory` | 2.95 | Chunker 100%; rest 0% |
| `src/common` | ~0 | Utils + members/timeline untested in Jest |
| `src/auth`, `src/team`, `src/reports`, `src/scheduler` | 0 | — |
| `src/check-in`, `src/collection`, `src/slack` | 0 | — |
| `src/jira`, `src/admin`, `src/analytics`, `src/demo` | 0 | — |
| `src/ai` (all workspace/RAG/eval) | 0 | Largest untested surface |

---

## Uncovered services

**72** `*.service.ts` files exist. **3** have Jest unit suites. **69** do not.

Empty/unused stubs (`users.service.ts`, `notifications.service.ts`) are omitted from the priority list.

---

## Ranking (highest → lowest priority)

Scoring: **business importance**, **ease of testing**, **expected coverage gain** (instrumented lines × realistic %), **complexity** (lower complexity ranks higher when other factors are equal).

### Tier A — Do next (pure logic, high value)

| Rank | Service | Instrumented lines | Prisma | Slack/OpenAI/Jira | Ease | Why |
|-----:|---------|-------------------:|:------:|:-----------------:|:----:|-----|
| **1** | **`IntentDetectionService`** | 132 (136 branches) | No | No | High | RAG routing; rule-based; no I/O |
| 2 | `PatternDetectorService` | 139 | No | No | High | Heuristics on evidence arrays |
| 3 | `ContextBuilderService` | 140 | No | No | High | Truncation/bucketing |
| 4 | `MemoryEvidenceMergeService` | ~216 src / ~50+ inst. | No | No | High | Authority merge policy |
| 5 | `MemoryHybridRankingService` | 54 | No | No | High | RRF + boosts; pairs with chunker |
| 6 | `ResponseRendererService` | ~20–30 | No | No | High | Markdown/citations |
| 7 | `TimelineBuilderService` | 17 | No | No | High | Small; lower gain |

**Estimated overall line-coverage lift** if each reaches ~90% of its instrumented lines (current total 14,595):

| Service | ~New covered lines | ~Overall line % after |
|---------|-------------------:|----------------------:|
| IntentDetection | ~120 | **1.7%** |
| PatternDetector | ~125 | **1.7%** |
| ContextBuilder | ~125 | **1.7%** |
| HybridRanking | ~50 | **1.2%** |
| TeamService | ~32 | **1.1%** |

(Sequential, not additive across the table — each row is vs **today’s** 128 covered lines.)

### Tier B — Prisma mocks (continue Phase 3 pattern)

| Rank | Service | Prisma | External | Ease | Notes |
|-----:|---------|:------:|:--------:|:----:|-------|
| 8 | **`TeamService`** | Yes | No | Med | Workspace/user fixtures; good Phase 4 *alternative* |
| 9 | `JiraAuditService` | Yes | No | High | Tiny insert + workspace check |
| 10 | `MemoryOutboxService` | Yes | No | High | Enqueue only |
| 11 | `AuthService` | Yes | Slack IDs only | Med | Upserts; no Slack HTTP |
| 12 | `LatestStandupResolverService` | Yes | No | Med | Temporal queries |
| 13 | `MemoryAclService` | Yes | No | Med | SQL/ACL builders |
| 14 | `ReportsService` | Yes | No | Med | Large (~900 src lines) |
| 15 | `CheckInRunService` | Yes | No | Med | Run lifecycle |
| 16 | `WorkspaceMembersService` | Yes | No | Med | Cache + listing |

### Tier C — One external mock (OpenAI / Jira HTTP / Slack API)

| Rank | Service | Mocks needed |
|-----:|---------|----------------|
| 17 | `MemoryEmbeddingService` | OpenAI embeddings |
| 18 | `JiraIssuePickerService` | `JiraService` |
| 19 | `AiService` | OpenAI + Prisma + EventEmitter |
| 20 | `KnowledgeEmbeddingService` | OpenAI + Prisma |
| 21 | Slack/Jira member caches | Live APIs + Prisma |

### Tier D — Orchestrators (defer)

`RagPipelineService`, `AiChatService`, `WorkspaceRetrievalService`, `ReportGenerationService`, `VacationCatchupService`, `EvidenceCollectorService`, `JiraHubService`, `JiraBlockerService`, `CheckInReportService`, `CheckInThreadService`, `AiSlackExportService`.

**Prisma + many collaborators.** Prefer extracting pure helpers first.

### Tier E — Gateways (last)

`WorkspaceKnowledgeService` (576 inst. lines, 1607 branches), `CollectionService`, `JiraService`, `CheckInService`, `SchedulerService`, `AdminService`, `SlackService`.

**Do not start here.** Need fakes, ModuleRef, OAuth, Socket Mode.

---

## Recommended testing order

1. **IntentDetectionService** ← Phase 4  
2. PatternDetectorService  
3. ContextBuilderService  
4. MemoryHybridRankingService + MemoryEvidenceMergeService  
5. TimelineBuilder + ResponseRenderer (quick wins)  
6. TeamService (Prisma mock #2)  
7. JiraAuditService, MemoryOutboxService, AuthService  
8. ReportsService / CheckInRunService  
9. Embedding + Jira picker (external mocks)  
10. RAG/chat orchestrators  
11. Collection / Jira / Slack / Scheduler / Admin / Knowledge  

Keep **GitHub Actions CI v1** on `npm test` (Jest unit only). Integration stays `npm run test:integration`.

---

## Mock classification

### Pure logic (no Prisma, no Slack/OpenAI/Jira HTTP)

`IntentDetectionService`, `PatternDetectorService`, `ContextBuilderService`, `TimelineBuilderService`, `ResponseRendererService`, `MemoryHybridRankingService`, `MemoryEvidenceMergeService`, `AnalysisOrchestratorService` (routes analyzers), `WorkspaceSearchService` (thin facade).

### Prisma mock only

`TeamService`, `AuthService`, `JiraAuditService`, `MemoryOutboxService`, `LatestStandupResolverService`, `MemoryAclService`, `ReportsService`, `CheckInRunService`, `WorkspaceMembersService`, `AiEvalDatasetService`, `ConversationMemoryService` (plus in-memory cache), most Jira cache/blocker **write** paths if HTTP is mocked away at `JiraService`.

### External mocks required

| Service | Slack | OpenAI | Jira HTTP |
|---------|:-----:|:------:|:---------:|
| `SlackService`, `CheckInThreadService`, `SlackAiAssistantService` | Yes | Chat: yes | No |
| `AiService`, `AiChatService`, `ReportGenerationService`, `VacationCatchupService` | No | Yes | No |
| `MemoryEmbeddingService`, `KnowledgeEmbeddingService` | No | Embeddings | No |
| `JiraService`, picker/cache/actions | No | No | Yes |
| `CollectionService` | Yes | No | Partial |
| `SchedulerService` | Yes (digest post) | Yes (reports) | No |

---

## Phase 4 recommendation: IntentDetectionService

**Path:** `src/ai/workspace/intent/intent-detection.service.ts`

| Criterion | Assessment |
|-----------|------------|
| **Business importance** | Decides RAG intent (status, detective, vacation, reports, members) before retrieval |
| **Complexity** | High *logic* density, **zero** injected dependencies |
| **Coverage gain** | 132 instrumented lines, **136 branches** — among the best easy wins |
| **Ease of testing** | Same pattern as Digest/Chunker: Nest `TestingModule`, no Prisma, no network |
| **Mocks** | None (uses existing pure utils: `keyword.util`, `assignee-match`, `temporal-retrieval`) |

**Not TeamService for Phase 4**, unless the goal is specifically “second Prisma mock.” TeamService is only **36** instrumented lines vs **132** for intent, with more fixture setup.

**Suggested suite:** `src/ai/workspace/intent/intent-detection.service.unit.spec.ts`  
Use `@jest/globals` (same IDE/build pattern as QuestionsService).

---

## Approval gate

This document is an assessment. **No new tests were written.**

Please approve **IntentDetectionService** as Unit Testing Phase 4 (or name `TeamService` if you prefer the Prisma-mock track).
