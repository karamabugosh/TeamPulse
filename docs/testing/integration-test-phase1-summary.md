# Integration Test Phase 1 Summary

**Date:** August 30, 2026  
**Module:** QuestionsModule  
**Status:** Complete — wait for approval before Phase 2

---

## Files created

| File | Purpose |
|------|---------|
| `backend/integration/questions.integration.spec.ts` | HTTP + Prisma integration suite (12 tests) |
| `backend/integration/jest.integration.config.js` | Jest config isolated from `npm test` |
| `backend/integration/set-test-database-url.js` | Forces `DATABASE_URL` → `pulse_test`; refuses other DB names |
| `backend/integration/ensure-pulse-test-db.js` | Creates `pulse_test` and `prisma db push` to that DB only |
| `docs/testing/integration-test-phase1-report.md` | Full Phase 1 report |
| `docs/testing/integration-test-phase1-summary.md` | This summary |

---

## Files modified

| File | Change |
|------|--------|
| `backend/package.json` | Added `test:integration` and `test:integration:coverage`; added `supertest` / `@types/supertest` |
| `backend/package-lock.json` | Lockfile for new devDependencies |
| `backend/tsconfig.spec.json` | Included `integration/**/*` for ts-jest |

**Not modified:** `.github/workflows/backend-ci.yml`, `jest.config.js` (unit `testMatch` unchanged), any production `src/` files.

---

## Production code changes

**None.**

`PATCH /questions/:id` as a generic partial-update route **does not exist**. Tests use the real `PATCH /questions/:id/toggle` endpoint. No controller/service changes were made.

---

## Test database configuration

| Item | Value |
|------|--------|
| Development/demo database | `teampulse` (`backend/.env`) — **not used** |
| Integration database | `pulse_test` |
| URL | `postgresql://postgres:postgres@localhost:5432/pulse_test?schema=public` |
| Override | `DATABASE_URL_TEST` (optional) |
| Schema apply | `prisma db push` with `DATABASE_URL` set to `pulse_test` |
| Cleanup | `prisma.question.deleteMany()` before/after each test |

---

## New npm scripts

Existing `test`, `test:watch`, and `test:coverage` are **unchanged**.

| Script | Command |
|--------|---------|
| `test:integration` | Ensure `pulse_test` + run integration Jest |
| `test:integration:coverage` | Same, with coverage for `src/questions/**` |

---

## Commands to execute the integration tests

```bash
cd pulse/backend
npm run test:integration
```

```bash
cd pulse/backend
npm run test:integration:coverage
```

Unit tests (CI v1) remain:

```bash
cd pulse/backend
npm test
```

---

## Execution results (30 August 2026)

| Metric | Value |
|--------|-------|
| Test suites | **1 passed** |
| Tests | **12 passed** |
| Execution time | **32.976 s** |
| Pass/Fail | **Pass** |
| Module coverage (lines) | **78.68%** (QuestionsModule files only) |

---

## Lessons learned

1. **Never share the demo database.** Wiping `Question` is only safe on `pulse_test`.
2. **Prisma CLI loads `.env` but honors an already-set `DATABASE_URL`.** Spawn `db push` with the test URL in `env`.
3. **Keep integration files out of `test/**/*.spec.ts`.** Placing them under `integration/` leaves GitHub Actions CI v1 on `npm test` only.
4. **Do not boot `AppModule` for this phase.** Slack/scheduler would start and require secrets.
5. **HTTP 404 on PUT** requires `order` in the body with the current service (otherwise Prisma `P2025` may not map to 404).

---

## Recommendations for Phase 2

**Next module:** `TeamModule` (`TeamController` + `TeamService` + Prisma).

| Why next | Caution |
|----------|---------|
| Still no Slack/OpenAI HTTP | Needs `Workspace` (and usually `User`) fixtures in `pulse_test` |
| Clear REST surface | Larger FK graph than `Question` |
| Same `pulse_test` + `supertest` pattern | Keep isolation; never use `teampulse` |

Defer Check-In, Collection, Scheduler, Jira, and AI until later phases.

---

## Approval gate

Stop here. Do not implement TeamModule or CI v3 until approved.
