# Blockers Data Consistency Report

**Product:** Pulse  
**Date:** 2026-08-20  
**Scope:** Align AI Workspace blocker counts/lists with the Blockers page

---

## Root cause

The Blockers page and AI used **different queries and rules**:

| Path | Behavior |
|------|----------|
| **Blockers page** | `GET /api/blockers` → `JiraBlockerService.listDashboardBlockers` — **all** workspace blockers, no `take`. Stats via `computeBlockerStats` (open = not resolved/closed). |
| **AI RAG** | `WorkspaceKnowledgeService.collectBlockers` — independent Prisma query with **`take: 40`**, keyword/token `OR` filters, and a different open notion in other AI metrics (`open\|in_progress\|…`). |

Example: page Open = **8**, AI answered **4** because retrieval truncated and/or token-filtered the set.

---

## Previous architecture

```
Blockers page → JiraBlockerService.listDashboardBlockers → computeBlockerStats (frontend)
AI chat        → collectSnapshot → collectBlockers (prisma + take:40 + tokens) → LLM
```

Two sources of truth → divergent counts.

---

## New architecture

```
Blockers page  ─┐
                ├─► JiraBlockerService.listDashboardBlockersForWorkspace(workspaceId)
AI GET_BLOCKERS─┘         │
                          ├─► computeBlockerStats (backend util = UI rules)
                          └─► AUTHORITATIVE_BLOCKER_STATS + full blocker docs → LLM

GET /api/blockers/stats → same stats helpers
```

Single shared service: **`JiraBlockerService`**.  
Single shared rules: **`blocker-stats.util.ts`** (mirrors frontend `blockers.types.ts`).

---

## Shared service

**`JiraBlockerService`**

- `listDashboardBlockersForWorkspace(workspaceId, teamId?)` — full list, **no take**
- `getBlockerStatsForWorkspace(workspaceId)` — Open / Critical / Waiting>3d / Resolved this week
- `listDashboardBlockers()` — active workspace wrapper (unchanged API)

**`blocker-stats.util.ts`**

- `isOpenBlockerStatus` — not `resolved` / `closed`
- `computeBlockerStats` — same four cards as the UI
- `isBlockerCountOrListQuestion` — routes count/list prompts to full-list path

---

## Queries

### Dashboard list (page + AI)

```ts
prisma.pulseBlocker.findMany({
  where: { workspaceId, ...(teamId ? { teamId } : {}) },
  orderBy: { createdAt: 'desc' },
  // NO take / skip
})
```

There is no `deleted` / `archived` column on `PulseBlocker`.

### Open definition (page + AI)

`status ∉ { resolved, closed }` (includes `waiting`, `investigating`, `in_progress`, `open`).

### AI full-list trigger

`blockersFullList=true` when intent is `GET_BLOCKERS` or question matches count/list/summary patterns. Collector skips token filters and `take`.

---

## Tests

**File:** `backend/src/ai/workspace/retrieval/blockers-consistency.spec.ts`  
**Command:** `npm run test:ai-retrieval`

| Question | Expected |
|----------|----------|
| How many blockers? | Same open count as Blockers page rules on full set |
| List open blockers. | Intent `GET_BLOCKERS`; full-list flag path |
| Critical blockers | Matches critical card rule (open + priority critical) |

Also asserts truncation (`take: 4`) would diverge from page — full list required.

---

## Validation

1. Open Blockers page (default filters) → note Open / Critical / Waiting>3d / Resolved this week.
2. Ask AI: “How many open blockers?” → must equal Open card.
3. Ask AI: “List open blockers.” → same set as unfiltered list open rows.
4. Ask AI: “Critical blockers” → same as Critical card.
5. Logs include: Workspace ID, Retrieved blockers, Open / Critical / Resolved counts.

---

## Files modified

| File | Change |
|------|--------|
| `backend/src/jira/blocker-stats.util.ts` | **New** shared stats rules |
| `backend/src/jira/jira-blocker.service.ts` | Workspace-scoped list + stats |
| `backend/src/jira/blocker.controller.ts` | `GET /blockers/stats` |
| `backend/src/ai/workspace/knowledge/workspace-knowledge.service.ts` | Dashboard collector path |
| `backend/src/ai/workspace/rag/rag-pipeline.service.ts` | `blockersFullList` |
| `backend/src/ai/workspace/retrieval/workspace-retrieval.service.ts` | Preserve full blocker set |
| `backend/src/ai/workspace/context/context-builder.service.ts` | Larger budget for full list |
| `backend/src/ai/workspace/prompts/workspace-prompt.builder.ts` | Authoritative stats guidance |
| `backend/src/ai/workspace/types/workspace-ai.types.ts` | `blockersFullList` |
| `backend/src/ai/workspace/retrieval/blockers-consistency.spec.ts` | Tests |
| `docs/BLOCKERS_DATA_CONSISTENCY_REPORT.md` | This report |

---

## Summary

AI no longer invents blocker counts from truncated RAG hits. Count/list questions use **`JiraBlockerService`** — the same collection as the Blockers page — with identical open/critical/aging/resolved-week rules.
