# Pulse AI System Architecture

**Product:** Pulse (Team Pulse / Pulse V2)  
**Document:** Complete technical architecture for the AI Workspace and related systems  
**Audience:** New engineers joining the team  
**Last updated:** 2026-08-20  
**Status:** Living document — prefer code when this doc and the repository disagree  

This document explains **how the entire AI system works**, from PostgreSQL and Prisma through Demo/Real workspaces, Jira and Slack ingestion, RAG retrieval, embeddings, prompts, and the end-to-end answer path. It is written so a new engineer can onboard without tribal knowledge.

**Related documents**

| Document | Focus |
|----------|--------|
| [DEMO_WORKSPACE_ARCHITECTURE.md](./DEMO_WORKSPACE_ARCHITECTURE.md) | Demo tenant design |
| [DEMO_WORKSPACE_REFACTOR_REPORT.md](./DEMO_WORKSPACE_REFACTOR_REPORT.md) | Demo/Real unification |
| [SLACK_DEMO_REFACTOR_REPORT.md](./SLACK_DEMO_REFACTOR_REPORT.md) | Slack seed vs live API |
| [JIRA_ASSIGNEE_DEBUG_REPORT.md](./JIRA_ASSIGNEE_DEBUG_REPORT.md) | Jira field authority |
| [JIRA_CACHE_DUPLICATE_AUDIT.md](./JIRA_CACHE_DUPLICATE_AUDIT.md) | Cache uniqueness |
| [AI_WORKSPACE_DOCUMENTATION.md](./AI_WORKSPACE_DOCUMENTATION.md) | Earlier AI Workspace notes |
| [AI_VECTOR_SEARCH_REPORT.md](./AI_VECTOR_SEARCH_REPORT.md) | Vector search details |
| [TECHNICAL_DOCUMENTATION.md](./TECHNICAL_DOCUMENTATION.md) | General Pulse platform |

---

# 1. Project Overview

## 1.1 What Pulse is

**Pulse** is a production standup and team-intelligence platform for Slack workspaces. Managers configure check-ins (schedules, questions, participants, reminders, reports) from a web dashboard. Pulse:

1. Sends scheduled Slack DMs to participants  
2. Collects answers one question at a time  
3. Stores submissions, blockers, and digests in PostgreSQL  
4. Optionally links answers to Jira issues  
5. Surfaces that knowledge in Admin, Jira Hub, Reports, and **AI Workspace**

Pulse is multi-tenant: every meaningful row belongs to a **Workspace** (directly via `workspaceId`, or indirectly via User / Team / Run).

## 1.2 What AI Workspace does

The **AI Workspace** is Pulse’s grounded Q&A and reporting layer. Users ask natural-language questions about their team’s work and receive answers backed by **workspace-scoped database evidence**, with citations and a confidence band.

Typical questions:

- Who is blocked today?  
- Who is assigned to SCRUM-9?  
- Why was SCRUM-8 delayed?  
- Summarize yesterday’s standup  
- What happened while I was on vacation?  
- Generate a weekly / sprint / executive report  
- Investigate a delay end-to-end (Project Detective)

Surfaces:

| Surface | Entry |
|---------|--------|
| Web | `/ai-workspace` → `AiWorkspacePage` → `POST /api/ai/workspace/chat` |
| Slack | App mention or idle DM → `SlackAiAssistantService` → same `AiChatService` |

AI Workspace is **not** a free-form chatbot. When evidence is missing, it refuses to invent facts and returns a fixed insufficient-data message.

## 1.3 Why we built the AI module

Without AI Workspace, knowledge is scattered across:

- Slack standup threads and DMs  
- Jira issue pages  
- AI digests / report posts  
- Ad-hoc team memory notes  

Managers and ICs need one place to ask operational questions and get **grounded** answers with sources. The AI module:

1. Unifies retrieval across Pulse tables  
2. Classifies intent so response shape matches the question  
3. Injects only relevant evidence into the LLM prompt  
4. Works identically for Demo and Real tenants (isolation by `workspaceId`)

## 1.4 High-level system architecture

```
┌──────────────┐     ┌──────────────┐
│  Web UI      │     │  Slack App   │
│ /ai-workspace│     │ mention / DM │
└──────┬───────┘     └──────┬───────┘
       │                    │
       └─────────┬──────────┘
                 ▼
       ┌─────────────────────┐
       │ NestJS API          │
       │ WorkspaceAiController│
       │ SlackAiAssistant    │
       └──────────┬──────────┘
                  ▼
       ┌─────────────────────┐
       │ AiChatService       │
       │ Intent → RAG /      │
       │ Reports / Detective │
       └──────────┬──────────┘
                  ▼
       ┌─────────────────────┐
       │ Prisma + PostgreSQL │
       │ (workspace-scoped)  │
       └──────────┬──────────┘
                  │
       ┌──────────┴──────────┐
       ▼                     ▼
┌─────────────┐      ┌──────────────┐
│ Live Jira   │      │ Live Slack   │
│ (Real only) │      │ (Real only)  │
└─────────────┘      └──────────────┘
                  │
                  ▼
           ┌─────────────┐
           │ OpenAI API  │
           │ Chat + Embed│
           └─────────────┘
```

**Core idea:** PostgreSQL is the source of truth for AI. Live Jira/Slack enrich that store for Real workspaces. Demo seeds the same store without calling live Slack/Jira write APIs.

---

# 2. Database Architecture

## 2.1 Why we use PostgreSQL

PostgreSQL is the single source of truth for Pulse because it provides:

- Strong relational integrity (foreign keys, unique constraints)  
- Multi-tenant isolation via `workspaceId`  
- JSON columns for flexible payloads (embeddings, citations, structured answers)  
- Optional **pgvector** extension for ANN semantic search  
- Mature tooling, backups, and local/prod parity  

AI does **not** maintain a separate vector-only database as the product store. Embeddings are stored alongside relational data (`KnowledgeEmbedding`), with optional native `embedding_vec` when pgvector is available.

## 2.2 How PostgreSQL is organized

One database (example name: `teampulse`) holds **all** workspaces:

