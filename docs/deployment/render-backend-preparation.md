# Render backend preparation (Phase 1)

**Status:** Complete — see [Phase 2 deployment guide](./render-backend-deployment.md).  
**Date:** August 31, 2026  
**Service:** TeamPulse NestJS backend (`backend/`)  
**Target:** [Render](https://render.com) Web Service + PostgreSQL

---

## Production architecture

```
Internet
   │
   ▼
Render Web Service (Node 20)
   │  Build: npm ci → prisma generate → nest build
   │  Release/start: prisma migrate deploy → node dist/main.js
   │  Health: GET /api/health
   │
   ├──► Render PostgreSQL (DATABASE_URL)
   ├──► Slack (Socket Mode + Web API)
   ├──► OpenAI (optional, PULSE_AI_ENABLED)
   └──► Atlassian Jira OAuth / API
```

- NestJS listens on `0.0.0.0` and **`process.env.PORT`** (Render injects `PORT`).
- Global API prefix: **`/api`**.
- Prisma Client is generated at install (`postinstall`) and again during build as needed.
- Schema changes ship via Prisma **migrations** (`prisma/migrations`), applied with `prisma migrate deploy`.

---

## Required environment variables

Set these in the Render dashboard (or sync from `backend/.env.example`).

### Required for a healthy production boot

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string (`sslmode=require` on Render Postgres) |
| `PORT` | Injected by Render; do not hardcode |
| `FRONTEND_URL` | SPA origin for CORS + Jira redirect UX |
| `NODE_ENV` | Set to `production` |

### Slack

| Variable | Purpose |
|----------|---------|
| `SLACK_BOT_TOKEN` | Bot token (`xoxb-…`) |
| `SLACK_SIGNING_SECRET` | Request verification |
| `SLACK_APP_TOKEN` | Socket Mode app token (`xapp-…`) |
| `SLACK_SOCKET_MODE_ENABLED` | `true` to receive Slack events |
| `SLACK_DIGEST_CHANNEL_ID` | Default digest channel |
| `SLACK_DIGEST_ENABLED` | Digest posting toggle |

### AI

| Variable | Purpose |
|----------|---------|
| `PULSE_AI_ENABLED` | `true` to enable OpenAI features |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_MODEL` | Chat model (default `gpt-4o-mini`) |

### Schedulers

| Variable | Purpose |
|----------|---------|
| `DAILY_DIGEST_TIMEZONE` | Cron timezone |
| `DAILY_COLLECTION_CRON` | Collection schedule |
| `DAILY_DIGEST_CRON` | Digest schedule |
| `CHECKIN_SCHEDULER_ENABLED` | Check-in scheduler |
| `DIGEST_SCHEDULER_ENABLED` | Digest scheduler |

### Jira OAuth

| Variable | Purpose |
|----------|---------|
| `JIRA_CLIENT_ID` | Atlassian OAuth client id |
| `JIRA_CLIENT_SECRET` | Atlassian OAuth secret |
| `JIRA_REDIRECT_URI` | Must match Atlassian app callback (backend URL) |
| `JIRA_AUTH_URL` | Atlassian authorize URL |
| `JIRA_TOKEN_URL` | Atlassian token URL |
| `JIRA_API_URL` | Atlassian API base |
| `JIRA_SCOPES` | OAuth scopes |

### Optional

| Variable | Purpose |
|----------|---------|
| `CORS_ORIGINS` | Comma-separated extra allowed origins |
| `SLACK_TEAM_ID` | Single-workspace Slack team id |
| `JIRA_TOKEN_ENCRYPTION_KEY` | Token encryption; falls back to client secret |
| `MEMORY_V2_ASK_MODE` | Memory ask mode (`hybrid`, etc.) |
| `MEMORY_WORKER_ENABLED` | Set `false` to disable memory worker |
| `OPENAI_EMBEDDING_MODEL` | Embedding model override |

Full annotated template: [`backend/.env.example`](../../backend/.env.example).

---

## Build command

Recommended Render **Build Command** (service root = `backend/`):

```bash
npm ci && npx prisma generate && npm run build
```

Notes:

- `postinstall` already runs `prisma generate`; an explicit generate keeps the build resilient if install hooks are skipped.
- Build output: `dist/main.js` (Nest `outDir`).
- Requires **Node 20+** (`engines.node` in `package.json`).
- `tsconfig.build.json` sets `"incremental": false` so Nest’s `deleteOutDir` cannot leave a partial `dist/` (incremental + wipe is unsafe for `start:prod`).

---

## Start command

Recommended Render **Start Command**:

```bash
npx prisma migrate deploy && npm run start:prod
```

Equivalent scripts in `package.json`:

| Script | Command |
|--------|---------|
| `start:prod` | `node dist/main.js` |
| `prisma:migrate:deploy` | `prisma migrate deploy` |

Do **not** use `npm run start` or `start:dev` in production (those run TypeScript via `ts-node` / watch mode).

---

## Prisma requirements

| Item | Detail |
|------|--------|
| Provider | PostgreSQL (`schema.prisma` → `env("DATABASE_URL")`) |
| Client generate | `prisma generate` (also via `postinstall`) |
| Schema apply (prod) | **`prisma migrate deploy`** — uses `prisma/migrations` |
| Avoid in prod | `prisma db push` (dev/CI convenience only; Docker entrypoint still uses push for the container image path) |
| Seed | Optional; not part of production start |

Ensure the Render Postgres instance exists and `DATABASE_URL` is wired before the first deploy.

---

## Health endpoint

### Platform health (Render)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | **`/api/health`** | Liveness probe — no DB or external calls |

Example response:

```json
{
  "ok": true,
  "status": "up",
  "service": "teampulse-backend"
}
```

**Render Health Check Path:** `/api/health`

### Existing module health (not for Render)

These were already present and remain for diagnostics only:

| Path | Notes |
|------|-------|
| `GET /api/ai/workspace/health` | AI / embeddings / pgvector status |
| `GET /api/ai/eval/health` | AI evaluation framework status |

They depend on AI modules and are **not** suitable as the sole platform health check.

---

## CORS

Configured in `src/main.ts`:

1. If `CORS_ORIGINS` is set → allow that comma-separated list.
2. Else if `FRONTEND_URL` is set → allow that single origin.
3. Else → allow any origin (local/dev fallback).

`X-Workspace-Id` remains an exposed response header for the SPA.

---

## Production notes

1. **Do not deploy in Phase 1.** This document prepares the backend only.
2. Bind address is `0.0.0.0` so Render’s proxy can reach the process.
3. Port must come from **`process.env.PORT`** (fallback `3000` for local prod runs only).
4. Slack Socket Mode starts in the background and must not block HTTP listen.
5. Set Atlassian `JIRA_REDIRECT_URI` to the public Render API URL before enabling Jira OAuth.
6. Prefer secrets in the Render Environment UI; never commit `.env`.
7. After Phase 2 deploy, verify: health `200`, CORS from the real frontend origin, and a DB migration apply log line on boot.
8. Optional Docker path (`Dockerfile` + `docker-entrypoint.sh`) remains available; Phase 2 should prefer Render native Node unless container deploy is explicitly chosen.

---

## Local validation (Phase 1)

From `backend/`:

```bash
npm run build
npm run start:prod
# then:
# GET http://localhost:$PORT/api/health
```

Expect Nest bootstrap logs and a successful health JSON response.
