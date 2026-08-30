# AI Retrieval Refactor Report

**Product:** Pulse (Team Pulse / Pulse V2)  
**Document:** Multi-source RAG retrieval pipeline redesign  
**Date:** 2026-08-20  
**Scope:** AI Workspace retrieval only (no unrelated API/surface changes)

---

## 1. Previous architecture

```
Question
  → IntentDetectionService
  → RagPipelineService.refineFiltersForIntent()
       └─ ISSUE_STATUS + issueKey → jiraFieldsOnly = true
  → WorkspaceRetrievalService.retrieve()
       → WorkspaceKnowledgeService.collectSnapshot()
            └─ if jiraFieldsOnly: collectors = [jira, jira_audit] ONLY
       → keyword + optional hybrid ranking
       → enforceJiraFieldAuthority() DROPPED non-Jira hits for ISSUE_STATUS
  → ContextBuilderService (flat “### Source N” list)
  → WorkspacePromptBuilder
  → OpenAI
```

Jira field authority was implemented by **excluding** Slack, Reports, Team Memory, Blockers, and AI history from collection and ranking for status/assignee questions. That prevented wrong Jira field overwrites, but also produced single-source answers.

---

## 2. Problems found

| Problem | Symptom |
|---------|---------|
| Single-source ISSUE_STATUS | “Who is assigned to SCRUM-9?” answered from Jira only — no Slack discussion / reports / memory |
| Team Memory / Reports over-weight | Soft ranking could still surface memory-only narratives for some intents |
| Flat prompt context | LLM received an unordered dump; hard to keep Jira fields vs supporting context separated |
| Fragile collector mapping | `results.slice(0, 10)` assumed fixed collector order; broke when collectors were filtered |
| Incomplete AI history | Only `SlackAiChatLog` was collected; `AiConversationMessage` was not part of RAG |
| Weak pipeline logging | Missing sources-selected / merge / dedupe / rerank / prompt-size counters |

---

## 3. Root causes

1. **`jiraFieldsOnly` hard gate** in `RagPipelineService` and `WorkspaceKnowledgeService.collectSnapshot` limited collectors to Jira + audit.
2. **`enforceJiraFieldAuthority` hard filter** removed supporting documents after ranking for `ISSUE_STATUS`.
3. **Authority confused with exclusivity** — correct rule is “Jira owns ticket fields”; incorrect implementation was “Jira is the only evidence.”
4. **Context builder** did not structure evidence into source sections, so the model could not reliably separate authoritative fields from narrative.

---

## 4. New architecture

True multi-source RAG:

```
Question
  → Intent Detection
  → Determine Relevant Sources (selectRelevantSources)
  → Retrieve from ALL relevant collectors (workspaceId-scoped)
  → Merge Results (force-include Jira + blockers + issue-matched narrative)
  → Deduplicate (issue key / chunk / doc / DB id; prefer Live Jira + newer)
  → Rerank (exact key, Live Jira, fresh cache, recent Slack/standups/reports/blockers)
  → Build Structured Prompt (JIRA / SLACK / STANDUPS / BLOCKERS / REPORTS / TEAM MEMORY / AI HISTORY)
  → Call OpenAI
```

Jira remains **field authority** via:

- Live Jira → else Jira cache
- Ranking pin of `jira_issue` docs
- Structured **JIRA** section first
- Prompt hard rules forbidding overwrite

Supporting sources are **always retrieved** for issue questions (graceful empty if a source has no rows).

---

## 5. Retrieval flow diagram

```
┌─────────────┐
│  Question   │
└──────┬──────┘
       ▼
┌─────────────────┐
│ Intent Detect   │
└──────┬──────────┘
       ▼
┌─────────────────────────┐
│ selectRelevantSources() │  CORE: jira, slack, standups, blockers,
│                         │  reports, team_memory, ai_conversations
└──────┬──────────────────┘
       ▼
┌──────────────────────────────┐
│ collectSnapshot(workspaceId) │  Demo OR Real — never both
│  parallel collectors         │  per-source try/catch (degrade)
└──────┬───────────────────────┘
       ▼
┌──────────────┐     ┌──────────────┐
│ Keyword rank │ ──► │ Hybrid RRF   │ (optional embeddings)
└──────┬───────┘     └──────┬───────┘
       └─────────┬──────────┘
                 ▼
┌────────────────────────┐
│ Merge + Deduplicate    │
└──────────┬─────────────┘
           ▼
┌────────────────────────┐
│ Rerank + Pin Jira      │  (keep supporting docs)
└──────────┬─────────────┘
           ▼
┌────────────────────────┐
│ Structured Context     │
│ JIRA / SLACK / …       │
└──────────┬─────────────┘
           ▼
┌────────────────────────┐
│ Prompt → OpenAI        │
└────────────────────────┘
```

