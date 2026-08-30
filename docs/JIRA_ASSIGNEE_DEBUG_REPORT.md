# Jira Assignee Debug Report

Investigation and fix for incorrect assignee answers such as:

> Who is assigned to SCRUM-9?

**Date:** 2026-08-19  
**Verdict:** Live Jira refresh was available for issue-key questions, but RAG still mixed **Team Memory / standups / reports** (and multi-user cache rows) into context, so the LLM often cited the wrong person. Assignee/status/priority/summary now come from **Live Jira → freshest `JiraIssueCacheEntry`**, with Memory/Reports/Mock excluded as sources of truth.

---

## Root cause

1. **Competing evidence:** For `SCRUM-9`, Team Memory and standup-linked docs also matched the issue key and ranked high enough to appear in the prompt. Those texts often name people who *mentioned* the ticket (e.g. Rami), not the Jira **assignee** (e.g. Karam Waleed).
2. **Soft ranking only:** `ISSUE_STATUS` preferred `jira_issue` lightly but never **excluded** Memory/Reports. Hybrid embedding merge could promote non-Jira docs further.
3. **Multiple cache rows:** `JiraIssueCacheEntry` is per-user. Demo mock rows (assignee **Aroob…**, summary “Fix timezone…”) and live rows (assignee **Karam Waleed**) both exist for key `SCRUM-9` across workspaces. Without live overlay + single authoritative doc, the wrong row/person could influence answers.
4. **Prompt gap:** The model was not told that assignee/status/priority/summary must come **only** from `jira_issue` evidence.

Live API path itself was already correct when a real OAuth connection exists (`lookupIssueForUser` → assignee fields). The failure mode was **source selection for the LLM**, not missing assignee in the Atlassian response.

---

## Files involved

| File | Role |
|------|------|
| `backend/src/ai/workspace/workspace-ai.controller.ts` | `POST /api/ai/workspace/chat` |
| `backend/src/ai/workspace/chat/ai-chat.service.ts` | Chat orchestration → RAG → OpenAI |
| `backend/src/ai/workspace/intent/intent-detection.service.ts` | `ISSUE_STATUS` for “who is assigned…” + `issueKey` |
| `backend/src/ai/workspace/rag/rag-pipeline.service.ts` | Sets `jiraFieldsOnly` for `ISSUE_STATUS` + issue key |
| `backend/src/ai/workspace/knowledge/workspace-knowledge.service.ts` | `collectJiraIssues` + `refreshIssueFromLiveJira` + assignee debug logs |
| `backend/src/jira/jira.service.ts` | `lookupIssueForUser` — Live `GET /rest/api/3/issue/{key}` |
| `backend/src/jira/jira-cache.service.ts` | `upsertFromSnapshot` (writes `assigneeName`) |
| `backend/src/ai/workspace/retrieval/workspace-retrieval.service.ts` | Rank boost + `enforceJiraFieldAuthority` |
| `backend/src/ai/workspace/context/context-builder.service.ts` | `ISSUE_STATUS` source priority = Jira only |
| `backend/src/ai/workspace/prompts/workspace-prompt.builder.ts` | Hard rules: Jira fields only from `jira_issue` |
| `backend/src/ai/workspace/types/workspace-ai.types.ts` | `jiraFieldsOnly` filter flag |

---

## Retrieval flow (assignee)

```
Question: "Who is assigned to SCRUM-9?"
  → IntentDetectionService → ISSUE_STATUS, issueKey=SCRUM-9
  → RagPipelineService.refineFiltersForIntent
       → jiraFieldsOnly=true, userQuery=null, keyword=SCRUM-9
  → WorkspaceKnowledgeService.collectSnapshot
       → Collectors limited to Jira (+ jira_audit)
       → collectJiraIssues(SCRUM-9)
            → refreshIssueFromLiveJira()   // Live Atlassian when real connection
            → upsertFromSnapshot()         // refresh JiraIssueCacheEntry
            → Build ONE authoritative jira_issue doc
            → Debug log: Question / Source used / Value returned
  → WorkspaceRetrievalService.retrieve
       → Rank (+300 for authoritative jira_issue)
       → enforceJiraFieldAuthority()       // drop Memory/Reports for ISSUE_STATUS
  → ContextBuilder → Prompt (Jira-field hard rules)
  → OpenAI → answer uses Assignee line from jira_issue only
```

### Where assignee is retrieved

| Step | Location | Field |
|------|----------|--------|
| Live | `JiraService.lookupIssueForUser` → `fields.assignee.displayName` | `assigneeName` |
| Cache write | `JiraCacheService.upsertFromSnapshot` | `JiraIssueCacheEntry.assigneeName` |
| Knowledge doc | `collectJiraIssues` → content line `Assignee: …` | metadata.assigneeName |
| Answer | LLM reads **only** that jira_issue chunk under `jiraFieldsOnly` | — |

---

## Source selected (priority)

| Priority | Source | When used |
|----------|--------|-----------|
| 1 | **Live Jira API** | Real OAuth connection on the workspace; refreshed on every issue-key question |
| 2 | **JiraIssueCacheEntry** | Live refresh skipped/failed; freshest workspace cache row |
| 3 | **Mock** | Demo Workspace / demo Jira connection only — never treated as live Atlassian |

**Never** used as source of truth for assignee/status/priority/summary/sprint/reporter:

- Team Memory  
- Reports / AI Digests  
- Standup / conversation history  
- Demo mock narrative (except when the active workspace *is* Demo — then labeled **Mock**)

---

## Debug logging

Knowledge + retrieval log in this shape:

```
Jira assignee debug:
Question: Who is assigned to SCRUM-9? (or related field question)
Source used: Live Jira / Cache / Mock
Value returned: Karam Waleed

Jira assignee debug (retrieval):
Question: Who is assigned to SCRUM-9?
Source used: Live Jira
Value returned: Karam Waleed
```

---

## Fix implemented

1. **`jiraFieldsOnly`** on `ISSUE_STATUS` + issue key — snapshot collectors restricted to Jira (+ audit).
2. **Single authoritative `jira_issue` document** per key with Live overlay; explicit `Assignee: Unassigned` when null; `AUTHORITATIVE_JIRA_FIELDS` marker in content.
3. **`enforceJiraFieldAuthority`** — for `ISSUE_STATUS`, hits are only matching `jira_issue` (and optional audit).
4. **Ranking** — large boost for authoritative/live jira docs; demote Memory/Reports when an issue key is present.
5. **Prompt hard rules** — assignee/status/priority/summary/sprint/reporter must come from `jira_issue` only.
6. **Stale cache** — still refreshed via Live Jira before answer when a real connection exists.

---

## Observed SCRUM-9 cache diversity (pre-fix context)

| Assignee in DB | Status | Summary | Notes |
|----------------|--------|---------|--------|
| Aroob Amr Abughoush | Done | Fix timezone drift… | Demo/mock cache rows |
| (null) | To Do | Dashboard Analytics | Stale live-workspace cache |
| Karam Waleed | In Progress | Dashboard Analytics | Live-refreshed cache |

After this fix, a real-workspace question refreshes Live Jira and answers with the live assignee (e.g. **Karam Waleed**), not Demo Aroob or a standup/memory name.
