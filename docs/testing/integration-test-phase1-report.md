# Integration Test Phase 1 Report — QuestionsModule

**Date:** August 30, 2026  
**Status:** Complete — awaiting approval before Integration Testing Phase 2  
**Module:** `QuestionsModule`  
**Database:** `pulse_test` (dedicated — never `teampulse`)

---

> Integration tests exercise the real HTTP API, real `QuestionsService`, and real Prisma against **`pulse_test` only**. GitHub Actions CI v1 is unchanged and still runs unit tests only.

---

## Objective

Prove that standup question CRUD works end-to-end through NestJS HTTP + PostgreSQL, without Slack, OpenAI, Jira, Scheduler, AI Workspace, Memory, or Check-In.

---

## Architecture

```
supertest  →  Nest INestApplication (QuestionsModule only)
                    ↓
            QuestionsController  (/api/questions)
                    ↓
            QuestionsService
                    ↓
            PrismaService  →  PostgreSQL `pulse_test`
```

`AppModule` is **not** booted. Booting the full app would start Slack socket mode, the scheduler, and Jira/AI modules. Phase 1 uses the **real QuestionsModule** (real controller, service, and Prisma client) inside `Test.createTestingModule`.

Global prefix `api` matches `main.ts`.

---

## Components under test

| Component | Role |
|-----------|------|
| `QuestionsController` | HTTP routes |
| `QuestionsService` | Validation, unique `order`, persistence |
| `PrismaService` | Real `PrismaClient` against `pulse_test` |
| Nest HTTP exception layer | 400 / 404 mapping |

Not loaded: Slack, OpenAI, Jira, Scheduler, AI, Memory, Check-In.

---

## Database strategy

| Database | Role | Used by integration tests? |
|----------|------|:--------------------------:|
| `teampulse` | Development / demo (`backend/.env`) | **No** |
| `pulse_test` | Dedicated integration database | **Yes** |

### Why a dedicated test database is required

- Integration tests **create, update, and delete** rows after every case.
- Using `teampulse` would destroy or collide with demo/dev questions.
- `order` uniqueness is application-wide; leftover demo orders would make tests flaky.
- A dedicated database can be wiped safely (`deleteMany` on `Question` only in `pulse_test`).

### Safety rails

1. `integration/set-test-database-url.js` sets `DATABASE_URL` to `pulse_test` **before** Prisma loads.
2. It **throws** if the database name is not `pulse_test`.
3. The suite asserts `DATABASE_URL` contains `/pulse_test` in `beforeAll`.
4. Prisma `db push` is invoked with `DATABASE_URL` pointing at `pulse_test` only.

Development `.env` (`teampulse`) is never used as the Prisma datasource for these tests.

---

## Test strategy

| Practice | How |
|----------|-----|
| HTTP | `supertest` against `app.getHttpServer()` |
| Nest | `@nestjs/testing` + `QuestionsModule` |
| Prisma | Real client, no mock |
| Isolation | `deleteMany()` on `Question` in `beforeEach` / `afterEach` / `afterAll` |
| Fixtures | `[itest]` prefix; high `order` values |
| CI | Separate Jest config — **not** `npm test` |

### PATCH note (no production change)

There is **no** generic `PATCH /questions/:id` in `QuestionsController`. Partial updates in the real API are:

- `PUT /questions/:id` (question / order / isActive)
- `PATCH /questions/:id/toggle` (`isActive` flip)

Phase 1 tests **`PATCH /:id/toggle`**. Adding `PATCH /:id` would be a production API change and was not made.

### PUT 404

`QuestionsService.update` calls `findOne` (404) only when `order` is present. The missing-id PUT test sends both `question` and `order` so the HTTP contract is 404 without changing production code.

---

## API endpoints tested

| Method | Path | Covered |
|--------|------|:-------:|
| GET | `/api/questions` | Yes |
| GET | `/api/questions/:id` | Yes |
| POST | `/api/questions` | Yes |
| PUT | `/api/questions/:id` | Yes |
| PATCH | `/api/questions/:id/toggle` | Yes |
| DELETE | `/api/questions/:id` | Yes |
| PATCH | `/api/questions/reorder` | Not in Phase 1 (`swapOrder` / reorder left for later) |

---

## Scenarios covered

| Scenario | Result |
|----------|--------|
| GET all questions (ordered) | 200, both fixtures, ascending `order` |
| GET existing by id | 200 |
| GET missing id | 404 |
| POST valid question | 201, row in `pulse_test` |
| POST too-short text | 400 |
| POST duplicate `order` | 400 |
| PUT existing question text | 200, persisted |
| PUT missing id | 404 |
| PATCH toggle `isActive` | 200, persisted |
| PATCH toggle missing id | 404 |
| DELETE existing | 200, row gone |
| DELETE missing | 404 |

**12 tests, all passing.**

---

## Test execution instructions

From `pulse/backend`:

```bash
npm run test:integration
```

With coverage (QuestionsModule files only):

```bash
npm run test:integration:coverage
```

These scripts:

1. Ensure `pulse_test` exists (`integration/ensure-pulse-test-db.js`)
2. `prisma db push` against **`pulse_test` only**
3. Run Jest with `integration/jest.integration.config.js`

Do **not** use `npm test` for this suite. That command remains unit tests for GitHub Actions CI v1.

---

## Results

Captured **August 30, 2026** via `npm run test:integration:coverage`:

```
PASS integration/questions.integration.spec.ts
Test Suites: 1 passed, 1 total
Tests:       12 passed, 12 total
Time:        32.976 s
```

| Metric | Value |
|--------|-------|
| **Test suites** | 1 passed |
| **Tests** | 12 passed, 12 total |
| **Execution time** | 32.976 s |
| **Pass/Fail** | **Pass** |

### Coverage (QuestionsModule only)

| File | Stmts | Branch | Funcs | Lines |
|------|------:|-------:|------:|------:|
| `questions.controller.ts` | 95% | 100% | 87.5% | 94.44% |
| `questions.module.ts` | 100% | 100% | 100% | 100% |
| `questions.service.ts` | 65.11% | 53.33% | 69.23% | 68.42% |
| **All (module)** | **77.14%** | **53.33%** | **76.19%** | **78.68%** |

Uncovered on purpose: `reorder` / `swapOrder` (no HTTP coverage in Phase 1 except unused reorder line 35 in the controller).

---

## Future improvements

- Cover `PATCH /api/questions/reorder` and `swapOrder`
- Map Prisma `P2025` on PUT-without-order to 404 (would be a **production** change — not done here)
- Add generic `PATCH /questions/:id` only if product wants that contract
- GitHub Actions **CI v3**: Postgres service + `npm run test:integration`
- Integration Testing Phase 2: **TeamModule** (workspace/user fixtures)

---

## Approval gate

QuestionsModule integration Phase 1 is complete. **Do not start Phase 2** until approved.