---

## 6. Source priority

### Jira ticket fields (Status, Assignee, Summary, Priority, Sprint, Reporter, Issue Type)

1. **Live Jira** (when OAuth usable)
2. **JiraIssueCacheEntry** (latest cache)
3. **Stop** — never Team Memory / Reports / Slack / Digests / AI history

### Supporting context (soft ranking boosts)

| Intent family | Soft boost order (never exclusion) |
|---------------|-------------------------------------|
| ISSUE_STATUS / ISSUE_ANALYSIS | jira_issue → audit → standups → blockers → reports → team_memory → ai_chat |
| GET_BLOCKERS | blockers → jira → standups → memory → reports |
| GENERAL_QA | jira → standups → blockers → memory → reports → ai_chat |
| SLACK_MEMBERS | users only (roster authority — intentional exception) |

---

## 7. Merge strategy

1. Start from keyword/hybrid ranked hits.
2. Force-merge matching **jira_issue** for the issue key.
3. Force-merge **blockers** when question/intent signals blocked/dependency/waiting/issue key.
4. Soft-merge Team Memory / Reports / Standups / AI chats whose content or metadata matches the issue key.
5. Deduplicate:
   - `jira_issue:{ISSUE_KEY}` (one row per key)
   - `chunk:{chunkId}` / `{entity}:{dbId}` / document `id`
   - Prefer **Live Jira** over cache, then higher score, then newer timestamp

---

## 8. Ranking strategy

Boosts:

- Exact issue key match (+50 / +40 metadata)
- Live Jira / authoritative cache (+200 base, +120 live, +80 authoritative)
- Intent entity soft boosts
- Recency for Slack, standups, reports, blockers
- Soft demote of memory/reports vs Jira for field conflict (−40) — **documents kept**

Pin step places matching `jira_issue` first; all supporting docs remain.

---

## 9. Prompt building strategy

`ContextBuilderService` emits named sections:

```
====================
JIRA
Status / Assignee / Summary / Priority / Sprint / …
====================
SLACK / STANDUPS
Recent Discussion / Relevant Messages
====================
BLOCKERS
Current Blockers / Dependencies
====================
REPORTS
Weekly / Monthly Summary
====================
TEAM MEMORY
Past Blockers / Historical Context
====================
AI HISTORY
Previous Related Questions
====================
```

`WorkspacePromptBuilder` instructs the model to:

- Answer from WORKSPACE CONTEXT only
- Take ticket fields **only** from the JIRA section
- Use other sections as supporting evidence only
- Say Jira is unavailable rather than hallucinate

---

## 10. Workspace isolation

Every collector query filters by `workspaceId` (directly or via User/Team/Run relation).

| Active workspace | Data retrieved |
|------------------|----------------|
| Demo | Demo rows only |
| Real | Real rows only |

No cross-tenant joins. Snapshot cache keys include `workspaceId`. Issue-key queries skip the short TTL cache to avoid stale Live Jira misses.

---

## 11. Jira authority rules

| Field | Allowed source |
|-------|----------------|
| Status | Live Jira → Cache |
| Assignee | Live Jira → Cache |
| Summary | Live Jira → Cache |
| Priority | Live Jira → Cache |
| Sprint | Live Jira → Cache (when present) |
| Reporter | Live Jira → Cache |
| Issue Type | Live Jira → Cache |

Slack, Reports, Team Memory, Standups, and AI History **must never overwrite** these fields. They may add discussion, history, and dependency context only.

---

## 12. Slack behavior

Slack (standups / threads) answers:

- Who mentioned SCRUM-9?
- What was discussed about SCRUM-9?
- What did people say about this issue?

Slack is **contextual evidence only**. It never supplies Status / Assignee / Summary / Priority / Sprint / Reporter.

---

## 13. Team Memory behavior

Used for:

- Past blockers
- Lessons learned
- Historical decisions
- Previous similar issues

**Not** used as live Jira field source. Ranking soft-demotes memory vs Jira when an issue key is present; prompt forbids overwrite.

---

## 14. Reports behavior

Reports (`AiDigest` and related) provide summarized historical evidence (weekly/monthly/sprint). Supporting only — never authoritative issue metadata.

