# Demo Workspace Architecture

**Last updated:** 2026-08-20  
**Audience:** engineers working on Pulse AI, Jira, Slack, and multi-workspace isolation

This document describes how the **Demo Workspace** is designed to behave like a **Real Workspace**: one PostgreSQL database, one schema, one set of Nest services, and one AI retrieval pipeline. The only difference is how data is *produced* (seeded vs live APIs).

Related reports:

- [DEMO_WORKSPACE_REFACTOR_REPORT.md](./DEMO_WORKSPACE_REFACTOR_REPORT.md)
- [SLACK_DEMO_REFACTOR_REPORT.md](./SLACK_DEMO_REFACTOR_REPORT.md)
- [JIRA_ASSIGNEE_DEBUG_REPORT.md](./JIRA_ASSIGNEE_DEBUG_REPORT.md)
- [JIRA_CACHE_DUPLICATE_AUDIT.md](./JIRA_CACHE_DUPLICATE_AUDIT.md)

---

## Overview

### Why this architecture was chosen

Pulse needs a safe, rich sandbox for:

- Product demos and sales walkthroughs
- AI Workspace evaluation without touching customer Slack/Jira
- UI testing of standups, blockers, reports, memory, and chat

Early approaches tended to fork the product (“if Demo, use mock objects / special retrieval”). That caused:

- Duplicated logic that drifted from production
- Incorrect AI answers (stale mock assignees, memory overriding Jira fields)
- Hard-to-test isolation bugs

**Chosen model:** treat Demo as **just another tenant** in the same system.

| Principle | Meaning |
|-----------|---------|
| Same schema | No Demo-only tables |
| Same services | Controllers, repositories, AI chat, Jira hub, reports — identical code |
| Same AI pipeline | Filter by `workspaceId` only; no `if (demo)` answer path |
| Different ingestion | Real = live Slack/Jira APIs; Demo = generator seeds PostgreSQL |
| Hard isolation | Clear/seed Demo never mutates Real workspace rows |

People names in Demo come from the **connected real Jira member list** (read-only). Activity (issues, standups, blockers, conversations) is **synthetic narrative data** stored in production tables under the Demo `workspaceId`.

---

## Previous Architecture

### How Demo data worked before

Historically, Demo evolved through several stages:

1. **Hardcoded fake people**  
   Seed scripts used fixed names (e.g. Sara / Nora / Layla) and separate narrative docs. Eval gold datasets and conversation seeds assumed those names.

2. **Parallel “demo” mental model**  
   Even when rows landed in Postgres, product thinking treated Demo as special: mock Jira paths, Mock source labels in AI, Demo Slack channel strings without a shared channel table, and generators that were not clearly named (`seed` / `clear` / `refresh`).

3. **Per-user Jira cache duplication**  
   `JiraIssueCacheEntry` was unique on `(userId, issueKey)`. Multiple users in one workspace each got a SCRUM-9 row, so AI could see conflicting assignees/statuses inside the same workspace.

4. **AI source confusion**  
   Team Memory / standups that *mentioned* an issue competed with `JiraIssueCacheEntry` for assignee/status questions. Live refresh was missing or incomplete.

5. **Slack risk**  
   Demo teams could keep `schedulerEnabled: true` with placeholder tokens/channel ids, while Real used a live bot — unsafe and confusing.

### What was already good

- One PostgreSQL database (not a separate Demo DB)
- Tenant key `slackWorkspaceId = T_DEMO_PULSE_WS`
- Most product APIs already accepted `X-Workspace-Id`

The refactor completed the model: **Demo is only seeded data + isolation keys**, not a second product stack.

---

## New Architecture

### How Demo behaves exactly like a Real Workspace

```
┌─────────────────────────────────────────────────────────────────┐
│                     ONE PostgreSQL database                      │
│                                                                  │
│   Workspace A (Real)              Workspace B (Demo)             │
│   slackWorkspaceId = T0…          slackWorkspaceId = T_DEMO_…    │
│         │                                   │                    │
│         └──────────── same tables ──────────┘                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                 NestJS services / controllers
                 (no Demo vs Real product fork)
                              │
                              ▼
              AI + UI resolve tenant via X-Workspace-Id
```

