# AI Implementation Report

**Date:** August 19, 2026  
**Module:** Pulse AI Workspace  
**Scope:** Hybrid retrieval, embeddings, intent, conversations, confidence, detective, reports, evaluation, performance

---

## Executive Summary

This release upgrades the AI Workspace from **keyword-only RAG** to **hybrid keyword + OpenAI embedding retrieval**, while keeping the existing Nest architecture, multi-workspace isolation, short-vs-detective response depth, and Demo Workspace behavior intact.

**pgvector is not available** on the local Postgres install (`CREATE EXTENSION vector` fails with `0A000`). Embeddings are therefore stored as **JSON float arrays** in `KnowledgeEmbedding`, with **cosine similarity computed in-process**. Conversations are now **persisted in PostgreSQL** so chat history survives restarts. Intent classification, confidence scoring, Project Detective patterns, executive reports, and an offline evaluation suite were also improved.

---

## Features Completed

- Hybrid retrieval (keyword + semantic merge via Reciprocal Rank Fusion)
- Vector embeddings for searchable knowledge (JSON storage + OpenAI `text-embedding-3-small`)
- Improved intent classification (`ISSUE_STATUS`, `ROOT_CAUSE_ANALYSIS`, `SPRINT_REPLAY`, `EXECUTIVE_REPORT`, etc.)
- Clarification-only vacation pending continuation (unchanged policy, now persisted)
- Improved confidence scoring (sources, semantic similarity, consistency, missing-info)
- Project Detective pattern / root-cause expansions (ownership churn, handoff gaps)
- Persisted AI conversations (`AiConversation`, `AiConversationMessage`)
- Executive report type + UI/export labeling
- Offline evaluation pipeline (`npm run test:ai-workspace-eval`)
- Snapshot TTL cache to reduce duplicate collector fan-out
- Migration `20260819120000_ai_embeddings_conversations`

---

## Features Improved

| Area | Change |
|------|--------|
| Retrieval | Still collects all workspace sources; ranks with keyword scores **and** embedding similarity; RRF fusion |
| Intent | Clearer separation of status vs short analysis vs detective vs replay vs executive vs vacation vs members |
| Conversation memory | L1 in-memory cache + Postgres restore with workspace isolation |
| Confidence | Uses hybrid signals instead of chunk count alone |
| Detective | Extra patterns/causes; short answers still for non-explicit questions |
| Reports | Dedicated `executive` report with snapshot section; better PDF print styling |
| Performance | One knowledge snapshot per retrieve; 5s snapshot cache; embedding upsert skips unchanged hashes |

---

## Remaining TODO

- [ ] Install/enable **pgvector** in production Postgres and switch storage to native `vector` + ANN indexes
- [ ] Background batch embedding indexer (cron) instead of lazy index-on-query only
- [ ] Wire web UI **Send to Slack** for reports
- [ ] Persist conversation list / history browser in the frontend
- [ ] Live eval harness against Demo Workspace with labeled answer quality scores
- [ ] Calibrate confidence thresholds on production traces
- [ ] Cap embedding table growth / reindex strategies for very large tenants
- [ ] Optional LLM-assisted intent when rule scores are ambiguous

---

## Architecture Changes

No rewrite of the orchestrator. Existing flow remains:

`WorkspaceAiController` → `AiChatService` → intent / dedicated routes / `RagPipelineService` → OpenAI → formatter

**New services:**

- `OpenAiEmbeddingProvider` — OpenAI embeddings API
- `KnowledgeEmbeddingService` — index + semantic search over `KnowledgeEmbedding`

**Updated services:**

- `WorkspaceRetrievalService` — hybrid merge
- `ConversationMemoryService` — Postgres persistence
- `IntentDetectionService` — richer intents
- `ChatResponseFormatter` — richer confidence
- `WorkspaceKnowledgeService` — snapshot TTL cache

Multi-workspace isolation unchanged: all embedding/conversation rows are keyed by `workspaceId`.

---

## Retrieval Improvements

