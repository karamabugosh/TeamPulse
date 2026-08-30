# GitHub Actions — Phase 3 (CI v3)

**Date:** August 30, 2026  
**Status:** Implemented — awaiting approval before CI v4 (Playwright)  
**Workflow file:** `.github/workflows/backend-ci.yml` (same file as v1/v2; not a second workflow)  
**GitHub repository:** [karamabugosh/TeamPulse](https://github.com/karamabugosh/TeamPulse)  
**Working directory:** `backend/`

---

> **CI v3 adds an ephemeral PostgreSQL service and integration tests** after unit tests. Schema is applied with `prisma db push` only. No `migrate deploy`, no Playwright, no live Slack/OpenAI/Jira.

---

## Workflow architecture

One job, one YAML file:

```
GitHub-hosted runner (ubuntu-latest)
    │
    ├── Service: postgres:16  (job-scoped container, destroyed after the job)
    │         POSTGRES_DB=pulse_test
    │
    └── Steps
          Checkout → Node 20 → npm ci → prisma generate → nest build
          → npm test (unit)
          → wait for Postgres → prisma db push → npm run test:integration
          → unit coverage → upload artifact
```

The database name **`pulse_test`** matches the integration safety rails (`set-test-database-url.js` refuses any other name). That name lives **inside the Actions service container**, not on a developer laptop. CI never uses **`teampulse`**.

`POSTGRES_USER` / `POSTGRES_PASSWORD` are `postgres` / `postgres` so the existing `ensure-pulse-test-db.js` admin URL (`postgresql://postgres:postgres@localhost:5432/postgres`) works **without changing integration scripts**.

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
Wait for PostgreSQL
    ↓
Prisma db push (`npx prisma db push --skip-generate`)
    ↓
Integration tests (`npm run test:integration`)
    ↓
Coverage (`npm run test:coverage`)
    ↓
Upload coverage artifact
```

Unit tests and integration tests are **separate steps**. Integration tests do not run if unit tests fail. Coverage and artifact upload do not run if integration tests fail (no `continue-on-error`).

---

## PostgreSQL service configuration

| Setting | Value |
|---------|--------|
| Image | `postgres:16` |
| `POSTGRES_DB` | `pulse_test` |
| `POSTGRES_USER` | `postgres` |
| `POSTGRES_PASSWORD` | `postgres` |
| Port | `5432:5432` (localhost on the job) |
| Healthcheck | `pg_isready -U postgres -d pulse_test` (interval 10s, timeout 5s, retries 5) |

GitHub does not start job steps until the service healthcheck passes. A Node TCP wait step then confirms `localhost:5432` before `db push`.

---

## Environment variables

Set at workflow `env` (available to every step):

| Variable | CI value | Purpose |
|----------|----------|---------|
| `POSTGRES_DB` | `pulse_test` | Database created in the service |
| `POSTGRES_USER` | `postgres` | Role for the service and Prisma |
| `POSTGRES_PASSWORD` | `postgres` | Password for that role |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/pulse_test?schema=public` | Prisma generate, `db push`, Jest |
| `DATABASE_URL_TEST` | same | `set-test-database-url.js` pin |

No GitHub Secrets are required. This is **not** production and **not** the local `teampulse` `.env`.

---

## Prisma db push

| Item | Detail |
|------|--------|
| Command | `npx prisma db push --skip-generate` |
| Target | CI `DATABASE_URL` only (`pulse_test` on the service) |
| **Not used** | `prisma migrate deploy`, `migrate dev`, production migration files |

`db push` syncs `schema.prisma` onto an empty CI database. Integration `npm run test:integration` also runs `ensure-pulse-test-db.js`, which may push again; that is idempotent.

---

## Integration test execution

`npm run test:integration` → ensure `pulse_test` + `prisma db push` + Jest (`backend/integration/`).

Current suite: QuestionsModule HTTP + Prisma (Phase 1). Safety rails refuse any database name other than `pulse_test`.

---

## Failure behavior

| Failure | Workflow |
|---------|----------|
| Build / unit tests | Job fails; Postgres wait, db push, and integration **do not run** |
| Postgres never ready | Wait step fails; integration **does not run** |
| `db push` fails | Job fails; integration **does not run** |
| Integration tests fail | Job fails immediately; coverage/artifact **do not run** |

---

## Runtime expectations

Approximate on `ubuntu-latest` (warm npm cache):

| Segment | Typical |
|---------|---------|
| Checkout, Node, `npm ci`, generate, build, unit tests | ~2–4 min |
| Postgres ready (usually already healthy) | seconds |
| `db push` + integration tests | ~30–90 s |
| Unit coverage + artifact | ~20–40 s |
| **Total (warm)** | **about 3–6 minutes** |
| **Cold** | **about 4–8 minutes** |

Local confirmation (developer machine, 30 August 2026): `npm run build` exit 0; `npm test` 4 suites, 120 tests, **7.459 s**; `npm run test:integration` 1 suite, 12 tests, **7.548 s** (local `pulse_test` only).

---

## What CI v3 still does not do

- `prisma migrate deploy`
- Playwright / frontend E2E
- Live Slack, OpenAI, or Jira
- Coverage percentage as a fail gate
- Connecting to a developer `teampulse` or a laptop `pulse_test`

---

## Local equivalent (developer machine)

Uses **local** `pulse_test` only — not GitHub’s container, not `teampulse`:

```bash
cd backend
npm run build
npm test
npm run test:integration
```

---

## Future CI roadmap

| Version | Add | Still excluded |
|---------|-----|----------------|
| **v1** | Unit tests + coverage artifact | Build, DB |
| **v2** | `nest build` | Postgres, integration |
| **v3 (this phase)** | Ephemeral Postgres + `db push` + integration tests | Playwright |
| **v4** | Playwright / frontend E2E as approved | Live third-party APIs unless mocked |

---

## Approval gate

CI v3 is complete. **Do not add Playwright (CI v4)** until approved.
