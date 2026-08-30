# Unit Test Phase 4 Report — TeamService

**Date:** August 30, 2026  
**Status:** Complete — awaiting approval before Unit Testing Phase 5  
**Service:** `TeamService` (`src/team/team.service.ts`)  
**Suite:** `src/team/team.service.unit.spec.ts`

---

> NestJS unit suite with **Prisma fully mocked**. No PostgreSQL, no `pulse_test`, no `teampulse`, no HTTP integration.

---

## Objective

Add a Jest + `@nestjs/testing` unit suite for `TeamService` that:

- Mocks every `PrismaService` operation the service uses
- Covers all public methods and exception paths
- Reaches **100%** statements, branches, functions, and lines
- Leaves GitHub Actions CI v1 unchanged (`npm test` already discovers `*.unit.spec.ts`)

---

## Why TeamService was selected

Phase 3 (`QuestionsService`) was approved. The automatic coverage ranking was **not** used.

| Criterion | Detail |
|-----------|--------|
| Core business module | Teams, membership, and workspace isolation sit at the center of Pulse |
| Realistic Prisma service | Lookups, create, upsert, and include graphs — same mock pattern as QuestionsService |
| Engineering value | Business rules (trim, defaults, upsert, workspace mismatch) matter more than chasing the next highest-coverage file |
| Complements Questions | Catalog vs. org structure; still no Slack Web API in the service |

---

## Architecture overview

```
TeamController (HTTP — out of scope for this unit suite)
        │
        ▼
   TeamService
        │
        ▼
  PrismaService  →  PostgreSQL  (mocked; never connected in unit tests)
        │
        ├── Workspace
        ├── Team
        ├── User
        └── TeamMember
```

`TeamModule` registers `TeamService` and `TeamController`. The unit suite compiles **only** `TeamService` plus a `PrismaService` `useValue` stub via `Test.createTestingModule`. No HTTP, no `supertest`, no real Prisma Client, no `$connect`.

`safeTeamInclude` is a private field (not a method). It is the include graph for `team.create`, `team.findMany`, and `getTeam`'s `findUnique`. Membership `upsert` uses a separate inline include.

**`$transaction`:** `TeamService` does **not** call `prisma.$transaction`. There is no transaction-failure path. Duplicate membership is a single `teamMember.upsert`.

---

## Service analysis

### Responsibilities

`TeamService` is the **team catalog and membership** layer: create a team in a workspace, add or re-activate a member, list teams, and load one team with safe nested selects.

### Business logic

| Rule | Behavior |
|------|----------|
| Required fields | Trimmed `workspaceId` / `name` / `teamId` empty or missing → `BadRequestException` |
| Member identity | At least one of trimmed `userId` or `slackUserId` is required |
| Workspace exists | `workspace.findUnique` null → `NotFoundException` |
| Team exists | `team.findUnique` null on add/get → `NotFoundException` |
| User exists | Lookup by `id` if `userId` is truthy after trim; otherwise by `slackUserId` |
| Same workspace | `user.workspaceId !== team.workspaceId` → `BadRequestException` |
| Duplicate member | `teamMember.upsert` on `teamId_userId` — update role and set `optedOut: false`; no second insert |
| Defaults on create | Cron `0 0 9 * * 0-4`, timezone `Asia/Riyadh`, `schedulerEnabled` true, `slackChannelId` null if unset/whitespace |
| Default role | `input.role?.trim() \|\| 'member'` on both create and update of membership |

Optional create fields (`slackChannelId`, `scheduleCron`, `timezone`) use `?.trim() || default`. `schedulerEnabled` uses `?? true` (explicit `false` is preserved).

### Public methods

| Method | Role |
|--------|------|
| `createTeam` | Validate, load workspace, `team.create` with `safeTeamInclude` |
| `addMember` | Validate, load team + user, workspace check, `teamMember.upsert` |
| `getTeams` | `team.findMany` ordered by `createdAt` asc with include |
| `getTeam` | `team.findUnique` with include; 404 if missing |

There are no other public methods.

### Private helpers

**None.** There are no private methods.

`safeTeamInclude` is a `private readonly` include object. Tests cover it through create/list/get success paths.

### Validation logic

