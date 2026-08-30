# Unit Test Report — JiraStandupHookService

**Date:** August 31, 2026  
**Branch:** `karam-final1`  
**Spec file:** `backend/src/jira/jira-standup-hook.service.unit.spec.ts`

---

## Service Overview

`JiraStandupHookService` bridges standup question delivery and post-submission flows with Jira. It decides when to show issue pickers, prepares questions for Slack delivery, creates blockers from modal answers after submission, proposes Jira actions, and formats issue-ref answers for digests.

### Public methods

| Method | Purpose |
|--------|---------|
| `shouldRenderIssuePicker` | Whether an ISSUE_REF question should use the Jira picker |
| `shouldShowJiraLinkPicker` | Whether a Slack user can link Jira |
| `isWorkspaceJiraConnected` | Workspace-level Jira connection status |
| `prepareQuestionForDelivery` | Downgrade ISSUE_REF to FREE_TEXT or refresh cache |
| `afterSubmissionCompleted` | Post-submission blocker + Jira proposal hook |
| `formatAnswerForDigest` | Render issue-ref snapshots for digest text |

---

## Dependencies

| Dependency | Role |
|------------|------|
| `PrismaService` | Load user and standup submission with answers |
| `JiraService` | User resolution, connection checks, workspace status |
| `JiraCacheService` | Refresh issue cache before picker delivery |
| `JiraIssueRefService` | Read issue snapshots from structured answers |
| `JiraBlockerService` | Create blockers and propose Jira actions |
| `extractBlockerDetailsFromAnswer` | Parse blocker modal payload (mocked) |

---

## Mock Strategy

- **NestJS TestingModule** with `useValue` stubs for all five injected services.
- **`jest.mock('./jira-issue-payload.util')`** — isolate blocker parsing; control title/description/severity via `blockerDetails()` helper.
- **Prisma** — mock `user.findUnique` and `standupSubmission.findUnique` with inline submission fixtures.
- **Logger** — spy on private `logger.warn` for exception-path assertions.
- **No real DB, Slack, or Jira** — all I/O is mocked.

---

## Test Cases (34 tests)

### `shouldRenderIssuePicker` (5)
- Non ISSUE_REF → false
- Unresolved Slack user → false
- Connected / disconnected user
- Sync error swallowed → false

### `shouldShowJiraLinkPicker` (2)
- Linked user → true
- Synchronous throw → false

### `isWorkspaceJiraConnected` (3)
- Connected / disconnected workspace
- Rejected promise → false

### `prepareQuestionForDelivery` (5)
- Non ISSUE_REF unchanged
- ISSUE_REF downgraded to FREE_TEXT when picker unavailable
- Cache refresh on picker success
- Cache refresh failure swallowed
- No refresh when second resolve returns null

### `afterSubmissionCompleted` (17)
- User / submission not found → early return
- Skip: no modal blocker, missing blocker object, non-object blocker, null structured value
- Skip: empty title and description
- Process: title-only or description-only blockers
- Create blocker without Jira proposal
- Linked issue key from `jiraIssue` or snapshot fallback
- Proposal: `add_comment` (with/without issue key), `create_issue`
- No proposal returned → skip callback
- Outer catch: Error and non-Error logging

### `formatAnswerForDigest` (2)
- Snapshot → formatted display string
- No snapshot → raw text

---

## Exception Cases

| Scenario | Expected behavior |
|----------|-------------------|
| Jira lookup throws in picker checks | Return `false`, never propagate |
| Cache refresh fails during delivery | Swallow error, return question |
| User/submission missing | Silent return |
| Any error in `afterSubmissionCompleted` | Log warning, never fail standup |
| Non-Error thrown in hook | Log via `String(error)` |

---

## Coverage Achieved

| Metric | Target | Result |
|--------|--------|--------|
| Statements | 100% | **100%** |
| Branches | 100% | **100%** |
| Functions | 100% | **100%** |
| Lines | 100% | **100%** |

---

## Lessons Learned

1. **`shouldShowJiraLinkPicker` lacks `await`** — its `try/catch` only catches synchronous throws from `hasJiraForSlackUser`, not rejected promises. Test accordingly.
2. **Modal blocker gate** — `hasModalBlocker` requires `blocked === true`, a truthy `blocker`, and `typeof blocker === 'object'`; array/string blockers are skipped without calling extract.
3. **Linked issue resolution** — `details.jiraIssue ?? linkedSnapshot?.issueKey ?? null` needs separate tests for each nullish path.
4. **Helper factory** — `blockerDetails()` keeps `ExtractedBlockerDetails` mocks type-safe and DRY across many submission scenarios.

---

## Project Impact

| Metric | Before | After | Δ |
|--------|--------|-------|---|
| Statements | 8.38% | 8.84% | +0.46 pp |
| Branches | 3.88% | 4.22% | +0.34 pp |
| Functions | 5.53% | 5.85% | +0.32 pp |
| Lines | 8.02% | 8.49% | +0.47 pp |

**Statements covered by this file:** 72 (was 0%)
