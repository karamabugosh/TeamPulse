# Jira Integration Documentation

This folder contains the complete technical documentation for Pulse's Jira integration.

| Document | Description |
|----------|-------------|
| [COMPLETE_TECHNICAL_REPORT.md](./COMPLETE_TECHNICAL_REPORT.md) | Full end-to-end implementation report (OAuth, API, database, Slack, security, code walkthrough) |

## Related docs (project root)

- `pulse/JIRA_INTEGRATION_REPORT.md` — Phase 1 OAuth implementation notes
- `pulse/JIRA_STANDUP_LINKING_REPORT.md` — Standup issue linking implementation
- `pulse/SLACK_JIRA_INTEGRATION_REPORT.md` — Slack picker and blocker automation

## Quick reference

- **OAuth start:** `GET /api/auth/jira`
- **OAuth callback:** `GET /api/auth/jira/callback`
- **Connection status:** `GET /api/auth/jira/status`
- **Sync + cache refresh:** `POST /api/jira/sync`
- **List issues:** `GET /api/jira/issues`
- **Slack picker:** Bolt Socket Mode `app.options()` in `backend/src/slack/jira-slack.listener.ts`