| Concern | Real Workspace | Demo Workspace |
|---------|----------------|----------------|
| Slack | Live Socket Mode / Web API → DB | **No Slack API** — generator seeds standups, channels, chats |
| Jira | Live OAuth → sync / live refresh → cache | **No Atlassian writes** — fake OAuth tokens; issues in `JiraIssueCacheEntry` |
| People | Slack member sync | Names from real Jira members (seed input only) |
| AI chat | RAG by `workspaceId` | **Same** RAG by `workspaceId` |
| Jira page / Blockers / Reports / Memory | Read shared tables | **Same** reads |
| Outbound Slack (“Send to Slack”) | Usable `xoxb-` token | Placeholder token rejected by `isUsableSlackBotToken()` |

**The AI does not know** whether the active tenant is Demo or Real. It always:

1. Resolves `workspaceId`
2. Collects knowledge from shared tables
3. Ranks and prompts
4. Answers

For Jira fields, Live API is used only when the workspace has **usable OAuth credentials**. Demo has placeholder tokens → answers come from cache rows (which the seeder filled) — still the same code path as any offline Real workspace.

---

## Database Design

### Shared tables (Demo and Real)

There are **no Demo-only Prisma models**. Demo inserts into the same tables Real uses.

#### Direct `workspaceId` (preferred isolation)

| Table | Role |
|-------|------|
| `Workspace` | Tenant root (`T_DEMO_PULSE_WS` for Demo) |
| `User` | Members |
| `Team` | Engineering / Platform teams |
| `InboundEvent` | Event log (Demo: seeded history only) |
| `SlackChannel` | Channel metadata (`#eng-standup`, …) |
| `JiraConnection` | OAuth (Demo: non-usable placeholders) |
| `JiraIssueCacheEntry` | Issue fields; **unique `(workspaceId, issueKey)`** |
| `PulseBlocker` | Blockers |
| `JiraAuditLog` | Status / comment history |
| `AnswerJiraIssueLink` | Standup ↔ issue links |
| `TeamMemoryDocument` | Indexed memory |
| `SlackAiChatLog` | Slack AI Q&A |
| `KnowledgeEmbedding` | Vector index (rebuilt after seed) |
| `AiConversation` / messages | Web AI history |
| `AiSlackExportLog` | Export audit (usually Real-only) |
| `AiEvalCase` / `AiEvalRun` | Evaluation |

#### Parent-scoped (isolated via Team / User / Run joins)

| Table | Isolation path |
|-------|----------------|
| `TeamMember` | `team.workspaceId` |
| `CheckIn`, `Question`, `CheckInParticipant` | via `Team` |
| `StandupRun`, `StandupSubmission`, `Answer` | via team / user |
| `ConversationState` | via user / submission |
| `StandupThreadUpdate` | via run / user |
| `AiDigest` | via `teamId` / `runId` (reports) |
| `PulseBlockerUpdate` | via blocker / user |

### `workspaceId` isolation

```
Request header: X-Workspace-Id
        │
        ▼
resolveActiveWorkspaceId() / workspaceStorage
        │
        ▼
Queries:  where: { workspaceId }     (preferred)
     or:  where: { user: { workspaceId } }
     or:  where: { team: { workspaceId } }
```

**Rules:**

1. Every Demo seed row belongs to the Demo workspace id (or to a Demo user/team under that workspace).
2. `clearDemoWorkspace()` / `deleteDemoWorkspaceOnly()` delete **only** the Demo tenant graph.
3. Real workspace rows are never updated by the Demo generator.
4. Same issue key may exist in Demo and Real (e.g. both have `SCRUM-9`) — different `workspaceId`, different meaning.

### Isolation keys (Demo only)

| Constant | Purpose |
|----------|---------|
| `T_DEMO_PULSE_WS` | Stable Slack team id for the Demo `Workspace` row |
| `xoxb-demo-pulse-placeholder` | Non-usable Slack bot token |
| `demo-cloud-id` / `demo-access-token-*` | Non-usable Jira OAuth |
| `C_DEMO_*` | Synthetic Slack channel ids |
| `U0DM…` | Synthetic Slack user ids derived from Jira account ids |