```
PostgreSQL database
├── Workspace (Real) ──► Users, Teams, Standups, Jira cache, …
└── Workspace (Demo) ──► Users, Teams, Standups, Jira cache, …
```

There is no “Demo database” and no “AI database.” Isolation is logical (row-level by `workspaceId`), not physical.

## 2.3 How Prisma connects to PostgreSQL

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
        │
        ▼
prisma/schema.prisma
  datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL")
  }
        │
        ▼
npx prisma generate  →  @prisma/client
        │
        ▼
NestJS PrismaService  →  queries at runtime
```

`DATABASE_URL` lives in `backend/.env` (see also `pulse/.env.example`).

## 2.4 What Prisma ORM does

Prisma:

1. Declares models in `schema.prisma`  
2. Generates a type-safe TypeScript client  
3. Runs SQL migrations from `prisma/migrations/`  
4. Exposes `findMany`, `upsert`, transactions, etc. to Nest services  

AI collectors call Prisma exclusively for product data (not raw SQL, except pgvector helpers).

## 2.5 Why Prisma was chosen

- Type safety across NestJS services  
- Clear migration history for multi-engineer teams  
- Fits Nest dependency injection (`PrismaModule` / `PrismaService`)  
- Good DX for relations used heavily by RAG collectors  

## 2.6 Migration flow

```
1. Edit prisma/schema.prisma
2. Add SQL under prisma/migrations/<timestamp>_name/migration.sql
3. npx prisma migrate deploy     # apply to DB
4. npx prisma generate           # refresh client types
5. Restart NestJS (watch mode may need restart if engine DLL locked on Windows)
```

## 2.7 Connection diagram

```
┌────────────┐
│  Frontend  │  React (Vite)  /ai-workspace
└─────┬──────┘
      │ HTTP /api/*
      ▼
┌────────────┐
│   NestJS   │  Controllers + AiChatService + Collectors
└─────┬──────┘
      │ Prisma Client
      ▼
┌────────────┐
│   Prisma   │  @prisma/client
└─────┬──────┘
      │ SQL
      ▼
┌────────────┐
│ PostgreSQL │  teampulse (all workspaces)
└────────────┘
```

---

# 3. Database Tables

This section covers the tables most important to AI. Some names in product language differ slightly from Prisma model names (noted below).

> **Naming note:** There is no Prisma model literally named `AIReport` or `Conversation`.  
> - **Reports** → primarily `AiDigest` (standup digests) + dynamic report objects built at request time  
> - **Conversations** → `AiConversation` + `AiConversationMessage` (web/Slack AI history); standup DM state is `ConversationState`

---

## 3.1 Workspace

**Purpose:** Root tenant. Every Pulse install / Slack team maps to one workspace.

**Key fields:** `id`, `slackWorkspaceId` (unique), `slackWorkspaceName`, `botToken`, `installedAt`

**Relationships:** Parent of users, teams, Jira connections, memory, embeddings, AI conversations, etc.

**`workspaceId` usage:** This table *is* the workspace. All isolation starts here.

**Example**

| id | slackWorkspaceId | name |
|----|------------------|------|
| `0e49…` | `T0BKKJNTQJ3` | Pules project (Real) |
| `b1ba…` | `T_DEMO_PULSE_WS` | Demo Workspace |

---

## 3.2 User

**Purpose:** A person known to Pulse (usually a Slack user).

**Key fields:** `workspaceId`, `slackUserId` (globally unique), `slackDisplayName`, `slackRealName`, `email`, `timezone`

**Relationships:** Answers, submissions, blockers, Jira connection, AI chat logs

**`workspaceId` usage:** Direct. AI member listing filters `User` by `workspaceId`.

**Demo note:** Synthetic Slack ids `U0DM…` with **real Jira display names**.

---

## 3.3 Team

**Purpose:** A standup team inside a workspace (e.g. Engineering, Platform).

**Key fields:** `workspaceId`, `name`, `slackChannelId`, `scheduleCron`, `schedulerEnabled`, `timezone`

**Relationships:** TeamMembers, CheckIns, StandupRuns, AiDigests

**Demo note:** `schedulerEnabled = false` so Demo never posts via live Slack.

---

## 3.4 TeamMember

**Purpose:** Membership of a User on a Team.

**Key fields:** `teamId`, `userId`, `role`, `optedOut`

**Isolation:** Via `team.workspaceId` (no direct `workspaceId` column).

---

## 3.5 JiraConnection

**Purpose:** OAuth credentials linking a User to an Atlassian cloud site.

**Key fields:** `userId` (unique), `workspaceId`, `cloudId`, `siteUrl`, `accessToken`, `refreshToken`, …

**Real:** Real tokens; used for sync and live issue lookup.  
**Demo:** Placeholder tokens (`demo-access-token-*`, `demo-cloud-id`) — never used for live Atlassian calls in RAG.

---

## 3.6 JiraIssueCacheEntry

**Purpose:** Cached Jira issue fields for AI, pickers, and hub UI.

**Key fields:** `workspaceId`, `userId` (last refresher), `issueKey`, `summary`, `status`, `assigneeName`, `priority`, `refreshedAt`

**Unique constraint:** `@@unique([workspaceId, issueKey])` — one active row per issue per workspace.

**Why it exists:** Live Jira on every chat turn would be slow, fragile, and rate-limited. Cache is the durable store; live refresh updates it for issue-key questions.

---

## 3.7 JiraAuditLog

**Purpose:** Historical Jira activity (status changes, comments) for detective / timeline narratives.

**Key fields:** `workspaceId`, `userId`, `actionType`, `jiraIssueKey`, `status`, `metadata`, `createdAt`

**AI use:** `collectJiraAudits` — secondary to authoritative issue fields.

---

## 3.8 StandupRun

**Purpose:** One scheduled (or triggered) standup collection event for a team.

**Key fields:** `teamId`, `checkInId`, `scheduledFor`, `status`, Slack thread fields, report status

**Isolation:** `run → team → workspaceId`

**AI use:** Summaries, date-range filters, vacation catch-up.

---

## 3.9 StandupSubmission

**Purpose:** One participant’s response set for a run.

**Key fields:** `runId`, `userId`, `status`, `slackDmChannelId`, timestamps

**AI use:** Primary standup evidence (`collectStandups`).

---

## 3.10 Answer

**Purpose:** One answer to one question inside a submission.

**Key fields:** `userId`, `questionId`, `submissionId`, `text`, `structuredValue`

**AI use:** Content of “yesterday / today / blockers” narrative.

---

## 3.11 PulseBlocker

**Purpose:** Structured blocker tracked by Pulse (often from standup).

**Key fields:** `workspaceId`, `userId`, `description`, `severity`, `status`, `linkedIssueKey`, …

**AI use:** `GET_BLOCKERS`, detective, reports.

---

## 3.12 PulseBlockerUpdate

**Purpose:** Status transition history for a blocker.

**Isolation:** Via `blockerId` → `PulseBlocker.workspaceId`

---

## 3.13 AIReport (product concept → `AiDigest` + dynamic reports)

**Prisma model:** `AiDigest`

**Purpose:** Generated digest for a standup run (summary, blockers JSON, themes, Slack report text).

**Key fields:** `teamId`, `runId` (unique), `summary`, `blockers`, `themes`, `slackReportText`, …

**Additionally:** `ReportGenerationService` builds **dynamic** reports at request time from metrics (not always persisted as `AiDigest`). The UI may show an `AiReportCard` for those.

---

## 3.14 Conversation (product concept)

| Model | Purpose |
|-------|---------|
| `AiConversation` | AI chat session (`workspaceId`, optional `userId`, title, preview) |
| `AiConversationMessage` | Turns: role, content, intent, citations, confidence |
| `ConversationState` | Standup DM progress (not AI chat) |

**AI history:** `ConversationMemoryService` / `ConversationHistoryService` load and persist `AiConversation*`.

---

## 3.15 Team Memory

**Prisma model:** `TeamMemoryDocument`

**Purpose:** Indexed snippets (standup answers, Jira links, AI summaries, fingerprints) searchable by AI.

**Key fields:** `workspaceId`, `sourceType`, `sourceId`, `title`, `content`, optional `issueKey`

**Important:** Team Memory is **never** the source of truth for Jira assignee/status/priority/summary. Those come from Live Jira / `JiraIssueCacheEntry`.

---

## 3.16 AiDigest

Covered in §3.13. AI collector label: **Reports**.

---

## 3.17 Other AI-related tables

| Model | Purpose |
|-------|---------|
| `SlackChannel` | Channel metadata (Demo seeds; Real may sync later) |
| `SlackAiChatLog` | Audit of Slack AI Q&A |
| `KnowledgeEmbedding` | Embedding vectors (JSON + optional pgvector column) |
| `AiSlackExportLog` | “Send to Slack” from web |
| `AiEvalCase` / `AiEvalRun` / `AiEvalResult` | Evaluation framework |
| `InboundEvent` | Slack/Jira event processing log |
| `AnswerJiraIssueLink` | Standup answer ↔ issue snapshot |

---

## 3.18 Relationship sketch

```
Workspace
  ├── User ─────────────────┬── Answer
  │                         ├── StandupSubmission
  │                         ├── PulseBlocker
  │                         ├── JiraConnection
  │                         └── SlackAiChatLog
  ├── Team ── TeamMember
  │     └── CheckIn ── Question
  │           └── StandupRun ── StandupSubmission ── Answer
  │                 └── AiDigest
  ├── JiraIssueCacheEntry
  ├── TeamMemoryDocument
  ├── SlackChannel
  ├── KnowledgeEmbedding
  └── AiConversation ── AiConversationMessage
```

---

# 4. Workspace Architecture

## 4.1 Real Workspace

A Real workspace is created when a Slack team installs Pulse (or is provisioned for development). It has:

- Real `slackWorkspaceId`  
- Usable Slack bot token (when configured)  
- Optional real Jira OAuth connections  
- Live event ingestion and sync  

## 4.2 Demo Workspace

A Demo workspace is a normal `Workspace` row with:

- `slackWorkspaceId = T_DEMO_PULSE_WS`  
- Placeholder bot token (rejected by `isUsableSlackBotToken`)  
- Seeded activity from `DemoWorkspaceGeneratorService`  
- People names from the connected **real** Jira member list  

## 4.3 Coexistence in one database

```
Workspace
│
├── Real Workspace (e.g. T0BKKJNTQJ3)
│     ├── Users (Slack-synced)
│     ├── JiraIssueCacheEntry (live + sync)
│     └── Standups (from Slack events)
│
└── Demo Workspace (T_DEMO_PULSE_WS)
      ├── Users (seeded; Jira names)
      ├── JiraIssueCacheEntry (seeded mock issues)
      └── Standups (seeded)
```

## 4.4 Workspace isolation

Every AI request carries **`X-Workspace-Id`** (or resolves a default). Collectors always filter by that id.

```
Request
  Header: X-Workspace-Id: <uuid>
      │
      ▼
resolveActiveWorkspaceId(prisma, preferred)
      │
      ▼
collectSnapshot(workspaceId, filters)
  WHERE workspaceId = :id
     OR user.workspaceId = :id
     OR team.workspaceId = :id
```

Demo clear/seed deletes **only** Demo rows. Real data is never wiped by the generator.

---

# 5. Demo Workspace

## 5.1 DemoWorkspaceGeneratorService

**File:** `backend/src/demo/demo-workspace-generator.service.ts`

| Method | Behavior |
|--------|----------|
| `listSourceJiraMembers()` | Read-only Atlassian members from a **real** Jira connection |
| `generateDemoWorkspace()` / `seedDemoWorkspace()` | Force wipe + rebuild Demo |
| `refreshDemoWorkspace()` | Rebuild if fingerprint changed or Demo missing |
| `clearDemoWorkspace()` | Delete Demo tenant only |
| `getStatus()` | Fingerprint, members, stale/missing flags |

After seed it emits `WORKSPACE_KNOWLEDGE_CHANGED` so embeddings reindex for Demo.

## 5.2 How demo data is generated

```
Jira Members (read-only)
        │
        ▼
DemoWorkspaceGeneratorService
        │
        ▼
buildDemoWorkspaceFromJiraMembers()
        │
        ├─ Create Workspace (T_DEMO_PULSE_WS)
        ├─ Users (realistic names)
        ├─ SlackChannel rows
        ├─ Teams / CheckIns (scheduler off)
        ├─ JiraIssueCacheEntry + audits
        ├─ StandupRun / Submission / Answer / ConversationState
        ├─ PulseBlocker / updates
        ├─ AiDigest (reports)
        ├─ TeamMemoryDocument
        ├─ AiConversation (+ messages)
        ├─ SlackAiChatLog
        └─ InboundEvent (history only)
        │
        ▼
Prisma
        │
        ▼
PostgreSQL
```

## 5.3 How mock data is inserted

Templates in `demo-mock-templates.ts` are **name-free** (issue summaries, blocker text). The builder fills names from the live Jira roster (`fillTemplate`). All inserts go through Prisma `create` / `createMany` into **production tables**.

## 5.4 Why “Dynamic Mock Data”

Demo activity is **mock** (not live Slack/Jira events) but **dynamic**:

- People change when the real Jira member list changes  
- Fingerprint detects roster drift and can refresh  
- Narrative still uses SCRUM-* templates, but assignees/names track reality  

---

# 6. Dynamic Mock Data

## 6.1 What it means

**Dynamic Mock Data** = synthetic operational history stored in real tables, whose **people roster is derived from a live system** (Jira members), and which can be **regenerated** when that roster changes.

## 6.2 Comparison

| Type | Definition | Example |
|------|------------|---------|
| **Hardcoded Data** | Fixed names and stories in source code | Old Sara/Nora/Layla seeds |
| **Static Mock Data** | Fake data that never updates with real org | Fixed JSON fixture forever |
| **Dynamic Mock Data** | Fake activity + live-derived people; regenerable | Current Demo Workspace |
| **Real Data** | Produced by live Slack/Jira | Real workspace standups & cache |

## 6.3 Regeneration and refresh

```
refreshDemoWorkspace():
  fingerprint(current Jira members)
  == stored fingerprint ?
      YES → skip (idempotent)
      NO  → clear Demo only → seed again

seedDemoWorkspace() / generateDemoWorkspace():
  always force clear + seed
```

CLI: `npm run seed:demo` / `npm run seed:demo:remove`  
API: `POST /api/demo/seed|refresh`, `DELETE /api/demo`  
Auto: after `POST /api/jira/sync` → `refreshDemoWorkspace()`

---

# 7. Jira Architecture

## 7.1 How Jira is connected

Users connect Atlassian OAuth → `JiraConnection` row (`accessToken`, `cloudId`, `workspaceId`).

`JiraService` wraps Atlassian REST (`lookupIssueForUser`, `searchIssues`, `listWorkspaceMembers`, sync helpers).

## 7.2 How Jira data is synchronized

| Path | Behavior |
|------|----------|
| Manual / hub sync | Pulls visible issues into `JiraIssueCacheEntry` |
| AI issue-key question | Live `GET /rest/api/3/issue/{key}` then upsert cache |
| Demo | No live sync of issues; seeder writes cache rows |

## 7.3 How Jira cache works

```
Live Jira API
      │  (Real, when OAuth usable)
      ▼
JiraCacheService.upsertFromSnapshot
      │
      ▼
JiraIssueCacheEntry  (unique workspaceId + issueKey)
      │
      ▼
WorkspaceKnowledgeService.collectJiraIssues
      │
      ▼
AI context / answer
```

## 7.4 Why cache exists

1. **Performance** — chat should not call Atlassian for every token match  
2. **Reliability** — Atlassian downtime should not erase historical context  
3. **Demo** — Demo has no usable OAuth; cache *is* the Jira data  
4. **Authority** — after live refresh, cache holds the latest assignee/status  

## 7.5 Field authority (critical)

For assignee, status, priority, summary (and similar):

1. Live Jira (if usable connection)  
2. Else `JiraIssueCacheEntry`  
3. **Never** Team Memory / Reports / Digests / standup mentions as source of truth  

`ISSUE_STATUS` + `issueKey` sets `jiraFieldsOnly` so collectors load only Jira (+ audit).

---

# 8. Slack Architecture

## 8.1 Real Slack flow

```
Slack Socket Mode / Events API
        │
        ▼
SlackListener / SlackGateway
        │
        ├─ Standup DM answers → CollectionService → Submission/Answer
        ├─ Idle DM / app_mention → SlackAiAssistantService → AiChatService
        └─ InboundEvent (idempotency)
        │
        ▼
PostgreSQL (workspace-scoped)
```

Outbound messaging uses a **usable** bot token (`isUsableSlackBotToken`).

## 8.2 Demo Slack flow

```
DemoWorkspaceGeneratorService
        │
        ▼
Seed StandupRun / Submission / Answer / Threads /
SlackChannel / SlackAiChatLog / InboundEvent
        │
        ▼
PostgreSQL
```

**No Socket Mode. No Web API.** Placeholder token is rejected. Schedulers disabled.

## 8.3 Standup flow (Real)

```
Scheduler / trigger
  → create StandupRun
  → DM participants
  → ConversationState advances per question
  → Answer rows stored
  → optional AnswerJiraIssueLink
  → optional PulseBlocker
  → AiDigest / Slack report post
```

## 8.4 Slack synchronization

Admin `syncSlackMembersForWorkspace` uses WebClient `users.list` when the workspace bot token is usable. Demo skips sync and keeps seeded users.

## 8.5 Conversation flow (AI)

```
User message (web or Slack)
  → AiChatService.chat({ workspaceId, conversationId, question })
  → ConversationMemoryService loads prior turns
  → answer generated
  → appendAssistantTurn → AiConversationMessage
```

Slack also writes `SlackAiChatLog` for audit.

---

# 9. AI Architecture

## 9.1 Complete pipeline

```
Question
   │
   ▼
Intent Detection          IntentDetectionService
   │
   ▼
Workspace Retrieval       WorkspaceRetrievalService
   │                         └─ WorkspaceKnowledgeService
   ▼
RAG Pipeline              RagPipelineService
   │                         ├─ ContextBuilderService
   │                         └─ WorkspacePromptBuilder
   ▼
OpenAI                    OpenAiChatProvider
   │
   ▼
Answer                    ChatResponseFormatter
```

Shortcuts (before or instead of full RAG chat generation):

- Vacation catch-up → `VacationCatchupService`  
- Project Detective / decision replay → `AnalysisOrchestratorService`  
- Explicit reports → `ReportGenerationService`  

## 9.2 Services (every important one)

| Service | Responsibility |
|---------|----------------|
| `WorkspaceAiController` | HTTP `/ai/workspace/*` |
| `AiChatService` | Orchestrator |
| `IntentDetectionService` | Classify intent + extract filters |
| `RagPipelineService` | prepare: retrieve → context → prompt |
| `WorkspaceRetrievalService` | Hybrid keyword + embedding rank |
| `WorkspaceKnowledgeService` | Prisma collectors |
| `KnowledgeEmbeddingService` | Index + semantic search |
| `EmbeddingReindexService` | Debounced + cron reindex |
| `PgVectorSupportService` | pgvector detect/sync/ANN |
| `OpenAiEmbeddingProvider` | Embedding API |
| `ContextBuilderService` | Build grounded context text |
| `WorkspacePromptBuilder` | System + user messages |
| `OpenAiChatProvider` | Chat Completions |
| `UnavailableAiProvider` | Stub when AI disabled |
| `ChatResponseFormatter` | Answer + sources + confidence |
| `ConversationMemoryService` | Session turns / vacation pending |
| `ConversationHistoryService` | CRUD conversations |
| `ReportGenerationService` | Dynamic reports |
| `ReportMetricsService` | Deterministic metrics |
| `VacationCatchupService` | Absence catch-up |
| `AnalysisOrchestratorService` | Detective routing |
| `EvidenceCollectorService` | Investigation evidence |
| `TimelineBuilderService` | Timelines |
| `PatternDetectorService` | Patterns |
| `AiSlackExportService` | Web → Slack export |
| `SlackAiAssistantService` | Slack → AiChatService |
| `DemoWorkspaceGeneratorService` | Demo seed/clear |
| `AiService` (legacy) | Standup digest generation (separate path) |

---

# 10. RAG

## 10.1 What Retrieval-Augmented Generation is

RAG = **retrieve** relevant workspace documents first, then **generate** an answer using only that evidence in the prompt. The LLM is not asked to “know” your team; it is asked to read Pulse evidence.

## 10.2 How documents are collected

`WorkspaceKnowledgeService.collectSnapshot(workspaceId, filters)` runs collectors in parallel (conceptually sequential in code) and normalizes rows into `KnowledgeDocument`:

```
{
  id, workspaceId, source, entity, title, content,
  timestamp, url, reference, metadata, score?
}
```

Collectors (full list):

1. Slack Standups  
2. Slack Threads  
3. Standup Runs  
4. Check-ins  
5. Jira issues  
6. Blockers  
7. Blocker updates  
8. Reports (`AiDigest`)  
9. Slack Members  
10. Slack Channels  
11. Team Memory  
12. Jira Audit Logs  
13. Slack AI Conversations  

Special case: `jiraFieldsOnly` → only Jira + audit.

## 10.3 How ranking works

`WorkspaceRetrievalService.rankDocuments`:

- Boost exact `issueKey` matches  
- Boost `userQuery` name matches  
- Token overlap on title/body  
- Intent entity preference boosts  
- Recency boosts  
- Hard boosts for authoritative `jira_issue` when issue key present  
- Demote memory/reports for issue-key field questions  

## 10.4 How embeddings work

Each embeddable document is sent to OpenAI Embeddings → vector of floats (default 1536 dims, `text-embedding-3-small`). Stored in `KnowledgeEmbedding`.

## 10.5 How cosine similarity works

For JSON backend, similarity between query vector \(q\) and doc vector \(d\):

\[
\cos(q,d) = \frac{q \cdot d}{\|q\|\ \|d\|}
\]

Higher = more semantically similar. Used when pgvector ANN is unavailable.

## 10.6 How hybrid retrieval works

```
Keyword ranked IDs  ──┐
                     ├── Reciprocal Rank Fusion (RRF)
Semantic ranked IDs ─┘
                     │
                     ▼
              Fused hit list (top N)
```

Mode: `keyword_only` or `hybrid`. Intent soft-boosts preferred entities after fusion.

---

# 11. Embeddings

## 11.1 OpenAI Embeddings

`OpenAiEmbeddingProvider` calls OpenAI Embeddings API. Requires `OPENAI_API_KEY` and AI feature enabled.

## 11.2 JSON embeddings

Prisma field `KnowledgeEmbedding.embedding` is `Json` (`number[]`). Always written. Works without pgvector.

## 11.3 pgvector (current + future)

`PgVectorSupportService`:

- Tries to enable `vector` extension  
- Maintains native `embedding_vec` via raw SQL  
- ANN search when available  
- Falls back to JSON cosine if not  

Health: `GET /api/ai/workspace/health` reports `vectorSearch.backend` = `pgvector` | `json` | `none`.

## 11.4 Embedding generation

On `ensureIndexed(workspaceId, documents)`:

1. Filter embeddable entity types  
2. Hash content; skip unchanged  
3. Call OpenAI for new/changed  
4. Upsert JSON row  
5. Sync native vector if pgvector on  

## 11.5 Embedding refresh / background job

`EmbeddingReindexService`:

- Listens to `WORKSPACE_KNOWLEDGE_CHANGED`  
- Debounces ~8 seconds per workspace  
- Cron every ~10 minutes reindexes all workspaces (hash-skip)  
- Manual: `POST /api/ai/workspace/embeddings/reindex`  

Demo seed emits the same event after rebuild.

---

# 12. AI Retrieval

## 12.1 Where AI retrieves from

| Source | Table / origin | Collector |
|--------|----------------|-----------|
| Jira | `JiraIssueCacheEntry` (+ live refresh) | `collectJiraIssues` |
| Standups | Submissions / Answers | `collectStandups` |
| Threads | `StandupThreadUpdate` | `collectStandupThreads` |
| Reports | `AiDigest` | `collectReports` |
| Blockers | `PulseBlocker` | `collectBlockers` |
| Team Memory | `TeamMemoryDocument` | `collectTeamMemory` |
| AI Digests | same as Reports | `collectReports` |
| Conversation history | `AiConversationMessage` (memory service) + `SlackAiChatLog` | memory + `collectSlackAiChats` |
| Members / Channels | `User` / `SlackChannel` | `collectUsers` / `collectSlackChannels` |
| Audits | `JiraAuditLog` | `collectJiraAudits` |

## 12.2 Priority order (conceptual)

**For Jira ticket fields (assignee/status/…):**

1. Live Jira  
2. Jira cache  
3. (stop — do not use memory/reports)

**For general Q&A / detective (soft ranking):**

1. Intent-preferred entities (e.g. blockers for GET_BLOCKERS)  
2. Keyword + semantic relevance  
3. Recency  
4. Broader memory / digests as supporting narrative  

Exact boost tables live in `INTENT_ENTITY_BOOST` inside `workspace-retrieval.service.ts`.

---

# 13. AI Intent Detection

## 13.1 How it works

`IntentDetectionService.detect(question)`:

1. Normalize text  
2. Extract `issueKey` via regex (`SCRUM-9`)  
3. Extract date ranges / user name candidates when relevant  
4. Score keyword patterns per intent  
5. Pick highest score → `DetectedIntent { intent, filters, rationale }`

## 13.2 Intent catalog

| Intent | Typical questions |
|--------|-------------------|
| `ISSUE_STATUS` | Who is assigned to SCRUM-9? What is the status of …? |
| `ISSUE_ANALYSIS` | Why was SCRUM-8 delayed? |
| `GET_BLOCKERS` | Who is blocked? List open blockers |
| `SUMMARIZE_STANDUP` | Summarize yesterday’s standup |
| `GET_USER_ACTIVITY` | What did Karam do? |
| `LIST_MEMBERS` | Who is on the team? |
| `PROJECT_DETECTIVE` | Investigate SCRUM-8 end-to-end |
| `ROOT_CAUSE_ANALYSIS` | Root cause of the delay |
| `DECISION_REPLAY` / `SPRINT_REPLAY` | Replay decisions / sprint |
| `SPRINT_REPORT` / `EXECUTIVE_REPORT` / `GENERATE_REPORT` | Generate reports |
| `VACATION_CATCHUP` | What did I miss on vacation? |
| `TEAM_MEMORY_SEARCH` | Search team memory |
| `GENERAL_QA` | Fallback |

## 13.3 Example

```
Input:  "Who is assigned to SCRUM-9?"
Output: intent = ISSUE_STATUS
        filters.issueKey = "SCRUM-9"
        rationale = "Issue status lookup for SCRUM-9"
```

`RagPipelineService.refineFiltersForIntent` then sets `jiraFieldsOnly = true` and clears unrelated user filters.

---

# 14. AI Prompt Building

## 14.1 How prompts are built

`WorkspacePromptBuilder.build({ question, intent, context })` returns:

- `system` — hard rules + intent guidance  
- `user` — question + WORKSPACE CONTEXT  
- `messages` — OpenAI chat message array  

## 14.2 How context is injected

`ContextBuilderService` selects top ranked hits (char/chunk budgets), formats:

```
### Source 1 (jira / jira_issue) — SCRUM-9 — Dashboard Analytics
Key: SCRUM-9
Summary: ...
Status: In Progress
Assignee: Karam Waleed
Data source: Live Jira API ...
```

## 14.3 How sources are selected

Retrieval ranking + intent priority. For ISSUE_STATUS, non-Jira sources are excluded upstream. Citations are attached by `ChatResponseFormatter` from retrieval references (UI may hide chips unless `VITE_SHOW_AI_SOURCES`).

## 14.4 How hallucinations are reduced

1. Hard rules: only use WORKSPACE CONTEXT  
2. Insufficient-data exact message when empty  
3. Jira field authority rules  
4. No inventing members/issues  
5. Confidence band (High/Medium/Low) from evidence quality  
6. Eval framework flags hallucination-like answers  

---

# 15. AI Answer Flow

```
User Question
      │
      ▼
Controller          WorkspaceAiController.chat
      │
      ▼
Service             AiChatService.chat
      │
      ├─ resolve workspaceId
      ├─ load conversation memory
      ├─ detect intent
      ├─ optional shortcuts (report / vacation / detective)
      │
      ▼
Retrieval           RagPipeline → Retrieval → Knowledge collectors
      │
      ▼
Prompt Builder      ContextBuilder + WorkspacePromptBuilder
      │
      ▼
OpenAI              OpenAiChatProvider.complete
      │
      ▼
Response Formatter  ChatResponseFormatter.format
      │
      ▼
Persist             ConversationMemoryService.appendAssistantTurn
      │
      ▼
Frontend            AiConversationArea renders answer (+ optional report card)
```

Slack path replaces Controller/Frontend with `SlackAiAssistantService` posting Block Kit / text back to Slack, and writing `SlackAiChatLog`.

---

# 16. Demo vs Real Workspace

## 16.1 Differences

| Area | Real | Demo |
|------|------|------|
| Slack API | Live | None (seeded) |
| Jira OAuth | Real tokens | Placeholders |
| Issue data | Sync + live refresh | Seeded cache |
| People | Slack sync | Jira member names |
| Schedulers | Often enabled | Forced off |
| Bot token | Usable xoxb | Placeholder |

## 16.2 Similarities

- Same PostgreSQL schema  
- Same Nest services and controllers  
- Same AI pipeline and prompts  
- Same UI routes  
- Same `X-Workspace-Id` isolation  

## 16.3 Why AI uses exactly the same code

Forking Demo AI would recreate the bugs we already fixed (wrong assignees, stale status, divergent prompts). Tenant isolation is a **data** problem, not a **codepath** problem.

## 16.4 Why only `workspaceId` changes

```
AiChatService.chat({ workspaceId, question })
```

All collectors take that id. Switching the dashboard workspace switcher changes the header; the AI stack does not branch on Demo vs Real names.

---

# 17. End-to-End Request Flow

## 17.1 Real Workspace — general chat

```
Browser X-Workspace-Id=REAL
  → POST /api/ai/workspace/chat { question }
  → AiChatService
  → Intent GENERAL_QA / …
  → collectSnapshot(REAL)
  → hybrid retrieve
  → OpenAI
  → answer grounded on Real rows
```

## 17.2 Demo Workspace — general chat

```
Browser X-Workspace-Id=DEMO
  → POST /api/ai/workspace/chat { question }
  → AiChatService   (same)
  → collectSnapshot(DEMO)
  → hybrid retrieve (seeded rows)
  → OpenAI
  → answer grounded on Demo rows
```

## 17.3 Jira question (ISSUE_STATUS)

```
"Who is assigned to SCRUM-9?"
  → ISSUE_STATUS, issueKey=SCRUM-9, jiraFieldsOnly
  → collectors: jira (+ audit only)
  → refreshIssueFromLiveJira?
        Real + OAuth → Live GET → upsert cache → Assignee from live
        Demo / no OAuth → Cache row only
  → enforceJiraFieldAuthority
  → prompt with authoritative Assignee line
  → short factual answer
```

## 17.4 Standup question

```
"Summarize yesterday’s standup"
  → SUMMARIZE_STANDUP
  → boost standup_submission / standup_run
  → collect standups in date window
  → concise bullet summary
```

## 17.5 Project Detective

```
"Investigate why SCRUM-8 was delayed"
  → PROJECT_DETECTIVE (or analysis shortcut)
  → AnalysisOrchestratorService
  → EvidenceCollector + Timeline + Patterns
  → structured investigation sections
  → (optional) LLM narrative over evidence
```

---

# 18. Folder Structure

## 18.1 Top level

```
pulse/
├── backend/                 NestJS API, Prisma, AI, Slack, Jira
├── frontend/                React (Vite) dashboard + AI Workspace UI
├── docs/                    Architecture and audit reports
└── .env.example             Shared env documentation
```

## 18.2 backend/

```
backend/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   ├── seed.ts / seed-demo.ts / remove-demo.ts
│   └── demo/                Demo README + constant re-exports
├── src/
│   ├── main.ts / app.module.ts
│   ├── ai/                  AI digests + AI Workspace
│   ├── demo/                Demo generator
│   ├── jira/                OAuth, cache, hub, blockers
│   ├── slack/               Bolt listeners, gateway, Slack AI assistant
│   ├── collection/          Standup collection engine
│   ├── admin/               Workspace admin + Slack member sync
│   ├── common/              workspace-context, slack-member utils
│   └── prisma/              PrismaService module
└── package.json
```

## 18.3 frontend/

```
frontend/src/
├── app/App.tsx              Routes including /ai-workspace
├── pages/AiWorkspacePage.tsx
├── pages/AiEvaluationPage.tsx
└── components/ai-workspace/ Conversation UI, history, Send to Slack
```

## 18.4 backend/src/ai/

```
ai/
├── ai.module.ts
├── ai.service.ts            Legacy standup digests
├── openai-client.ts
└── workspace/
    ├── workspace-ai.controller.ts
    ├── chat/ai-chat.service.ts
    ├── rag/rag-pipeline.service.ts
    ├── intent/
    ├── knowledge/
    ├── retrieval/           hybrid + embeddings + pgvector
    ├── context/
    ├── prompts/
    ├── providers/
    ├── response/
    ├── memory/
    ├── report/
    ├── analysis/
    ├── slack/               Send-to-Slack export
    └── evaluation/
```

## 18.5 jira/ and slack/

| Folder | Role |
|--------|------|
| `jira/` | Connection, cache, hub UI APIs, audit, answer links, team memory indexing |
| `slack/` | Socket Mode, listeners, gateway, check-in views, `SlackAiAssistantService` |
| `demo/` | Constants, templates, builder, generator, controller |

---

# 19. Files Modified / Important Files

*(“Important” = critical to AI architecture; not an exhaustive git diff.)*

| File | Responsibility |
|------|----------------|
| `backend/prisma/schema.prisma` | All models, workspace uniques |
| `backend/src/ai/workspace/chat/ai-chat.service.ts` | Chat orchestrator |
| `backend/src/ai/workspace/rag/rag-pipeline.service.ts` | RAG prepare + filter refinement |
| `backend/src/ai/workspace/intent/intent-detection.service.ts` | Intent classification |
| `backend/src/ai/workspace/knowledge/workspace-knowledge.service.ts` | Collectors + live Jira refresh |
| `backend/src/ai/workspace/retrieval/workspace-retrieval.service.ts` | Hybrid ranking + Jira field authority |
| `backend/src/ai/workspace/retrieval/knowledge-embedding.service.ts` | Embed index/search |
| `backend/src/ai/workspace/retrieval/embedding-reindex.service.ts` | Background reindex |
| `backend/src/ai/workspace/retrieval/pgvector-support.service.ts` | pgvector backend |
| `backend/src/ai/workspace/context/context-builder.service.ts` | Context packing |
| `backend/src/ai/workspace/prompts/workspace-prompt.builder.ts` | Prompt hard rules |
| `backend/src/ai/workspace/providers/openai-chat.provider.ts` | LLM calls |
| `backend/src/ai/workspace/response/chat-response.formatter.ts` | Final API shape |
| `backend/src/ai/workspace/memory/conversation-memory.service.ts` | Conversation persistence |
| `backend/src/ai/workspace/workspace-ai.controller.ts` | HTTP API |
| `backend/src/jira/jira.service.ts` | Atlassian API |
| `backend/src/jira/jira-cache.service.ts` | Cache upsert (workspace-scoped) |
| `backend/src/slack/slack-ai-assistant.service.ts` | Slack → AI |
| `backend/src/demo/demo-workspace-generator.service.ts` | Demo seed/clear/refresh |
| `backend/src/demo/demo-workspace-builder.ts` | Demo graph builder |
| `backend/src/common/workspace-context.ts` | Tenant resolution + filters |
| `backend/src/common/slack-member.util.ts` | Usable Slack token gate |
| `frontend/src/pages/AiWorkspacePage.tsx` | AI UI |
| `docs/DEMO_WORKSPACE_ARCHITECTURE.md` | Demo deep dive |

---

# 20. Future Improvements

| Area | Direction |
|------|-----------|
| **pgvector** | Ensure extension in all envs; tune ANN indexes; monitor fallback to JSON |
| **Background embedding jobs** | Stronger queue/worker isolation; progress metrics |
| **Evaluation** | Gold cases dynamically tied to Demo roster; CI gates |
| **Conversation history** | Richer threading, sharing, export |
| **Slack export** | Better Block Kit, channel pickers, permission UX |
| **Better timeline** | Unified InboundEvent + audit + standup timeline UI |
| **Upsert Demo regen** | Preserve Demo UUIDs on soft refresh |
| **More `workspaceId` columns** | StandupRun, AiDigest, etc. for simpler deletes |
| **Real SlackChannel sync** | Populate `SlackChannel` from Slack API for Real tenants |

---

# 21. Frequently Asked Questions

### Why PostgreSQL?

Reliable relational multi-tenant store with JSON + optional pgvector. One database for product + AI evidence.

### Why Prisma?

Type-safe queries, migrations, and Nest integration. AI collectors stay readable and consistent.

### Why `workspaceId`?

It is the tenant key. Without it, Demo and Real would leak into each other.

### How does Demo work?

Generator clears Demo only, then inserts synthetic activity into the **same** tables, with people names from real Jira members.

### Where is mock data stored?

In PostgreSQL production tables under Demo’s `workspaceId`. There is no separate mock database.

### How does AI know which workspace to search?

`X-Workspace-Id` header (or resolved default) → every collector filters by that id.

### Does AI search PostgreSQL directly?

Yes, via Prisma collectors. It does not scrape Slack/Jira HTML. Live Jira is an optional refresh into cache for issue keys.

### Does AI read Jira every time?

No. Only issue-key questions attempt live refresh when OAuth is usable. Otherwise cache (and other tables) are used.

### Why do we have Jira cache?

Speed, resilience, Demo support, and a single upsert target after live refresh.

### What is Team Memory?

Indexed documents for narrative search. Supporting context — **not** authority for Jira fields.

### What is RAG?

Retrieve workspace documents first; generate answers from that evidence only.

### What are embeddings?

Numeric vectors representing meaning. Used for semantic similarity search alongside keywords.

### What is Dynamic Mock Data?

Seeded Demo activity whose roster tracks live Jira members and can be regenerated.

### Can Demo call Slack?

No. Placeholder token fails `isUsableSlackBotToken`; schedulers are off.

### Is there a fake Slack API?

No. Demo seeds PostgreSQL only.

### What is Project Detective?

An analysis mode that gathers evidence, builds timelines/patterns, and returns a structured investigation — same workspace isolation.

### How do I reseed Demo?

```bash
cd pulse/backend
npm run seed:demo
```

### How do I check vector backend?

`GET /api/ai/workspace/health`

### What env vars does AI need?

`DATABASE_URL`, `OPENAI_API_KEY`, `PULSE_AI_ENABLED=true`, optional `OPENAI_MODEL`, `OPENAI_EMBEDDING_MODEL`.

---

# 22. Summary

*(Plain-language overview for managers, professors, or stakeholders.)*

Pulse is a Slack standup product that stores team activity in PostgreSQL. On top of that store we built an **AI Workspace**: a grounded assistant that answers questions about standups, Jira issues, blockers, and reports.

We deliberately **do not** let the AI invent team facts. It first **retrieves** rows for the active workspace, then asks OpenAI to answer using only that evidence. That pattern is called **RAG** (Retrieval-Augmented Generation). We also store **embeddings** so the system can find relevant notes by meaning, not only by keywords, with optional **pgvector** acceleration.

Every customer (and our Demo sandbox) lives in the **same database** as a separate **workspace**. The AI code is identical for Demo and Real; only the `workspaceId` changes. Real workspaces fill data from live Slack and Jira. The Demo workspace fills the same tables with **dynamic mock data**—realistic stories whose people names come from the connected Jira org—without calling Slack or writing to Jira.

Jira ticket fields such as assignee and status are treated carefully: they come from live Jira when possible, otherwise from a per-workspace cache, never from chatty memory documents. That keeps answers trustworthy.

In short: **one database, one AI pipeline, strict workspace isolation, grounded answers, Demo as a safe twin of production.**

---

## Appendix A — Example API request

```http
POST /api/ai/workspace/chat HTTP/1.1
Host: localhost:3000
Content-Type: application/json
X-Workspace-Id: b1ba6c87-0e8e-412e-b934-7c3b981d6982

{
  "question": "Who is assigned to SCRUM-9?",
  "conversationId": null
}
```

## Appendix B — Example grounded context fragment

```
### Source 1 (jira / jira_issue) — SCRUM-9 — Dashboard Analytics
Key: SCRUM-9
Summary: Dashboard Analytics
Status: In Progress
Assignee: Karam Waleed
Priority: Medium
Data source: Live Jira API (refreshed for this question)
AUTHORITATIVE_JIRA_FIELDS: assignee, status, priority, summary …
```

## Appendix C — Environment checklist for local AI

```
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...
PULSE_AI_ENABLED=true
OPENAI_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

Optional frontend:

```
VITE_SHOW_AI_SOURCES=true
```

## Appendix D — Onboarding checklist for new engineers

1. Read this document end-to-end  
2. Run backend + frontend; open `/ai-workspace`  
3. Switch between Real and Demo workspaces; ask the same Jira question in both  
4. Trace one chat in logs: intent → collectors → hybrid mode → OpenAI  
5. Run `npm run seed:demo` and confirm Real data unchanged  
6. Hit `/api/ai/workspace/health` and note embedding backend  
7. Skim `workspace-knowledge.service.ts` and `ai-chat.service.ts`  

---

*End of AI System Architecture document.*
