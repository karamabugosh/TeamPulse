# Jira Status Debug Report

Investigation and fix for incorrect status answers such as:

> give jira status for scrum-9  
> → “The status for SCRUM-9 is unassigned, and the summary is 'Untitled issue.'”

**Date:** 2026-08-20  
**Verdict:** SCRUM-9 **does exist** with real fields in Live Jira and in `JiraIssueCacheEntry` (Pules project + Demo). The AI invented **fallback placeholders** when the collector emitted a synthetic `jira_issue` document without real Live/cache data (wrong workspace or empty lookup), and the LLM treated “Unassigned” / “Untitled issue” as status/summary.

---

## Root cause

1. **`collectJiraIssues` always built a `jira_issue` evidence doc for an extracted issue key**, even when **neither Live Jira nor `JiraIssueCacheEntry`** had a hit for the **active workspace**.
2. That synthetic doc filled gaps with:
   - Summary → `"Untitled issue"`
   - Assignee → `"Unassigned"`
3. The model then answered as if those were real Jira fields (and sometimes misread assignee as “status”).
4. **Workspace mismatch amplifies this:** TeamPulse Workspace (`T00000000`) has **no** SCRUM-9 cache row. Asking from that workspace (or without `X-Workspace-Id` resolving to Pules/Demo) triggered the invent path.
5. Secondary risk: Live refresh mapping used `summary || 'Untitled issue'`, which could overlay a **good cache row** with a placeholder if Live returned an empty summary.

**Not the root cause:** Missing ticket in Atlassian for the real workspace — Live Jira returns full fields for SCRUM-9 on Pules project.

---

## Execution flow — `give jira status for scrum-9`

```
POST / AI chat (X-Workspace-Id)
  → IntentDetectionService.extractFilters
       issueKey = SCRUM-9  (regex \b([A-Z][A-Z0-9]+-\d+)\b/i)
  → IntentDetectionService → ISSUE_STATUS
       (+ keywords: "jira status", "status for", …)
  → RagPipelineService.refineFiltersForIntent
       jiraFieldsOnly = true
  → WorkspaceKnowledgeService.collectSnapshot
       collectors limited to Jira + Jira audit
  → collectJiraIssues(workspaceId, { issueKey: SCRUM-9 })
       1) refreshIssueFromLiveJira (usable OAuth only)
       2) prisma.jiraIssueCacheEntry.findMany({ workspaceId, issueKey })
       3) merge Live + cache OR emit ISSUE_NOT_FOUND
  → WorkspaceRetrievalService.enforceJiraFieldAuthority
       keep only matching jira_issue (+ audit)
  → WorkspacePromptBuilder (ISSUE_STATUS hard rules)
  → LLM answer
```

### Where SCRUM-9 is searched

| Step | Location | Query |
|------|----------|--------|
| Issue key extract | `intent-detection.service.ts` `extractFilters` | regex on question |
| Live refresh | `workspace-knowledge.service.ts` `refreshIssueFromLiveJira` | `JiraService.lookupIssueForUser(userId, 'SCRUM-9')` → `GET /rest/api/3/issue/SCRUM-9` |
| Cache | `workspace-knowledge.service.ts` `collectJiraIssues` | `JiraIssueCacheEntry` where `workspaceId` + `issueKey` equals (insensitive) |
| Authority filter | `workspace-retrieval.service.ts` `enforceJiraFieldAuthority` | keep `entity === 'jira_issue'` matching key |

---

## Existence check

| Source | Result |
|--------|--------|
| **Live Jira** (Pules / `karamwaleed70.atlassian.net`) | **Found** — HTTP 200 |
| **JiraIssueCacheEntry / PostgreSQL** (Pules) | **Found** |
| **JiraIssueCacheEntry / PostgreSQL** (Demo) | **Found** (seeded) |
| **TeamPulse Workspace** | **Not found** |
| **Demo Workspace live OAuth** | Placeholder tokens only — no Live call; uses cache |

### Database row — Pules project (Real)

```json
{
  "id": "8717f86c-0478-4fb1-829a-86444db8e377",
  "workspaceId": "0e4985cc-3955-4af5-8cba-d72f25f1a8ee",
  "workspaceName": "Pules project",
  "slackWorkspaceId": "T0BKKJNTQJ3",
  "issueKey": "SCRUM-9",
  "summary": "Dashboard Analytics",
  "status": "In Progress",
  "assigneeName": "Karam Waleed",
  "priority": "Lowest",
  "projectKey": "SCRUM",
  "issueType": "Task",
  "issueUrl": "https://karamwaleed70.atlassian.net/browse/SCRUM-9",
  "refreshedAt": "2026-08-19T18:23:22.605Z"
}
```

### Database row — Demo Workspace

```json
{
  "id": "af3c4118-991f-434b-ad9d-c1d576b5c2bb",
  "workspaceId": "b1ba6c87-0e8e-412e-b934-7c3b981d6982",
  "workspaceName": "Demo Workspace",
  "slackWorkspaceId": "T_DEMO_PULSE_WS",
  "issueKey": "SCRUM-9",
  "summary": "Fix timezone drift in report cron",
  "status": "Done",
  "assigneeName": "Aroob Amr Abughoush",
  "priority": "High",
  "projectKey": "SCRUM",
  "issueType": "Bug",
  "issueUrl": "https://demo.atlassian.net/browse/SCRUM-9",
  "refreshedAt": "2026-08-19T10:14:04.704Z"
}
```

