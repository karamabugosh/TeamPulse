# Jira Standup Issue Linking — Phase 2 Implementation Report

## Overview

Phase 2 links **real Jira issues** to Slack standup answers without modifying the existing Jira OAuth flow. Users can:

1. Answer standup questions normally (text, buttons, etc.)
2. Optionally link one or more Jira issues via a Slack picker
3. See linked issues on the dashboard run report

**OAuth was not changed.** All Jira reads use the stored per-user OAuth token on the backend only.

---

## 1. Files Modified

| File | Change |
|------|--------|
| `backend/prisma/schema.prisma` | Added `AnswerJiraIssueLink` model and relations |
| `backend/src/jira/jira.service.ts` | Added `searchIssuesByQuery()` |
| `backend/src/jira/jira-api.controller.ts` | Added `GET /api/jira/issues/search?q=` |
| `backend/src/jira/jira.module.ts` | Registered `AnswerJiraLinkService` |
| `backend/src/slack/slack-checkin.views.ts` | Link Jira Issue Block Kit blocks + confirmation |
| `backend/src/slack/jira-slack.listener.ts` | Picker options + multi-select link handler |
| `backend/src/slack/slack.gateway.ts` | Shows link picker when user has Jira connected |
| `backend/src/jira/jira-standup-hook.service.ts` | Added `shouldShowJiraLinkPicker()` |
| `backend/src/collection/collection.service.ts` | Attaches pending links when answer is saved |
| `backend/src/admin/admin.service.ts` | Returns `linkedJiraIssues` per answer in run reports |
| `frontend/src/lib/answer-semantics.ts` | Extended `FormattedAnswer` type |
| `frontend/src/pages/ReportDetailPage.tsx` | Renders linked Jira issues per answer |

---

## 2. Files Created

| File | Purpose |
|------|---------|
| `backend/prisma/migrations/20260816120000_answer_jira_issue_links/migration.sql` | DB migration |
| `backend/src/jira/answer-jira-link.service.ts` | Normalized issue link CRUD |

---

## 3. Database Changes

### New table: `AnswerJiraIssueLink`

Normalized relation (not a JSON blob on `Answer`):

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID | Primary key |
| `userId` | FK → User | Who linked the issue |
| `submissionId` | FK → StandupSubmission | Standup session |
| `questionId` | FK → Question | Which question |
| `answerId` | FK → Answer (nullable) | Set when text answer is saved |
| `issueId` | String | Jira issue ID |
| `issueKey` | String | e.g. `SCRUM-6` |
| `summary` | String | Snapshot at link time |
| `status` | String? | Snapshot at link time |
| `assigneeName` | String? | From cache when available |
| `projectKey` | String? | Project key |
| `issueUrl` | String? | Browse URL |
| `capturedAt` | DateTime | When snapshot was taken |

**Unique constraint:** `(submissionId, questionId, issueKey)` — prevents duplicate links.

**Why normalized:** Enables querying, indexing, dashboard joins, and run history without parsing JSON.

---

## 4. Jira REST Endpoints Used

All calls use **Jira REST API v3** with the connected user's OAuth token:

| Jira API | Used by |
|----------|---------|
| `POST /rest/api/3/search/jql` | `searchIssues()`, `searchIssuesByQuery()`, picker cache |
| `GET /rest/api/3/issue/{key}` | Issue lookup / enrichment |

### Pulse API endpoints (backend proxy)

| Method | Route | Returns |
|--------|-------|---------|
| `GET` | `/api/jira/issues` | All workspace project issues |
| `GET` | `/api/jira/my-issues` | Current user's assigned issues |
| `GET` | `/api/jira/issues/search?q=` | Text/key search (real Jira JQL) |

**Search logic:**
- Empty query → assigned issues (`assignee = currentUser()`)
- Issue key pattern → `key = "SCRUM-6"`
- Otherwise → `text ~ "query" ORDER BY updated DESC`

**Response fields:** `id`, `key`, `summary`, `status`, `assignee`, `projectKey`, `projectName`, `issueType`, `priority`, `updatedAt`, `issueUrl`

OAuth tokens are **never** sent to the frontend.

---

## 5. Slack Block Kit Components Used

| Component | Usage |
|-----------|--------|
| `section` | Question text, "🔗 Link Jira Issue" label, confirmation |
| `actions` | Container for picker |
| `multi_external_select` | Dynamic Jira issue search (multiple selection) |
| `context` | "Reply below with your answer." hint |
| `external_select` | Existing `ISSUE_REF` question type (preserved) |

**Action ID:** `checkin_link_jira:{submissionId}:{questionId}`

**Options loading:** Bolt `app.options()` → backend cache → Jira JQL fallback (same as existing picker infrastructure).

**Confirmation after selection:**