These are **ingestion / safety gates**, not AI branching.

---

## Demo Generator Flow

### Entry points

| Method | Behavior |
|--------|----------|
| `generateDemoWorkspace()` | Force full rebuild |
| `seedDemoWorkspace()` | Same as generate (force) |
| `refreshDemoWorkspace()` | Rebuild only if missing or Jira member fingerprint changed |
| `clearDemoWorkspace()` | Delete Demo tenant only |
| `ensureGenerated({ force })` | Underlying implementation |
| `listSourceJiraMembers()` | Read-only Atlassian members (seed input) |

CLI:

```bash
cd pulse/backend
npm run seed:demo          # force seed
npm run seed:demo:remove   # clear Demo only
```

HTTP (`/api/demo`):

- `GET /status`, `GET /jira-members`
- `POST /seed`, `POST /generate`, `POST /refresh`, `POST /regenerate?force=1`
- `DELETE /` → clear

Auto: `POST /api/jira/sync` calls `refreshDemoWorkspace()` after a successful Real Jira sync.

### Step-by-step: force seed (`seedDemoWorkspace`)

```
1. Guard
   - Skip if another regeneration is already in progress.

2. Resolve seed people (read-only)
   - findRealJiraConnection()  → excludes Demo placeholder OAuth
   - listWorkspaceMembers()    → Atlassian users/search (+ assignee fallback)
   - Require ≥ 1 human member

3. Fingerprint
   - SHA-256 of sorted accountId|displayName
   - Compare to TeamMemoryDocument fingerprint (if refreshing without force)
   - force=true → always rebuild

4. clearDemoWorkspace / deleteDemoWorkspaceOnly
   - Delete Demo workspace graph only:
     embeddings, conversations, SlackChannel, Jira cache, blockers,
     audits, answer-jira links, standups, digests, teams, users, workspace
   - Never delete Real workspaceId rows

5. Create Demo Workspace row
   - slackWorkspaceId = T_DEMO_PULSE_WS
   - botToken = placeholder (not usable for Web API)
   - installedAt far in the future (avoid becoming default tenant)

6. Insert users
   - Real Jira display names
   - Synthetic slackUserId (U0DM…)
   - workspaceId = Demo

7. Insert SlackChannel rows
   - #general, #eng-standup, #platform-sync, #random
   - Same SlackChannel table Real can use later

8. Insert teams / check-ins / questions
   - Engineering + Platform
   - schedulerEnabled = false  (no live Slack posts)

9. Insert Jira demo graph
   - Fake JiraConnection rows (first few members)
   - One JiraIssueCacheEntry per issue key (workspace-scoped unique)
   - JiraAuditLog narrative + noise
   - AnswerJiraIssueLink on standup answers

10. Insert Slack activity graph
    - StandupRun / StandupSubmission / Answer
    - ConversationState (completed)
    - StandupThreadUpdate
    - AiDigest (reports)
    - PulseBlocker / PulseBlockerUpdate
    - TeamMemoryDocument (incl. fingerprint)
    - AiConversation multi-turn chats
    - SlackAiChatLog channel Q&A
    - InboundEvent historical rows (not live Socket Mode)

11. Emit WORKSPACE_KNOWLEDGE_CHANGED
    - Triggers embedding reindex for Demo workspaceId
    - Same event Real uses after knowledge writes

12. Return counts + fingerprint + member list
```

### Step-by-step: refresh (`refreshDemoWorkspace`)

```
1. Load current Jira members → fingerprint
2. Load stored fingerprint from Demo Team Memory
3. If equal and Demo exists → skip (idempotent no-op)
4. Else → same as force seed (clear Demo only → rebuild)
```

### What the generator never does

- Never writes to Atlassian / live Jira
- Never calls Slack Web API or Socket Mode with Demo tokens
- Never modifies Real workspace data
- Never forks AI or controller code paths

---

## Runtime Data Flow

### Real Workspace

