# RAG Multi-Source Retrieval Fix Report

**Date:** 2026-08-23  
**Issue:** Composite Ask Pulse queries (latest standup + Live Jira fields) returned incomplete Jira status/priority and incorrectly showed "Warning — fallback used" in AI Trace.

---

## 1. Root Cause

**Primary: `jiraFieldsOnly` filter leak on composite questions**

Composite questions such as:

> What did Karam say about SCRUM-9 in his latest standup, and what is SCRUM-9's current status, assignee, and priority in Jira?

matched both narrative signals (`standup`, `latest`) **and** Jira field signals (`status`, `assignee`, `priority`).  
`isJiraFieldQuestion()` returned `true`, setting `filters.jiraFieldsOnly = true` during refine.

`buildMemoryRetrievalPlan()` correctly classified the query as `COMPOSITE_JIRA_MEMORY` with `jiraFieldsOnly: false`, but `RagPipelineService` only **set** `jiraFieldsOnly=true` when the plan required it — it never **cleared** the stale `true` from refine.

**Effects:**
- `selectRelevantSources()` returned **Jira only** — no standup/V2/team memory
- `pinJiraAuthority()` dropped all non-Jira evidence
- `mustUseLive=true` on live failure → `ISSUE_NOT_FOUND` doc with no usable fields
- User saw correct assignee sometimes (partial cache/live) but missing status/priority

**Secondary causes:**
- `formatJiraChunk()` omitted Status/Priority lines when metadata values were falsy (even when content had placeholders)
- AI Trace marked `WARNING_FALLBACK_USED` for any stage WARNING (ACL, temporal, zero legacy hits) — not actual API fallback
- `countLiveJiraDocuments()` counted cache docs as "live"

---

## 2. Why Fallback Was Triggered (Trace)

Before fix, `derivePipelineHealth()` returned `WARNING_FALLBACK_USED` when **any** stage had status `WARNING` or quality warnings existed — including:
- Unresolved temporal scope (non-fatal)
- Zero legacy hits when V2 supplied evidence (expected in HYBRID)
- Quality warnings (multi-run scope)

This was **not** an API fallback — it was a trace classification bug.

After fix:
| Health | Meaning |
|--------|---------|
| `ALL_STAGES_PASSED` | All stages succeeded |
| `PARTIAL_SUCCESS` | Quality/temporal warnings only |
| `FALLBACK_USED` | V2 error, Live Jira API failure, legacy error, or OpenAI failure |
| `FAILED` | Hard failure (e.g. OpenAI down on required path) |

---

## 3. Files Modified

| File | Change |
|------|--------|
| `retrieval/jira-field-question.ts` | Composite (narrative + field / latest + field) → not fields-only |
| `retrieval/source-selection.ts` | `COMPOSITE_JIRA_MEMORY` always multi-source |
| `rag/rag-pipeline.service.ts` | Sync `jiraFieldsOnly` + `memoryAskCategory` from plan; multi-source debug logs |
| `knowledge/workspace-knowledge.service.ts` | Live Jira retry; expanded field metadata on documents |
| `jira/jira.service.ts` | Expanded Live API fields (labels, components, duedate, resolution, fixVersions) |
| `jira/jira.types.ts` | Extended `JiraIssueSummary` |
| `context/context-builder.service.ts` | Always emit Status/Priority/Assignee for authoritative Jira chunks |
| `memory/memory-evidence.adapter.ts` | `LIVE_JIRA_CURRENT` only for authoritative Jira docs |
| `trace/ai-pipeline-trace.builder.ts` | Accurate Live Jira stage + fallback health semantics |
| `trace/ai-pipeline-trace.types.ts` | `PARTIAL_SUCCESS`, `FALLBACK_USED` health values |
| `types/workspace-ai.types.ts` | `memoryAskCategory` on filters |
| `frontend/.../AiPipelineTracePanel.tsx` | Updated health labels |
| `frontend/.../ai-pipeline-trace.types.ts` | Mirror backend health enum |

**New tests:** `retrieval/jira-field-question.spec.ts`

---

## 4. Jira Retrieval Flow

```
Question + issueKey detected
  ↓
Policy: CURRENT_JIRA_FIELD | COMPOSITE_JIRA_MEMORY | HISTORICAL_NARRATIVE
  ↓
collectJiraIssues()
  ↓
refreshIssueFromLiveJiraWithRetry()  ← 2 attempts
  ↓
GET /rest/api/3/issue/{key}?fields=summary,status,priority,assignee,reporter,labels,components,duedate,resolution,fixVersions
  ↓
upsertFromSnapshot() → JiraIssueCacheEntry
  ↓
Build authoritative jira_issue KnowledgeDocument
  metadata: { status, priority, assigneeName, summary, liveRefreshed, authoritativeJiraFields }
  ↓
COMPOSITE: cache fallback allowed if live fails (partial answer + trace shows liveApiFailed)
CURRENT_JIRA_FIELD: cache blocked when live connected (mustUseLive)
```

