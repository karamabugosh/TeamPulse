# Slack Demo Architecture Refactor Report

**Date:** 2026-08-20  
**Goal:** Align Slack with the Jira Demo pattern — **same PostgreSQL schema and AI pipeline** for Demo and Real; **no fake Slack API**; Demo only seeds realistic Slack activity into shared tables.

---

## Current Slack architecture (before)

| Path | Behavior |
|------|----------|
| **Real** | Slack Socket Mode / Web API → `InboundEvent` → gateway / collection / AI → shared PG tables |
| **Demo** | Already wrote standups/answers/digests/chats into shared tables under `T_DEMO_PULSE_WS` |
| **Gaps** | No first-class `SlackChannel` rows; Demo teams had `schedulerEnabled: true` (risk of live posts); sparse `ConversationState`; AI channel questions had no channel docs |

There was **never** a fake Slack WebClient. Demo used a **non-usable** bot token (`xoxb-demo-pulse-placeholder`) rejected by `isUsableSlackBotToken()`.

---

## New architecture

```
REAL WORKSPACE                         DEMO WORKSPACE
──────────────                         ──────────────
Slack Events / Web API                 DemoWorkspaceGeneratorService
        │                                         │
        ▼                                         ▼
   InboundEvent + live writes              Seed into SAME tables
        │                                         │
        └────────────┬────────────────────────────┘
                     ▼
              PostgreSQL (one DB)
                     │
                     ▼
         AI / UI filter by workspaceId only
   Standups → Answers → Blockers → Reports → Memory → Conversations → Channels
```

- **Real:** continues to use the real Slack API (Socket Mode + WebClient with env / workspace bot token).
- **Demo:** **skips Slack API completely** — placeholder token + schedulers off; all Slack-like activity is seeded.
- **AI:** identical retrieval; only stored rows differ by `workspaceId`.

---

## Seeder flow

```
listSourceJiraMembers()          // names only (read-only Atlassian)
        │
        ▼
clearDemoWorkspace()             // Demo tenant only
        │
        ▼
seedDemoWorkspace() / generateDemoWorkspace()
        │
        ├─ Users (realistic Jira display names + synthetic U0DM* Slack ids)
        ├─ SlackChannel (#general, #eng-standup, #platform-sync, #random)
        ├─ Teams / CheckIns (schedulerEnabled = false)
        ├─ StandupRun / StandupSubmission / Answer / ConversationState
        ├─ StandupThreadUpdate
        ├─ PulseBlocker / PulseBlockerUpdate
        ├─ AiDigest (reports)
        ├─ TeamMemoryDocument
        ├─ AiConversation (+ multi-turn messages)
        ├─ SlackAiChatLog (channel Q&A with roster names)
        └─ InboundEvent (historical timeline rows — not live Socket Mode)
```

Helpers (unchanged names from Jira refactor):

| Method | Slack implication |
|--------|-------------------|
| `seedDemoWorkspace()` / `generateDemoWorkspace()` | Force rebuild Slack + Jira seed graph |
| `refreshDemoWorkspace()` | Rebuild if member fingerprint changed |
| `clearDemoWorkspace()` | Delete Demo only |

---

## Database tables used (Slack-related)

| Table | Demo seeds? | Notes |
|-------|-------------|--------|
| `Workspace` | Yes | `botToken = DEMO_BOT_TOKEN` (non-usable) |
| `User` | Yes | Realistic names from connected Jira |
| **`SlackChannel`** | **Yes (new)** | Shared schema; Demo seeds 4 channels |
| `Team` / `TeamMember` | Yes | `schedulerEnabled: false` |
| `CheckIn` / `Question` / `CheckInParticipant` | Yes | |
| `StandupRun` | Yes | Fake `slackThreadUrl` strings only |
| `StandupSubmission` | Yes | Includes `slackDmChannelId` |
| `Answer` | Yes | |
| `ConversationState` | **Yes (new)** | Completed DM collection states |
| `StandupThreadUpdate` | Yes | |
| `AiDigest` | Yes | Reports |
| `PulseBlocker` (+ updates) | Yes | `workspaceId` scoped |
| `TeamMemoryDocument` | Yes | |
| `AiConversation` / `AiConversationMessage` | Yes | Multi-turn, roster names |
| `SlackAiChatLog` | Yes | Channel-scoped Q&A |
| `InboundEvent` | Yes | Stored history only |

**No Demo-only Slack tables.** No mock Slack API layer.

---

## AI retrieval flow (identical)

```
X-Workspace-Id
  → WorkspaceKnowledgeService.collectSnapshot(workspaceId)
       → Slack Standups / Threads / Runs
       → Slack Members
       → Slack Channels          ← new collector (same for Demo & Real)
       → Blockers / Reports / Team Memory / AI chat logs
  → rank → context → OpenAI
```

There is **no** `if (demo)` branch in Slack RAG collectors. Live Slack export / member sync already no-op when `!isUsableSlackBotToken(botToken)`.

---

## Workspace isolation

1. All Demo rows use Demo `workspaceId`.
2. Clear/seed never touches Real workspace ids.
3. Outbound Slack (admin sync, Send to Slack, Socket Mode) requires a usable `xoxb-` token — Demo’s placeholder fails the check.
4. Demo team schedulers are **disabled** so the Real bot token cannot post to `C_DEMO_*` channel ids.

---

## Files modified

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added `SlackChannel` model |
| `prisma/migrations/20260820020000_slack_channel_table/` | Migration |
| `src/demo/demo.constants.ts` | Extra channel ids; document non-usable bot token |
| `src/demo/demo-workspace-builder.ts` | Seed channels, ConversationState, richer chats; disable schedulers |
| `src/demo/demo-workspace-generator.service.ts` | Docs: never calls live Slack |
| `src/ai/workspace/types/workspace-ai.types.ts` | `slack_channel` entity |
| `src/ai/workspace/knowledge/workspace-knowledge.service.ts` | `collectSlackChannels` (workspaceId only) |
| `docs/SLACK_DEMO_REFACTOR_REPORT.md` | This report |

---

## Benefits

1. Slack matches Jira’s Demo/Real split: seed vs live API, same schema.
2. AI cannot tell Demo from Real — only `workspaceId` data differs.
3. Channels are first-class rows for both tenants.
4. Safer Demo: no Slack API, no scheduled Slack posts.
5. Richer seeded conversations use real roster names from connected Jira.

---

## Remaining improvements

1. Optional Real-side Slack channel sync into `SlackChannel` (users.list / conversations.list).
2. Seed `BlockerFollowUpSession` / `AiSlackExportLog` samples if UI demos need them.
3. Ensure embedding reindex always completes after Demo seed in all environments.
4. Refresh stale `DEMO_DATA_SUMMARY.md` / verify scripts that still mention Sara/Nora or old ConversationState counts.
