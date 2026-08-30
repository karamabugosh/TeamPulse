# Demo Workspace Architecture Refactor Report

**Date:** 2026-08-20  
**Goal:** Demo and Real use the **same** PostgreSQL schema, models, services, and AI pipeline. Demo is only another `Workspace` row populated with seeded data.

---

## Current architecture (before this refactor)

| Layer | Reality |
|-------|---------|
| Database | **Already one PostgreSQL DB** — no Demo-only tables |
| Schema | Shared Prisma models |
| Demo data | Dedicated wipe/rebuild builder writing into shared tables under `T_DEMO_PULSE_WS` |
| AI chat / RAG | Same services; filtered by `workspaceId` |
| Divergence | Demo-aware Jira labels (`Mock`), live-refresh skips by Slack id, some activity tables lacked direct `workspaceId`, generator helpers incompletely named, dead Sara/Nora seed file |

---

## New architecture

```
┌─────────────────────────────────────────────────────────┐
│                   PostgreSQL (one DB)                    │
│  Workspace(real)          Workspace(demo / T_DEMO_…)    │
│       │                            │                     │
│       └──── same tables ───────────┘                     │
│  User, Team, JiraConnection, JiraIssueCacheEntry,        │
│  Standup*, PulseBlocker, AiDigest, TeamMemoryDocument,   │
│  AiConversation, JiraAuditLog, AnswerJiraIssueLink, …    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
              Nest services / controllers
              (no Demo vs Real product fork)
                           │
                           ▼
         AI pipeline: filter by workspaceId only
         Jira → Standups → Reports → Memory → Blockers → Digests
```

- **Demo** = seeded tenant (fake Jira OAuth tokens so Atlassian is never called).
- **Real** = live Slack/Jira OAuth + sync.
- **AI never “knows” Demo** — it only sees cache/live based on usable credentials.

---

## Tables affected

### Already workspace-scoped (unchanged ownership model)

`Workspace`, `User`, `Team`, `InboundEvent`, `JiraConnection`, `JiraIssueCacheEntry`, `TeamMemoryDocument`, `SlackAiChatLog`, `KnowledgeEmbedding`, `AiConversation`, `AiSlackExportLog`, `AiEvalCase`, `AiEvalRun`

### Now denormalized with `workspaceId` (this refactor)

| Table | Change |
|-------|--------|
| `PulseBlocker` | Added `workspaceId` + FK + index |
| `JiraAuditLog` | Added `workspaceId` + FK + index |
| `AnswerJiraIssueLink` | Added `workspaceId` + FK + index |

Migration: `prisma/migrations/20260820010000_workspace_id_activity_tables/`

### Still parent-scoped (via Team / User — acceptable)

`TeamMember`, `CheckIn`, `Question`, `StandupRun`, `StandupSubmission`, `Answer`, `AiDigest`, `PulseBlockerUpdate`, `JiraProposedAction`, …

Isolation remains correct via joins; listed as remaining improvements if we want every row to carry `workspaceId`.

---

## Files modified

| File | Change |
|------|--------|
| `prisma/schema.prisma` | `workspaceId` on blockers / audit / answer-jira links; Workspace relations |
| `prisma/migrations/20260820010000_…` | Backfill + unique indexes/FKs |
| `src/demo/demo-workspace-generator.service.ts` | `generateDemoWorkspace`, `clearDemoWorkspace`, `seedDemoWorkspace`, `refreshDemoWorkspace`; emit knowledge-changed |
| `src/demo/demo.controller.ts` | `POST /demo/seed|generate|refresh`, `DELETE /demo` |
| `src/demo/demo-workspace-builder.ts` | Write/clear using `workspaceId`; one cache row per issue |
| `src/ai/workspace/knowledge/workspace-knowledge.service.ts` | Credential-based live Jira (no Demo/Mock branch); direct `workspaceId` filters |
| `src/common/workspace-context.ts` | Blocker/Jira cache/audit/link filters by `workspaceId` |
| `src/jira/jira-blocker.service.ts` | Set `workspaceId` on create |
| `src/jira/jira-audit.service.ts` | Set `workspaceId` on create |
| `src/jira/answer-jira-link.service.ts` | Set `workspaceId` on create |
| `src/jira/jira-api.controller.ts` | Calls `refreshDemoWorkspace()` after sync |
| `prisma/seed-demo.ts` / `remove-demo.ts` | Use new helper names |
| `prisma/demo/data.ts` / `README.md` | Document shared-schema model |
| **Deleted** `prisma/demo/ai-conversations.ts` | Dead hardcoded-name seed |

