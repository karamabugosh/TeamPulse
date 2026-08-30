# Assignee & Blocker Owner Fix

Fixes two AI Workspace retrieval problems: assignee list queries returning no results, and blocker owner answers exposing raw Slack user IDs.

---

## Root cause

### Problem 1 — Assignee list ("Show all issues assigned to Karam")

1. **Live Jira bulk skip** — When Live Jira is connected, `collectJiraIssues()` intentionally skips all cached Jira rows for bulk queries (no issue key). Assignee list questions are bulk queries, so they returned **zero Jira documents**.
2. **No assignee-list path** — There was no dedicated collector for "issues assigned to &lt;person&gt;" questions. `userQuery` was not wired into Jira collection for multi-issue lists.
3. **Weak name matching** — No partial/normalized assignee matching (`"Karam"` → `"Karam Waleed"`, `"Karam W."`). A bug in the first matcher version also incorrectly matched *any* assignee when a candidate display name started with the query.

### Problem 2 — Blocker owners ("Who owns the open blockers?")

1. **Raw Slack IDs in resolution** — `resolveOwnerDisplayName()` / `resolveSlackMentionsInText()` returned the bare ID when no name map entry existed. IDs starting with `B…` (Slack bot/app member IDs) were not recognized as Slack IDs at all.
2. **Missing Owner in AI docs** — `collectBlockersFromDashboard()` emitted `Reporter:` but not `Owner:`, so the model had no human-readable owner field to cite.
3. **Unstructured DTO** — `DashboardBlockerDto` lacked `ownerName`, `ownerSlackId`, and `ownerUserId` as first-class fields.

---

## Files changed

| File | Change |
|------|--------|
| `backend/src/ai/workspace/retrieval/assignee-match.util.ts` | **New** — normalize names, partial assignee match, list-question detection, workspace-member ranking |
| `backend/src/ai/workspace/retrieval/blocker-owner.util.ts` | **New** — `resolveBlockerOwner()`; never expose raw Slack IDs in `ownerName` |
| `backend/src/common/slack-member.util.ts` | `SLACK_MEMBER_ID_RE` (`U`/`W`/`B` prefixes); unresolved bare IDs → `"Unknown User"` |
| `backend/src/ai/workspace/types/workspace-ai.types.ts` | `assigneeQuery`, `jiraAssigneeList` filters |
| `backend/src/ai/workspace/retrieval/keyword.util.ts` | Extract person name from `assigned to` / `assignee` patterns |
| `backend/src/ai/workspace/intent/intent-detection.service.ts` | Sets `jiraAssigneeList` + `assigneeQuery` for assignee list questions |
| `backend/src/ai/workspace/retrieval/source-selection.ts` | Assignee list → Jira-only source selection |
| `backend/src/ai/workspace/knowledge/workspace-knowledge.service.ts` | `resolveAssigneeCandidates()`, `collectJiraIssuesForAssignee()`, Owner fields in blocker docs, `AUTHORITATIVE_BLOCKER_OWNERS` summary |
| `backend/src/ai/workspace/rag/rag-pipeline.service.ts` | Ensures assignee list filters after intent detection |
| `backend/src/jira/jira.service.ts` | `searchIssuesByAssignee()` — Live JQL by accountId + displayName |
| `backend/src/jira/jira-blocker.service.ts` | `ownerName` / `ownerSlackId` / `ownerUserId` on DTO; uses `resolveBlockerOwner()` |
| `backend/src/ai/workspace/prompts/workspace-prompt.builder.ts` | Blocker intent: never output Slack IDs for owners |
| `backend/src/ai/workspace/retrieval/assignee-blocker-owner.spec.ts` | **New** unit tests |
| `backend/package.json` | `test:assignee-blocker-owner` script |

---

## Assignee normalization

### Query flow

```
Question: "Show all issues assigned to Karam"
    ↓
IntentDetectionService → jiraAssigneeList=true, assigneeQuery="Karam"
    ↓
RagPipelineService (fallback extract if needed)
    ↓
collectJiraIssues() → collectJiraIssuesForAssignee()
    ↓
resolveAssigneeCandidates()
    ├── Workspace members (ranked first via rankAssigneeCandidateScore)
    ├── JiraIssueCacheEntry assignee names (partial match)
    └── JiraMemberCache accountIds + displayNames
    ↓
Live Jira JQL (assignee = accountId OR assignee = "displayName")
    + cache filter via assigneeMatchesPersonQuery()
    ↓
AUTHORITATIVE_ASSIGNEE_LIST summary doc + per-issue Jira docs
```

### Matching rules (`assigneeMatchesPersonQuery`)

| Input | Matches |
|-------|---------|
| Jira `assigneeAccountId` | Exact match against resolved candidate account IDs |
| Jira `assigneeName` | Partial match against query + expanded candidate names |
| `"Karam"` | `"Karam Waleed"`, `"Karam W."` (normalized, first-token prefix) |
| Workspace members | Ranked above Jira-only display names when scores tie |

Normalization: lowercase, collapse whitespace, strip periods on initials (`"Karam W."` → `"karam w"`).

---

## Slack ID resolution

### Resolution chain (`resolveBlockerOwner`)

```
ownerLabel (raw DB value)
    ↓
Detect Slack ID or <@U…> mention (U / W / B prefixes)
    ↓
nameBySlackId map (WorkspaceMembersService)
    ↓
userBySlackId map (Prisma User: slackDisplayName, slackRealName)
    ↓
memberDisplayLabel() → real name → display name
    ↓
Fallback: "Unknown User" (never raw ID)
```

### Blocker DTO fields

Every dashboard blocker now exposes:

- `ownerName` — human-readable (always safe for AI output)
- `ownerSlackId` — internal only (metadata, not shown to users)
- `ownerUserId` — workspace User.id when mapped

### AI evidence

- Per-blocker doc: `Owner: Rami Atrash` (never `B0BLVE1NSSC`)
- Rollup doc: `AUTHORITATIVE_BLOCKER_OWNERS` lists open blockers with owners
- Prompt rule: GET_BLOCKERS intent forbids Slack ID output

---

## Validation results

### Automated (`npm run test:assignee-blocker-owner`)

| Test | Result |
|------|--------|
| `"Karam"` matches `"Karam Waleed"` | ✓ |
| `"Karam"` matches `"Karam W."` | ✓ |
| `"Karam"` does **not** match `"Rami Atrash"` | ✓ |
| Workspace members rank above Jira-only names | ✓ |
| Assignee list question detection | ✓ |
| `B0BLVE1NSSC` → `"Rami Atrash"` | ✓ |
| Unmapped Slack ID → `"Unknown User"` | ✓ |
| Typecheck (`npx tsc --noEmit`) | ✓ |

### Expected AI answers (manual / staging)

| Question | Expected behavior |
|----------|-------------------|
| Show all issues assigned to Karam. | Lists Jira issues whose assignee partially matches Karam (Live JQL + cache); uses workspace member name expansion |
| Show all issues assigned to Rami. | Same path; workspace member `"Rami Atrash"` ranked first |
| Who owns the open blockers? | Names from `AUTHORITATIVE_BLOCKER_OWNERS` / `Owner:` lines — no Slack IDs |
| Who owns blocker API auth? | Matches blocker by title/description; returns `Owner: <display name>` |
| List blockers by owner. | Groups by `ownerName`; `"Unknown User"` when unmapped |

---

## Run tests

```bash
cd pulse/backend
npx tsc --noEmit
npm run test:assignee-blocker-owner
```
