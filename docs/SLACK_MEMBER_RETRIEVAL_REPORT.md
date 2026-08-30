# Slack Member Retrieval Report

Investigation and fix for Slack member questions returning DB/Demo roster instead of the connected Slack workspace directory.

**Date:** 2026-08-20  
**Verdict:** Member questions used the `User` table only. There was no Live `users.list` refresh on the AI path and no `SlackMemberCache`. Behavior now matches Jira: **Live Slack → SlackMemberCache → TeamMember → Demo/User**.

---

## Current behavior (before fix)

Questions such as:

- “Who are the members in Slack?”
- “Who is in the Slack workspace?”

were detected as `LIST_MEMBERS`, collected via `collectUsers()` → `prisma.user.findMany({ workspaceId })`, and answered from whatever Pulse had stored (often Demo or a partial TeamMember/`User` set). Live Slack was never consulted on the AI path.

Admin UI already had a `users.list` sync into `User`, but the AI collector did not call it and did not isolate member evidence from Memory/Reports/Standups.

---

## Root cause

1. **AI collector read `User` only** — not Live Slack.
2. **No dedicated Slack directory cache** analogous to `JiraIssueCacheEntry`.
3. **No `slackMembersOnly` authority mode** — other RAG sources could dilute or confuse the roster.
4. Intent coverage was OK-ish (`LIST_MEMBERS`) but not explicitly modeled as a Live-directory intent.

---

## Retrieval flow (after fix)

```
Question: "Who are the Slack members?"
  → IntentDetectionService → SLACK_MEMBERS
  → RagPipeline refineFilters → slackMembersOnly = true
  → WorkspaceKnowledgeService.collectSnapshot
       collectors limited to slack_members only
  → collectUsers / Slack directory collector
       1) SlackMemberCacheService.syncFromLive (users.list)
       2) else SlackMemberCache (human, !deleted, !bot)
       3) else TeamMember → User
       4) else User table (Demo when T_DEMO_PULSE_WS)
  → enforceSlackMemberAuthority (entity === user only)
  → Prompt: AUTHORITATIVE_SLACK_MEMBERS only
  → LLM lists members
```

### Priority (same shape as Jira)

| Order | Source | When used |
|------|--------|-----------|
| 1 | **Live Slack API** (`users.list`) | Usable `xoxb-` bot token on workspace |
| 2 | **SlackMemberCache** | Live failed/unavailable; cache has humans |
| 3 | **TeamMember → User** | Cache empty |
| 4 | **User / Demo** | Last resort (Demo seeds cache too) |

Ignored for this intent: Team Memory, Reports, Standups, AI conversations.

---

## Live Slack API flow

`SlackMemberCacheService.syncFromLive(workspaceId)`:

1. Load workspace `botToken`.
2. Skip if `!isUsableSlackBotToken` (Demo placeholder / empty).
3. Paginate `client.users.list({ limit: 200 })`.
4. For each member, upsert `SlackMemberCache` (`isBot`, `deleted`, names, email).
5. For **human** members only (not bot, not app user, not deleted, not placeholder, not `USLACKBOT`):
   - Include in returned roster
   - Upsert `User` (product features)
6. Mark cache rows missing from this sync as `deleted: true`.

Human filter matches product rules:

- ignore `deleted`
- ignore `is_bot` / `is_app_user`
- ignore `USLACKBOT` / `slackbot`
- ignore placeholder test accounts

---

## Cache flow

### Model `SlackMemberCache`

| Field | Type |
|-------|------|
| workspaceId | string (FK Workspace) |
| slackUserId | string |
| displayName | string |
| realName | string? |
| email | string? |
| isBot | boolean |
| deleted | boolean |
| updatedAt | DateTime |
| cachedAt | DateTime |

Unique: `(workspaceId, slackUserId)`.

### Refresh triggers

- Every AI `SLACK_MEMBERS` / `LIST_MEMBERS` question (live attempt first)
- Admin `listWorkspaceMembers` / `syncWorkspaceMembers` (delegates to same service)

