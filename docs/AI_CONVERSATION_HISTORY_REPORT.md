# AI Conversation History Report

**Date:** August 19, 2026  
**Module:** Pulse AI Workspace  
**Feature:** Persisted multi-workspace conversation history

---

## Executive Summary

Every AI Workspace conversation is stored in **PostgreSQL**, scoped by `workspaceId`, and restored after server restart. The AI Workspace UI provides a history sidebar to **view**, **search**, **reopen**, **continue**, and **delete** conversations. Context is never mixed across workspaces.

---

## Requirements Coverage

| Requirement | Status |
|-------------|--------|
| Store every AI conversation in PostgreSQL | Done (`AiConversation` + `AiConversationMessage`) |
| Multiple workspaces | Done (`workspaceId` on every row) |
| Multiple users | Ready (`userId` nullable on conversation) |
| Workspace isolation | Done (all queries filter `workspaceId`) |
| Survive server restart | Done (Postgres + `ensureLoaded`) |
| Reopen previous conversations | Done (GET detail + warm memory) |
| Preserve context | Done (L1 cache + DB turns fed to provider history) |
| Never mix workspaces | Done (hard filter + mismatch reject) |
| View / continue / delete / search | Done (API + UI) |

---

## Data Model

### `AiConversation`

- `id`, `workspaceId`, `userId?`, `title`, `preview`, `vacationPending`, timestamps

### `AiConversationMessage`

- `id`, `conversationId`, `role`, `content`, `intent`, `citations` (JSON pack with sources + confidence), `confidence` column (optional), `createdAt`

Citations are stored as:

```json
{ "sources": [ … ], "confidence": "High" }
```

Legacy bare arrays still parse correctly.

---

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/ai/workspace/conversations?workspaceId=&q=&limit=` | List / search |
| `GET` | `/ai/workspace/conversations/:id?workspaceId=` | Reopen + warm memory |
| `DELETE` | `/ai/workspace/conversations/:id?workspaceId=` | Delete (scoped) |

Search matches **title**, **preview**, and **message content** (case-insensitive), always within the active workspace.

---

## UI

`AiConversationHistory` inside `AiWorkspacePage`:

- Debounced search box
- New chat
- Select → restore messages + confidence + citations
- Delete
- Clears open thread when `workspaceId` changes

---

## Conversation Flow

```
POST /chat
  → ConversationMemoryService.ensureLoaded (workspace-scoped)
  → append user / assistant turns → Postgres
  → title from first user message; preview from latest assistant

GET /conversations/:id
  → verify workspaceId
  → return messages
  → warm L1 memory for follow-ups
```

---

## Files

| File | Role |
|------|------|
| `memory/conversation-memory.service.ts` | Persist + restore turns |
| `memory/conversation-history.service.ts` | List / search / get / delete |
| `workspace-ai.controller.ts` | HTTP endpoints |
| `frontend/.../AiConversationHistory.tsx` | Sidebar UI |
| `frontend/.../AiWorkspacePage.tsx` | Wiring |

---

## Testing Notes

- Demo + real workspace: create chats in A, switch to B → history empty for A’s threads
- Restart server → reopen conversation → follow-up keeps context
- Search filters within workspace only
- Delete removes only the targeted conversation

---

## Remaining Limitations

- Web user identity may be null (Slack sets `userId` when available)
- Soft title truncation at 120 chars
- In-memory L1 cache is per process (DB is source of truth)
