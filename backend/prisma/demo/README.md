# Demo Workspace

Demo is a **normal workspace tenant** in the same PostgreSQL database and schema as Real.

There are **no Demo-only tables**. Seeded rows live in shared models (`User`, `JiraIssueCacheEntry`, `StandupSubmission`, `PulseBlocker`, `TeamMemoryDocument`, `AiConversation`, …) with `workspaceId` pointing at Demo.

The AI / Jira / Reports / Blockers / Team Memory pipelines filter by `workspaceId` only — they do not branch on “Demo vs Real”.

## Pipeline

1. `JiraService.listWorkspaceMembers` — read-only Atlassian members (seed input for people names)
2. `DemoWorkspaceGeneratorService.seedDemoWorkspace` / `refreshDemoWorkspace` — wipe Demo tenant only, then insert into shared tables
3. Runtime: same Nest services + `X-Workspace-Id` as Real

Auto-refresh: `POST /api/jira/sync` calls `refreshDemoWorkspace()` when the Jira member fingerprint changes.

## Commands

```bash
cd pulse/backend

# Force rebuild Demo into shared PostgreSQL tables
npm run seed:demo

# Delete Demo Workspace only (never touches Real)
npm run seed:demo:remove
```

API:

- `GET /api/demo/status`
- `GET /api/demo/jira-members`
- `POST /api/demo/seed` — force seed
- `POST /api/demo/generate` — alias of seed
- `POST /api/demo/refresh` — regenerate if fingerprint changed
- `POST /api/demo/regenerate?force=1`
- `DELETE /api/demo` — clear Demo only

## Docs

- Architecture (canonical): [`docs/DEMO_WORKSPACE_ARCHITECTURE.md`](../../../docs/DEMO_WORKSPACE_ARCHITECTURE.md)
- Architecture refactor notes: [`docs/DEMO_WORKSPACE_REFACTOR_REPORT.md`](../../../docs/DEMO_WORKSPACE_REFACTOR_REPORT.md)
- Slack Demo notes: [`docs/SLACK_DEMO_REFACTOR_REPORT.md`](../../../docs/SLACK_DEMO_REFACTOR_REPORT.md)
- Data report: [`docs/DEMO_WORKSPACE_DATA_REPORT.md`](../../../docs/DEMO_WORKSPACE_DATA_REPORT.md)