---

## 5. Slack / Standup Retrieval Flow

For composite + latest standup:

```
detectTemporalRetrievalScope() → LATEST_STANDUP
  ↓
LatestStandupResolverService → submission + scoped source IDs
  ↓
V2 Memory retrieval (scoped SQL filters)
  ↓
Legacy collectors: standup_runs, team_memory, blockers, slack_standups, …
  ↓
Post-filter + HYBRID merge (temporal scope enforced)
```

Standup evidence and Live Jira evidence both enter merged context.

---

## 6. Merge Strategy

HYBRID mode (unchanged mode, fixed inputs):

1. **Live Jira** → `LIVE_JIRA_CURRENT` (authoritative for status/assignee/priority)
2. **V2 Memory** → `TEAM_MEMORY_HISTORICAL` (standup answers, blockers)
3. **Legacy** → `LEGACY_SUPPORTING` (supporting narrative)

Merge rules:
- Composite queries receive **both** Jira doc and scoped standup/V2 docs
- Temporal scope filter excludes out-of-scope legacy when `LATEST_STANDUP`
- Prompt explicitly instructs: historical from memory/standups; **current Jira fields ONLY from JIRA section**

---

## 7. Prompt Construction

`WorkspacePromptBuilder` for `COMPOSITE_JIRA_MEMORY`:

```
This is a COMPOSITE question: answer historical context from TEAM MEMORY / blockers / standups / reports,
and current Jira fields ONLY from the JIRA (LIVE_JIRA_CURRENT) section.
```

Context sections ordered: **JIRA → SLACK → STANDUPS → … → TEAM MEMORY**

Jira section now always includes explicit lines:
```
Summary: ...
Status: ...
Assignee: ...
Priority: ...
```

Even when a field is null in Jira, the prompt shows `(not set in Jira)` — never silently omitted.

---

## 8. Debug Logs

New `[RAG Multi-Source]` log line per request:

```
workspaceId, question, intent, category, issueKey, jiraFieldsOnly,
temporal, sources, merged/v2/legacy/liveJira counts,
liveRefreshed, jiraStatus, jiraPriority, jiraAssignee, promptSize, contextChunks
```

Existing `[JiraLiveSource]` and `[JiraLookup]` logs retained.

---

## 9. Test Results

| Test | Result |
|------|--------|
| `npm run test:jira-field-question` | **PASS** — composite multi-source, pure field jira-only |
| `npm run test:ai-pipeline-trace` | **PASS** |
| `npm run test:ai-pipeline-trace-integration` | **PASS** |
| `npm run test:memory-latest-standup-queries` | **PASS** (8/8) |

Manual verification recommended in AI Workspace:
- Composite Karam + SCRUM-9 + latest standup + Jira fields
- Pure field: Who is assigned to SCRUM-9?
- Trace should show `All stages passed` or `Completed with warnings` — not fallback unless Live Jira API actually failed

---

## 10. Final RAG Architecture

```
User Question
  ↓
Intent Detection (+ temporal scope if "latest standup")
  ↓
buildMemoryRetrievalPlan() → category + jiraFieldsOnly + useLiveJira + useV2Memory
  ↓
Filters synced from plan (authoritative — no stale jiraFieldsOnly)
  ↓
selectRelevantSources()
  ├─ COMPOSITE → multi-source (Jira + standups + V2 + …)
  └─ CURRENT_JIRA_FIELD → Jira only
  ↓
Parallel retrieval tasks:
  ├─ Task 1: Legacy collectors (+ Live Jira refresh with retry)
  └─ Task 2: V2 Memory (scoped when temporal)
  ↓
Evidence merge (authority-aware, temporal filter)
  ↓
Field validation in context builder (authoritative Jira always structured)
  ↓
Prompt builder (composite vs fields-only rules)
  ↓
OpenAI
  ↓
Answer + pipelineTrace (accurate health)
```

**Schema changed:** NO  
**Migration:** NO

---

## Remaining Risks

| Risk | Mitigation |
|------|------------|
| Live Jira OAuth unavailable | Cache fallback + trace `FALLBACK_USED` with `liveApiFailed` |
| Sprint field varies by Jira site | Uses fixVersions as sprint proxy; site-specific sprint custom fields may need future mapping |
| Conversation history does not persist trace | Live response only (documented) |
