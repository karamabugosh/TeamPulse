# JiraIssueCacheEntry Duplicate Audit

**Date:** 2026-08-19  
**Scope:** Per-workspace uniqueness of cached Jira issue keys  
**Verdict:** Duplicates existed by design under `(userId, issueKey)`. Migration + code now enforce **one active row per `(workspaceId, issueKey)`**. Live refresh updates that row instead of inserting another.

---

## Summary

| Metric | Before | After |
|--------|--------|-------|
| Total cache rows | **131** | **50** |
| Unique `(workspace, issueKey)` | 50 | 50 |
| Duplicate groups | **41** | **0** |
| Extra (stale) rows removed | — | **81** |

Unique constraint now:

```text
@@unique([workspaceId, issueKey])
→ index JiraIssueCacheEntry_workspaceId_issueKey_key
```

---

## Why duplicates existed

1. **Schema uniqueness was per-user**, not per-workspace:
   - Old: `@@unique([userId, issueKey])`
   - Each user who synced or linked Jira got their **own** row for the same key (e.g. `SCRUM-9`).
2. **Demo seed multiplied rows**: `demo-workspace-builder` created **every Demo user × every mock issue** (3 users × ~40 issues ≈ 120 rows).
3. **Live refresh upserted by `userId_issueKey`**: User A’s live refresh updated A’s row; User B’s stale row for the same key remained. Workspace queries (`user: { workspaceId }`) then saw multiple SCRUM-9 rows with different assignee/status.

This is why AI could see conflicting assignees/statuses for the same issue key inside one workspace.

---

## Duplicates found (pre-fix)

### By workspace

| Workspace ID | Duplicate groups | Extra rows |
|--------------|------------------|------------|
| `b1ba6c87-0e8e-412e-b934-7c3b981d6982` (Demo) | 40 | 80 |
| `0e4985cc-3955-4af5-8cba-d72f25f1a8ee` (real / Pules) | 1 | 1 |

### Example: SCRUM-9 (real workspace) — before merge

| Kept? | User | Status | Assignee | refreshedAt |
|-------|------|--------|----------|-------------|
| **Keep** | Aroob Amr Abughoush | In Progress | **Karam Waleed** | 2026-08-19T18:23:22Z |
| Delete | Karam | To Do | null | 2026-08-17T09:48:28Z |

### Demo pattern

Each of SCRUM-1 … SCRUM-N had **3 identical field copies** (one per Demo Jira-connected user: Rami, Karam, Aroob), same timestamps from seed.

---

## How duplicates were resolved

Migration: `prisma/migrations/20260819200000_jira_cache_workspace_unique/migration.sql`

1. Added `workspaceId` column; backfilled from `User.workspaceId`.
2. **Deleted stale duplicates**, keeping the row with the latest `refreshedAt` (tie-break: higher `id`).
3. Set `workspaceId` NOT NULL; FK → `Workspace`.
4. Dropped `JiraIssueCacheEntry_userId_issueKey_key`.
5. Created unique index `JiraIssueCacheEntry_workspaceId_issueKey_key`.

**Resolution rule:** freshest row wins; older per-user copies removed.

Post-migration verification (raw SQL):

- `COUNT(*) = 50`
- `GROUP BY workspaceId, UPPER(issueKey) HAVING COUNT(*) > 1` → **empty**
- SCRUM-9: **one row per workspace** (live workspace: Karam Waleed / In Progress; Demo: separate mock row)

---

## Code / schema changes

| Area | Change |
|------|--------|
| `prisma/schema.prisma` | `workspaceId` + `@@unique([workspaceId, issueKey])`; `userId` = last refresher |
| `JiraCacheService.upsertFromSnapshot` | Upserts on `workspaceId_issueKey`; normalizes key to uppercase; updates same row |
| `searchCachedIssues` / `resolveIssueKeysForUser` | Resolve via workspace shared cache |
| `AnswerJiraLinkService` | Cache lookup by workspace |
| `demo-workspace-builder` | One cache row per issue (not per user); clear by `workspaceId` |
| `WorkspaceKnowledgeService.collectJiraIssues` | Query `where: { workspaceId }` |

Live Jira refresh path:

```text
refreshIssueFromLiveJira → upsertFromSnapshot(userId, live)
  → resolve user’s workspaceId
  → upsert where workspaceId_issueKey
  → update existing row (no second active row)
```

---

## Guarantee going forward

1. Issue keys are **unique per workspace**.
2. There is **never more than one active cache row** for the same issue key in the same workspace (DB unique index enforces it).
3. Live refresh **updates** that row; it does not create workspace-level duplicates.
4. The same issue key in **different** workspaces (e.g. Demo vs real) remains allowed — those are different boards/contexts.

---

## Follow-up

Restart backend after this migration (`npm run start:dev`) so the process loads the regenerated Prisma client. Prisma Studio was also holding the engine DLL during generate; reopen it if needed.
