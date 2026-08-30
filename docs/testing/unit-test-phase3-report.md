# Unit Test Phase 3 Report — QuestionsService

**Date:** August 30, 2026  
**Status:** Complete — awaiting approval before Unit Testing Phase 4  
**Service:** `QuestionsService` (`src/questions/questions.service.ts`)  
**Suite:** `src/questions/questions.service.unit.spec.ts`

---

> First NestJS unit suite that **mocks Prisma**. No PostgreSQL, no `pulse_test`, no `teampulse`, no integration HTTP.

---

## Objective

Add a Jest + `@nestjs/testing` unit suite for `QuestionsService` that:

- Mocks every `PrismaService` call
- Covers all public methods and exception paths
- Reaches **100%** statements, branches, functions, and lines
- Leaves GitHub Actions CI v1 unchanged (`npm test` already discovers `*.unit.spec.ts`)

---

## Why QuestionsService was selected

| Criterion | Detail |
|-----------|--------|
| Next on the unit roadmap | After zero-dep `DigestService` and `MemoryChunkerService` |
| First Prisma seam | Single injected dependency: `PrismaService` |
| Business rules | Text length, unique `order`, 404/400, `$transaction` |
| Complements integration Phase 1 | Integration proved HTTP + DB; unit tests isolate service logic without I/O |
| Small surface | ~103 lines, eight public methods |

---

## Service analysis

### Responsibilities

`QuestionsService` is the standup **question catalog** layer: list, get, create, update, toggle active, delete, bulk reorder, and adjacent swap.

### Business logic

| Rule | Behavior |
|------|----------|
| Text length | Trimmed length must be 5–255 or `BadRequestException` |
| Unique `order` | `findFirst({ order })` on create and when update changes order |
| Missing id | `findUnique` null → `NotFoundException` |
| Reorder | `$transaction` of `update` calls — **no** unique-order check |
| Swap | Load all, swap orders with neighbor, or no-op at list ends |

### Dependencies

| Dependency | Role |
|------------|------|
| `PrismaService` | Only constructor injection |

No Slack, OpenAI, Jira, or scheduler.

### Methods tested (all public)

`findAll`, `findOne`, `create`, `update`, `toggleActive`, `remove`, `reorder`, `swapOrder`.

Private `validateQuestion` and `validateOrderUnique` are covered through those methods.

### Why Prisma is mocked

- Unit tests must be **fast, deterministic, and offline**
- CI v1 has **no PostgreSQL**
- Integration Phase 1 already uses `pulse_test` for real I/O
- Mocking Prisma asserts **call contracts** (args, not-called on validation failure) without touching demo data

---

## Mocking strategy

| Collaborator | Mocked? |
|--------------|:-------:|
| `PrismaService` | **Yes** — entire object |
| PostgreSQL | N/A — never connected |
| HTTP / `supertest` | No — this is not an integration suite |
| Slack / OpenAI / Jira | N/A |

`Test.createTestingModule` provides:

```ts
{ provide: PrismaService, useValue: prisma }
```

where `prisma` is a plain object of `jest.fn()` mocks. `PrismaService.onModuleInit` / `$connect` are **not** invoked.

---

## Prisma mock architecture

```
QuestionsService
    │
    ▼
PrismaService (useValue)
    ├── question.findMany
    ├── question.findUnique
    ├── question.findFirst
    ├── question.create
    ├── question.update
    ├── question.delete
    └── $transaction
```

- `beforeEach` builds a **fresh** mock object (no shared state).
- Success paths: `mockResolvedValue` / `mockImplementation(Promise.all)`.
- Failures: `null` from `findUnique`, existing row from `findFirst`, `$transaction` `mockRejectedValue`.

---

## Test cases implemented

**29 tests**, AAA, descriptive names.

| Area | Cases |
|------|--------|
| `findAll` | Ordered list; empty list |
| `findOne` | Found; `NotFoundException` |
| `create` | Valid; too short; empty; too long; duplicate order |
| `update` | Text only; unchanged order skips unique check; changed order checks unique; missing id; duplicate order; invalid text |
| `toggleActive` | true→false; false→true; missing |
| `remove` | Delete; missing |
| `reorder` | Transaction success; empty list; transaction failure; duplicate orders **not** pre-validated |
| `swapOrder` | Up; down; missing; first-item up no-op; last-item down no-op |

---