1. Resolve workspace + filters (issue key, user, dates, synonym tokens).  
2. **Single** `collectSnapshot` (cached ~5s) across Jira, audits, standups, threads, blockers, updates, digests/reports, team memory, etc.  
3. **Keyword rank** (existing scoring + soft intent boosts).  
4. If AI embeddings are enabled:  
   - `ensureIndexed` upserts missing/changed document embeddings  
   - `searchSimilar` embeds the query and ranks by cosine similarity  
5. **RRF merge** of keyword + semantic ranked IDs → fused hit list with `keywordScore` / `semanticScore`.  
6. Diagnostics include `hybrid.mode` = `keyword_only` | `hybrid`.

If embeddings are disabled (no API key / flag), behavior falls back to keyword-only — **no breakage**.

---

## Vector Search

| Question | Answer |
|----------|--------|
| Implemented? | **Yes** (application-level) |
| pgvector? | **No** — extension not installed on this Postgres (`ERROR: extension "vector" is not available`) |
| Where stored? | Table `KnowledgeEmbedding.embedding` as **JSONB number[]** |
| How generated? | OpenAI Embeddings API via `OpenAiEmbeddingProvider` (default model `text-embedding-3-small`, override `OPENAI_EMBEDDING_MODEL`) |
| Who uses them? | `KnowledgeEmbeddingService` → `WorkspaceRetrievalService` hybrid merge |
| Why not pgvector? | Host Postgres lacks the extension binaries; enabling requires installing pgvector on the DB server, then a follow-up migration to `vector` columns + indexes |

---

## Intent Detection

Rule-based (deterministic) with hard overrides first:

1. Explicit detective / root-cause → `PROJECT_DETECTIVE` or `ROOT_CAUSE_ANALYSIS`  
2. Sprint replay → `SPRINT_REPLAY`  
3. Decision replay → `DECISION_REPLAY`  
4. Executive report → `EXECUTIVE_REPORT`  
5. Soft phrase scoring for blockers, members, activity, standups, vacation, reports, issue status, short issue analysis, team memory  
6. Fallback: issue key alone → `ISSUE_STATUS`; named user → `GET_USER_ACTIVITY`; else `GENERAL_QA`

Intent always runs **before** vacation pending continuation.

---

## Conversation Flow

```
User question
 → resolve workspace
 → ensureLoaded conversation (Postgres + cache)
 → detect intent
 → if vacationPending: continue only on date-like replies, else clear
 → route: vacation / detective|root-cause|replay / report|executive / RAG
 → RAG: hybrid retrieve → context → prompt → OpenAI → confidence format
 → persist turns to AiConversationMessage
 → response (answer + sources + confidence [+ report])
```

---

## Database Changes

### New tables

| Table | Purpose |
|-------|---------|
| `KnowledgeEmbedding` | Per-document embedding vectors (JSON) |
| `AiConversation` | Persisted chat session + `vacationPending` JSON |
| `AiConversationMessage` | User/assistant turns |

### New columns

All new tables (no alterations to existing business tables).

### New indexes

- `KnowledgeEmbedding(workspaceId, sourceType, sourceId)` unique  
- `KnowledgeEmbedding(workspaceId)`, `(workspaceId, entityType)`, `(contentHash)`  
- `AiConversation(workspaceId)`, `(updatedAt)`  
- `AiConversationMessage(conversationId, createdAt)`

Migration: `prisma/migrations/20260819120000_ai_embeddings_conversations/`

---

## Performance

- Avoids a second full collector pass: keyword + semantic share one snapshot  
- Snapshot TTL cache (5s) collapses duplicate fan-out in rapid requests  
- Embedding upserts skip unchanged `contentHash`  
- Semantic search currently scans up to 2000 workspace embeddings in memory (acceptable for current tenant sizes; pgvector ANN is the next scale step)

---

## Files Modified

