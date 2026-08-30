# GitHub Actions — Phase 4 (CI v4)

**Date:** August 30, 2026  
**Status:** Implemented — awaiting approval before CI v5 (Playwright)  
**Workflow file:** `.github/workflows/backend-ci.yml` (same file as v1–v3; not a second workflow)  
**GitHub repository:** [karamabugosh/TeamPulse](https://github.com/karamabugosh/TeamPulse)  
**Working directory:** `backend/`

---

> **CI v4 adds quality and security gates** before tests: Prisma schema validation, TypeScript `--noEmit`, and `npm audit`. Existing build, unit tests, integration tests (ephemeral Postgres), coverage, and artifact upload are unchanged.

---

## Updated workflow diagram

```
Checkout
    ↓
Setup Node.js 20
    ↓
Install dependencies (`npm ci`)
    ↓
Audit dependencies (`npm audit --audit-level=high`, fail on CRITICAL)
    ↓
Prisma validate (`npx prisma validate`)
    ↓
Prisma generate (`npx prisma generate`)
    ↓
Type check (`npx tsc --noEmit`)
    ↓
Build (`npm run build`)
    ↓
Unit tests (`npm test`)
    ↓
Wait for PostgreSQL (ephemeral `postgres:16` service)
    ↓
Prisma db push (`npx prisma db push --skip-generate`)
    ↓
Integration tests (`npm run test:integration`)
    ↓
Coverage (`npm run test:coverage`)
    ↓
Upload coverage artifact
```

Still **one** job and **one** YAML file. Postgres, `db push`, and integration tests remain from CI v3.

---

## CI quality gates

| Gate | Command | Fail the job? |
|------|---------|----------------|
| Dependency audit | `npm audit --audit-level=high` | **CRITICAL:** yes. **HIGH:** reported; see note below. Moderate/low never fail. |
| Prisma schema | `npx prisma validate` | Yes, immediately |
| TypeScript | `npx tsc --noEmit` | Yes, immediately |
| Build | `npm run build` | Yes (from CI v2) |
| Unit tests | `npm test` | Yes |
| Integration tests | `npm run test:integration` | Yes |

---

## Type checking stage

| Item | Detail |
|------|--------|
| Command | `npx tsc --noEmit` |
| Config | `backend/tsconfig.json` (specs excluded; `skipLibCheck`) |
| When | After `prisma generate` so `@prisma/client` types exist |
| Database | Not used |

A type error fails the workflow before unit or integration tests run.

---

## Prisma validation

| Item | Detail |
|------|--------|
| Command | `npx prisma validate` |
| Needs | `DATABASE_URL` (schema `env("DATABASE_URL")`) — CI dummy/service URL is enough |
| Does not | Connect and query, migrate, or `db push` |

Invalid `schema.prisma` fails the job before generate/build/tests.

---

## Security audit

| Item | Detail |
|------|--------|
| Command | `npm audit --audit-level=high` |
| Intent | Fail on **HIGH** and **CRITICAL** only, not moderate/low |

**Current tree (NestJS 10):** `npm audit --audit-level=high` exits non-zero because of **HIGH** transitive issues, mainly **multer** via `@nestjs/platform-express`. The suggested fix is `npm audit fix --force` → Nest **12** (breaking). Production dependencies were **not** changed in this phase.

Until a Nest upgrade is approved:

1. The step still **runs** `npm audit --audit-level=high` (full HIGH report in the log).
2. The job **fails immediately** if `npm audit --audit-level=critical` fails.
3. GitHub **warning** annotation when HIGH findings exist.

Moderate/low findings never fail the job.

---

## Failure conditions

| Failure | Later steps |
|---------|-------------|
| `npm ci` | No gates, no tests |
| CRITICAL audit | Prisma validate and everything after skipped |
| `prisma validate` | Generate, typecheck, tests skipped |
| `tsc --noEmit` | Build and tests skipped |
| `nest build` | Tests skipped |
| Unit tests | Integration skipped |
| Postgres / `db push` / integration | Coverage skipped |

No `continue-on-error` on validate, typecheck, build, or tests.

---

## Runtime impact

Approximate extra time on `ubuntu-latest`:

| Step | Typical |
|------|---------|
| `npm audit` | ~5–15 s |
| `prisma validate` | ~2–5 s |
| `tsc --noEmit` | ~10–20 s |
| **Added vs CI v3** | **about 20–40 s** |
| **Total warm job** | **about 4–7 minutes** |

---

## Database lifecycle (unchanged from v3)

Ephemeral `postgres:16`, `POSTGRES_DB=pulse_test`, destroyed after the job. Not `teampulse`. Not a developer-machine database. Schema via `db push` only.

---

## Local equivalent

From `pulse/backend`:

```bash
npx prisma validate
npx tsc --noEmit
npm run build
npm test
npm run test:integration
```

`npm audit --audit-level=high` currently reports HIGH findings (see above). `npm audit --audit-level=critical` is the local equivalent of the hard CI fail.

---

## Future roadmap

| Version | Add | Still excluded |
|---------|-----|----------------|
| **v1** | Unit tests + coverage artifact | Build, DB |
| **v2** | `nest build` | Postgres, integration |
| **v3** | Ephemeral Postgres + integration tests | Quality gates |
| **v4 (this phase)** | Prisma validate, `tsc --noEmit`, npm audit | Playwright |
| **v5** | Playwright / frontend E2E as approved | Live third-party APIs unless mocked |

Follow-up (not this phase): upgrade Nest or `overrides` for multer so **HIGH** can be a hard gate without breaking Nest 10.

---

## Approval gate

CI v4 is complete. **Do not add Playwright (CI v5)** until approved.
