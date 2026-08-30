# Pulse Jira Hub — Implementation Report

## Summary

The previous single **Jira Integration** card on Overview has been replaced by a full **Jira Hub** at `/jira`. The hub uses live Jira REST API data and persisted Pulse database records. Overview now shows only a compact summary widget.

---

## 1. Files Changed

### Backend

| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | Added `runId`, `cloudId` to `AnswerJiraIssueLink`; added `TeamMemoryDocument` model |
| `backend/prisma/migrations/20260816140000_jira_hub_schema/migration.sql` | Migration for hub schema |
| `backend/src/jira/jira-hub.service.ts` | **New** — aggregation service for all hub sections |
| `backend/src/jira/jira-hub.controller.ts` | **New** — REST endpoints under `/api/jira/hub/*` |
| `backend/src/jira/team-memory.service.ts` | **New** — RAG-ready indexing + search |
| `backend/src/jira/answer-jira-link.service.ts` | Stores `runId`, `cloudId`; indexes team memory on link |
| `backend/src/jira/jira.module.ts` | Registers hub + memory services/controllers |
| `backend/src/jira/jira.service.ts` | OAuth redirect now lands on `/jira` |

### Frontend

| File | Change |
|------|--------|
| `frontend/src/lib/jira-api.ts` | **New** — typed API client for hub endpoints |
| `frontend/src/pages/JiraHubPage.tsx` | **New** — dedicated hub page |
| `frontend/src/components/jira/JiraConnectionCard.tsx` | **New** — compact connection card with ⋮ actions menu |
| `frontend/src/components/jira/JiraProjectsCard.tsx` | **New** — expandable projects + recent issues |
| `frontend/src/components/jira/JiraRecentLinksCard.tsx` | **New** — linked issues table from DB |
| `frontend/src/components/jira/JiraBlockersCard.tsx` | **New** — enhanced blocker register |
| `frontend/src/components/jira/JiraAnalyticsSection.tsx` | **New** — KPIs + status pie chart |
| `frontend/src/components/jira/JiraLinkedStandupsCard.tsx` | **New** — per-issue standup timeline |
| `frontend/src/components/jira/JiraAiInsightsCard.tsx` | **New** — computed insights from real data |
| `frontend/src/components/jira/JiraTeamMemoryCard.tsx` | **New** — search entry point for RAG |
| `frontend/src/components/jira/JiraOverviewWidget.tsx` | **New** — small Overview summary |
| `frontend/src/app/App.tsx` | Added `/jira` route |
| `frontend/src/components/dashboard/AppSidebar.tsx` | Added **Jira** nav item |
| `frontend/src/pages/OverviewPage.tsx` | Replaced full Jira cards with `JiraOverviewWidget` |

---

## 2. New Components Created

- `JiraConnectionCard` — connection status, project/issue counts, ⋮ menu (Sync / Reconnect / Disconnect)
- `JiraProjectsCard` — live projects with expandable recent issues
- `JiraRecentLinksCard` — DB-backed linked issue table
- `JiraBlockersCard` — blocker register with reporter, owner, linked Jira status
- `JiraAnalyticsSection` — KPI cards + status distribution chart
- `JiraLinkedStandupsCard` — standup timeline grouped by issue key
- `JiraAiInsightsCard` — most mentioned, likely blocked, inactive, etc.
- `JiraTeamMemoryCard` — searchable team memory (RAG-ready)
- `JiraOverviewWidget` — compact Overview summary with link to hub

---

## 3. Database Migrations Added

**Migration:** `20260816140000_jira_hub_schema`

- `AnswerJiraIssueLink.runId` → FK to `StandupRun`
- `AnswerJiraIssueLink.cloudId` → Atlassian cloud ID at link time
- Indexes on `runId`, `issueKey`, `createdAt`
- Backfill `runId` from existing submissions
- New table `TeamMemoryDocument` for future RAG indexing

### Relational graph

```
User
  → JiraConnection (OAuth)
  → StandupSubmission
      → Answer
      → AnswerJiraIssueLink (issueKey, runId, cloudId, submissionId)
          → StandupRun
              → CheckIn
              → AiDigest (report)
              → StandupThreadUpdate (Slack thread)
  → PulseBlocker (linkedIssueKey/Url)
  → TeamMemoryDocument (indexed searchable content)
```

---

## 4. API Endpoints Added

