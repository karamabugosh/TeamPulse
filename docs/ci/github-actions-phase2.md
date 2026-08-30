# GitHub Actions — Phase 2 (CI v2)

**Date:** August 30, 2026  
**Status:** Implemented — awaiting approval before CI v3 (integration tests)  
**Workflow file:** `.github/workflows/backend-ci.yml` (same file as CI v1; not a second workflow)  
**GitHub repository:** [karamabugosh/TeamPulse](https://github.com/karamabugosh/TeamPulse)  
**Working directory:** `backend/` (NestJS package at the repository root)

---

> **CI v2 adds `npm run build` as a hard gate** after Prisma generate and before unit tests. Still no PostgreSQL, no integration tests, no Playwright.

---

## Workflow overview

CI v2 extends the single **Backend CI** workflow:

| Still from v1 | New in v2 |
|---------------|-----------|
| Checkout, Node 20, `npm ci` | **`npm run build`** (`nest build`) |
| Dummy `DATABASE_URL` + `prisma generate` | Build failure **fails the job immediately** |
| `npm test` + `npm run test:coverage` | — |
| Coverage artifact `backend-unit-coverage` | — |

Triggers, concurrency, and permissions are unchanged (`push`, `pull_request`, cancel in-progress, `contents: read`).

The job name is **Build and unit tests**. There is still **one** job and **one** YAML file.

---

## Execution order

```
Checkout
    ↓
Setup Node.js 20
    ↓
Install dependencies (`npm ci`)
    ↓
Prisma generate (`npx prisma generate`)
    ↓
Build (`npm run build`)
    ↓
Unit tests (`npm test`)
    ↓
Coverage (`npm run test:coverage`)
    ↓
Upload coverage artifact
```

GitHub Actions skips remaining steps when a step fails (no `continue-on-error` on Build). If `nest build` fails, unit tests, coverage, and the artifact upload **do not run**.

---

## Build validation

| Item | Detail |
|------|--------|
| Command | `npm run build` → `nest build` |
| Directory | `backend/` (`defaults.run.working-directory`) |
| Config | `nest-cli.json` → `tsconfig.build.json` (excludes `**/*.spec.ts` and `**/*.unit.spec.ts`) |
| Database | **Not used.** Compile does not connect to PostgreSQL |
| Secrets | **Not required** |

A TypeScript or Nest compile error fails the workflow. This catches production compile breaks that unit tests alone might miss.

---

## Unit testing

Unchanged from CI v1 except that tests run **only if Build succeeded**.

| Item | Detail |
|------|--------|
| Command | `npm test` → Jest |
| Discovery | `src/**/*.unit.spec.ts` only |
| Excluded | Legacy `src/**/*.spec.ts` (ts-node), `backend/integration/` |
| Database | **Not used.** Prisma is mocked or unused in these suites |

Current unit suites (local `npm test` at the time of this document): Digest, MemoryChunker, Questions, Team — **120** tests.

---

## Coverage upload

Unchanged from CI v1:

1. `npm run test:coverage` (Jest `--coverage`; **no** `coverageThreshold`)
2. Upload `backend/coverage` as artifact **`backend-unit-coverage`** (14-day retention, fail if missing)

Download from **Actions → selected run → Artifacts**.

---

## Expected runtime

Approximate on `ubuntu-latest` (network and cache vary):

| Segment | Typical |
|---------|---------|
| Checkout + Node + `npm ci` (warm cache) | ~30–90 s |
| Prisma generate | ~5–15 s |
| `nest build` | ~15–40 s |
| Unit tests + coverage (Jest twice) | ~20–40 s |
| Artifact upload | ~5–15 s |
| **Total (warm)** | **about 2–4 minutes** |
| **Cold** (no npm cache) | **about 3–6 minutes** |

Local confirmation (developer machine, 30 August 2026): `npm run build` exit 0; `npm test` 4 suites, 120 tests, **9.455 s**.

---

## What CI v2 still does not do

- PostgreSQL service container
- `prisma migrate` / seed
- Integration tests (`npm run test:integration` / `pulse_test`)
- Playwright / frontend build
- Slack, OpenAI, Jira live calls
- Coverage percentage as a fail gate

Dummy `DATABASE_URL` remains generate-only. It is not a real database.

---

## Local equivalent

From the repository root (`pulse/`):

```bash
cd backend
npm ci
npx prisma generate
npm run build
npm test
npm run test:coverage
```

---

## Future roadmap

| Version | Add | Still excluded until then |
|---------|-----|---------------------------|
| **v1** | Install, Prisma generate, Jest, coverage artifact | Build, DB, E2E |
| **v2 (this phase)** | **`nest build` as a hard gate** | Postgres, integration, Playwright |
| **v3** | PostgreSQL + selected integration specs (`pulse_test` only) | Live Slack/OpenAI, Playwright |
| **v4** | Playwright / frontend build as needed | Live third-party APIs unless mocked |

---

## Approval gate

CI v2 is complete. **Do not add integration tests to GitHub Actions (CI v3)** until approved.
