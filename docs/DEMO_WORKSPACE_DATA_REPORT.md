# Demo Workspace Data Report

How Demo Workspace mock data is generated from **real connected Jira members** while staying fully isolated.

| Field | Value |
|-------|-------|
| Slack workspace id | `T_DEMO_PULSE_WS` |
| Display name | Demo Workspace |
| Member source | Connected **real** Jira site (read-only) |
| Seed command | `cd backend && npm run seed:demo` |
| Regenerate API | `POST /api/demo/regenerate?force=1` |
| Status API | `GET /api/demo/status` |
| Auto-refresh | `POST /api/jira/sync` regenerates when the member fingerprint changes |

---

## Which service reads Jira members

**`JiraService.listWorkspaceMembers()`** (`backend/src/jira/jira.service.ts`)

1. Resolves a **real** `JiraConnection` via `findRealJiraConnection()` (skips Demo fake `demo-cloud-id` / demo tokens).
2. Calls Atlassian **read-only** `GET /rest/api/3/users/search` (paginated).
3. Falls back to unique **assignees** on recent visible issues + the connected Atlassian profile if search is unavailable.
4. Filters out apps/bots; returns `{ accountId, displayName, emailAddress, avatarUrl }`.

**`DemoWorkspaceGeneratorService`** (`backend/src/demo/demo-workspace-generator.service.ts`) orchestrates:

- `listSourceJiraMembers()` → calls `JiraService.listWorkspaceMembers`
- `ensureGenerated({ force })` → compares SHA-256 **member fingerprint**; rebuilds Demo when members change
- Never calls Jira write APIs

---

## How mock data is generated from those members

**`buildDemoWorkspaceFromJiraMembers()`** (`backend/src/demo/demo-workspace-builder.ts`)

1. Maps each Jira user → Demo `User` with the **exact display name** (no fake roster).
2. Stable synthetic Slack ids `U0DM…` derived from `accountId` (schema requires `slackUserId`; not real Slack accounts).
3. Assigns mock `SCRUM-*` issues by **slot % memberCount** (templates in `demo-mock-templates.ts` have no people names).
4. Generates standups, blockers, digests, timeline inbound events, team memory, and AI conversations using those real names.

Example (from a live seed):

| Jira member | Example mock ownership |
|-------------|------------------------|
| Aroob Amr Abughoush | Slot 0 → SCRUM-22, SCRUM-33, … |
| Karam Waleed | Slot 1 → SCRUM-8, SCRUM-11, … |
| Rami Atrash | Slot 2 → SCRUM-12, SCRUM-13, … |

If a new engineer is added in Jira, the next `POST /api/jira/sync` (or `npm run seed:demo`) detects a new fingerprint and **reassigns** mock activity across the updated roster.

---

## Isolation from real Jira data

| Concern | Behavior |
|---------|----------|
| Writes to Atlassian | **None** — only `users/search` / issue search reads |
| Demo `JiraConnection` | Fake `demo-cloud-id` + placeholder tokens (not usable against Atlassian) |
| Tenant scope | All Demo rows use Demo `workspaceId` / `T_DEMO_PULSE_WS` |
| Delete / regenerate | Touches **only** the Demo workspace |
| Product queries | Same `workspaceId` / `X-Workspace-Id` path as any real tenant — no `if (demo)` branches |

Mock issues live in `JiraIssueCacheEntry` and related Pulse tables for Demo only. The real Jira board is never created, updated, or commented on by the generator.

---

## Seed / service files

| File | Role |
|------|------|
| `src/jira/jira.service.ts` | Read Jira members |
| `src/demo/demo-workspace-generator.service.ts` | Fingerprint + regenerate orchestration |
| `src/demo/demo-workspace-builder.ts` | Insert Demo mock graph |
| `src/demo/demo-mock-templates.ts` | Name-free issue/blocker templates |
| `src/demo/demo.controller.ts` | `/api/demo/*` |
| `prisma/seed-demo.ts` | CLI → Nest → `ensureGenerated({ force: true })` |

---

## Example AI questions (names follow your Jira roster)

| Question | Answer shape |
|----------|----------------|
| Who owns SCRUM-8? | The Demo assignee for SCRUM-8 (a **real** Jira display name). |
| Why is SCRUM-8 delayed? | Narrative using that assignee + SCRUM-12 owner from the same roster. |
| Which blockers are still open? | Open `PulseBlocker` rows owned by Demo users mapped from Jira members. |
| Summarize Sprint 14 | Digests/memory generated with those member names only. |

No hardcoded names like Sara / Layla / Nora appear in Demo after regeneration.