---

## Data flow

### Real Workspace

```
Slack OAuth / Jira OAuth
  → sync into shared tables (workspaceId = real)
  → AI / UI query by X-Workspace-Id
```

### Demo Workspace

```
Real Jira members (read-only)  →  name roster only
  → clearDemoWorkspace() deletes Demo tenant only
  → seed inserts into SAME tables (workspaceId = demo)
  → AI / UI query by X-Workspace-Id (identical code)
```

### Seeder flow (idempotent)

1. `refreshDemoWorkspace()` — skip if fingerprint unchanged  
2. `seedDemoWorkspace()` / `generateDemoWorkspace()` — force wipe + rebuild  
3. `clearDemoWorkspace()` — delete Demo only  
4. After seed: emit `WORKSPACE_KNOWLEDGE_CHANGED` → embedding reindex (same as Real)

Never mutates Real `workspaceId` rows.

---

## AI retrieval flow (identical for Demo & Real)

```
POST /api/ai/workspace/chat + X-Workspace-Id
  → IntentDetection
  → RagPipeline (filters)
  → WorkspaceKnowledge.collectSnapshot(workspaceId)
       JiraIssueCacheEntry / live refresh if usable OAuth
       Standups, Blockers, Reports (AiDigest), Team Memory, …
  → rank / context / prompt
  → OpenAI
```

Live Jira refresh runs **only** when the workspace has non-placeholder OAuth tokens. Demo has placeholder tokens → answers come from `JiraIssueCacheEntry` (seeded), labeled **Cache**, not a separate Mock pipeline.

---

## Workspace isolation strategy

1. **Request:** `X-Workspace-Id` → `workspaceStorage` / `resolveActiveWorkspaceId`  
2. **Queries:** prefer direct `where: { workspaceId }` (cache, blockers, audits, links, memory, conversations)  
3. **Parent-scoped:** `team: { workspaceId }`, `run: { team: { workspaceId } }`  
4. **Demo clear:** delete by Demo `workspaceId` / Demo users only  
5. **Jira member sourcing:** `findRealJiraConnection()` excludes placeholder tokens (generator input only — not RAG)

---

## Helper methods

| Method | Behavior |
|--------|----------|
| `generateDemoWorkspace()` | Force rebuild |
| `seedDemoWorkspace()` | Force rebuild (alias) |
| `refreshDemoWorkspace()` | Rebuild if fingerprint changed / missing |
| `clearDemoWorkspace()` | Delete Demo tenant only |
| `ensureGenerated({ force })` | Underlying implementation |
| `removeDemoOnly()` | Underlying clear |

HTTP: `POST /api/demo/seed|generate|refresh`, `DELETE /api/demo`

---

## Benefits

1. One schema, one AI pipeline, one set of controllers  
2. Demo behaves like Real for AI, Jira page, Reports, Blockers, Memory, Search, Conversations  
3. Stronger isolation via denormalized `workspaceId` on activity tables  
4. No Mock product path — only Live vs Cache by credentials  
5. Idempotent refresh; force seed for full rebuild  
6. Real Workspace untouched by Demo clear/seed  

---

## Remaining improvements

1. Add `workspaceId` to remaining parent-scoped models (`StandupRun`, `AiDigest`, `PulseBlockerUpdate`, `JiraProposedAction`, …) for uniform deletes/queries  
2. Upsert-style Demo regen (preserve Demo UUIDs) instead of full wipe when only membership deltas change  
3. Regenerate AI eval gold cases from live roster slots (drop Sara/Nora/Layla assumptions in `gold-dataset.ts`)  
4. Ensure embeddings always reindex after every Demo seed in all environments  
5. Optional: remove fake `JiraConnection` rows entirely and rely on cache-only for Demo (still same tables)

---

## Verification checklist

- [x] One PostgreSQL database  
- [x] Same tables for Demo and Real  
- [x] Demo seeded into PostgreSQL (not in-memory product store)  
- [x] AI filters by `workspaceId` (no Demo answer fork)  
- [x] Generator helpers named as required  
- [x] Idempotent refresh; force seed clears Demo only  
- [x] Real Workspace not modified by Demo clear/seed  
- [ ] Manual: select Demo in UI → AI / Jira / Reports / Blockers / Memory work on seeded data  
- [ ] Manual: select Real → live data unchanged after Demo reseed  