## Exception scenarios

| Exception | Trigger |
|-----------|---------|
| `NotFoundException` | `findOne` / update-order / toggle / remove / `swapOrder` missing id |
| `BadRequestException` | Invalid text; duplicate `order` on create/update |
| Transaction `Error` | `reorder` `$transaction` rejection |

`reorder` does **not** throw on duplicate `order` in the payload; uniqueness is not checked. That is current production behavior (documented, not changed).

---

## Coverage

Scoped command (QuestionsService only):

```bash
cd pulse/backend
npx jest --coverage --collectCoverageFrom="src/questions/questions.service.ts" --testPathPattern="questions.service.unit.spec"
```

**Real output (30 August 2026, after TypeScript/Jest typing fixes):**

```
PASS src/questions/questions.service.unit.spec.ts
Test Suites: 1 passed, 1 total
Tests:       29 passed, 29 total
Time:        5.936 s
```

| Metric | Result |
|--------|--------|
| **Statements** | **100%** |
| **Branches** | **100%** |
| **Functions** | **100%** |
| **Lines** | **100%** |

Uncovered line #s: *(none)*

**100% is achievable** because every branch is reachable via the public API with mocked Prisma.

---

## TypeScript and build validation

VS Code Problems were caused by `src/**/*.unit.spec.ts` being type-checked with the **app** `tsconfig.json` (`types: ["node"]` only), so `describe` / `jest` were unresolved. Production `QuestionsService` was not changed.

| Change | Why |
|--------|-----|
| Import `describe`, `it`, `expect`, `beforeEach`, `jest` from `@jest/globals` | Explicit Jest types in the spec file (no `@ts-ignore`, no `any`) |
| Typed Prisma mock + `Question` fixtures | Replace `Record<string, unknown>` / untyped `jest.Mock` |
| `tsconfig.json` `types`: `["node", "jest"]` and exclude `**/*.spec.ts` / `**/*.unit.spec.ts` | App compile no longer swallows test files |
| `tsconfig.build.json` + `nest-cli.json` | `npm run build` compiles production `src` only |

`npx tsc -p tsconfig.spec.json --noEmit` reports **zero** errors for this suite. IDE lints on the spec file are **clean**.

### `npm run build`

```
> nest build
```

**Result: success, exit code 0, zero errors.**

### `npm test`

```
PASS src/digest/digest.service.unit.spec.ts
PASS src/memory/memory-chunker.service.unit.spec.ts
PASS src/questions/questions.service.unit.spec.ts

Test Suites: 3 passed, 3 total
Tests:       87 passed, 87 total
Time:        8.005 s
```

---

## Files changed while fixing the suite

| File | Change |
|------|--------|
| `src/questions/questions.service.unit.spec.ts` | `@jest/globals` imports; typed Prisma mock; `Question` fixtures |
| `tsconfig.json` | `jest` types; exclude spec files from app compile |
| `tsconfig.build.json` | **Created** — Nest production compile excludes tests |
| `nest-cli.json` | **Created** — `tsConfigPath: tsconfig.build.json` |

**Production `questions.service.ts`: not modified.**

---

## Lessons learned

1. **Mock Prisma at the Nest provider**, not by hitting `pulse_test`.
2. **Update-without-order** never calls `findOne` — 404 on PUT in integration required `order` in the body; unit tests make that explicit.
3. **`reorder` ≠ unique constraint.** Do not invent a duplicate-order failure the service does not implement.
4. **`swapOrder` boundary no-ops** (`return` without transaction) are first-class branches.
5. Unit `*.unit.spec.ts` is already on CI v1 — no workflow edit required.
6. **Colocated specs need explicit Jest types** (`@jest/globals`) so the IDE does not type-check them as app code without Jest.

---

## Remaining uncovered paths

None in `questions.service.ts`.

Out of scope: `QuestionsController` HTTP (integration Phase 1), Prisma FK delete failures (would need Prisma error mapping in production).

---

## Recommendations

**Phase 4 unit target:** `TeamService` — still Prisma-only, slightly richer fixtures (`Workspace` / `User` mocks), still no Slack HTTP.

Alternatively: `AuthService` (Prisma upsert) or `JiraAuditService` (thin insert).

Do **not** mix `pulse_test` into this suite.

---

## Approval gate

Unit Testing Phase 3 is complete. **Do not start Phase 4** until approved.