```
Slack Events / Web API          Jira OAuth / sync / live issue GET
        │                                    │
        ▼                                    ▼
   InboundEvent + standups            JiraIssueCacheEntry (+ live refresh)
        │                                    │
        └────────────────┬───────────────────┘
                         ▼
              Shared tables (workspaceId = real)
                         ▼
              AI / UI (X-Workspace-Id = real)
```

### Demo Workspace

```
Connected Real Jira members (read-only names)
        │
        ▼
DemoWorkspaceGeneratorService
        │
        ▼
Shared tables (workspaceId = demo)
        │
        ▼
AI / UI (X-Workspace-Id = demo)
   — identical services —
```

---

## AI Retrieval Flow (identical)

```
POST /api/ai/workspace/chat
  Header: X-Workspace-Id
    → IntentDetectionService
    → RagPipelineService
    → WorkspaceRetrievalService
        → WorkspaceKnowledgeService.collectSnapshot(workspaceId)
             Collectors (same for Demo & Real):
               - Slack standups / threads / runs
               - Slack members / Slack channels
               - Jira issues (live refresh if usable OAuth, else cache)
               - Blockers / blocker updates
               - Reports (AiDigest)
               - Team Memory
               - Jira audits
               - Slack AI chat logs
        → rank / hybrid embeddings
        → ContextBuilder → PromptBuilder
    → OpenAI
    → formatted answer + sources
```

**Jira field authority** (assignee, status, priority, summary):

1. Prefer Live Jira when OAuth works  
2. Else `JiraIssueCacheEntry`  
3. Never Team Memory / Reports / Digests as source of truth for those fields  

Demo almost always hits (2) because tokens are placeholders — still the same branch Real uses when offline.

---

## Safety Guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| No live Slack for Demo | `isUsableSlackBotToken()` rejects `demo`/`placeholder`; Demo `schedulerEnabled = false` |
| No live Jira writes for Demo | Placeholder tokens; `findRealJiraConnection()` excludes Demo |
| No Real data wipe | Clear filters by `T_DEMO_PULSE_WS` / Demo `workspaceId` |
| One issue row per workspace | `@@unique([workspaceId, issueKey])` on cache |
| AI tenant isolation | All collectors take `workspaceId` |

---

## Key Source Files

| File | Responsibility |
|------|----------------|
| `backend/src/demo/demo.constants.ts` | Isolation keys |
| `backend/src/demo/demo-mock-templates.ts` | Name-free issue/blocker templates |
| `backend/src/demo/demo-workspace-builder.ts` | Clear + seed graph |
| `backend/src/demo/demo-workspace-generator.service.ts` | Orchestration helpers |
| `backend/src/demo/demo.controller.ts` | Admin HTTP API |
| `backend/prisma/seed-demo.ts` | CLI seed |
| `backend/prisma/remove-demo.ts` | CLI clear |
| `backend/src/ai/workspace/knowledge/workspace-knowledge.service.ts` | Shared RAG collectors |
| `backend/src/common/workspace-context.ts` | Workspace filter helpers |
| `backend/src/common/slack-member.util.ts` | Usable Slack token gate |

---

## Benefits

1. **One product** — Demo bugs are Real bugs; fixes apply once  
2. **Faithful demos** — AI, Jira page, blockers, reports, memory, conversations all work  
3. **Safe** — no accidental Slack posts or Jira writes from Demo  
4. **Realistic people** — roster tracks the customer’s real Jira members  
5. **Clear ops** — `seed` / `refresh` / `clear` with fingerprint idempotency  

---

## Remaining Improvements

1. Denormalize `workspaceId` onto remaining parent-scoped models (`StandupRun`, `AiDigest`, …) for simpler deletes  
2. Upsert-style regen that preserves Demo UUIDs when only membership deltas change  
3. Align AI eval gold cases with dynamic roster names (drop hardcoded legacy names)  
4. Optional Real Slack channel sync into `SlackChannel`  
5. Keep docs/scripts that still mention Sara/Nora or old row counts up to date  

---

## Quick Mental Model

> **Demo Workspace = Real Workspace with seeded rows and dead credentials.**  
> Same tables. Same AI. Same UI. Different `workspaceId`. Different how the rows got there.
