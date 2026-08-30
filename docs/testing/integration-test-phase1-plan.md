# Integration Testing Phase 1 — Plan

**Date:** August 30, 2026  
**Status:** Plan only — no tests implemented  
**Prerequisite:** Unit testing Phases 1–2 complete; GitHub Actions CI v1 passing  
**Recommendation:** `QuestionsModule` (`QuestionsController` + `QuestionsService` + `PrismaService`)

---

> **Do not implement tests until this plan is approved.** Production code will not be changed in Phase 1.

---

## Table of Contents

1. [Objective](#objective)
2. [Scope](#scope)
3. [What integration testing means here](#what-integration-testing-means-here)
4. [Candidate ranking](#candidate-ranking)
5. [Selected module](#selected-module)
6. [Why QuestionsModule](#why-questionsmodule)
7. [Components under test](#components-under-test)
8. [Dependencies](#dependencies)
9. [Integration testing strategy](#integration-testing-strategy)
10. [Mock strategy](#mock-strategy)
11. [Expected coverage](#expected-coverage)
12. [Risks](#risks)
13. [CI interaction](#ci-interaction)
14. [Future phases](#future-phases)
15. [Approval gate](#approval-gate)

---

## Objective

Introduce the **first NestJS integration test suite** for Pulse: exercise a real HTTP controller, a real service, and a real Prisma/PostgreSQL round-trip, without Slack, OpenAI, Jira, or the scheduler.

This phase establishes:

- A repeatable `TestingModule` + `supertest` pattern
- A dedicated test database workflow
- Isolation from GitHub Actions CI v1 (unit tests stay green without Postgres)

---

## Scope

| In scope | Out of scope |
|----------|----------------|
| One NestJS module: **QuestionsModule** | Production code changes |
| HTTP API (`/api/questions`) through the controller | Slack / OpenAI / Jira |
| Real Prisma queries against a **test** PostgreSQL database | Prisma migrate in GitHub Actions v1 |
| Validation and persistence behavior | Scheduler, collection, AI, check-in runs |
| Documented setup for `DATABASE_URL` in tests | Playwright / frontend |

---

## What integration testing means here

| Layer | Unit tests (done) | Integration tests (this phase) |
|-------|-------------------|--------------------------------|
| Pure logic (`DigestService`, `MemoryChunkerService`) | Yes | Not valuable as first target |
| Service + mocked Prisma | Future unit phase | No |
| Controller + service + **real Prisma** + HTTP | No | **Yes** |
| Full `AppModule` + Slack socket | No | Later |

Phase 1 is **module-level integration**, not full-system E2E.

---

## Candidate ranking

Easiest → hardest among NestJS modules that actually persist or orchestrate I/O.

### 1. QuestionsModule — **easiest / recommended**

| Item | Detail |
|------|--------|
| **Components** | `QuestionsController`, `QuestionsService`, `PrismaModule` / `PrismaService` |
| **Prisma** | Yes — `Question` CRUD, `$transaction` for reorder |
| **Slack / OpenAI / Jira** | **No** |
| **Complexity** | **Low** |
| **Why ranked first** | Small surface (CRUD + validation + reorder). `Question` rows can exist without `checkInId`. No workspace/user seed required for happy-path create. Application-level unique `order` is a real DB-backed rule worth proving. |

### 2. DigestModule — easy but low integration value

| Item | Detail |
|------|--------|
| **Components** | `DigestController`, `DigestService` |
| **Prisma** | No |
| **Slack / OpenAI / Jira** | No |
| **Complexity** | Very low |
| **Why not first** | Already **100% unit-tested**. An HTTP wrapper test adds little compared to proving Prisma wiring. Defer as a thin controller smoke test later if needed. |

### 3. TeamModule — moderate

| Item | Detail |
|------|--------|
| **Components** | `TeamController`, `TeamService`, Prisma |
| **Prisma** | Yes — `Team`, `TeamMember`, `Workspace`, `User` |
| **Slack / OpenAI / Jira** | No live Slack; stores Slack IDs only |
| **Complexity** | **Medium** |
| **Why later** | Creating a team requires a real `Workspace`. Member add requires `User` or `slackUserId` resolution. Fixture graph is larger than Question. |

### 4. AuthModule — moderate, weak HTTP surface

| Item | Detail |
|------|--------|
| **Components** | `AuthService`, Prisma (`User` / `Workspace` upsert) |
| **Prisma** | Yes |
| **Slack / OpenAI / Jira** | No HTTP Slack calls in the service; models Slack identity |
| **Complexity** | **Medium** |
| **Why later** | `AuthController` has **no routes**. Integration would be service-only against Prisma, overlapping Team/workspace fixtures. |

### 5. ReportsModule (CSV export path) — moderate, little DB

| Item | Detail |
|------|--------|
| **Components** | `ReportsController`, `ReportsService` |
| **Prisma** | Partial — CSV export is in-memory; other report paths hit DB |
| **Slack / OpenAI / Jira** | No for CSV export |
| **Complexity** | Medium (DTO shape, HTTP `Res`) |
| **Why later** | Better as a controller test with fixtures, not the first Prisma integration. |

### 6. CheckInRunService / CheckInModule — hard

| Item | Detail |
|------|--------|
| **Components** | `CheckInController`, `CheckInService`, `CheckInRunService`, `CheckInReportService`, Slack, AI, Collection, Digest |
| **Prisma** | Yes — large graph (`CheckIn`, runs, questions, answers) |
| **Slack / OpenAI / Jira** | Slack and AI on report/collection paths |
| **Complexity** | **High** |
| **Why later** | Circular `CheckInService` ↔ `SchedulerService` (`ModuleRef`). Too many collaborators for Phase 1. |

### 7. CollectionModule / SlackModule — hard

| Item | Detail |
|------|--------|
| **Components** | `CollectionService`, Slack listeners/gateway, Jira link services, EventEmitter, MemoryOutbox |
| **Prisma** | Yes |
| **Slack / OpenAI / Jira** | **Slack required** (or heavy mocks); Jira optional on some paths |
| **Complexity** | **High** |
| **Why later** | Bolt/socket lifecycle; not HTTP-first. |

### 8. JiraModule — hard

| Item | Detail |
|------|--------|
| **Components** | `JiraService` + cache, blockers, hub, OAuth |
| **Prisma** | Yes |
| **Slack / OpenAI / Jira** | **Jira REST/OAuth required** unless fully mocked (then it is not integration) |
| **Complexity** | **High** |

### 9. SchedulerModule — hardest among “app glue”

| Item | Detail |
|------|--------|
| **Components** | `SchedulerService`, Collection, Digest, Slack, AI, Reports, CheckIn |
| **Prisma** | Yes |
| **Slack / OpenAI / Jira** | Yes on real ticks |
| **Complexity** | **Very high** |

### 10. AiModule / Memory retrieval — hardest

| Item | Detail |
|------|--------|
| **Components** | RAG pipeline, OpenAI, pgvector, knowledge collector |
| **Prisma** | Yes |
| **Slack / OpenAI / Jira** | **OpenAI** (and often Jira/Slack caches) |
| **Complexity** | **Very high** |
| **Why last** | Non-deterministic LLM output; belongs after eval harness + recorded fixtures. |

---

## Selected module

**QuestionsModule** — Phase 1 integration target.

| Path | Role |
|------|------|
| `src/questions/questions.module.ts` | Nest module |
| `src/questions/questions.controller.ts` | HTTP (`GET/POST/PUT/PATCH/DELETE`) |
| `src/questions/questions.service.ts` | Validation, uniqueness, transactions |
| `src/prisma/prisma.service.ts` | Real `PrismaClient` |

HTTP prefix in production is `api` (`main.ts`). Tests should use the same prefix or call the controller with `supertest` against a Nest app that sets `setGlobalPrefix('api')`.

---

## Why QuestionsModule

1. **First real I/O seam** after two zero-dependency unit suites — teaches Prisma + HTTP without Slack or OpenAI.
2. **Small, complete CRUD** — list, get, create, update, toggle, reorder, delete.
3. **Business rules that only integration can prove** — unique `order` is enforced in the service (not a Prisma `@@unique`); transactions in `reorder` / `swapOrder`; `NotFoundException` / `BadRequestException` mapped through Nest HTTP.
4. **Minimal fixtures** — `Question.checkInId` is optional; no workspace/user/team seed for basic CRUD.
5. **Product-critical** — standup questions drive Slack collection and check-ins.
6. **Isolated module** — `QuestionsModule` imports only `PrismaModule`. `Test.createTestingModule({ imports: [QuestionsModule] })` is sufficient.
7. **FK risk is observable** — `remove()` may fail if `Answer` rows exist. Phase 1 can document this; a dedicated test can use a question **without** answers, and optionally one with answers as an explicit later case.

---

## Components under test

| Component | What to assert |
|-----------|----------------|
| `QuestionsController` | Status codes, JSON body, route params (`reorder` before `:id` is already ordered correctly in the controller) |
| `QuestionsService` | Validation (length 5–255), duplicate `order`, 404 on missing id, toggle flips `isActive` |
| `PrismaService` | Rows actually written/read/deleted in PostgreSQL |
| Nest HTTP layer | Exception filters turn `NotFoundException` → 404, `BadRequestException` → 400 |

`swapOrder` is **not** exposed on the controller. Phase 1 HTTP tests cover controller routes; `swapOrder` can be called via the service in the same suite if we want transaction coverage without a new endpoint.

---

## Dependencies

| Dependency | Phase 1 requirement |
|------------|---------------------|
| PostgreSQL | **Yes** — dedicated test database (not production) |
| `DATABASE_URL` | Test URL only (example: `postgresql://…/pulse_test`) |
| Prisma migrate / `db push` | Once on the test database (local / future CI v3) |
| Slack | **No** |
| OpenAI | **No** |
| Jira | **No** |
| Redis | **No** |
| `@nestjs/testing` + `supertest` | **Yes** (`supertest` may need to be added as a **devDependency** when implementing — that is not production code) |

`PrismaService.onModuleInit` calls `$connect()`. The test app must use a reachable test database or the module will fail to boot.

---

## Integration testing strategy

### Bootstrapping

1. `Test.createTestingModule({ imports: [QuestionsModule] }).compile()`
2. `app = module.createNestApplication()`
3. `app.setGlobalPrefix('api')` to match production
4. `await app.init()`
5. `supertest(app.getHttpServer())` for HTTP calls

### Data isolation

- Create questions with a unique prefix (e.g. `[itest] …`) and unique `order` values in a high range to avoid colliding with seed data.
- `afterEach` / `afterAll`: delete rows created by the suite (`question` starts with prefix, or tracked ids).
- Do **not** `DELETE FROM "Question"` globally if the same database is used for local demo data.

### Scenarios (planned, not implemented)

| Scenario | Expected |
|----------|----------|
| `GET /api/questions` | 200, array ordered by `order` |
| `POST /api/questions` valid body | 201/200, row persisted |
| `POST` question too short / too long | 400 |
| `POST` duplicate `order` | 400 |
| `GET /api/questions/:id` unknown | 404 |
| `PUT` update text | persisted change |
| `PATCH /:id/toggle` | `isActive` inverted |
| `PATCH /reorder` | transactional order swap persisted |
| `DELETE /:id` without answers | 200 and subsequent GET 404 |

### File and runner convention (when implementing)

Jest CI v1 currently matches `test/**/*.spec.ts`. **Do not** add integration files under that glob without excluding them from `npm test`, or GitHub Actions v1 will fail (no Postgres).

Recommended when implementation is approved:

| Item | Proposal |
|------|----------|
| File | `test/integration/questions.integration.spec.ts` |
| Unit Jest | Keep `src/**/*.unit.spec.ts` only **or** exclude `**/*.integration.spec.ts` |
| Script | `"test:integration": "jest --config jest.integration.config.js"` |
| CI | **Not** in CI v1; add in CI v3 with a Postgres service |

---

## Mock strategy

| Collaborator | Mock? | Reason |
|--------------|:-----:|--------|
| `PrismaService` | **No** | The point of this phase is a real database |
| PostgreSQL | **No** | Real test instance |
| Slack / Bolt | N/A | Unused |
| OpenAI | N/A | Unused |
| Jira HTTP | N/A | Unused |
| `QuestionsService` | **No** | Real service behind the controller |

**No unnecessary mocks.** If `supertest` is used, do not mock the controller.

---

## Expected coverage

Integration tests measure **behavior through HTTP + DB**, not line coverage of the whole backend.

| Target | Expectation |
|--------|-------------|
| `questions.controller.ts` | High — all routes exercised |
| `questions.service.ts` public methods used by HTTP | High (`swapOrder` only if called directly) |
| `prisma.service.ts` | Incidental (`$connect` / queries) |
| Whole `src/` | Still low — same as unit CI |

Approximate: **80–95% of QuestionsModule** if all routes and error paths above are included; **`swapOrder` uncovered** unless tested via the service.

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Accidental use of production `DATABASE_URL` | Data loss | Separate `DATABASE_URL` for tests; refuse to run if URL host is production; document `.env.test` |
| Integration files picked up by `npm test` | CI v1 fails | Distinct filename + Jest config split **before** adding tests |
| Shared local DB with seed/demo questions | Flaky unique `order` | High `order` values + prefixed text + cleanup |
| `DELETE` with existing `Answer` FK | Test 500 | Phase 1 deletes only questions created by the suite without answers |
| `supertest` not in `package.json` | Cannot HTTP-test | Add as **devDependency** at implementation time |
| Windows vs Linux Prisma engine | Local vs CI | Same as unit CI; test DB only when Postgres is available |
| Schema drift | Tests fail after migrations | Apply migrations to `pulse_test` in the same way as local backend |

---

## CI interaction

| Pipeline | Integration tests |
|----------|-------------------|
| GitHub Actions **CI v1** (current) | **Do not run** — no PostgreSQL |
| **CI v1.1** (Build) | Still unit + build only |
| **CI v3** (from CI plan) | Postgres service + `npm run test:integration` |

Phase 1 implementation is **local-first** (developer machine or a future Compose `postgres` service).

---

## Future phases

| Phase | Target | Adds |
|-------|--------|------|
| **IT-1 (this plan)** | QuestionsModule | HTTP + Prisma |
| **IT-2** | TeamModule | Workspace/User fixtures |
| **IT-3** | CheckInRunService | Run lifecycle, still mock Slack/AI |
| **IT-4** | Collection (selected commands) | Mock Slack WebClient, real Prisma |
| **IT-5** | Reports persistence | Digest rows |
| **IT-6** | Memory outbox + worker (no OpenAI) | Fake embedding provider (already used in `memory-phase2b.spec.ts`) |
| **IT-7** | Scheduler tick with fakes | Clock/cron without live Slack |
| **Later** | AI/RAG | Recorded fixtures / eval harness, not live GPT in CI |

---

## Approval gate

This document is a **plan only**. No integration tests have been written.

**Please confirm before implementation:**

1. **QuestionsModule** as Integration Testing Phase 1
2. Local test database approach (`DATABASE_URL` for a `pulse_test` database)
3. Jest split so `npm test` / GitHub Actions v1 remain unit-only

After approval, implementation should start with `questions.integration.spec.ts` and **no production code changes** unless a blocker is found (for example adding `supertest` as a devDependency).
