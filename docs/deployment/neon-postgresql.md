# Neon PostgreSQL — production database (Phase 3)

**Status:** Configured — set `DATABASE_URL` in Render before Phase 4 deploy.  
**Date:** August 31, 2026  
**Branch:** `karam-final1`  
**Related:** [Render deployment](./render-backend-deployment.md) · [`render.yaml`](../../render.yaml)

---

## Neon architecture

```
Render Web Service (teampulse-backend)
        │
        │  DATABASE_URL (TLS)
        ▼
Neon PostgreSQL
  ├── Project (e.g. teampulse-prod)
  │     └── Branch: main (production)
  │           └── Database: neondb (or custom name)
  │
  ├── Direct endpoint  ──► prisma migrate deploy (pre-deploy)
  └── Pooler endpoint  ──► optional runtime pooling (Phase 4 tuning)
```

TeamPulse uses **one** Prisma datasource variable:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

There is **no** `directUrl`, `shadowDatabaseUrl`, or second database env var in the schema. All production connectivity is configured through **`DATABASE_URL`** only.

---

## Prisma schema analysis (Step 1)

| Item | Value |
|------|--------|
| **Datasource** | `db` |
| **Provider** | `postgresql` |
| **Connection URL** | `env("DATABASE_URL")` |
| **Other DB env vars** | **None** |
| **Migrations** | `backend/prisma/migrations/` (do not modify in deploy phases) |

---

## Create a Neon project (Step 2)

### 1. Sign up / sign in

