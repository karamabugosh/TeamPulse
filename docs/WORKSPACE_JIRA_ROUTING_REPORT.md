# Workspace Jira Routing Report

**Product:** Pulse  
**Date:** 2026-08-20  
**Scope:** Per-workspace live Jira for AI + OAuth (TeamPulse vs Pulse project vs Demo)

---

## 1. Root cause

Two separate issues stacked:

### A. OAuth always bound to the earliest workspace (primary)

`Connect Jira` used:

```ts
window.location.href = '/api/auth/jira';
```

Browser navigation **cannot** send `X-Workspace-Id`.  
`resolveActiveWorkspaceId()` then fell back to the **earliest installed** workspace → **Pules project**.

So even when **TeamPulse Workspace** was selected in the UI:

- Status API (via `apiFetch`) correctly showed **Not Connected** for TeamPulse  
- Clicking Connect still wrote `JiraConnection.workspaceId = Pules project`

**DB evidence before fix:**

| Workspace | Live `JiraConnection` | `JiraIssueCacheEntry` |
|-----------|----------------------|------------------------|
| Pules project | 2 | 10 |
| TeamPulse Workspace | **0** | **0** |
| Demo Workspace | demo tokens only | 40 |

AI retrieval already filtered by `workspaceId`. TeamPulse had **no** connection and **no** cache →  
`"I couldn't find SCRUM-9 in the current Jira workspace."` (misleading; real issue was **Jira not connected**).

### B. Misleading not-found copy

When `hasLiveJiraConnection=false`, the knowledge layer still phrased the miss as “couldn’t find the issue,” not “connect Jira for this workspace.”

---

## 2. Files modified

| File | Change |
|------|--------|
| `backend/src/jira/jira.controller.ts` | Accept `?workspaceId=` on OAuth start |
| `backend/src/jira/jira.service.ts` | Prefer explicit workspace for OAuth; `findLiveConnectionForWorkspace(workspaceId)` |
| `backend/src/jira/jira-member-cache.service.ts` | Use shared live-connection resolver |
| `backend/src/ai/workspace/knowledge/workspace-knowledge.service.ts` | Workspace-scoped live refresh logs; not-connected vs not-found; routing snapshot |
| `backend/src/ai/workspace/rag/rag-pipeline.service.ts` | Log workspace / JiraConnectionId / hit counts |
| `frontend/src/lib/jira-oauth.ts` | **New** — build OAuth URL with `workspaceId` |
| `frontend/src/components/jira/JiraConnectionCard.tsx` | Pass workspaceId; reload on workspace switch |
| `frontend/src/components/dashboard/JiraIntegrationCard.tsx` | Same |
| `docs/WORKSPACE_JIRA_ROUTING_REPORT.md` | This report |

**Data repair (one-time):** Cloned the live OAuth row from Pules project onto a TeamPulse user so TeamPulse has its **own** `JiraConnection` row (same Atlassian cloud, correct `workspaceId`). Future connects use the fixed OAuth URL and do not need cloning.

---

## 3. Workspace routing flow

```
UI workspace switch
  → localStorage pulse.activeWorkspaceId
  → apiFetch adds X-Workspace-Id on every request
  → Nest middleware → AsyncLocalStorage
  → resolveActiveWorkspaceId(preferred from body/header)
  → RAG / Knowledge / JiraService filter by that workspaceId

Connect Jira (browser redirect)
  → /api/auth/jira?workspaceId=<selected>
  → OAuth state embeds workspaceId + userId
  → callback upserts JiraConnection for THAT workspace only
```

**Never** uses hardcoded names/IDs for Pulse project, TeamPulse, or Demo in the retrieval path.

---

## 4. Jira connection resolution

```ts
JiraService.findLiveConnectionForWorkspace(workspaceId)
// WHERE workspaceId = ?
// AND cloudId != demo
// AND accessToken not demo/placeholder
// ORDER BY connectedAt DESC
```

Used by:

- `WorkspaceKnowledgeService.refreshIssueFromLiveJira`
- `JiraMemberCacheService.syncFromLive`
- Status / disconnect still resolve via active workspace ALS (+ header)

`findRealJiraConnection()` remains only for **Demo generation** (template source), not AI ask path.

---

## 5. PostgreSQL queries (AI Jira path)

All issue/member/blocker/cache reads for AI are scoped, e.g.:

```sql
-- Live connection
SELECT * FROM "JiraConnection"
WHERE "workspaceId" = $current
  AND "cloudId" <> 'demo-cloud-id'
  AND "accessToken" NOT LIKE '%demo-access-token%';

-- Cache fallback / merge
SELECT * FROM "JiraIssueCacheEntry"
WHERE "workspaceId" = $current
  AND lower("issueKey") = lower($issueKey);

-- Members cache
SELECT * FROM "JiraMemberCache"
WHERE "workspaceId" = $current AND active = true;
```

Slack / standups / reports / blockers / team memory collectors already take `workspaceId` into `WHERE` / relation filters the same way.

---

## 6. Tests

Live HTTP checks (2026-08-20):

| Workspace | `GET /auth/jira/status` | `Who is assigned to SCRUM-9?` |
|-----------|-------------------------|------------------------------|
| **Pules project** | Connected → karamwaleed70 | **Karam Waleed** (Live) |
| **TeamPulse Workspace** | Connected → karamwaleed70 | **Karam Waleed** (Live via TeamPulse connection) |
| **Demo Workspace** | Demo site | **Aroob Amr Abughoush / Done** (Demo cache only) |

No cross-workspace leakage: Demo assignee ≠ Live assignee.

---

## 7. Final architecture

```
Selected workspaceId
        │
        ├─► Slack data (users, channels, standups, AI history) WHERE workspaceId
        ├─► Reports / blockers / team memory WHERE workspaceId
        └─► Jira
              ├─ findLiveConnectionForWorkspace(workspaceId)
              │     └─ Atlassian API (issue / members) → upsert cache for that workspace
              └─ else JiraIssueCacheEntry WHERE workspaceId
                    └─ Demo: seeded cache only (no live tokens)
```

**Logs (examples):**

- `[JiraOAuth] start workspaceId=… slackWorkspaceId=…`
- `[WorkspaceJira] refresh issue=SCRUM-9 workspace="…" jiraConnectionId=…`
- `RAG … workspace="…" jiraConnectionId=… hasLiveJira=…`
- `[WorkspaceJira] retrieved jiraIssues=N slackMessages=M …`

---

## Operator notes

1. After switching workspace, Jira Hub / Dashboard connection cards reload automatically.  
2. **Connect Jira** must be done while the target workspace is selected (URL includes `workspaceId`).  
3. If a workspace has no connection, AI now says **Jira is not connected for &lt;name&gt;** instead of a false “issue not found.”  
4. Demo never uses live Atlassian tokens for AI answers.
