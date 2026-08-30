# GitHub Actions — Phase 5 (CI v5)

**Date:** August 30, 2026  
**Status:** Implemented — awaiting approval before Deployment  
**Workflow file:** `.github/workflows/backend-ci.yml` (same file as v1–v4; not a second workflow)  
**GitHub repository:** [karamabugosh/TeamPulse](https://github.com/karamabugosh/TeamPulse)

---

> **CI v5 runs the project’s existing Playwright command** after integration tests. There is **no** `playwright.config` and **no** `@playwright/test` suite. The existing automation is `docs/capture-screenshots.mjs` (`node capture-screenshots.mjs`). A new Playwright project was **not** created.

---

## Updated CI architecture

```
ubuntu-latest
    ├── Service: postgres:16 (`pulse_test`, from v3)
    └── One job
          Quality gates (v4)
          → nest build
          → unit tests
          → integration tests
          → frontend npm ci
          → Playwright browsers
          → start backend + frontend
          → readiness HTTP checks
          → node capture-screenshots.mjs
          → unit coverage + upload
          → Playwright artifacts (always)
```

---

## Playwright stage

| Item | Detail |
|------|--------|
| Config file | **None** (`playwright.config.*` does not exist) |
| Test runner | **Not** `npx playwright test` — that command is not defined |
| Existing command | `node capture-screenshots.mjs` (documented in `docs/TECHNICAL_DOCUMENTATION.md`) |
| Package | `playwright` (Chromium API), installed in CI under `docs/` |

The script opens dashboard routes (`/overview`, `/checkins`, `/teams`, `/reports`, `/settings`) and the Create CheckIn dialog, and writes PNGs to `docs/screenshots/`.

---

## Browser installation

```bash
cd docs
npm install playwright
npx playwright install --with-deps
```

`--with-deps` installs OS libraries on `ubuntu-latest`. This does **not** change committed `package.json` files.

---

## Application startup

Existing commands:

| App | Command | URL |
|-----|---------|-----|
| Backend | `node dist/main.js` (after `npm run build`) | `http://127.0.0.1:3000` |
| Frontend | `npm run dev` (`vite`, port **5173** from `vite.config.ts`) | `http://127.0.0.1:5173` |

`PULSE_URL=http://127.0.0.1:5173` is set so the screenshot script matches Vite (the script default `5175` is not the Vite config port).

GitHub Actions reaps background processes at the end of a step, so **start, readiness, and Playwright run in one step**. That is still: start apps → wait for HTTP → `node capture-screenshots.mjs`.

---

## Readiness strategy

No fixed `sleep` before Playwright.

Readiness waits for **frontend** `GET http://127.0.0.1:5173/` (the screenshot target). Backend is started with `node dist/main.js` but is not required for the poll, because `capture-screenshots.mjs` only opens `PULSE_URL`.

---

## Artifact upload

Step **Upload Playwright artifacts** uses `if: always()` so it runs even when Playwright fails.

| Artifact name | Contents |
|---------------|----------|
| `playwright-artifacts` | `docs/screenshots/**` (PNGs from the existing script) |
| (same artifact) | `playwright-report/**` and `test-results/**` **if present** |

### HTML report / videos / traces

`capture-screenshots.mjs` does **not** use `@playwright/test`, so it does **not** write:

- HTML report (`playwright-report/`)
- Videos
- Trace files

Those paths are still listed in the upload glob so they appear if a future suite adds them. `if-no-files-found: warn` avoids failing the upload when only PNGs exist.

Coverage artifact remains **`backend-unit-coverage`**.

---

## Execution order

```
Checkout
    ↓
Setup Node
    ↓
npm ci (backend)
    ↓
Prisma validate
    ↓
Prisma generate
    ↓
Type check
    ↓
npm audit (report only)
    ↓
Build
    ↓
Unit tests
    ↓
Wait for PostgreSQL + db push
    ↓
Integration tests
    ↓
Frontend npm ci
    ↓
Install Playwright browsers
    ↓
Start backend + frontend
    ↓
Readiness checks
    ↓
Playwright (`node capture-screenshots.mjs`)
    ↓
Coverage
    ↓
Upload coverage
    ↓
Upload Playwright artifacts
```

---

## Runtime expectations

| Segment | Typical |
|---------|---------|
| CI v4 path through integration | ~3–6 min |
| Frontend `npm ci` + Playwright browsers | ~1–3 min |
| App start + readiness | ~10–40 s |
| Screenshot script | ~30–90 s |
| **Warm job total** | **about 6–12 minutes** |

---

## Future roadmap

| Version | Status |
|---------|--------|
| **v1–v4** | Complete |
| **v5 (this phase)** | Existing Playwright screenshot command in CI |
| **Later** | A real `@playwright/test` suite (config, HTML report, video, trace) if approved |
| **Deployment** | Not started |

---

## Approval gate

CI v5 is complete. **Do not start the Deployment phase** until approved.