### Live Jira API response (mapped) — Pules

```json
{
  "key": "SCRUM-9",
  "id": "10008",
  "summary": "Dashboard Analytics",
  "status": "In Progress",
  "assignee": "Karam Waleed",
  "priority": "Lowest",
  "reporter": "Karam Waleed",
  "issueType": "Task",
  "projectKey": "SCRUM",
  "updated": "2026-08-19T16:27:13.482+0300"
}
```

### Field population (Live)

| Field | Populated? | Value |
|-------|------------|--------|
| status | Yes | In Progress |
| assignee | Yes | Karam Waleed |
| summary | Yes | Dashboard Analytics |
| priority | Yes | Lowest |
| reporter | Yes | Karam Waleed |

---

## Fallback injection sites (exact)

| String | File | Role |
|--------|------|------|
| `"Untitled issue"` | `backend/src/jira/jira.service.ts` ~1205 (`mapIssueSummary`) | UI/search mapping when `fields.summary` missing |
| `"Untitled issue"` | `backend/src/jira/jira.service.ts` ~840 (changelog activities) | Activity label fallback |
| `"Untitled issue"` | `backend/src/jira/jira-issue-picker.service.ts` ~125 | Picker display |
| `"Unassigned"` | Frontend `JiraIssueDrawer.tsx` / activity cards | UI only |
| **Former AI path** | `workspace-knowledge.service.ts` `collectJiraIssues` | Previously emitted Untitled/Unassigned into RAG when Live+cache missed |

`"No status provided"` was **not** found in the current backend source; the bad AI answer used **Unassigned** (assignee fallback) misread as status, plus **Untitled issue**.

---

## Mapping (after fix)

```
Live usable payload?
  yes → prefer Live status/summary/assignee/priority/reporter
         (reject placeholder-only Live: empty / "Untitled issue")
  no  → use JiraIssueCacheEntry for workspaceId + issueKey

Neither Live nor cache?
  → ISSUE_NOT_FOUND document (no invented fields)
  → Prompt: reply exactly
     "I couldn't find SCRUM-9 in the current Jira workspace."
```

Evidence content lines (when found):

- `Summary: …` or `Summary: (not set in Jira)`
- `Status: …` or `Status: (not set in Jira)`
- `Assignee: …` or `Assignee: (unassigned in Jira)` — only when Jira truly has no assignee
- `Priority: …`
- `Reporter: …` (when Live returns it)
- `ISSUE_FOUND: true` / `ISSUE_NOT_FOUND: …`

---

## Fix applied

1. **`collectJiraIssues`** — never invent Untitled/Unassigned when missing; emit `ISSUE_NOT_FOUND` instead.
2. **Prefer cache over Live placeholders** via `isUsableLiveIssuePayload` / `isPlaceholderSummary` / `pickPreferredField`.
3. **`refreshIssueFromLiveJira`** — ignore empty/placeholder Live payloads; do not force `Untitled issue`; include `reporterName`.
4. **`lookupIssueForUser`** — request `reporter` field; log mapped lookup fields.
5. **Prompt (`ISSUE_STATUS`)** — if `ISSUE_NOT_FOUND`, answer with the exact couldn’t-find sentence; do not invent defaults.
6. **Intent** — recognize `jira status` / `status for`.
7. **Debug logs** (`logJiraStatusDebug`):

```
Jira status debug:
Question: SCRUM-9
Workspace: <workspaceId>
Source: Live Jira | Cache | none
Issue found: true|false
Status: …
Summary: …
Assignee: …
Priority: …
Reporter: …
```

### Files involved

- `backend/src/ai/workspace/knowledge/workspace-knowledge.service.ts`
- `backend/src/jira/jira.service.ts`
- `backend/src/ai/workspace/prompts/workspace-prompt.builder.ts`
- `backend/src/ai/workspace/intent/intent-detection.service.ts`
- `backend/src/ai/workspace/retrieval/workspace-retrieval.service.ts` (existing `enforceJiraFieldAuthority` / `jiraFieldsOnly`)
- `docs/JIRA_STATUS_DEBUG_REPORT.md` (this file)

---

## Expected answers after fix

| Active workspace | Expected |
|------------------|----------|
| **Pules project** | Status **In Progress**, summary **Dashboard Analytics**, assignee **Karam Waleed**, priority **Lowest** (Live refresh when OAuth works, else cache) |
| **Demo Workspace** | Status **Done**, summary **Fix timezone drift in report cron**, assignee **Aroob Amr Abughoush** (cache) |
| **TeamPulse** (no row) | `I couldn't find SCRUM-9 in the current Jira workspace.` |

**Note:** Select **Pules project** (or Demo) in the UI so `X-Workspace-Id` matches a workspace that actually has SCRUM-9.
