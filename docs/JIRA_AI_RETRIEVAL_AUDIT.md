# Jira AI Retrieval Audit

Investigation of how Pulse AI answers Jira questions such as:

> What is the status of SCRUM-9?

**Audit date:** 2026-08-19  
**Verdict:** Before the fix, AI used **stale `JiraIssueCacheEntry` data** and never called Live Jira during chat. After the fix, issue-key questions **refresh from Live Jira** (when a real connection exists), update the cache, then answer.

---

## Complete request flow

```
POST /api/ai/workspace/chat
  → WorkspaceAiController.chat()
  → AiChatService.chat()
  → IntentDetectionService.detect()          // ISSUE_STATUS + issueKey=SCRUM-9
  → RagPipelineService.prepare()
      → WorkspaceRetrievalService.retrieve()
          → WorkspaceKnowledgeService.collectSnapshot()
              → collectJiraIssues()
                  → refreshIssueFromLiveJira()   // NEW: Live Atlassian GET /issue/{key}
                  → JiraCacheService.upsertFromSnapshot()
                  → Prisma JiraIssueCacheEntry.findMany()
          → hybrid keyword + embedding rank
      → ContextBuilderService.build()
      → WorkspacePromptBuilder.build()
  → OpenAiChatProvider.complete()
  → ChatResponseFormatter.format()
  → AiChatResponse (answer + sources metadata)
```

### Step-by-step

| # | Step | File | Function |
|---|------|------|----------|
| 1 | HTTP entry | `backend/src/ai/workspace/workspace-ai.controller.ts` | `chat()` → `POST ai/workspace/chat` |
| 2 | Chat orchestration | `backend/src/ai/workspace/chat/ai-chat.service.ts` | `chat()` |
| 3 | Intent | `backend/src/ai/workspace/intent/intent-detection.service.ts` | `detect()` → `WorkspaceAiIntent.ISSUE_STATUS`, `filters.issueKey` |
| 4 | RAG prepare | `backend/src/ai/workspace/rag/rag-pipeline.service.ts` | `prepare()` |
| 5 | Retrieval | `backend/src/ai/workspace/retrieval/workspace-retrieval.service.ts` | `retrieve()` |
| 6 | Knowledge collect | `backend/src/ai/workspace/knowledge/workspace-knowledge.service.ts` | `collectSnapshot()` → `collectJiraIssues()` |
| 7 | **Live refresh (fix)** | same | `refreshIssueFromLiveJira()` |
| 8 | Live API | `backend/src/jira/jira.service.ts` | `lookupIssueForUser()` → `GET /rest/api/3/issue/{key}` |
| 9 | Cache write | `backend/src/jira/jira-cache.service.ts` | `upsertFromSnapshot()` |
| 10 | Context + prompt | `context-builder.service.ts`, `workspace-prompt.builder.ts` | `build()` |
| 11 | LLM answer | `openai-chat.provider.ts` | `complete()` |
| 12 | Format | `chat-response.formatter.ts` | `format()` |

---

## Data sources used

| Source | Used for ISSUE_STATUS? | Notes |
|--------|------------------------|-------|
| **Live Jira API** | **Yes (after fix)** | Read-only `lookupIssueForUser` when workspace has a real OAuth connection |
| **`JiraIssueCacheEntry`** | Yes | Always read after refresh; Demo Workspace uses this only (mock) |
| Team Memory | Secondary | May mention SCRUM-9 from standups/index; ranked below exact jira_issue match |
| Reports / AiDigest | Possible | Not authoritative for current status |
| Standups / AnswerJiraIssueLink | Possible | Historical links |
| Demo mock seed | Only in Demo Workspace | Fake SCRUM-* board — isolated from live site |

Intent preference for `ISSUE_STATUS` (`workspace-retrieval.service.ts`):

`jira_issue` → `jira_audit` → `blocker` → `standup_submission`

---

## Live vs cache comparison (real workspace)

Workspace: **Pules project** (`T0BKKJNTQJ3`)  
Issue: **SCRUM-9**

| Field | Stale cache (before) | Live Jira | Cache after AI refresh |
|-------|----------------------|-----------|------------------------|
| Summary | Dashboard Analytics | Dashboard Analytics | Dashboard Analytics |
| Status | **To Do** | **In Progress** | **In Progress** |
| Assignee | null | Karam Waleed | Karam Waleed |
| Refreshed | 2026-08-17 | 2026-08-19 (live) | 2026-08-19 |

**Root cause of wrong answers:** AI never called Live Jira during chat. It only read `JiraIssueCacheEntry`, which was last filled by picker sync (`JiraCacheService.refreshUserCache`, max 50 visible issues) and could lag days behind the board.

Demo Workspace is a separate case: SCRUM-9 there is **mock** (“Fix timezone drift…”, Done). That is intentional isolation — Demo has no real Atlassian tokens.

---

## Root cause

1. `WorkspaceKnowledgeService.collectJiraIssues()` queried **only** Postgres `JiraIssueCacheEntry`.
2. Cache sync happened on `POST /api/jira/sync` / picker refresh — **not** on every AI question.
3. Knowledge snapshot TTL (5s) could also reuse a stale in-memory snapshot for the same filters (issue-key queries now skip that cache).

---

## Files involved

| File | Role |
|------|------|
| `workspace-ai.controller.ts` | Receives chat request |
| `ai-chat.service.ts` | Routes to RAG |
| `intent-detection.service.ts` | Detects ISSUE_STATUS + issue key |
| `rag-pipeline.service.ts` | Intent → retrieval → context → prompt |
| `workspace-retrieval.service.ts` | Hybrid retrieval / ranking |
| `workspace-knowledge.service.ts` | Collectors + **live refresh** |
| `jira.service.ts` | Live `lookupIssueForUser` |
| `jira-cache.service.ts` | Upsert cache after live read |
| `jira-issue-ref.types.ts` | Snapshot includes assignee fields |

---

## Fix implemented

For any knowledge collection with `filters.issueKey` set:

1. Resolve a **real** `JiraConnection` for the active workspace (skip Demo fake `demo-cloud-id`).
2. Call **Live Jira** `GET /rest/api/3/issue/{key}?fields=summary,status,...,assignee`.
3. **Upsert** `JiraIssueCacheEntry` (status, summary, assignee, `refreshedAt`).
4. Build RAG documents from the refreshed row and mark `liveRefreshed: true`.
5. If Live Jira fails, fall back to cache (logged).
6. Skip in-memory knowledge snapshot cache when `issueKey` is present.

**Demo Workspace:** still mock-only (no live tokens) — correct isolation.

---

## Recommended ops habits

- Keep using `POST /api/jira/sync` for broad picker cache refresh.
- Treat issue-key AI questions as **live-authoritative** after this fix.
- When testing Demo vs production, confirm the active workspace switcher — same key `SCRUM-9` means different tickets in Demo vs real Jira.

---

## Answer to “Live or stale?”

| Before fix | After fix |
|------------|-----------|
| **Stale cached data** (`JiraIssueCacheEntry`) | **Live Jira first**, then updated cache, for real workspaces |

Verified: AI knowledge doc for SCRUM-9 now includes  
`Status: In Progress` and `Data source: Live Jira API (refreshed for this question)`.
