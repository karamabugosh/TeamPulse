# Jira Member Retrieval Report

**Product:** Pulse (Team Pulse / Pulse V2)  
**Date:** 2026-08-20  
**Scope:** AI Workspace Jira member directory questions (parity with Slack members)

---

## Root cause

Slack member questions (`SLACK_MEMBERS`) already had a dedicated path:

Live Slack `users.list` → `SlackMemberCache` → TeamMember/User → Demo

Jira member questions such as **“give me the members in jira”** did **not**:

1. They were often classified as generic `SLACK_MEMBERS` / `LIST_MEMBERS` (phrase “members” matched Slack scoring).
2. Collectors only loaded Slack directory / Pulse `User` rows — never `JiraService.listWorkspaceMembers()`.
3. There was **no `JiraMemberCache`** table and no AI collector for Jira site users.
4. Multi-source RAG / empty Slack-biased context led to the insufficient-data reply: *“I couldn't find information…”*

---

## Retrieval flow

```
Question: "Who are the Jira members?"
  → IntentDetectionService
       hard override → JIRA_MEMBERS + jiraMembersOnly=true
  → RagPipeline refineFilters
       jiraMembersOnly=true (Slack collectors off)
  → selectRelevantSources → ['jira_members']
  → WorkspaceKnowledgeService.collectSnapshot
       collectors limited to jira_members only
  → collectJiraMembers()
       1) JiraMemberCacheService.syncFromLive(workspaceId)
            → find usable JiraConnection for this workspaceId
            → JiraService.listWorkspaceMembers({ connection })
            → upsert JiraMemberCache (active humans)
       2) else JiraMemberCache (active=true)
       3) Demo: seeded JiraMemberCache only (never Live Atlassian)
  → enforceJiraMemberAuthority (entity === jira_member only)
  → Prompt: AUTHORITATIVE_JIRA_MEMBERS
  → LLM lists displayName / accountId / email
```

### Priority

| Order | Source | When used |
|------|--------|-----------|
| 1 | **Live Jira API** (`listWorkspaceMembers`) | Real workspace with usable OAuth connection |
| 2 | **JiraMemberCache** | Live failed / unavailable; cache has active rows |
| 3 | **Demo Workspace members** | Demo workspace only (seeded cache; no Live call) |

**Never used for this intent:** Slack, Team Memory, Reports, Standups, AI Conversations.

---

## API used

`JiraService.listWorkspaceMembers({ connection, maxResults })`

- Primary: `GET /rest/api/3/users/search` (paginated)
- Fallback enrichment: assignees from recent visible issues + connected Atlassian user
- Filters out apps/customers/addon accounts
- Returns **active** humans only (`active !== false`)

`JiraMemberCacheService.syncFromLive(workspaceId)` scopes the connection by **`workspaceId`** (never mixes Demo/Real).

---

## Cache flow

### Model `JiraMemberCache`

| Field | Type |
|-------|------|
| workspaceId | string (FK Workspace) |
| accountId | string |
| displayName | string |
| email | string? |
| avatarUrl | string? |
| accountType | string? |
| active | boolean |
| updatedAt / cachedAt | DateTime |

Unique: `(workspaceId, accountId)`.

### Refresh

- Every AI `JIRA_MEMBERS` question attempts Live sync first (Real workspaces).
- Upsert all returned members; mark missing accounts `active: false`.
- Demo seed writes roster into `JiraMemberCache` (same names as Demo Slack roster / Jira template).

---

## Workspace isolation

- Every query filters by `workspaceId`.
- Live sync refuses Demo fake tokens (`DEMO_CLOUD_ID` / `demo-access-token`).
- Demo never calls Live Atlassian for member sync.
- Real never reads Demo `JiraMemberCache` rows.

---

## Debug logs

```
Jira members debug:
Question: …
Detected Intent: JIRA_MEMBERS
Workspace: …
Source used: Live Jira | JiraMemberCache | Demo | none
Members retrieved: …
```

Also logged at retrieval authority step with the same fields.

---

## Files modified

| File | Change |
|------|--------|
| `prisma/schema.prisma` | `JiraMemberCache` model + Workspace relation |
| `prisma/migrations/20260820140000_jira_member_cache/migration.sql` | Migration |
| `src/jira/jira-member-cache.service.ts` | **New** Live → cache service |
| `src/jira/jira.module.ts` | Provide/export `JiraMemberCacheService` |
| `src/ai/workspace/types/workspace-ai.types.ts` | `JIRA_MEMBERS`, `jira_member`, `jiraMembersOnly` |
| `src/ai/workspace/intent/intent-detection.service.ts` | Hard detect Jira member queries |
| `src/ai/workspace/retrieval/source-selection.ts` | `jira_members` only for `JIRA_MEMBERS` |
| `src/ai/workspace/knowledge/workspace-knowledge.service.ts` | `collectJiraMembers` |
| `src/ai/workspace/retrieval/workspace-retrieval.service.ts` | `enforceJiraMemberAuthority` |
| `src/ai/workspace/rag/rag-pipeline.service.ts` | `jiraMembersOnly` refine |
| `src/ai/workspace/prompts/workspace-prompt.builder.ts` | Jira member guidance |
| `src/ai/workspace/context/context-builder.service.ts` | Map `jira_member` → users section |
| `src/demo/demo-workspace-builder.ts` | Seed + clear `JiraMemberCache` |
| `src/ai/workspace/retrieval/jira-members.spec.ts` | **New** tests |
| `package.json` | Wire tests into `test:ai-retrieval` |
| `docs/JIRA_MEMBER_RETRIEVAL_REPORT.md` | This report |

---

## Tests added

**File:** `backend/src/ai/workspace/retrieval/jira-members.spec.ts`  
**Command:** `npm run test:ai-retrieval`

| Question | Expected |
|----------|----------|
| Who are the Jira members? | Intent `JIRA_MEMBERS`; sources `['jira_members']`; live roster in context |
| List Jira users. | Same |
| Show Jira workspace members. | Same |
| give me the members in slack | Still `SLACK_MEMBERS` (no regression) |

Also asserts: no Slack/Team Memory pollution; Real/Demo isolation.

---

## Summary

Jira member questions now mirror Slack member retrieval: dedicated intent, Live API first, PostgreSQL cache, Demo seed fallback, strict exclusion of narrative sources, workspace isolation, debug logs, and integration tests.
