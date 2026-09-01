# Render frontend deployment (Static Site)

**Framework:** Vite + React (not Create React App)  
**Branch:** `karam-final1`  
**Backend:** https://teampulse-go8z.onrender.com  
**Blueprint:** [`render.yaml`](../../render.yaml) service `teampulse-frontend`

---

## Correct dashboard settings

| Setting | Value | Why |
|---------|--------|-----|
| **Service type** | Static Site | Serves `dist/` over CDN |
| **Root Directory** | `frontend` | Monorepo; build runs inside `frontend/` |
| **Build Command** | `npm install && npm run build:render` | Builds Vite output + verifies `dist/index.html` |
| **Publish Directory** | `dist` | Relative to **Root Directory** → publishes `frontend/dist` |

### Publish path: `dist` vs `frontend/dist`

With **Root Directory = `frontend`**, the publish directory must be:

```
dist
```

**NOT** `frontend/dist` — that resolves to `frontend/frontend/dist` and produces Render's plain **Not Found** page even when the build succeeds.

---

## Environment variables (build time)

Vite embeds env vars at build time:

| Variable | Example |
|----------|---------|
| `VITE_API_BASE_URL` | `https://teampulse-go8z.onrender.com` |

No trailing slash. Requests become `${VITE_API_BASE_URL}/api/...`.

---

## SPA routing (React Router)

React Router uses client-side routes (`/overview`, `/checkins`, etc.). Render must rewrite unknown paths to `index.html`.

**Blueprint** (`render.yaml`):

```yaml
routes:
  - type: rewrite
    source: /*
    destination: /index.html
```

**Manual dashboard:** Settings → Redirects/Rewrites → Add Rule:

| Field | Value |
|-------|--------|
| Source | `/*` |
| Destination | `/index.html` |
| Action | Rewrite |

`frontend/public/_redirects` (Netlify format) is copied into `dist/` but **Render ignores it** — use Blueprint `routes` or dashboard rewrites.

---

## Build output (verified locally)

After `npm run build`:

```
dist/
  index.html
  assets/
    index-*.js
    index-*.css
  _redirects
```

`npm run build:render` fails the deploy if `dist/index.html` or `dist/assets/` is missing.

---

## Backend CORS

After the frontend URL is live, set on **backend** Render service:

```
FRONTEND_URL=https://<your-frontend>.onrender.com
```

---

## Troubleshooting "Not Found"

| Symptom | Cause | Fix |
|---------|--------|-----|
| Plain **Not Found** at site root | Wrong **Publish Directory** | Use `dist` with Root Directory `frontend` |
| **Not Found** on `/overview` etc. | Missing SPA rewrite | Add `/*` → `/index.html` rewrite |
| API errors in browser | Missing/wrong `VITE_API_BASE_URL` | Set at build time; redeploy |
| Opening backend URL `/` | Nest only serves `/api/*` | Use the **frontend** `onrender.com` URL |

---

## Local production preview

```bash
cd frontend
export VITE_API_BASE_URL=https://teampulse-go8z.onrender.com  # macOS/Linux
npm run build:render
npm run preview
```
