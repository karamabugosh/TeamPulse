# Jira Live Source Debug Report

**Product:** Pulse  
**Date:** 2026-08-20  
**Scope:** Issue-key field questions (assignee / status / priority / summary / reporter / sprint) must answer from **Live Jira API** only

---

## 1. Root cause

After the multi-source RAG refactor, **factual field questions** (e.g. “Who is assigned to SCRUM-9?”) still:

1. Selected **Slack + Reports + Team Memory + AI history** collectors  
2. Built answers that could mix narrative / cache with Jira fields  
3. Used `pickPreferredField(live, cache)` which could prefer **stale cache** when live was partial or when merge order favored older embeddings  

So the model sometimes echoed:

- Outdated `JiraIssueCacheEntry` values  
- Demo assignee text that leaked into context  
- Team Memory / Reports mentions of the same issue key  

Live refresh already existed (`GET /rest/api/3/issue/{key}`), but it was not **exclusive** for field questions.

---

## 2. Cache behavior (new policy)

```
Detect issue key + field intent
        ↓
Resolve JiraConnection WHERE workspaceId = current
        ↓
GET /rest/api/3/issue/{issueKey}?fields=summary,status,assignee,priority,reporter,project,issuetype
        ↓
Upsert JiraIssueCacheEntry (same workspace)
        ↓
Build ONE jira_issue document from LIVE values only
        ↓
Exclude Team Memory / Reports / Slack / Demo / conversation history
        ↓
Answer from that document
```

| Situation | Behavior |
|-----------|----------|
| Live connected + API OK | Answer from Live; cache updated |
| Live connected + API miss | “Not found” — **do not** fall back to stale cache |
| No live connection (Demo / offline) | Cache for **that** workspace only |

**Never answer field questions from stale cache when a live connection exists.**

---

## 3. Workspace routing

Unchanged from prior fix:

- `X-Workspace-Id` / request `workspaceId` → `resolveActiveWorkspaceId`  
- `findLiveConnectionForWorkspace(workspaceId)` — no cross-workspace connection reuse  
- Cache upsert uses the connection user’s `workspaceId`  

---

## 4. Jira API calls

`JiraService.lookupIssueForUser(userId, issueKey)`:

```
GET /rest/api/3/issue/{issueKey}?fields=summary,status,issuetype,project,priority,updated,assignee,reporter
```

Reads:

- `fields.status.name`  
- `fields.assignee.displayName`  
- `fields.priority.name`  
- `fields.summary`  
- `fields.reporter.displayName`  
- `fields.project.name` / `key`  

Then `JiraCacheService.upsertFromSnapshot` writes `JiraIssueCacheEntry`.

---

## 5. Files modified

| File | Change |
|------|--------|
| `backend/src/ai/workspace/retrieval/jira-field-question.ts` | **New** — detect factual field questions |
| `backend/src/ai/workspace/retrieval/source-selection.ts` | Field Qs → `['jira']` only |
| `backend/src/ai/workspace/rag/rag-pipeline.service.ts` | Set `jiraFieldsOnly`; expect single-source for fields |
| `backend/src/ai/workspace/retrieval/workspace-retrieval.service.ts` | Respect `jiraFieldsOnly`; pin drops non-Jira; skip semantic hybrid |
| `backend/src/ai/workspace/knowledge/workspace-knowledge.service.ts` | Live-first fields; no stale fallback when live required; richer logs |
| `backend/src/ai/workspace/intent/intent-detection.service.ts` | Priority / summary / reporter / sprint signals |
| `backend/src/ai/workspace/prompts/workspace-prompt.builder.ts` | Harder Live / `JIRA_FIELDS_ONLY` rules |
| `backend/src/ai/workspace/types/workspace-ai.types.ts` | Document `jiraFieldsOnly` semantics |
| `backend/src/ai/workspace/retrieval/multi-source-rag.spec.ts` | Field = Jira-only; narrative stays multi-source |
| `docs/JIRA_LIVE_SOURCE_DEBUG_REPORT.md` | This report |

---

## 6. Debug logs

Examples:

```
[JiraLiveSource] Live API Response | Workspace: … | WorkspaceId: … | JiraConnectionId: … | Issue: SCRUM-9 | Status: … | Assignee: … | Source: Live Jira API
[JiraLiveSource] Answer | Issue: SCRUM-9 | Answer Source: Live Jira API | Status: In Progress | Assignee: Karam Waleed
Jira field authority (LIVE-ONLY): … Dropped non-Jira docs: N
RAG … jiraFieldsOnly=true | sourcesSelected=jira
```

---

## 7. Test results

### Unit (`multi-source-rag.spec.ts`)

- Field questions select **Jira-only**  
- Narrative “what happened” stays multi-source  
- Blocker questions still multi-source  
- All passed  

### Live HTTP (poisoned cache)

1. Wrote `assigneeName=CACHE_POISON_ASSIGNEE` into Pulse `JiraIssueCacheEntry` for SCRUM-9  
2. Asked AI on **Pules project** and **TeamPulse Workspace**  

| Question | Workspace | Result |
|----------|-----------|--------|
| Who is assigned to SCRUM-9? | Pules project | **Karam Waleed** (not poison) |
| Who is assigned to SCRUM-9? | TeamPulse | **Karam Waleed** |
| What is the status of SCRUM-9? | Pules project | **In Progress** (not Poisoned Status) |
| What is the priority of SCRUM-9? | Pules project | **Lowest** (not Poison) |
| Who is assigned to SCRUM-9? | Demo | **Aroob Amr Abughoush / Done** (Demo only) |

Cache after refresh: `assignee=Karam Waleed`, `status=In Progress`, `summary=Dashboard Analytics`.

---

## 8. Final architecture

```
Issue key + field intent (ISSUE_STATUS / auto field detect)
  → jiraFieldsOnly=true
  → selectedSources=['jira']
  → Live GET /rest/api/3/issue/{key} via workspace connection
  → upsert cache
  → single AUTHORITATIVE jira_issue doc (Answer Source: Live Jira API)
  → pin drops all other docs
  → prompt forbids Memory/Reports/Slack overwrite
```

Investigation questions (“what happened…”, root cause) remain multi-source; Jira still owns field values in the JIRA section.
