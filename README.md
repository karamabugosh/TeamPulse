# TeamPulse

Monorepo: NestJS backend (`backend/`) + React frontend (`frontend/`).

## Live services

| Service | URL |
|---------|-----|
| Backend API | https://teampulse-go8z.onrender.com |
| Health | https://teampulse-go8z.onrender.com/api/health |
| Frontend | Deploy via Render static site (see below) |

## Frontend (React + Vite)

### Framework

**Vite** (not Create React App). Production env var: **`VITE_API_BASE_URL`**.

### Local development

```bash
cd frontend
cp .env.example .env
# Optional for local dev when VITE_API_BASE_URL is empty — set in frontend/.env (not committed):
# VITE_DEV_PROXY_TARGET=http://127.0.0.1:3000
npm install
npm run dev
```

With `VITE_API_BASE_URL` unset, the app calls relative `/api/...` paths; the Vite dev server proxies them when `VITE_DEV_PROXY_TARGET` is set in `frontend/.env`.

### Production build (local verify)

```bash
cd frontend
npm install
set VITE_API_BASE_URL=https://teampulse-go8z.onrender.com   # Windows CMD
# export VITE_API_BASE_URL=https://teampulse-go8z.onrender.com  # macOS/Linux
npm run build
npm run preview
```

Output directory: **`dist/`**

### Render static site deployment

Blueprint: [`render.yaml`](render.yaml) service **`teampulse-frontend`**.

| Setting | Value |
|---------|--------|
| **Service type** | Static Site |
| **Root Directory** | `frontend` |
| **Build Command** | `npm install && npm run build:render` |
| **Publish Directory** | `dist` (relative to Root Directory — **not** `frontend/dist`) |
| **Environment variable** | `VITE_API_BASE_URL=https://teampulse-go8z.onrender.com` |

After the frontend URL is known, set **`FRONTEND_URL`** on the **backend** Render service (CORS + Jira OAuth redirects).

SPA routing: add a Render rewrite `/*` → `/index.html` (in [`render.yaml`](render.yaml) `routes`, or dashboard Redirects/Rewrites). See [`docs/deployment/render-frontend-deployment.md`](docs/deployment/render-frontend-deployment.md).

### API configuration

All backend calls go through `src/lib/api.ts` → `apiFetch()`, which prefixes paths with `VITE_API_BASE_URL` when set:

`${VITE_API_BASE_URL}/api/...`

## Backend

See [`docs/deployment/render-backend-deployment.md`](docs/deployment/render-backend-deployment.md).

```bash
cd backend
npm install
npm run start:dev
```

## Branch

Deploy from **`karam-final1`**.
