# Render backend deployment (Phase 2)

**Status:** Ready for Phase 4 — set Neon `DATABASE_URL` in Render, then deploy.  
**Date:** August 31, 2026  
**Database:** [Neon PostgreSQL setup](./neon-postgresql.md)  
**Repository:** [karamabugosh/TeamPulse](https://github.com/karamabugosh/TeamPulse)  
**Branch:** `karam-final1`  
**Blueprint:** [`render.yaml`](../../render.yaml) (repo root)

---

## Render architecture

```
GitHub (karam-final1)
        │
        ▼
Render Web Service — teampulse-backend
  rootDir: backend/
  build:  npm install && npm run build
  preDeploy: npx prisma migrate deploy
  start:  npm run start:prod
  health: GET /api/health
        │
        ├──► Neon PostgreSQL (DATABASE_URL) — see neon-postgresql.md
        ├──► Slack (Socket Mode + Web API)
        ├──► OpenAI
        └──► Atlassian Jira OAuth
```

- NestJS binds **`0.0.0.0`** and **`process.env.PORT`** (Render-injected).
- Global API prefix: **`/api`**.
- Prisma Client is generated during **`npm install`** via `postinstall` → `prisma generate`.
- Schema is applied with **`npx prisma migrate deploy`** (Render `preDeployCommand`); migrations are **not** modified in this phase.
- **Do not** use local PostgreSQL, `pulse_test`, or `teampulse` in production.

---

## Render settings (dashboard or Blueprint)

| Setting | Value |
|---------|--------|
| **Service type** | Web Service |
| **Runtime** | Node |
| **Root Directory** | `backend` |
| **Branch** | `karam-final1` |
| **Build Command** | `npm install && npm run build` |
| **Pre-Deploy Command** | `npx prisma migrate deploy` |
| **Start Command** | `npm run start:prod` |
| **Health Check Path** | `/api/health` |
| **Node version** | 20 (`NODE_VERSION=20` or `engines.node` in `package.json`) |

### Alternative: Blueprint deploy

1. In Render: **New → Blueprint**.
2. Connect the GitHub repo and select branch **`karam-final1`**.
3. Render reads [`render.yaml`](../../render.yaml) and creates the web service.
4. Set secret environment variables in the dashboard (see below).
5. Complete **Phase 3** (Neon `DATABASE_URL`) before expecting DB-backed routes to work.

---

## Build command

```bash
npm install && npm run build
```

What happens:

1. **`npm install`** — installs dependencies; **`postinstall`** runs **`prisma generate`**.
2. **`npm run build`** — Nest compiles TypeScript to **`dist/main.js`** (`tsconfig.build.json` uses `incremental: false` for reliable full output).

Output artifact: **`backend/dist/`**.

---

## Start command

```bash
npm run start:prod
```

Runs **`node dist/main.js`**. Render sets **`PORT`** automatically; the app must not hardcode it.

---

## Prisma setup

| Step | When | Command |
|------|------|---------|
| Generate client | Build (`postinstall`) | `prisma generate` |
| Apply migrations | Pre-deploy (Render) | `npx prisma migrate deploy` |
| Modify migration files | **Never** in deploy phases | — |

Prisma reads **`DATABASE_URL`** from the environment (`schema.prisma` → `env("DATABASE_URL")`).

If the first deploy fails on `migrate deploy`, **`DATABASE_URL`** is likely missing or unreachable — complete Phase 3 (Neon) first.

---

## Database connection

Production uses a **Neon PostgreSQL** connection string only. Full setup: [neon-postgresql.md](./neon-postgresql.md).

```env
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
```

| Rule | Detail |
|------|--------|
| **Use** | Neon (Phase 3) or any hosted Postgres |
| **Do not use** | Localhost, `pulse_test`, `teampulse` |
| **SSL** | Required for Neon (`sslmode=require` in connection string) |

The backend does not embed database hostnames; everything comes from **`DATABASE_URL`**.

---

## Health check

| Method | Path | Use |
|--------|------|-----|
| `GET` | **`/api/health`** | Render health check |

Example response:

```json
{
  "ok": true,
  "status": "up",
  "service": "teampulse-backend"
}
```

- No database or external API calls — safe for liveness probes.
- Diagnostic only (not for Render): `GET /api/ai/workspace/health`, `GET /api/ai/eval/health`.

---

## Environment variables

Set in **Render → Environment** (never commit secrets). Template: [`backend/.env.example`](../../backend/.env.example).

### Required before full production use

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Hosted PostgreSQL (Neon — Phase 3) |
| `FRONTEND_URL` | SPA origin (CORS + Jira UX) |
| `SLACK_BOT_TOKEN` | Slack bot token |
| `SLACK_SIGNING_SECRET` | Slack request verification |
| `SLACK_APP_TOKEN` | Slack Socket Mode |
| `OPENAI_API_KEY` | OpenAI (if `PULSE_AI_ENABLED=true`) |
| `JIRA_CLIENT_ID` | Atlassian OAuth |
| `JIRA_CLIENT_SECRET` | Atlassian OAuth |
| `JIRA_REDIRECT_URI` | Must match public backend URL + callback path |

### Injected / defaulted by Render or Blueprint

| Variable | Source |
|----------|--------|
| `PORT` | Injected by Render |
| `NODE_ENV` | `production` (Blueprint) |
| `NODE_VERSION` | `20` (Blueprint) |

### Not used

| Variable | Note |
|----------|------|
| `JWT_SECRET` | **Not used** — auth is Slack/workspace-based, not JWT |
| `JWT_EXPIRES_IN` | **Not used** |

### Optional / feature toggles

`SLACK_DIGEST_CHANNEL_ID`, `SLACK_SOCKET_MODE_ENABLED`, `PULSE_AI_ENABLED`, `OPENAI_MODEL`, scheduler crons, `JIRA_*` URLs/scopes, `CORS_ORIGINS`, `MEMORY_V2_ASK_MODE`, etc. — see `.env.example`.

---

## Deployment steps

### 1. Push configuration (this phase)

```bash
git push origin karam-final1
```

Wait for **Backend CI** (GitHub Actions) to pass.

### 2. Create Render service

- **Blueprint:** New → Blueprint → repo → branch `karam-final1`.
- **Manual:** New → Web Service → same repo/branch, settings table above.

### 3. Set secrets

In Render Environment, add all **Required** variables. Leave values empty in git.

### 4. Phase 3 — Neon

Add Neon **`DATABASE_URL`** (direct endpoint + `sslmode=require`), redeploy, confirm `prisma migrate deploy` succeeds in deploy logs. See [neon-postgresql.md](./neon-postgresql.md).

### 5. Verify

```bash
curl https://<your-service>.onrender.com/api/health
```

Expect HTTP **200** and `"ok": true`.

### 6. Update external callbacks

- **Jira:** `JIRA_REDIRECT_URI` = `https://<service>.onrender.com/api/jira/oauth/callback`
- **Slack:** event URLs if using HTTP mode (this app uses Socket Mode by default)
- **Frontend:** `FRONTEND_URL` = production SPA URL

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Build fails: `Cannot find module` | Incomplete `dist/` | Ensure `npm run build` completes; `tsconfig.build.json` has `incremental: false` |
| Build fails: Prisma client | `prisma generate` skipped | Confirm `postinstall` runs; run `npx prisma generate` in build logs |
| Pre-deploy fails: migrate | No DB / wrong URL | Set Neon `DATABASE_URL` (Phase 3); check SSL |
| Service unhealthy | App not listening on `PORT` | App uses `process.env.PORT` and `0.0.0.0` |
| Health 404 | Wrong path | Use `/api/health` (global prefix `api`) |
| CORS errors from frontend | Origin not allowed | Set `FRONTEND_URL` or `CORS_ORIGINS` |
| Slack Socket Mode down | Missing tokens | Set `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET` |
| Jira OAuth fails | Redirect mismatch | `JIRA_REDIRECT_URI` must exactly match Atlassian app settings |
| DB connects to wrong DB | Local URL in env | Remove localhost; use hosted `DATABASE_URL` only |

### Useful log lines (successful boot)

```
Application is running on: http://localhost:<PORT>
SLACK_BOT_TOKEN set: true
JIRA_CLIENT_ID set: true
```

Secrets are logged as **set/not set** only — never values.

---

## Related docs

- [Phase 1 — backend preparation](./render-backend-preparation.md)
- [Backend CI](../ci/github-actions-phase3.md)
- [Environment template](../../backend/.env.example)

---

## Phase 2 checklist

- [x] `render.yaml` at repo root
- [x] Build / start commands match Render requirements
- [x] `rootDir: backend`
- [x] Health check documented (`/api/health`)
- [x] Prisma generate (build) + migrate deploy (pre-deploy)
- [x] No secrets in git
- [ ] Neon `DATABASE_URL` — **Phase 4** (set in Render; see [neon-postgresql.md](./neon-postgresql.md))
- [ ] First successful Render deploy — **Phase 4**