| File | Reason |
|------|--------|
| `backend/prisma/schema.prisma` | Embedding + conversation models |
| `backend/prisma/migrations/20260819120000_ai_embeddings_conversations/migration.sql` | DDL |
| `backend/src/ai/ai.module.ts` | Register embedding providers |
| `backend/src/ai/workspace/types/workspace-ai.types.ts` | New intents/report type + hybrid diagnostics |
| `backend/src/ai/workspace/retrieval/embedding.util.ts` | Cosine / RRF / hashing |
| `backend/src/ai/workspace/retrieval/openai-embedding.provider.ts` | OpenAI embeddings |
| `backend/src/ai/workspace/retrieval/knowledge-embedding.service.ts` | Index + semantic search |
| `backend/src/ai/workspace/retrieval/workspace-retrieval.service.ts` | Hybrid retrieval |
| `backend/src/ai/workspace/intent/intent-detection.service.ts` | Better intents |
| `backend/src/ai/workspace/memory/conversation-memory.service.ts` | Postgres persistence |
| `backend/src/ai/workspace/chat/ai-chat.service.ts` | ensureLoaded + new routes + hybrid confidence inputs |
| `backend/src/ai/workspace/response/chat-response.formatter.ts` | Confidence formula |
| `backend/src/ai/workspace/context/context-builder.service.ts` | New intent priorities |
| `backend/src/ai/workspace/prompts/workspace-prompt.builder.ts` | New intent guidance |
| `backend/src/ai/workspace/rag/rag-pipeline.service.ts` | ISSUE_STATUS filter refine |
| `backend/src/ai/workspace/knowledge/workspace-knowledge.service.ts` | Snapshot cache |
| `backend/src/ai/workspace/report/report-generation.service.ts` | Executive reports |
| `backend/src/ai/workspace/report/report-metrics.service.ts` | Executive time window |
| `backend/src/ai/workspace/analysis/pattern-detector.service.ts` | More patterns/causes |
| `backend/src/ai/workspace/analysis/response-depth.spec.ts` | Updated expectations |
| `backend/src/ai/workspace/evaluation/run-workspace-eval.ts` | Eval pipeline |
| `backend/package.json` | `test:ai-workspace-eval` script |
| `frontend/.../ai-workspace.types.ts` | `executive` report type |
| `frontend/.../AiReportCard.tsx` | Executive label |
| `frontend/.../report-display.util.ts` | PDF styling |
| `docs/AI_IMPLEMENTATION_REPORT.md` | This report |
| `backend/scripts/check-pgvector.ts` | pgvector availability probe |

---

## Testing

| Suite | Result |
|-------|--------|
| `npx tsc --noEmit` | Pass (0 errors) |
| `npm run test:ai-workspace-eval` | Pass — intentAccuracy 1.0, detectiveGateAccuracy 1.0 |
| `npm run test:ai-retrieval` | Pass after updating sprint-replay expectation |
| pgvector probe | Confirmed unavailable; JSON fallback used |
| `prisma migrate deploy` | Applied `20260819120000_ai_embeddings_conversations` |
| `prisma generate` | Success |

End-to-end chat with live OpenAI embeddings requires `PULSE_AI_ENABLED=true` and `OPENAI_API_KEY`.

---

## Remaining Limitations

- No native vector indexes (pgvector missing) — similarity is O(n) per workspace  
- Lazy embedding on retrieve can add latency on cold workspaces  
- Conversation history UI still session-oriented on the frontend  
- Send-to-Slack from web report card still stubbed  
- Confidence bands are heuristic, not calibrated probabilities  
- Eval suite covers intent/policy/utils, not full answer quality against gold labels  

---

## Recommendations

1. Install **pgvector** on staging/production Postgres and migrate `KnowledgeEmbedding.embedding` to `vector(1536)` with HNSW/IVFFlat.  
2. Add a scheduled **embedding reindex** job after standup/Jira syncs.  
3. Build a Demo Workspace gold-answer eval set and track retrieval hit-rate + answer faithfulness.  
4. Persist and surface conversation history in the AI Workspace UI.  
5. Complete **Send to Slack** using the existing Slack file upload path.  
6. Consider a light LLM intent fallback when rule confidence &lt; 0.45.

---

*Architecture preserved. Multi-workspace isolation preserved. Keyword retrieval preserved and extended — not replaced.*
