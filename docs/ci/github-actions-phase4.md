# GitHub Actions — Phase 4 (CI v4)

**Date:** August 30, 2026  
**Status:** Implemented — awaiting approval before CI v5 (Playwright)  
**Workflow file:** `.github/workflows/backend-ci.yml` (same file as v1–v3; not a second workflow)  
**GitHub repository:** [karamabugosh/TeamPulse](https://github.com/karamabugosh/TeamPulse)  
**Working directory:** `backend/`

---

> **CI v4 adds quality gates before Build:** Prisma validate, TypeScript `--noEmit`, and a reported `npm audit`. Existing generate, build, unit tests, integration tests (ephemeral Postgres), coverage, and artifact upload remain.

---

## Workflow architecture

One job, one YAML file:

```
ubuntu-latest
    ├── Service: postgres:16 (CI-only `pulse_test`, from v3)
    └── Steps: quality gates → build → unit → integration → coverage
```

No second workflow. No automatic dependency upgrades.

---

## Execution order

```
Checkout
    ↓
Setup Node.js 20
    ↓
Install dependencies (`npm ci`)
    ↓
Prisma validate (`npx prisma validate`)
    ↓
Prisma generate (`npx prisma generate`)
    ↓
Type check (`npx tsc --noEmit`)
    ↓
Audit dependencies (`npm audit --audit-level=high`, report only)
    ↓
Build (`npm run build`)
    ↓
Unit tests (`npm test`)
    ↓
Wait for PostgreSQL
    ↓
Prisma db push
    ↓
Integration tests (`npm run test:integration`)
    ↓
Coverage
    ↓
Upload coverage artifact
```

---

## CI quality gates

| Gate | Command | Fail the job? |
|------|---------|----------------|
| Prisma schema | `npx prisma validate` | **Yes**, immediately |
| TypeScript | `npx tsc --noEmit` | **Yes**, immediately |
| Dependency audit | `npm audit --audit-level=high` | **No** — report in the log (`continue-on-error`) |
| Build | `npm run build` | Yes |
| Unit tests | `npm test` | Yes |
| Integration tests | `npm run test:integration` | Yes |

Project policy: do **not** fail CI on known Nest 10 transitive HIGH findings, and do **not** run `npm audit fix`.

---

## Prisma validation

| Item | Detail |
|------|--------|
| Command | `npx prisma validate` |
| When | After `npm ci`, **before** generate |
| Fail | Invalid `schema.prisma` stops the job |
| Does not | Query Postgres, migrate, or `db push` |

---

## TypeScript validation

| Item | Detail |
|------|--------|
| Command | `npx tsc --noEmit` |
| Config | `backend/tsconfig.json` (specs excluded) |
| When | After `prisma generate` so `@prisma/client` types exist |
| Fail | Any type error stops the job before Build |

---

## Dependency audit

| Item | Detail |
|------|--------|
| Command | `npm audit --audit-level=high` |
| When | After type check, before Build |
| Behavior | Prints HIGH/CRITICAL findings; step is allowed to fail without failing the workflow |
| Not done | `npm audit fix`, `--force`, package upgrades, new dependencies |

Current local/CI tree reports HIGH issues (for example **multer** via `@nestjs/platform-express` on Nest 10). They stay in the log until a separate, approved upgrade.

---

## Runtime impact

| Step | Typical extra time |
|------|-------------------|
| `prisma validate` | ~2–5 s |
| `tsc --noEmit` | ~10–20 s |
| `npm audit` | ~5–15 s |
| **Added vs CI v3** | **about 20–40 s** |
| **Warm job total** | **about 4–7 minutes** |

---

## Future roadmap

| Version | Add | Still excluded |
|---------|-----|----------------|
| **v1** | Unit tests + coverage artifact | Build, DB |
| **v2** | `nest build` | Postgres |
| **v3** | Ephemeral Postgres + integration tests | Quality gates |
| **v4 (this phase)** | Prisma validate, `tsc --noEmit`, npm audit (report) | Playwright |
| **v5** | Playwright / frontend E2E as approved | Live third-party APIs unless mocked |

---

## Approval gate

CI v4 is complete. **Do not add Playwright (CI v5)** until approved.