```
✅ Linked:
• SCRUM-6
  Implement AI Report Generation
```

---

## 6. How Issue Linking Works

```
Slack standup question posted
    ↓
If user has Jira connected → show "Link Jira Issue" multi_external_select
    ↓
User searches/selects issues (does NOT replace their text answer)
    ↓
AnswerJiraIssueLink rows upserted (submissionId + questionId + issueKey)
    ↓
Slack confirmation message posted in DM thread
    ↓
User replies with text answer in thread (normal flow)
    ↓
CollectionService.submitAnswer() saves Answer.text
    ↓
attachPendingLinksToAnswer() sets answerId on linked rows
```

**Key design decision:** Linking is **additive**. The user's text answer and linked issues are stored separately. Linking can happen before or after the text reply.

---

## 7. How Data Is Stored

1. **Picker selection** → `AnswerJiraLinkService.replaceLinksForQuestion()` upserts rows in `AnswerJiraIssueLink`
2. **Text answer submitted** → `Answer` row with `text` + optional `structuredValue` (existing behavior)
3. **After answer save** → pending links get `answerId` attached

Each link stores a **snapshot** (summary, status, URL) so historical reports remain readable even if Jira changes later.

---

## 8. How the Dashboard Reads It

**API:** `GET /api/admin/reports/by-run/:runId` (and `/api/admin/reports/:id`)

**Backend:** `AdminService.buildParticipantsFromSubmissions()` joins `StandupSubmission.jiraIssueLinks` grouped by `questionId` and attaches to each answer:

```json
{
  "question": "What did you work on yesterday?",
  "answer": "Finished backend implementation",
  "linkedJiraIssues": [
    {
      "issueKey": "SCRUM-6",
      "summary": "Implement AI Report Generation",
      "status": "In Progress",
      "issueUrl": "https://..."
    }
  ]
}
```

**Frontend:** `ReportDetailPage` (`/reports/run/:runId`) renders a "Linked Jira Issues" section under each answer with clickable Jira links.

---

## 9. How to Test Locally

### Prerequisites
- Backend: `http://localhost:3000`
- Frontend: `http://localhost:5173`
- Jira OAuth connected (Overview → Jira card shows Connected)
- Slack Socket Mode running

### Steps

1. **Verify Jira APIs**
   ```bash
   curl http://localhost:3000/api/auth/jira/status
   curl "http://localhost:3000/api/jira/issues/search?q=implement"
   curl http://localhost:3000/api/jira/issues?maxResults=5
   ```

2. **Start a standup run** from Check-ins page or scheduler.

3. **Open Slack DM** for the standup thread.

4. **Confirm UI:** Each question shows:
   - Question text
   - 🔗 Link Jira Issue → Search... (multi-select)
   - "Reply below with your answer."

5. **Select issues** from picker → confirmation message appears.

6. **Reply with text** in thread → standup continues normally.

7. **View run report:** `/reports/run/{runId}` → linked issues appear under each answer.

### Verified in this session

| Check | Result |
|-------|--------|
| Backend build | PASSED |
| Frontend build | PASSED |
| Jira OAuth status | PASSED (`connected: true`) |
| `GET /api/jira/issues/search?q=implement` | PASSED (real issues returned) |
| `GET /api/jira/issues` | PASSED |
| Slack picker (live) | NOT TESTED (requires live Slack interaction) |
| Dashboard linked issues display | NOT TESTED (requires completed run with links) |

---

## 10. Remaining Work

| Item | Status |
|------|--------|
| Live Slack end-to-end test (picker → save → dashboard) | Manual test required |
| Per-Slack-user Jira OAuth for all team members | Dashboard OAuth binds to first workspace user; Slack users should connect via `/api/auth/jira?slackUserId=U…` |
| Linked issues in CSV/PDF export | Not added in this phase |
| Check-in history table issue count column | Not added; full detail available on report page |
| Issue link removal UI in Slack | Re-selecting replaces links for that question |

---

## Architectural Decisions

1. **Normalized table over JSON** — Required by spec; enables dashboard queries and run history without parsing `Answer.structuredValue`.

2. **Separate from ISSUE_REF question type** — Phase 2 adds linking to *all* questions via "Link Jira Issue" button. Existing `ISSUE_REF` type preserved for questions configured as Jira-only answers.

3. **multi_external_select** — Supports linking multiple issues per question while keeping text answers independent.

4. **No Jira writes** — Phase 2 is read-only for Jira. Existing approve/write flow from prior integration is untouched but out of scope for this phase.

5. **OAuth untouched** — All changes are additive services/endpoints; `JiraController` and token handling unchanged.

6. **Graceful degradation** — If Jira is not connected, link picker is hidden; standup works as before.

---

*Report generated after Phase 2 implementation. Location: `pulse/JIRA_STANDUP_LINKING_REPORT.md`*