| Check | Location | Failure |
|-------|----------|---------|
| `workspaceId` after trim | `createTeam` | `BadRequestException` `'workspaceId is required.'` |
| `name` after trim | `createTeam` | `BadRequestException` `'name is required.'` |
| `teamId` after trim | `addMember` | `BadRequestException` `'teamId is required.'` |
| `userId` or `slackUserId` after trim | `addMember` | `BadRequestException` `'Either userId or slackUserId is required.'` |
| Workspace row exists | `createTeam` | `NotFoundException` |
| Team row exists | `addMember`, `getTeam` | `NotFoundException` |
| User row exists | `addMember` | `NotFoundException` (id vs Slack message) |
| Same workspace | `addMember` | `BadRequestException` workspace mismatch |

`getTeams` has no input validation.

### Exception paths

All `BadRequestException` and `NotFoundException` messages above have dedicated tests. Uncaught Prisma errors use `mockRejectedValue` on every Prisma call site.

### Complex branches

| Branch | How covered |
|--------|-------------|
| `input.x?.trim()` undefined vs empty string | Separate tests |
| Optional create fields `\|\|` defaults vs explicit vs whitespace | Three create tests |
| `schedulerEnabled ?? true` vs `false` | Omit vs explicit false |
| `userId` truthy → find by `id`, else by `slackUserId` | userId, slack-only, whitespace userId, both ids |
| User 404 message ternary | Missing user id vs missing Slack user |
| `role?.trim() \|\| 'member'` | Custom role vs whitespace vs omit |

### Dependencies

| Dependency | Role |
|------------|------|
| `PrismaService` | Only constructor injection |

No Slack, OpenAI, Jira, HTTP, or scheduler clients.

### Prisma operations used

| Model | Operation | Used by |
|-------|-----------|---------|
| `workspace` | `findUnique` | `createTeam` |
| `team` | `create` | `createTeam` |
| `team` | `findUnique` | `addMember`, `getTeam` |
| `team` | `findMany` | `getTeams` |
| `user` | `findUnique` | `addMember` (`id` or `slackUserId`) |
| `teamMember` | `upsert` | `addMember` |

### External dependencies

**None.** Persistence is the only I/O; it is mocked.

### What should be mocked

The entire `PrismaService` instance: `workspace.findUnique`, `team.create` / `findUnique` / `findMany`, `user.findUnique`, `teamMember.upsert`.

Do **not** mock Nest exceptions. Do **not** connect a database.

### Expected edge cases

- Undefined vs whitespace-only required strings (optional chaining + `if (!value)`)
- Optional create fields omitted vs whitespace vs explicit values; `schedulerEnabled: false`
- Missing workspace / team / user (id vs Slack id)
- User in another workspace
- Both `userId` and `slackUserId` provided (lookup prefers `userId`)
- Whitespace `userId` with a valid `slackUserId` (lookup by Slack id)
- Duplicate membership via upsert
- Empty `getTeams` list
- Prisma rejections on every call site

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
TeamService
    │
    ▼
PrismaService (useValue)
    ├── workspace.findUnique
    ├── team.create
    ├── team.findUnique
    ├── team.findMany
    ├── user.findUnique
    └── teamMember.upsert