Demo seed writes cache rows so Demo answers come from **Demo cache**, not Live.

---

## Database flow

```
Live users.list
  → upsert SlackMemberCache (all members, flags)
  → upsert User (humans only, workspace-safe)
```

Fallback reads:

```
SlackMemberCache WHERE workspaceId AND NOT isBot AND NOT deleted
  → else TeamMember INCLUDE User
  → else User WHERE workspaceId
```

---

## AI flow

| Piece | Behavior |
|-------|----------|
| Intent | `SLACK_MEMBERS` (phrases: slack members, who is in this slack workspace, list slack users, …). `LIST_MEMBERS` kept as deprecated alias in handlers. |
| Filters | `slackMembersOnly: true` |
| Collectors | Only `slack_members` |
| Retrieval | `enforceSlackMemberAuthority` keeps `entity === 'user'` |
| Prompt | Use authoritative Slack member docs only |
| Debug log | Question / Workspace / Source used / Members returned |

Example log:

```
Slack members debug:
Question: Who are the members in Slack?
Workspace: 0e4985cc-…
Source used: Live Slack
Members returned: Alice, Bob, …
```

---

## Files modified

| File | Change |
|------|--------|
| `prisma/schema.prisma` | `SlackMemberCache` model + Workspace relation |
| `prisma/migrations/20260820030000_slack_member_cache/` | Migration SQL |
| `src/slack/slack-member-cache.service.ts` | Live sync + cache helpers |
| `src/slack/slack-member-cache.module.ts` | Isolated Nest module (avoids Ai↔Slack cycle) |
| `src/ai/ai.module.ts` | Import `SlackMemberCacheModule` |
| `src/admin/admin.module.ts` / `admin.service.ts` | Sync via cache service |
| `src/ai/workspace/types/workspace-ai.types.ts` | `SLACK_MEMBERS`, `slackMembersOnly` |
| `src/ai/workspace/intent/intent-detection.service.ts` | Intent phrases |
| `src/ai/workspace/rag/rag-pipeline.service.ts` | `slackMembersOnly` |
| `src/ai/workspace/knowledge/workspace-knowledge.service.ts` | Live→cache→team→demo collector + debug logs |
| `src/ai/workspace/retrieval/workspace-retrieval.service.ts` | `enforceSlackMemberAuthority` |
| `src/ai/workspace/context/context-builder.service.ts` | Intent sources |
| `src/ai/workspace/prompts/workspace-prompt.builder.ts` | Hard rules |
| `src/demo/demo-workspace-builder.ts` | Seed + clear cache |
| `docs/SLACK_MEMBER_RETRIEVAL_REPORT.md` | This report |

---

## Final architecture

```
┌─────────────────────────────────────────────────────────────┐
│  SLACK_MEMBERS intent                                        │
│  slackMembersOnly = true                                     │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
              ┌─────────────────────────┐
              │ Live Slack users.list   │──success──► answer + refresh cache
              └────────────┬────────────┘
                           │ fail / no token
                           ▼
              ┌─────────────────────────┐
              │ SlackMemberCache        │──hit──► answer
              └────────────┬────────────┘
                           │ empty
                           ▼
              ┌─────────────────────────┐
              │ TeamMember → User       │──hit──► answer
              └────────────┬────────────┘
                           │ empty
                           ▼
              ┌─────────────────────────┐
              │ User / Demo roster      │──► answer
              └─────────────────────────┘

Never: Team Memory · Reports · Standups · AI conversations
```

This mirrors Jira: **Live source first, cache second, demo/fallback last.**

---

## Apply locally

```bash
cd backend
npx prisma migrate deploy
npx prisma generate
# optional: re-seed Demo so SlackMemberCache is populated
# POST /demo/seed (or existing demo seed endpoint)
```

Restart the backend, select the **connected Slack workspace** (not TeamPulse empty stub), and ask “Who are the Slack members?”
