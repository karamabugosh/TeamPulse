# GitHub Actions — Phase 6 (CI v6)

**Date:** August 30, 2026  
**Status:** Implemented — awaiting approval before CI v7 (Automatic Deployment)  
**Workflow file:** `.github/workflows/backend-ci.yml` (same file as v1–v5; not a second workflow)  
**GitHub repository:** [karamabugosh/TeamPulse](https://github.com/karamabugosh/TeamPulse)  
**Compose file:** `docker-compose.yml` (repository root)

---

> **CI v6 adds Docker Compose validation** after integration tests and **before** Playwright. Images are built with `docker compose build`, started with `docker compose up -d`, then polled until healthy. `docker compose down -v` always runs so Playwright can bind ports 3000 and 5173.

---

## Updated CI architecture

```
ubuntu-latest
    ├── Service: postgres:16 (`pulse_test`, from v3) — used by integration + Playwright seed
    └── One job
          Quality gates (v4)
          → nest build
          → unit tests
          → integration tests
          → docker compose build
          → docker compose up -d
          → health / HTTP readiness (backend, frontend, postgres)
          → docker compose down -v  (always)
          → frontend npm ci + Playwright browsers
          → Playwright (@playwright/test)
          → unit coverage + upload
          → Playwright artifacts (always)
```

---

## Docker architecture

| Service | Image / build | Host port | Role |
|---------|----------------|-----------|------|
| `postgres` | `postgres:16` | `${POSTGRES_PORT:-5432}` → 5432 | App database for Compose (not `pulse_test`) |
| `backend` | `backend/Dockerfile` | `3000` | Nest (`node dist/main.js` after `prisma db push`) |
| `frontend` | `frontend/Dockerfile` (Vite build + nginx) | `5173` → 80 | Static dashboard; `/api` proxied to `backend:3000` |

Compose postgres is isolated from the GitHub Actions Postgres **service** (`pulse_test` on host `5432`). In CI, Compose maps postgres to **5433** so the two databases do not collide.

---

## Compose build

```bash
docker compose build
```

Runs at the repository root. Fails the job immediately if an image fails to build. Does not start containers.

---

## Compose up

```bash
docker compose up -d
```

CI sets `POSTGRES_PORT=5433`. Local default remains `5432`.

`backend` waits for `postgres` **healthy**. `frontend` waits for `backend` **healthy**.

---

## Health checks

Defined in `docker-compose.yml`:

| Service | Check |
|---------|--------|
| postgres | `pg_isready -U postgres -d pulse` |
| backend | HTTP GET `http://127.0.0.1:3000/api/questions` (status &lt; 500) |
| frontend | `wget` `http://127.0.0.1/` |

The wait step also fails immediately if `docker compose ps --status exited` lists any container.

---

## Backend readiness

Poll **without a fixed sleep-only delay**:

`GET http://127.0.0.1:3000/api/questions` until HTTP **2xx/3xx** (up to 45 attempts, 2s between tries).

Nest global prefix is `api`, so `/` is not used as the success probe.

---

## Frontend readiness

Poll `GET http://127.0.0.1:5173/` until HTTP **2xx/3xx**. Host `5173` is mapped to nginx port 80.

---

## Cleanup strategy

Step **Stop Docker Compose**:

```bash
docker compose down -v
```

`if: always()` so it runs when build, up, or health checks fail. Volumes (`pulse_pg`) are removed. Ports 3000/5173 are released before Playwright.

---

## Failure behavior

| Failure | Workflow |
|---------|----------|
| `docker compose build` | Job fails; up/wait skipped; **down -v still runs** |
| `docker compose up -d` | Job fails; wait skipped; **down -v still runs** |
| Container exits while waiting | Wait step fails immediately; logs dumped; **down -v** |
| HTTP never 2xx/3xx | Wait step fails; **down -v** |
| Docker stage failed | Playwright / coverage **do not run** |

---

## Runtime expectations

| Segment | Typical (`ubuntu-latest`) |
|---------|---------------------------|
| CI v5 path through integration | ~3–6 min |
| Compose build (cold) | ~2–6 min |
| Up + health polls | ~20–60 s |
| Compose down | seconds |
| Playwright (unchanged) | ~1–3 min |
| **Warm job total** | **about 8–16 minutes** |

---

## Future roadmap

| Version | Status |
|---------|--------|
| **v1–v5** | Complete |
| **v6 (this phase)** | Docker Compose validation in the same workflow |
| **v7** | Automatic Deployment — **not started** (approval required) |

---

## Approval gate

CI v6 is complete. **Do not start Automatic Deployment (CI v7)** until approved.

---

## Local equivalent

```bash
docker compose build
docker compose up -d
docker ps
# backend:  http://localhost:3000/api/questions
# frontend: http://localhost:5173/
docker compose down -v
```