---

## 15. Blockers behavior

Blockers are retrieved when the question references:

- blocked / blocker / blocking
- dependency / waiting / stuck / impediment
- an issue key
- GET_BLOCKERS intent

Merged into final context under the **BLOCKERS** section.

---

## 16. Fallback strategy

| Failure | Behavior |
|---------|----------|
| Live Jira fails | Use latest Jira cache |
| Jira cache missing | Prompt: say Jira information unavailable — no hallucination |
| Slack unavailable / empty | Continue |
| Reports empty | Continue |
| Team Memory empty | Continue |
| AI history empty | Continue |
| Collector throws | Logged as `collector_error`; other sources still used |

Pipeline degrades gracefully; OpenAI is only called after merged context is built (or with an empty-context insufficient path).

---

## 17. Logging added

Pipeline logs (retrieval + RAG prepare):

- Intent
- Workspace ID
- Issue Key
- Sources Selected
- Sources Queried
- Retrieved Documents Count
- Documents After Merge
- Documents After Deduplication
- Documents After Reranking
- Prompt Size
- Final Sources Used

Also retained: Jira field authority pin log (source used for assignee/status), per-collector search logs, hybrid mode metadata.

---

## 18. Tests added

**File:** `backend/src/ai/workspace/retrieval/multi-source-rag.spec.ts`  
**Runner:** `npm run test:ai-retrieval` (includes this suite)

| Question | Expectations | Result |
|----------|--------------|--------|
| Who is assigned to SCRUM-9? | Status + Assignee from Jira; Slack + Reports + Team Memory included; no Demo rows | Pass |
| What happened with SCRUM-9 last week? | Slack + Reports + Standups + Team Memory + Jira merged | Pass |
| What blockers are related to SCRUM-9? | Blockers + Jira + Slack + Reports + Team Memory merged | Pass |

Additional invariants: ISSUE_STATUS is never Jira-only in source selection; SLACK_MEMBERS remains directory-only; prompt enforces Jira authority.

---

## 19. Files modified

| File | Change |
|------|--------|
| `backend/src/ai/workspace/retrieval/source-selection.ts` | **New** — relevant source selection |
| `backend/src/ai/workspace/retrieval/workspace-retrieval.service.ts` | Multi-source merge / dedupe / rerank / logging; soft Jira pin |
| `backend/src/ai/workspace/retrieval/multi-source-rag.spec.ts` | **New** — integration tests |
| `backend/src/ai/workspace/knowledge/workspace-knowledge.service.ts` | Removed `jiraFieldsOnly` collector exclusion; added `collectAiConversations`; fixed bucket mapping by collector key |
| `backend/src/ai/workspace/rag/rag-pipeline.service.ts` | Source selection; never sets `jiraFieldsOnly` |
| `backend/src/ai/workspace/context/context-builder.service.ts` | Structured multi-source sections |
| `backend/src/ai/workspace/prompts/workspace-prompt.builder.ts` | Jira authority + multi-section guidance |
| `backend/src/ai/workspace/types/workspace-ai.types.ts` | `ai_history` source; sections; pipeline diagnostics |
| `backend/src/ai/workspace/response/chat-response.formatter.ts` | `ai_history` label |
| `backend/src/ai/workspace/response/response-renderer.service.ts` | `ai_history` label |
| `backend/package.json` | Wire new test into `test:ai-retrieval` |
| `docs/AI_RETRIEVAL_REFACTOR_REPORT.md` | This report |

APIs (`POST /api/ai/workspace/chat`, etc.) were **not** changed.

---

## 20. Summary of improvements

- AI **never** answers issue questions from Slack-only, Team Memory-only, or Reports-only collection paths.
- Every issue-oriented question retrieves **all relevant** workspace sources before the LLM call.
- **Jira remains source of truth** for ticket fields (Live → Cache), enforced by pin + structured section + prompt rules — not by dropping context.
- Slack adds discussion; Reports add summaries; Team Memory adds history; Blockers add dependencies; AI Conversation History adds continuity.
- Evidence is **merged, deduplicated, and reranked** into one grounded, sectioned prompt.
- **Demo / Real isolation** by `workspaceId` is preserved; no cross-workspace leakage.
- Failures degrade per source; detailed pipeline logging and integration tests lock the new behavior.

**Success criteria:** met for multi-source retrieval design, Jira authority, graceful fallbacks, workspace isolation, logging, and tests.
