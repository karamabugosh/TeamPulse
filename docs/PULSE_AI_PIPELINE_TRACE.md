# PULSE — AI Pipeline Trace / Retrieval Debugger

**Date:** 2026-08-22  
**Scope:** Ask Pulse developer diagnostics — real backend execution trace + UI stepper  
**Status:** Implemented

---

## Overview

Every Ask Pulse `/chat` response can include a structured **`pipelineTrace`** object built from real backend execution — not fake frontend timers.

The UI shows an expandable **View AI Trace** panel with a horizontal pipeline stepper, per-stage status, timings, clickable stage details, pipeline health summary, and deterministic quality warnings.

---

## Pipeline Stages

| Stage | Source |
|-------|--------|
| Question | Request received (workspaceId, question length) |
| Intent | `IntentDetectionService` + category signals |
| Retrieval Policy | `buildMemoryRetrievalPlan()` + `MEMORY_V2_ASK_MODE` |
| Identity / ACL | `resolveMemoryAclUserId` + V2 ACL diagnostics |
| Temporal Scope | `LATEST_STANDUP` resolver (when applicable) |
| V2 Memory | `MemoryRetrievalService` (pgvector/json) |
| Legacy Retrieval | `WorkspaceRetrievalService` |
| Live Jira | Live Jira documents in merged evidence |
| Evidence Merge | `MemoryEvidenceMergeService` |
| Context | `ContextBuilderService` |
| OpenAI | `OpenAiChatProvider.complete()` |
| Answer | Formatter output + confidence |

SKIPPED stages are not treated as failures.

---

## Status Model

| Status | UI |
|--------|-----|
| SUCCESS | Green |
| WARNING | Amber |
| FAILED | Red |
| SKIPPED | Muted gray |
| PENDING / RUNNING | Neutral (only used when live progress exists — currently post-completion only) |

**Pipeline Health:**

- `ALL_STAGES_PASSED`
- `WARNING_FALLBACK_USED` (e.g. V2 error + legacy continues)
- `FAILED` (e.g. OpenAI failure)

---

## Backend API

### Response field

```typescript
AiChatResponse.pipelineTrace?: AiPipelineTrace | null
```

Also available on `RagPrepareResponse.traceMetrics` (internal metrics before OpenAI stage).

### Configuration

| Env | Default | Purpose |
|-----|---------|---------|
| `PULSE_AI_TRACE_MODE` | `full` | `full` \| `minimal` \| `off` — server controls exposure |
| `VITE_SHOW_AI_TRACE` | `true` | Frontend panel visibility |

### Security (sanitized server-side)

Never exposed:

- OpenAI API keys, Slack/Jira OAuth tokens
- Authorization headers, DATABASE_URL
- Embedding vectors, raw SQL
- Private evidence text rejected by ACL
- Cross-workspace data

OpenAI errors are categorized (`TIMEOUT`, `RATE_LIMIT`, `PROVIDER_ERROR`, etc.) with redacted messages.

Trace collection failures never break Ask Pulse (`buildAiPipelineTraceSafe`).

---

## Quality Warnings (deterministic)

1. **Latest-run contamination:** `LATEST_STANDUP` query but merged evidence spans multiple `runId` values  
2. **Wrong owner:** Requested user but STANDUP_ANSWER evidence has different `ownerUserId`

These would have made the Karam latest-standup bug immediately visible.

---

## UI

**Component:** `frontend/src/components/ai-workspace/AiPipelineTracePanel.tsx`

- Collapsed by default — **View AI Trace** button expands
- Horizontal connected stepper on desktop (wraps on mobile)
- Click stage → detail panel (status, duration, safe metadata)
- Trace `#REQUESTID` for log correlation
- Timings summary at bottom

Uses existing Pulse dark glass design system. Does not redesign the chat page.

---

## Storage

No new database table. Trace lives in the **live `/chat` response** only. Conversation history reload does not persist trace today (same as `retrievalDiagnostics`).

---

## Tests

| Script | Coverage |
|--------|----------|
| `npm run test:ai-pipeline-trace` | Unit: builder, sanitization, warnings, Jira vs latest |
| `npx ts-node src/ai/workspace/trace/ai-pipeline-trace.integration.spec.ts` | Real RAG prepare + trace for latest standup + SCRUM-9 |

---

## Files

### Created

- `backend/src/ai/workspace/trace/ai-pipeline-trace.types.ts`
- `backend/src/ai/workspace/trace/ai-pipeline-trace.config.ts`
- `backend/src/ai/workspace/trace/ai-pipeline-trace.builder.ts`
- `backend/src/ai/workspace/trace/ai-pipeline-trace.builder.spec.ts`
- `backend/src/ai/workspace/trace/ai-pipeline-trace.integration.spec.ts`
- `frontend/src/components/ai-workspace/ai-pipeline-trace.types.ts`
- `frontend/src/components/ai-workspace/AiPipelineTracePanel.tsx`

### Modified

- `backend/src/ai/workspace/types/workspace-ai.types.ts`
- `backend/src/ai/workspace/rag/rag-pipeline.service.ts`
- `backend/src/ai/workspace/chat/ai-chat.service.ts`
- `frontend/src/components/ai-workspace/ai-workspace.types.ts`
- `frontend/src/components/ai-workspace/ai-chat-display.flags.ts`
- `frontend/src/components/ai-workspace/AiConversationArea.tsx`
- `frontend/src/pages/AiWorkspacePage.tsx`
- `backend/package.json`

**Schema changed:** NO  
**Migration:** NO

---

## Risks

| Risk | Mitigation |
|------|------------|
| Trace not persisted on history reload | Documented; extend conversation metadata later if needed |
| No role-based auth yet | Backend `PULSE_AI_TRACE_MODE` + frontend `VITE_SHOW_AI_TRACE` |
| V2 debug adds minor overhead | Only when trace enabled |
| Dedicated flows (report/detective/vacation) | No trace yet — RAG path only |

---

## Manual Verification

1. Ask: *What blocker did Karam report in the latest standup?*  
   → Temporal SUCCESS, V2 SUCCESS, Live Jira SKIPPED, trace shows run/submission

2. Ask: *Who is assigned to SCRUM-9?*  
   → Temporal SKIPPED, V2 SKIPPED, Live Jira SUCCESS

3. Set `PULSE_AI_TRACE_MODE=off` → `pipelineTrace` null  
4. Set `VITE_SHOW_AI_TRACE=false` → panel hidden
