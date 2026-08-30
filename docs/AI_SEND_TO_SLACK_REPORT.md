# AI Send to Slack Report

**Date:** August 19, 2026  
**Module:** Pulse AI Workspace  
**Feature:** Send AI answers and reports to Slack (Block Kit + attachments)

---

## Executive Summary

**Send to Slack** is fully implemented end-to-end. Users can deliver AI chat answers and structured reports to a **DM**, **selected channel**, or **team channel**, with optional **PDF / Markdown / CSV** attachments. Messages use Slack Block Kit and every attempt is audited in `AiSlackExportLog`.

---

## Supported Content

- AI Chat responses / normal answers  
- Executive Reports  
- Sprint Reports  
- Project Detective Reports  
- Root Cause Analysis  
- Vacation / daily / weekly reports  

## Destinations

- Current user DM  
- Selected Slack channel  
- Team channel  
- Default engineering channel (resolved heuristically)

## Message Payload (Block Kit)

- Title  
- AI Answer  
- Confidence  
- Sources  
- Timestamp  
- Workspace name  

## Attachments

- PDF (`simple-pdf.util`)  
- Markdown  
- CSV  

---

## Error Handling

| Condition | Behavior |
|-----------|----------|
| Missing / invalid bot token | Clear error; log `success=false` |
| Slack disconnected | `slackConnected=false` in destinations |
| Invalid channel | Rejected with message |
| Permission / join failures | Surfaced + logged |
| Cross-workspace report | Rejected |

---

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/ai/workspace/slack/destinations` | Channels, teams, members, default |
| `POST` | `/ai/workspace/slack/send` | Deliver export |

## UI

- `SendToSlackDialog` from `AiReportCard` and `AiConversationArea`

## Files

| File | Role |
|------|------|
| `slack/ai-slack-export.service.ts` | Orchestration + WebClient |
| `slack/ai-slack-blocks.builder.ts` | Block Kit |
| `slack/simple-pdf.util.ts` | Minimal PDF |
| `slack/ai-slack-export.types.ts` | Contracts |
| `frontend/.../SendToSlackDialog.tsx` | Destination picker |

## Audit

Every send writes `AiSlackExportLog` (workspace, destination, success, error codes, attachments, message ts).

## Testing Notes

- Demo workspace with placeholder token → graceful disconnect messaging  
- Real workspace with valid `xoxb` → DM / channel / team delivery + file thread upload  

## Remaining Limitations

- Large PDF content is truncated for Slack limits  
- Requires workspace bot scopes for `chat:write`, `files:write`, `channels:join` (as applicable)