```

- `beforeEach` builds a **fresh** mock object (no shared state).
- Success: `mockResolvedValue` with in-memory fixtures (`workspace`, `team`, `user`, `membership`).
- Not found: `null` from `findUnique`.
- Failures: `mockRejectedValue(new Error(...))`.
- Duplicate member: still a **single** `upsert` — the mock returns an updated role; the service never calls `create` + `findFirst`.

---

## Test cases implemented

**33 tests**, AAA, descriptive names.

| Area | Cases |
|------|--------|
| `createTeam` | Defaults when optionals omitted; explicit optionals including `schedulerEnabled: false`; undefined `workspaceId` / `name`; whitespace `workspaceId` / empty `name`; workspace 404; whitespace optionals → defaults; Prisma fail on workspace lookup; Prisma fail on create |
| `addMember` | Lookup by `userId` (trimmed) with custom role; lookup by `slackUserId`; whitespace `userId` falls through to Slack id; duplicate upsert; undefined / whitespace `teamId`; missing identifiers; both identifiers whitespace; team 404; user id 404; Slack user 404; workspace mismatch; whitespace role → `member`; both ids provided prefers `userId`; Prisma fail on team / user / upsert |
| `getTeams` | Ordered list; empty list; Prisma fail |
| `getTeam` | Found; `NotFoundException`; Prisma fail |

---

## Exception scenarios

| Exception | Trigger |
|-----------|---------|
| `BadRequestException` | Missing/blank `workspaceId`, `name`, `teamId`; neither member identifier; workspace mismatch |
| `NotFoundException` | Unknown workspace; unknown team (add or get); unknown user by id; unknown Slack user |
| Raw `Error` | Prisma `mockRejectedValue` on find/create/upsert/findMany — service does not catch these |

There is **no** dedicated duplicate-key HTTP mapping: uniqueness is handled by upsert. A unique-constraint error on `team.create` is propagated as a Prisma error (covered).

**Transaction failures:** not applicable — no `$transaction` in this service. Do not invent a transaction mock.

---

## Coverage

Scoped command (`TeamService` only):

```bash
cd pulse/backend
npx jest --coverage --collectCoverageFrom="src/team/team.service.ts" --testPathPattern="team.service.unit.spec"
```

**Real output (30 August 2026):**

```
PASS src/team/team.service.unit.spec.ts
Test Suites: 1 passed, 1 total
Tests:       33 passed, 33 total
Time:        5.231 s
```

| Metric | Result |
|--------|--------|
| **Statements** | **100%** |
| **Branches** | **100%** |
| **Functions** | **100%** |
| **Lines** | **100%** |

Uncovered line #s: *(none)*

**100% is achievable** because every branch (optional chaining, `||` defaults, `?? true`, `userId` vs `slackUserId` lookup, not-found messages) is reachable through the public API with mocked Prisma.

---

## TypeScript and build validation

Same pattern as Phase 3: import `describe`, `it`, `expect`, `beforeEach`, `jest` from `@jest/globals`. Specs are excluded from `npm run build` via `tsconfig.build.json`.

### `npm run build`

```
> nest build
```

**Result: success, exit code 0, zero errors.**

### `npm test`

```
PASS src/memory/memory-chunker.service.unit.spec.ts
PASS src/questions/questions.service.unit.spec.ts
PASS src/digest/digest.service.unit.spec.ts
PASS src/team/team.service.unit.spec.ts

Test Suites: 4 passed, 4 total
Tests:       120 passed, 120 total
Time:        8.805 s
```

(Phase 3: 87 tests. Phase 4 adds 33.)

---

## Production code

**`team.service.ts` was not modified.** No production changes were required.

GitHub Actions (`.github/workflows/backend-ci.yml`) was **not** changed.

---

## Lessons learned

1. **Optional chaining is a separate branch from empty string.** `input.workspaceId?.trim()` when the property is `undefined` is not the same as `workspaceId: '   '`. Both must be tested for 100% branches.
2. **`upsert` is the duplicate-member strategy.** Do not invent a `create`-then-conflict path the service does not implement.
3. **Lookup order is `userId` first.** Whitespace-only `userId` is falsy after trim, so Slack id is used; both populated prefers `userId`.
4. **`schedulerEnabled: false` is not the same as omitted.** `?? true` only applies when the value is `null`/`undefined`.
5. Unit `*.unit.spec.ts` is already on CI v1 — no workflow edit required.

---

## Remaining uncovered paths

None in `team.service.ts`.

Out of scope: `TeamController` HTTP, Prisma FK / unique errors mapped to HTTP (the service does not translate them), Slack invite/sync (not in this class).

---

## Recommendations

**Do not start Phase 5 until approved.**

Suggested Phase 5 unit target (Prisma-mock, still no real DB): **`AuthService`** or **`JiraAuditService`** — thin persistence with a small public surface, same Nest + mock pattern.

Alternatively **`MemoryOutboxService`** if the next priority is reliability/outbox rather than auth/audit.

Do **not** mix `pulse_test` into the unit suite.

---

## Approval gate

Unit Testing Phase 4 is complete. **Do not start Phase 5** until approved.