1. Go to [https://neon.tech](https://neon.tech).
2. Create an account or sign in (GitHub OAuth works).

### 2. Create a project

1. **New Project**.
2. **Project name:** e.g. `teampulse-prod`.
3. **Region:** choose closest to Render (`frankfurt` if using Blueprint region).
4. **PostgreSQL version:** 16 (matches CI Postgres 16).
5. Create the project.

### 3. Production database

Neon creates a default database (often `neondb`) on the **`main`** branch.

- Use **`main`** for production (not a dev/preview branch).
- Optional: rename database in Neon console → **Databases** if you prefer `teampulse_prod` (any name works; connection string reflects it).

### 4. Obtain `DATABASE_URL`

In Neon console → your project → **Connect**:

1. Select branch: **`main`**.
2. Select role: default (`neondb_owner` or similar).
3. Select database: your production DB name.
4. Copy the connection string.

**Direct (recommended for Render Phase 4 initial setup):**

```
postgresql://USER:PASSWORD@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

**Pooled (PgBouncer — optional runtime optimization):**

```
postgresql://USER:PASSWORD@ep-xxxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

Paste into **Render → Environment → `DATABASE_URL`**. Never commit the value.

---

## SSL configuration

Neon requires TLS. Always include:

```
?sslmode=require
```

Prisma and `@prisma/client` honour this query parameter. Neon connection strings from the dashboard include SSL parameters by default.

| Check | Action |
|-------|--------|
| Missing SSL | Add `?sslmode=require` to `DATABASE_URL` |
| Certificate errors | Use the exact string from Neon dashboard (do not strip params) |
| Local dev | Neon still requires SSL; localhost Postgres is **not** used in production |

---

## Connection pooling

Neon offers a **pooler** hostname (`*-pooler.*.neon.tech`).

| Connection | Host pattern | Use case |
|------------|--------------|----------|
| **Direct** | `ep-xxx.region.aws.neon.tech` | Migrations (`migrate deploy`), long transactions |
| **Pooled** | `ep-xxx-pooler.region.aws.neon.tech` | High concurrency app runtime |

### Recommendation for TeamPulse (single `DATABASE_URL`)

Because the schema exposes only **`DATABASE_URL`**:

1. **Phase 4 first deploy:** set `DATABASE_URL` to the **direct** Neon URL (non-pooler).  
   Works for both `prisma migrate deploy` (Render pre-deploy) and application runtime.

2. **After stable deploy (optional):** switch runtime to pooler URL if connection count becomes an issue.  
   Re-run deploy; ensure pre-deploy migrations still succeed (use direct URL during migrate, or temporarily swap URL for deploy — see troubleshooting).

Future enhancement (not in Phase 3): add `directUrl` to `schema.prisma` to use pooler at runtime and direct URL for migrations simultaneously. **Not required** for initial production.

---

## Prisma compatibility (Step 3)

### `npx prisma generate`

**Works with Neon.** Generate reads `schema.prisma` only — **no live database connection** required.

Runs automatically via `npm install` → `postinstall` → `prisma generate` during Render build.

Local validation:

```bash
cd backend
npx prisma generate
```

Expect: `✔ Generated Prisma Client` with no database errors.

### `migrate deploy` vs `db push`

| Command | Production Render | Reason |
|---------|-------------------|--------|
| **`npx prisma migrate deploy`** | **Yes — recommended** | Applies versioned migrations in `prisma/migrations/`; safe, repeatable, auditable |
| **`npx prisma db push`** | **No** | Dev/CI convenience only; can drift schema without migration history |

**Render configuration (already set):**

```yaml
preDeployCommand: npx prisma migrate deploy
```

**Docker note:** `backend/docker-entrypoint.sh` uses `db push` for the optional Docker image path. Render does **not** use that entrypoint — it uses `render.yaml` + `migrate deploy`.

**Do not modify migration files** in deploy phases. Only connect Neon and run deploy.

---

## Render connection (Step 4)

### Set in Render dashboard

| Variable | Source | Required |
|----------|--------|----------|
| `DATABASE_URL` | Neon **Connect** → direct URL + `sslmode=require` | **Yes** |
| `NODE_ENV` | `production` (Blueprint default) | Yes |
| `PORT` | Injected by Render | Auto |

### Full production environment variable list

| Variable | Required | Used by app | Notes |
|----------|----------|-------------|-------|
| `DATABASE_URL` | **Yes** | Prisma | Neon hosted Postgres only |
| `NODE_ENV` | Yes | Runtime | `production` |
| `PORT` | Auto | NestJS | Render-injected |
| `OPENAI_API_KEY` | If AI enabled | OpenAI | Secret |
| `SLACK_BOT_TOKEN` | Yes | Slack | Secret |
| `SLACK_SIGNING_SECRET` | Yes | Slack | Secret |
| `SLACK_APP_TOKEN` | If Socket Mode | Slack | Secret |
| `JIRA_CLIENT_ID` | If Jira enabled | Jira OAuth | Secret |
| `JIRA_CLIENT_SECRET` | If Jira enabled | Jira OAuth | Secret |
| `JIRA_REDIRECT_URI` | If Jira enabled | Jira OAuth | Public Render URL |
| `FRONTEND_URL` | Yes | CORS, Jira UX | Production SPA URL |
| `JWT_SECRET` | **No** | — | **Not used** — no JWT auth in codebase |
| `JWT_EXPIRES_IN` | **No** | — | **Not used** |

Additional optional vars: see [`backend/.env.example`](../../backend/.env.example).

---

## Security recommendations

1. **Never commit** `DATABASE_URL` or any secret — Render Environment only.
2. Use a **dedicated Neon project/branch** for production; do not share with local `teampulse` or CI `pulse_test`.
3. Enable **Neon IP allow** / network rules if your org requires it (Render egress IPs may change — prefer Neon’s default secure TLS auth).
4. Rotate Neon role password if credentials leak; update Render env and redeploy.
5. Use **least-privilege** Neon roles if you add read replicas or workers later.
6. Enable Neon **backup / PITR** on paid tiers for production data protection.
7. Restrict Neon dashboard access to deploy admins only.

---

## Production reference audit (Step 6)

Verified: **production deployment configuration** does not point at local databases.

| Path | `localhost` / `pulse_test` / `teampulse` | Verdict |
|------|------------------------------------------|---------|
| `render.yaml` | None in `DATABASE_URL` (secret only) | OK |
| `backend/.env.example` | Documented as **forbidden** for prod | OK |
| `backend/prisma/schema.prisma` | Uses `env("DATABASE_URL")` only | OK |
| `backend/integration/*` | `pulse_test` + localhost | **CI/local only** — not production |
| `.github/workflows/backend-ci.yml` | `pulse_test` | **CI only** — unchanged per instructions |
| `backend/docker-entrypoint.sh` | `db push` (no host) | Docker path only; Render uses `migrate deploy` |
| `pulse/.env.example` (repo root) | localhost + `teampulse` | **Local dev template** — see note below |
| `backend/src/jira/jira.service.ts` | `localhost:5173` fallback | Dev fallback when `FRONTEND_URL` unset; set `FRONTEND_URL` in Render |

**Local dev templates** (`pulse/.env.example`, integration scripts) intentionally reference localhost/`teampulse`/`pulse_test`. They are **not** used by Render production deploy.

**Action for Phase 4:** set Render `DATABASE_URL` to Neon only before first deploy.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `migrate deploy` fails: connection refused | Wrong URL / Neon project paused | Copy fresh URL from Neon; wake project |
| `migrate deploy` fails: SSL | Missing `sslmode=require` | Add to connection string |
| `migrate deploy` fails on pooler URL | PgBouncer + migrations | Use **direct** (non-pooler) `DATABASE_URL` |
| App starts but DB queries fail | Invalid credentials | Regenerate password in Neon; update Render |
| `Can't reach database server` | Neon branch deleted / wrong branch | Use `main` production branch |
| Pre-deploy OK, runtime slow | Connection exhaustion | Consider pooler URL after migrations (Phase 4 tuning) |
| Wrong database content | Used dev DB URL | Never use `teampulse` or `pulse_test` URLs in Render |
| `prisma generate` fails on Render | Schema syntax error | Fix locally; CI build would also fail |

### Verify connectivity (Phase 4, after secrets set)

From Render shell or local with production URL (do not log URL):

```bash
cd backend
npx prisma migrate deploy   # should apply pending migrations
npx prisma db execute --stdin <<< "SELECT 1"  # optional smoke query
```

---

## Phase 3 checklist

- [x] Prisma uses `DATABASE_URL` only
- [x] Neon creation / URL / SSL documented
- [x] `migrate deploy` recommended over `db push` for Render
- [x] Production env vars documented (including JWT not used)
- [x] Production deploy paths audited for local DB references
- [ ] Set Neon `DATABASE_URL` in Render — **Phase 4**
- [ ] First production deploy — **Phase 4**

---

## Related docs

- [Render backend deployment](./render-backend-deployment.md)
- [Render backend preparation](./render-backend-preparation.md)
- [Backend environment template](../../backend/.env.example)
