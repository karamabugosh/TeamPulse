# CI Implementation Plan — GitHub Actions

**Date:** August 30, 2026  
**Status:** Design only — awaiting approval before any workflow YAML is created  
**Scope:** Pulse backend Jest unit tests (Phase 1 + Phase 2)

---

> **Recommendation:** Start with a single backend CI job that installs dependencies, generates the Prisma client, runs Jest unit tests, publishes coverage as an artifact (no fail-on-threshold), then compiles the NestJS app. Do **not** add PostgreSQL, Slack, OpenAI, integration tests, or Playwright in v1.

---

## Table of Contents

1. [Project inspection](#1-project-inspection)
2. [Toolchain facts](#2-toolchain-facts)
3. [Prisma and environment](#3-prisma-and-environment)
4. [Services required during CI](#4-services-required-during-ci)
5. [Potential GitHub Actions failure modes](#5-potential-github-actions-failure-modes)
6. [Recommended pipeline](#6-recommended-pipeline)
7. [Stage-by-stage design](#7-stage-by-stage-design)
8. [Include / exclude matrix](#8-include--exclude-matrix)
9. [Workflow sketch (not YAML)](#9-workflow-sketch-not-yaml)
10. [Phased rollout](#10-phased-rollout)
11. [Approval gate](#11-approval-gate)

---

## 1. Project inspection

Pulse is a **monorepo-style app** under `pulse/`:

| Path | Role |
|------|------|
| `pulse/backend/` | NestJS API, Prisma, Jest unit tests |
| `pulse/frontend/` | Vite + React UI (**no unit tests**) |
| `pulse/docs/` | Documentation; Playwright exists only as a local screenshot helper, **no `playwright.config`** |
| `pulse/package.json` | Root file with `dotenv` only — **not** a workspace orchestrator |

**Current test surface for CI:**

| Kind | Location | Runner | CI v1? |
|------|----------|--------|:------:|
| Nest Jest unit tests | `src/**/*.unit.spec.ts` | `npm test` (Jest) | **Yes** |
| Ad-hoc `*.spec.ts` scripts | `src/**/*.spec.ts` | `ts-node` + Node `assert` | **No** (many need a live DB) |
| Frontend tests | — | None | **No** |
| Playwright E2E | — | None for the app | **No** |

There is **no** `.github/` directory yet.

---

## 2. Toolchain facts

| Item | Value |
|------|--------|
| **Language** | TypeScript 5.x (backend target ES2017 / CommonJS) |
| **Runtime** | Node.js (recommend **20 LTS** — matches `@types/node` `^20`) |
| **Framework** | NestJS 10 |
| **ORM** | Prisma 5.22 + PostgreSQL |
| **Package manager** | **npm** (`package-lock.json` present in `backend/` and `frontend/`) |
| **Test runner** | Jest 29 + ts-jest + `@nestjs/testing` |
| **Install command** | `npm ci` (prefer over `npm install` for CI reproducibility) |
| **Test command** | `npm test` → `jest` |
| **Coverage command** | `npm run test:coverage` → `jest --coverage` |
| **Build command** | `npm run build` → `nest build` |
| **Prisma generate** | `npm run prisma:generate` and **`postinstall`: `prisma generate`** |

Jest discovery (`pulse/backend/jest.config.js`):

- Includes: `src/**/*.unit.spec.ts`, `test/**/*.spec.ts`
- Excludes legacy `src/**/*.spec.ts` (ts-node scripts)
- `passWithNoTests: true` (CI will still pass if all unit tests are deleted — see risks)
- **No `coverageThreshold`** — coverage does not fail the job today

---

## 3. Prisma and environment

### What Prisma needs in CI

| Operation | Live PostgreSQL? | `DATABASE_URL` env var? |
|-----------|:----------------:|:----------------------:|
| `prisma generate` | **No** | **Yes** (schema uses `url = env("DATABASE_URL")`) |
| `prisma migrate` / seed | Yes | Yes |
| Jest unit tests (Phase 1–2) | **No** | No (except generate step) |

`MemoryChunkerService` unit tests import `MemoryVisibility` from `@prisma/client`. If generate is skipped or fails, **Phase 2 tests fail**.

`postinstall` already runs `prisma generate`, so a successful `npm ci` usually generates the client. A dedicated generate step is still recommended: clearer logs, and it survives `npm ci --ignore-scripts` if that is ever used.

### Dummy `DATABASE_URL` for generate only

Use a **placeholder**, not a real database:

```text
DATABASE_URL=postgresql://ci:ci@localhost:5432/ci?schema=public
```

This satisfies Prisma’s env check. It must **not** trigger `$connect`.

### Secrets **not** required for CI v1

| Variable | Needed for unit tests? |
|----------|:----------------------:|
| `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` / `SLACK_APP_TOKEN` | No |
| `OPENAI_API_KEY` | No |
| `JIRA_CLIENT_ID` / `JIRA_CLIENT_SECRET` | No |
| Real `DATABASE_URL` | No |
| Frontend `VITE_*` | No |

Do **not** copy `backend/.env` into CI. `.env` is gitignored and contains secrets.

---

## 4. Services required during CI

| Service | CI v1 | Later |
|---------|:-----:|-------|
| PostgreSQL | No | Integration / Prisma-backed tests |
| Redis | No | Not used |
| Slack / Socket Mode | No | Never for unit tests |
| OpenAI | No | Eval / live AI scripts only |
| Jira | No | Never for unit tests |
| Docker Compose | No | Optional for a future test DB |
| Browser / Playwright | No | Frontend E2E later |

**CI v1 runs on a stock `ubuntu-latest` runner with Node 20 only.**

---

## 5. Potential GitHub Actions failure modes

### High likelihood if not handled

| Risk | Why it fails | Mitigation |
|------|----------------|------------|
| **Wrong working directory** | App lives in `pulse/backend/`, not repo root | Set `defaults.run.working-directory` (or `cd`) to the backend folder relative to the **git root** |
| **Missing `DATABASE_URL` during generate** | `schema.prisma` requires `env("DATABASE_URL")` | Set a dummy `DATABASE_URL` on the job |
| **Prisma client missing** | Tests import `@prisma/client` | Run `npm ci` (triggers `postinstall`) **and** explicit `npx prisma generate` |
| **`npm install` drift** | Unlocked installs | Use `npm ci` + committed `package-lock.json` |
| **Windows vs Linux path/case** | Local dev is Windows; GHA is Linux. `forceConsistentCasingInFileNames` is **false** locally, so case bugs may only appear on CI | Keep imports case-correct; consider enabling case-sensitive checks later |

### Medium likelihood

| Risk | Why it fails | Mitigation |
|------|----------------|------------|
| **`nest build` compiles `*.unit.spec.ts`** | No `nest-cli.json` and no `tsconfig.build.json`. Default Nest compile includes `src/**/*`. Jest types are not in app `tsconfig.json` (`types: ["node"]` only). `noImplicitAny` is false, so it **may still compile**, but this is fragile | Before enabling Build as a **required** gate, add `tsconfig.build.json` excluding `**/*.spec.ts` and `**/*.unit.spec.ts` (small, standard Nest file — do this when implementing Build, not tests) |
| **Coverage used as a fail gate too early** | `test:coverage` collects **entire** `src/` (~70 services). Overall % will be **low** even with 100% on Digest + Chunker | Publish coverage as artifact; **do not** set `coverageThreshold` until more services are tested |
| **`passWithNoTests: true`** | Empty suite still exits 0 | Keep at least the two `*.unit.spec.ts` files; later require `npm test` to run ≥1 suite via Jest `testFailureExitCode` / dropping `passWithNoTests` |
| **Git repository root mismatch** | This workspace may sit inside a larger/user-level git repo | Place `.github/workflows/` at the **actual GitHub repo root**. Confirm with `git rev-parse --show-toplevel` before adding the file |

### Do not enable yet (would fail today)

| Step | Why it would fail |
|------|-------------------|
| Legacy `npm run test:memory-phase2a` (etc.) | Live Prisma + seeded PostgreSQL |
| `npm run test:ai-workspace-eval` | OpenAI + workspace data |
| Frontend `npm test` | Script does not exist |
| Playwright | No app E2E config |
| `prisma migrate deploy` | Needs a real database |

---

## 6. Recommended pipeline

**Name:** `backend-ci`  
**Trigger:** `pull_request` + `push` to `main` / `master`  
**Runner:** `ubuntu-latest`  
**Node:** `20`  
**Working directory:** backend package (e.g. `pulse/backend` or `backend`, depending on git root)

**v1 job shape (single sequential job):**

1. Checkout  
2. Setup Node 20 with npm cache  
3. `npm ci`  
4. `npx prisma generate` (dummy `DATABASE_URL`)  
5. `npm test` (**required gate**)  
6. `npm run test:coverage` (**informational**; upload `coverage/` artifact)  
7. `npm run build` (**recommended**, after confirming Nest excludes spec files)

Keep **one job** for v1. Parallel frontend jobs can wait until frontend tests exist.

---

## 7. Stage-by-stage design

### Stage 1 — Checkout

Clone the repository at the commit under test. Required for every later step.

### Stage 2 — Setup Node + cache

- Node **20**
- Cache npm via `actions/setup-node` `cache: npm` and `cache-dependency-path` pointing at backend `package-lock.json`

### Stage 3 — Install

```bash
npm ci
```

**Include: yes (required).**  
Reproducible lockfile install. `postinstall` runs `prisma generate`.

### Stage 4 — Prisma generate

```bash
npx prisma generate
```

**Include: yes (required).**  
Even though `postinstall` already generates, an explicit step:

- Makes CI logs obvious if generate fails
- Guarantees `@prisma/client` exists for `MemoryVisibility` imports
- Uses dummy `DATABASE_URL` only — **no migrate, no db push, no seed**

### Stage 5 — Unit tests

```bash
npm test
```

**Include: yes (required gate).**  
Runs Jest `*.unit.spec.ts` only (DigestService + MemoryChunkerService today).  
No PostgreSQL, Slack, or OpenAI.

Fail the workflow if this step fails.

### Stage 6 — Coverage

```bash
npm run test:coverage
```

**Include: yes, as informational — not as a fail gate.**

- Upload `pulse/backend/coverage/` (or `backend/coverage/`) as a GitHub Actions artifact
- Optionally print the Jest coverage table in the log
- **Do not** fail on global coverage % yet (whole `src/` is mostly untested)

Later: add `coverageThreshold` **only for files that have unit tests**, or a coverage comment bot.

### Stage 7 — Build

```bash
npm run build
```

**Include: yes, after a one-time Nest compile hygiene check.**

Purpose: catch TypeScript/Nest compile errors that tests might miss (`main.ts`, modules).

**Before making this a required gate**, confirm `nest build` does not choke on `*.unit.spec.ts`. Preferred small production change (when implementing CI, not now):

- Add `tsconfig.build.json` excluding `**/*.spec.ts`, `**/*.unit.spec.ts`, `scripts`
- Add `nest-cli.json` with `sourceRoot: src`

If you prefer **zero production file changes** in the first CI PR: run tests only, add Build in CI v1.1.

### Stage 8 — Integration tests

**Include: later — not in v1.**

Needs PostgreSQL (service container), migrations, seed data, and a test `DATABASE_URL`. Legacy `memory-phase*.spec.ts` scripts belong here, not in `npm test`.

### Stage 9 — Playwright

**Include: later — not in v1.**

Frontend has no Playwright test project. `docs/node_modules/playwright` is for screenshot capture, not CI E2E.

---

## 8. Include / exclude matrix

| Stage | Include in CI v1? | Required to pass? | Notes |
|-------|:-----------------:|:-----------------:|-------|
| Install (`npm ci`) | **Yes** | Yes | Lockfile + postinstall generate |
| Prisma generate | **Yes** | Yes | Dummy `DATABASE_URL`; no DB |
| Unit tests (`npm test`) | **Yes** | **Yes** | Only Jest `*.unit.spec.ts` |
| Coverage (`npm run test:coverage`) | **Yes** | **No** | Artifact only; no threshold |
| Build (`nest build`) | **Yes (recommended)** | Yes, after exclude-spec hygiene | Optional delay if you want zero extra files |
| Integration tests | **Later** | — | Needs Postgres |
| Playwright | **Later** | — | No app E2E yet |
| Frontend `vite build` | Optional later | — | No tests; can be a second job |
| Lint / ESLint | **No** | — | No ESLint config found in backend |
| `prisma migrate` | **No** | — | Needs live DB |
| Slack / OpenAI secrets | **No** | — | Unused by unit tests |

---

## 9. Workflow sketch (not YAML)

This is the intended structure. **No workflow file will be created until you approve.**

```
name: Backend CI
on: [pull_request, push to main]

job: unit
  runs-on: ubuntu-latest
  env:
    DATABASE_URL: postgresql://ci:ci@localhost:5432/ci?schema=public
  defaults:
    working-directory: <backend path relative to git root>
  steps:
    - checkout
    - setup-node 20 (npm cache)
    - npm ci
    - npx prisma generate
    - npm test
    - npm run test:coverage
    - upload-artifact: coverage/
    - npm run build          # if Nest spec exclusion is in place
```

**Permissions:** default `contents: read` is enough for v1.

**Concurrency:** cancel in-progress runs on the same PR (optional, recommended).

---

## 10. Phased rollout

| CI version | What ships |
|------------|------------|
| **v1 (now)** | Install → Prisma generate → Jest unit tests → coverage artifact → (build) |
| **v1.1** | `tsconfig.build.json` + `nest-cli.json`; Build is a hard gate |
| **v2** | Optional frontend typecheck/`vite build` job |
| **v3** | Postgres service + selected integration specs |
| **v4** | Playwright against preview/staging |

---

## 11. Approval gate

This document is a **plan only**. No `.github/workflows/*.yml` has been created.

**Please confirm before implementation:**

1. GitHub repo root path (so `working-directory` is correct)
2. Whether CI v1 should include **Build** immediately, or tests-only first
3. Whether to add the small Nest `tsconfig.build.json` / `nest-cli.json` files as part of the CI PR

After approval, the first YAML should implement **v1 only**.