All under global prefix `/api`:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/jira/hub/overview` | Connection + project/issue counts + summary KPIs |
| GET | `/api/jira/hub/projects` | Live Jira projects with issue counts + recent issues |
| GET | `/api/jira/hub/linked-issues` | Recent `AnswerJiraIssueLink` rows with check-in/user context |
| GET | `/api/jira/hub/blockers` | Enhanced open blockers with Jira issue status |
| GET | `/api/jira/hub/analytics` | KPIs + status distribution from live Jira issues |
| GET | `/api/jira/hub/linked-standups` | Standup timeline grouped by issue key |
| GET | `/api/jira/hub/insights` | AI insight signals from linked issue activity |
| GET | `/api/jira/hub/memory/search?q=` | Team memory search (indexed + live DB fallback) |

Existing endpoints retained: `/api/auth/jira/*`, `/api/jira/sync`, `/api/jira/projects`, etc.

---

## 5. Frontend Routes Added

| Route | Page |
|-------|------|
| `/jira` | `JiraHubPage` |

Sidebar order: Overview → Check-ins → Run History → Reports → Teams → **Jira** → Settings

OAuth callback redirect: `/jira?jira=connected`

---

## 6. How Jira Data Flows Through Pulse

```
[1] OAuth Connect (Dashboard / Jira Hub)
    User → /api/auth/jira → Atlassian → callback → JiraConnection stored (encrypted tokens)

[2] Live Jira Reads (Hub)
    JiraHubService → JiraService → Atlassian REST API
    Projects, issues, analytics, issue counts

[3] Slack Standup Linking
    User selects issue in Slack picker
    → JiraCacheService resolves issue snapshot
    → AnswerJiraLinkService.linkIssueToQuestion()
        Stores: issueKey, issueId, summary, status, projectKey, issueUrl, cloudId, runId, submissionId, userId
    → TeamMemoryService.indexJiraLink()
    → SlackGateway completes standup (outro + public thread)

[4] Hub Display
    Recent Linked Issues ← AnswerJiraIssueLink (DB)
    Linked Standups ← links + answers + runs (DB)
    Blockers ← PulseBlocker + JiraIssueCacheEntry status (DB)
    Analytics ← live Jira issues + DB link counts
    AI Insights ← computed from link frequency, status, recency (DB)
    Team Memory ← TeamMemoryDocument index + live search fallback

[5] Reports
    Report detail pages continue to show linkedJiraIssues per answer (existing admin API)
```

---

## 7. Future AI + RAG Reuse

| Layer | Purpose |
|-------|---------|
| `AnswerJiraIssueLink` | Structured join between standups and Jira issues |
| `TeamMemoryDocument` | Canonical index row per standup answer, link, report, AI summary |
| `TeamMemoryService.search()` | Text search today; swap backend for vector embeddings later |
| `JiraHubService.getAiInsights()` | Rule-based signals today; replace with LLM scoring using same inputs |

**RAG pipeline (future):**
1. On standup complete / link / report generate → upsert `TeamMemoryDocument`
2. Embed `content` field → vector store
3. Team Memory search card → semantic retrieval + LLM answer
4. AI Insights card → LLM analysis over linked issue timelines

No fabricated values: insights only appear when sufficient linked data exists.

---

## 8. Architectural Decisions

1. **Dedicated hub page vs. Overview card** — Jira is a product surface (projects, links, blockers, analytics, memory). Overview keeps a small widget; full experience lives at `/jira`.

2. **Hub service layer** — `JiraHubService` aggregates DB + API so the frontend makes few focused calls instead of duplicating join logic.

3. **Non-breaking Slack flow** — Issue linking still uses `AnswerJiraIssueLink`; hub adds read APIs and richer stored fields (`runId`, `cloudId`) without changing OAuth or picker behavior.

4. **Team memory as index table** — Separate `TeamMemoryDocument` avoids duplicating standup/report content while providing a stable RAG ingestion point.

5. **Live Jira for analytics/projects** — Counts and charts come from Jira REST API; linked issue tables come from Pulse DB. Clear separation prevents stale UI for Jira-side status.

6. **AI insights as computed signals** — No fake LLM output. Insights are derived from real link counts, Jira status strings, and recency until a model layer is added.

7. **Actions menu on connection card** — Replaces scattered buttons; OAuth scopes removed from UI per product requirement.

---

## 9. Validation Checklist

- [x] Connection card shows live status, user, workspace, project count, issue count, last sync
- [x] Projects loaded from Jira REST API with expandable recent issues
- [x] Recent linked issues from `AnswerJiraIssueLink` with check-in, user, timestamps
- [x] Blockers show reporter, owner, linked issue, status, created time
- [x] Analytics KPIs + status distribution from live Jira data
- [x] Linked standups timeline from submitted answers + links
- [x] AI insights from real linked data only
- [x] Team memory search with backend structure for RAG
- [x] Sidebar Jira navigation
- [x] Overview summary widget only
- [x] Dark mode compatible (existing design tokens)

---

## 10. How to Use

1. Open **Jira** in the sidebar (or connect from Overview widget).
2. Connect Atlassian OAuth if not connected.
3. Use **⋮ → Sync Now** to refresh live Jira data.
4. Browse projects, linked issues, blockers, analytics, standup history, and insights.
5. Use **Team Memory** search to find past standups, links, and reports (indexed on each new Jira link).
