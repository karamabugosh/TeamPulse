# AI UI and Data Improvements

**Date:** August 19, 2026  
**Product:** Pulse  
**Scope:** Slack ID resolution, real timeline, real members, live Jira filters, AI UX polish  
**Constraint:** Existing architecture, multi-workspace isolation, and working features preserved

---

## Summary

This pass improves data fidelity and UI clarity across Pulse without rewriting the AI orchestrator or tenant model:

1. **Slack user IDs** resolve to display names (bot → “Pulse Slack Bot”)
2. **Workspace timeline** is built from PostgreSQL events (not static cards)
3. **Member pickers** show synchronized Slack humans only (no Flow Test / verify users)
4. **Jira filters** stay live from DB and poll for updates
5. **AI Workspace** gets better markdown, typing indicator, citations, and report meta
6. **Member maps** are TTL-cached to cut duplicate lookups

---

## Files Modified

### Backend

| File | Change |
|------|--------|
| `common/slack-member.util.ts` | Mention extraction/resolution, bot label, stronger placeholder filters |
| `common/workspace-members.service.ts` | TTL cache, display-name map, resolve helpers |
| `common/workspace-timeline.service.ts` | **New** — DB-backed chronological timeline |
| `common/workspace-members.module.ts` | Exports timeline service |
| `jira/jira-hub.controller.ts` | `GET /jira/hub/timeline` |
| `jira/jira-hub.service.ts` | Resolve mentions in standup answers; include `slackUserId` |
| `jira/jira-blocker.service.ts` | Resolve owner labels + mentions on read |
| `slack/slack.gateway.ts` | Persist display names instead of `<@U…>` for owners |
| `admin/admin.service.ts` | Invalidate member cache after Slack sync |
| `ai/workspace/analysis/timeline-builder.service.ts` | Natural detective timeline sentences |

### Frontend

| File | Change |
|------|--------|
| `components/jira/WorkspaceTimeline.tsx` | **New** — clickable real-event timeline |
| `components/jira/JiraStandupHistorySection.tsx` | Timeline mode loads `/jira/hub/timeline` |
| `components/jira/standup-history.types.ts` | Natural event copy |
| `lib/jira-api.ts` | `getWorkspaceTimeline` |
| `components/ai-workspace/AiConversationArea.tsx` | Markdown rendering, typing indicator, citations |
| `components/ai-workspace/AiReportCard.tsx` | Owner/Team/Sprint/Linked Issues meta; hide debug explanation |

---

## Queries Changed

New / updated Prisma queries (all `workspaceId`-scoped):

- `StandupSubmission` (completed standups)
- `JiraIssueCacheEntry` (status refreshes)
- `JiraAuditLog` (Jira actions)
- `AnswerJiraIssueLink` (issue links)
- `PulseBlocker` / `PulseBlockerUpdate`
- `AiDigest`
- `TeamMemoryDocument`
- `User` (display-name map + human member list)

Standup history + blockers now run mention resolution against the workspace name map before returning to the UI.

---

## Services Updated

| Service | Role |
|---------|------|
| `WorkspaceMembersService` | Canonical humans + 60s cache + resolve APIs |
| `WorkspaceTimelineService` | Merge chronological events |
| `JiraBlockerService` | Resolve `<@U…>` on API responses |
| `JiraHubService` | Resolve mentions in standup text |
| `SlackGateway` | Store human owner labels |
| `TimelineBuilderService` | Clearer detective timelines |

---

## Performance Improvements

- **Member list cache** (~60s TTL) per workspace  
- **Display-name map cache** shared across blockers / hub / timeline  
- **Cache invalidation** after Slack member sync  
- Timeline collectors run in **parallel** (`Promise.all`)  
- Standup history continues **20s polling** so filters refresh when new standups/issues/blockers appear  

---

## UI Improvements

- Timeline cards: “Sara completed Daily Standup”, “SCRUM-8 moved to Review”, “AI Digest generated…”  
- Clicking an event navigates to blockers / Jira hub / reports  
- Timeline filters: member + event type + date preset  
- AI chat: markdown (bold / lists / code), typing indicator, clearer confidence + sources  
- Reports: show Owner / Team / Sprint / Linked Issues when present in metrics; footer no longer dumps debug `explanation`  

---

## Hardcoded Data Removed / Prevented

| Pattern | Handling |
|---------|----------|
| `Flow Test User` | Filtered by `isPlaceholderSlackUser` |
| `verify-slack-user` / `verify-*` | Filtered |
| `USLACKBOT` / Slackbot | Shown as **Pulse Slack Bot** (not in human pickers) |
| Raw `<@U123>` owner labels | Resolved on write + read |
| Static timeline filler | Replaced by DB timeline endpoint |
| Placeholder / example.invalid emails | Filtered from members |

Demo Workspace `U_DEMO_*` members remain (they are real Demo tenant users).

---

## Pages Changed

- **Jira Hub** — Standup History / Workspace Timeline  
- **Blockers** — Owner + answer text resolved  
- **AI Workspace** — Chat + report cards  
- **Teams / Admin members** — still via `WorkspaceMembersService` (cache + filters)  
- **Filters** (Jira standup/history) — live users / standups / issues from DB  

---

## Remaining Limitations

1. Historical `ownerLabel` rows that still store `<@U…>` are fixed on **read**; re-save to persist clean names  
2. Jira cache “moved to Status” uses last refresh time (not a full changelog unless OAuth changelog is available)  
3. Report Owner/Team/Sprint chips only appear when generators put them in `metrics`  
4. Frontend has no independent Slack mention resolver (backend is source of truth)  
5. Timeline “Slack Threads” are represented via standup DM/thread anchors (not every Slack message)  
6. Restart backend after deploy so Nest picks up new `WorkspaceTimelineService` provider  

---

## Future Work

- Backfill script to rewrite stored `<@U…>` owner labels in `PulseBlocker`  
- Richer live Jira changelog events when OAuth is connected  
- Optional frontend mention resolver as defense-in-depth  
- Per-user conversation ownership in AI history when web auth is available  
