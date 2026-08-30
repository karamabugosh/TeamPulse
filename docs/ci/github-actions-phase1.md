# GitHub Actions — Phase 1 (CI v1)

**Date:** August 30, 2026  
**Status:** Implemented — awaiting approval before CI v1.1 (Build)  
**Workflow file:** `.github/workflows/backend-ci.yml`  
**GitHub repository:** [karamabugosh/TeamPulse](https://github.com/karamabugosh/TeamPulse)  
**Working directory:** `backend/` (NestJS package at the repository root)

---

> **CI v1 runs Jest unit tests only.** It does not compile the Nest app, migrate a database, or call Slack, OpenAI, or Jira.

---

## CI objective

Automatically run the Pulse backend **Jest unit test suite** on every `push` and every `pull_request`, so regressions in `DigestService` and `MemoryChunkerService` are caught before merge.

CI v1 is intentionally infrastructure-free: no PostgreSQL service, no secrets, and no live integrations.

---

## Workflow stages

| Order | Stage | Command / action | Required to pass? |
|------:|-------|------------------|:-----------------:|
| 1 | Checkout | `actions/checkout@v4` | Yes |
| 2 | Setup Node.js 20 | `actions/setup-node@v4` + npm cache | Yes |
| 3 | Install | `npm ci` | Yes |
| 4 | Prisma generate | `npx prisma generate` | Yes |
| 5 | Unit tests | `npm test` | **Yes** |
| 6 | Coverage | `npm run test:coverage` | Yes (run must succeed; **no coverage % threshold**) |
| 7 | Upload artifact | `actions/upload-artifact@v4` of `backend/coverage` | Yes |

**Not included in v1:** Build (`nest build`), Prisma migrate, seed, PostgreSQL, integration tests, Playwright, Slack, OpenAI, Jira.

---

## Trigger events

Defined in `.github/workflows/backend-ci.yml`:

| Event | When it runs |
|-------|----------------|
| `push` | Every push to any branch |
| `pull_request` | Every pull request |

Superseded runs on the same ref are cancelled (`concurrency.cancel-in-progress: true`).

---

## Environment variables used

| Variable | Value in CI | Purpose |
|----------|-------------|---------|
| `DATABASE_URL` | `postgresql://ci:ci@localhost:5432/ci?schema=public` | Satisfies Prisma schema `env("DATABASE_URL")` during **generate only** |

No GitHub Secrets are required for CI v1.

The following are **not** set and **not** needed:

- `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`
- `OPENAI_API_KEY`
- `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET`
- A real production or staging `DATABASE_URL`

---

## Why a dummy `DATABASE_URL` is sufficient

`pulse/backend/prisma/schema.prisma` declares:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

`prisma generate` **reads the schema and writes the TypeScript client**. It does **not** open a TCP connection to PostgreSQL.

Phase 2 unit tests import Prisma **enums** (for example `MemoryVisibility` from `@prisma/client`). Those types exist only after generate. They do not query the database.

A dummy URL is therefore enough. `prisma migrate`, `db push`, and seed are **out of scope** for v1.

---

## How coverage artifacts are produced

1. `npm run test:coverage` runs Jest with `--coverage` (see `backend/package.json`).
2. `backend/jest.config.js` writes reports to `backend/coverage/` (`text`, `lcov`, `json-summary`).
3. Coverage is collected from `src/**/*.(t|j)s`, excluding spec files and `main.ts`.
4. The workflow uploads `backend/coverage` as artifact **`backend-unit-coverage`** (14-day retention).

Download the artifact from the GitHub Actions run page: **Actions → selected run → Artifacts**.

**There is no `coverageThreshold`.** Global coverage across all of `src/` is still low because only two services have Jest suites. The coverage step must not fail the pipeline on percentage.

Expected unit test counts at the time of this document:

| Suite | Tests |
|-------|------:|
| `digest.service.unit.spec.ts` | 28 |
| `memory-chunker.service.unit.spec.ts` | 30 |
| **Total** | **58** |

---

## Local equivalent

From the repository root (`pulse/`):

```bash
cd backend
npm ci
npx prisma generate
npm test
npm run test:coverage
```

Set `DATABASE_URL` only if generate complains it is missing (local `.env` already provides it).

---

## Future roadmap

| Version | Add | Still excluded until then |
|---------|-----|---------------------------|
| **v1 (this phase)** | Install, Prisma generate, Jest, coverage artifact | Build, DB, E2E |
| **v1.1** | `nest build` after `tsconfig.build.json` / `nest-cli.json` exclude spec files | Postgres |
| **v2** | Optional frontend typecheck / `vite build` | App E2E |
| **v3** | PostgreSQL service container + selected integration specs | Live Slack/OpenAI |
| **v4** | Playwright against a running app | — |

Do **not** add Build until CI v1.1 is approved.

---

## Approval gate

CI v1 is complete. **Do not implement CI v1.1 (Build)** until approved.
