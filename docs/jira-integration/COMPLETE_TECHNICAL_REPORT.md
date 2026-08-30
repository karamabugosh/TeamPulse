# Pulse Jira Integration — Complete Technical Implementation Report

This document explains the entire Jira integration implemented in Pulse: OAuth connection from the dashboard, live Jira API access, Slack issue pickers, standup issue linking, blocker automation, and dashboard reporting. It is written for someone who did not write the code and needs to understand every layer well enough to explain it in a technical interview.

**Live environment reference:** Jira site `karamwaleed70.atlassian.net`, project key `SCRUM`, sample issues **SCRUM-6**, **SCRUM-7**, **SCRUM-8**.

---

## Table of Contents

1. [Overall Architecture](#1-overall-architecture)
2. [Files Changed](#2-files-changed)
3. [OAuth Implementation](#3-oauth-implementation)
4. [Environment Variables](#4-environment-variables)
5. [Backend Flow](#5-backend-flow)
6. [Jira API Calls](#6-jira-api-calls)
7. [Database](#7-database)
8. [Slack Integration](#8-slack-integration)
9. [Issue Selection](#9-issue-selection)
10. [Security](#10-security)
11. [Error Handling](#11-error-handling)
12. [Sequence Diagram](#12-sequence-diagram)
13. [Code Walkthrough](#13-code-walkthrough)
14. [Final Summary](#14-final-summary)
15. [Learning Section](#15-learning-section)

---

## 1. Overall Architecture

### End-to-end flow (text sequence)

```
[1] USER OPENS PULSE DASHBOARD
    Browser loads React app at http://localhost:5173
    Overview page renders JiraIntegrationCard
    Card calls GET /api/auth/jira/status
    Backend checks JiraConnection table → returns { connected: false }

[2] USER CLICKS "Connect Jira"
    Browser navigates to GET /api/auth/jira
    (Full URL: http://localhost:3000/api/auth/jira)

[3] OAUTH STARTS
    JiraController.startOAuth() calls JiraService.buildAuthorizationRedirectUrl()
    Backend:
      - Resolves Workspace record (Pulse must have Slack installed first)
      - Resolves Pulse User id to attach connection to
      - Builds signed OAuth state (workspaceId + userId + nonce + expiry)
      - Redirects browser to Atlassian authorize URL:
        https://auth.atlassian.com/authorize
          ?audience=api.atlassian.com
          &client_id=...
          &scope=read:jira-work write:jira-work read:jira-user offline_access
          &redirect_uri=http://localhost:3000/api/auth/jira/callback
          &state=<signed-payload>
          &response_type=code
          &prompt=consent

[4] USER AUTHORIZES ATLASSIAN
    Atlassian login/consent screen
    User grants Pulse access to their Jira workspace

[5] BACKEND RECEIVES CALLBACK
    Atlassian redirects to:
      GET /api/auth/jira/callback?code=...&state=...
    JiraController.oauthCallback() calls JiraService.handleOAuthCallback()

[6] TOKEN EXCHANGE
    Backend POSTs to https://auth.atlassian.com/oauth/token
    Receives:
      - access_token
      - refresh_token
      - expires_in
      - scope

[7] CLOUD ID RETRIEVED
    Backend GETs https://api.atlassian.com/oauth/token/accessible-resources
    Finds Jira site resource → cloudId (e.g. e874a9c5-e5af-48e7-97cc-356cea9c3aa2)
    siteName = pulse-team, siteUrl = https://karamwaleed70.atlassian.net

[8] USER INFORMATION RETRIEVED
    Backend GETs:
      https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/myself
    Receives accountId, displayName (e.g. "Karam Waleed")

[9] TOKENS STORED (ENCRYPTED)
    JiraConnection row upserted in PostgreSQL:
      - accessToken (AES-256-GCM encrypted)
      - refreshToken (encrypted)
      - cloudId, atlassianAccountId, siteName, siteUrl
      - workspaceId, userId
    Browser redirected to:
      http://localhost:5173/overview?jira=connected

[10] STANDUP RUN STARTS IN SLACK
    Scheduler triggers check-in run
    SlackGateway sends DM to user with standup questions
    JiraStandupHookService checks if Jira is connected
    If yes → buildDmQuestionMessage() embeds "Link Jira Issue" external_select

[11] USER OPENS "Select Jira Issue" DROPDOWN
    Slack sends block_suggestion event via Socket Mode
    JiraSlackListener.handleIssuePickerOptions() runs:
      - resolveJiraActingUserId(slackUserId)
      - refreshUserCache(userId) → calls Jira API
      - searchPickerOptions(userId, query)
      - ack({ options: [{ text: "SCRUM-7 • Slack Thread Integration", value: "SCRUM-7" }, ...] })

[12] BACKEND LOADS ISSUES FROM JIRA
    JiraCacheService.refreshUserCache():
      GET projects → discovers "SCRUM"
      POST /rest/api/3/search/jql
        jql: project in ("SCRUM") ORDER BY updated DESC
      Returns SCRUM-6, SCRUM-7, SCRUM-8, SCRUM-9, SCRUM-10, ...
    Issues cached in JiraIssueCacheEntry table

[13] SLACK RECEIVES OPTIONS
    Slack renders dropdown with real issue labels

[14] USER SELECTS SCRUM-7
    Slack sends block_actions event
    JiraSlackListener action handler:
      - resolvePickerValue("SCRUM-7") → full JiraIssueSnapshot
      - AnswerJiraLinkService.linkIssueToQuestion()
      - INSERT/UPDATE AnswerJiraIssueLink row

[15] THREAD UPDATED
    SlackService.postMessage() in same thread:
      "✅ Linked: • SCRUM-7 — Slack Thread Integration" (clickable link)

[16] USER SUBMITS TEXT ANSWER
    User replies in thread with standup answer
    CollectionService.submitAnswer() saves Answer
    attachPendingLinksToAnswer() links AnswerJiraIssueLink.answerId

[17] DASHBOARD REPORT
    Admin API includes jiraIssueLinks per submission
    ReportDetailPage shows "Linked Jira Issues" under each answer
```

### Architecture layers

| Layer | Technology | Role |
|-------|-----------|------|
| Dashboard UI | React + Vite | Connect/disconnect Jira, view linked issues in reports |
| Backend API | NestJS on port 3000, prefix `/api` | OAuth, Jira REST proxy, report data |
| Slack | Bolt + Socket Mode | Interactive pickers, issue linking, blocker proposals |
| Database | PostgreSQL + Prisma | Tokens, cache, links, audit |
| External | Atlassian OAuth + Jira Cloud REST API | Auth and issue data |

---

## 2. Files Changed

### Backend — Jira module (`backend/src/jira/`)

#### `jira.service.ts`

**Why it exists:** Central brain for all Jira operations.

**Responsibilities:**
- OAuth URL building and callback handling
- Token encryption/decryption and refresh
- All Jira REST API calls
- Resolving which Pulse user acts as Jira for a Slack user

**Key functions:**

| Function | Purpose |
|----------|---------|
| `buildAuthorizationRedirectUrl()` | Starts OAuth |
| `handleOAuthCallback()` | Completes OAuth, stores connection |
| `getConnectionStatus()` | Dashboard status card |
| `disconnect()` | Removes connection |
| `getCurrentJiraUser()` | Returns connected Atlassian profile |
| `getProjects()` / `getIssues()` / `getMyIssues()` | Dashboard/API issue browsing |
| `getVisibleIssuesForUser()` | Loads all visible project issues for Slack picker |
| `searchIssuesForUser()` | JQL search per user |
| `lookupIssueForUser()` | Fetch single issue by key |
| `addCommentForUser()` / `createIssueForUser()` | Blocker automation |
| `resolveJiraActingUserId()` | Maps Slack user → Jira OAuth user |
| `callJiraApi()` | Generic authenticated fetch wrapper |
| `refreshAccessToken()` | Token refresh on expiry |
| `logOAuthDiagnostics()` | Debug logging for picker |

**Endpoints:** None directly — used by controllers and Slack listeners.

**Communicates with:** Prisma (`JiraConnection`), Atlassian OAuth/token API, Jira REST API, `jira-token.crypto.ts`.

---

#### `jira.controller.ts`

**Route prefix:** `/api/auth/jira`

**Why it exists:** Browser-facing OAuth routes (redirect-based, not JSON API).

**Endpoints:**

| Route | Method | Handler |
|-------|--------|---------|
| `/api/auth/jira` | GET | Redirect to Atlassian OAuth |
| `/api/auth/jira/callback` | GET | Handle OAuth callback |
| `/api/auth/jira/status` | GET | Connection status JSON |
| `/api/auth/jira/config-check` | GET | Env diagnostics |
| `/api/auth/jira` | DELETE | Disconnect |

---

#### `jira-api.controller.ts`

**Route prefix:** `/api/jira`

**Why it exists:** JSON API for dashboard sync and issue browsing.

**Endpoints:**

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/jira/status` | GET | Same as auth status |
| `/api/jira/sync` | POST | Verify API + refresh issue cache |
| `/api/jira/me` | GET | Connected Jira user profile |
| `/api/jira/projects` | GET | List Jira projects |
| `/api/jira/issues` | GET | All visible issues in discovered projects |
| `/api/jira/my-issues` | GET | Issues assigned to connected user |
| `/api/jira/issues/search?q=` | GET | Search by key or text |

---

#### `jira-cache.service.ts`

**Why it exists:** Local cache so Slack picker is fast and survives brief Jira outages.

**Key functions:**

| Function | Purpose |
|----------|---------|
| `upsertFromSnapshot()` | Write/update cache row |
| `searchCachedIssues()` | Query cache by text |
| `refreshUserCache()` | Pull visible issues from Jira API |
| `searchPickerOptions()` | Cache-first, live-fallback for picker |
| `resolveIssueKeysForUser()` | Resolve issue key → full snapshot |
| `resolvePickerValue()` | Parse Slack selection (key or legacy JSON) |

**Communicates with:** `JiraService`, `JiraIssueCacheEntry` table, called by `JiraSlackListener`.

---

#### `answer-jira-link.service.ts`

**Why it exists:** Persists which Jira issue was linked to which standup question.

**Key functions:**

| Function | Purpose |
|----------|---------|
| `linkIssueToQuestion()` | Upsert `AnswerJiraIssueLink` |
| `attachPendingLinksToAnswer()` | Attach link to saved Answer after text reply |
| `getLinksForSubmission()` / `getLinksForQuestion()` | Read links for reports |

---

#### `jira-issue-ref.service.ts`

**Why it exists:** Handles `ISSUE_REF` question type answers (structured issue references).

**Key functions:**

| Function | Purpose |
|----------|---------|
| `buildSnapshotFromIssueKey()` | Resolve SCRUM-6 → snapshot |
| `enrichFreeTextAnswer()` | Detect issue key in free text |
| `formatAnswerText()` | Display format: `SCRUM-6 · Implement AI Report · In Progress` |

---

#### `jira-issue-ref.types.ts`

**Why it exists:** Shared types and parsers for issue reference payloads.

**Types:** `JiraIssueSnapshot`, `JiraIssuePickerOption`

**Functions:** `parseIssueRefPayload()`, `formatIssueRefDisplay()`, `extractJiraIssueKeys()`

---

#### `jira-standup-hook.service.ts`

**Why it exists:** Orchestrates Jira features during standup delivery and completion.

**Key functions:**

| Function | Purpose |
|----------|---------|
| `shouldShowJiraLinkPicker()` | Show "Link Jira Issue" block? |
| `shouldRenderIssuePicker()` | Use external_select for ISSUE_REF questions? |
| `prepareQuestionForDelivery()` | Pre-cache issues before question sent |
| `afterSubmissionCompleted()` | Blocker detection → propose Jira actions |
| `formatAnswerForDigest()` | Format issue refs in AI digest |

**Communicates with:** `SlackGateway`, `JiraSlackListener`, `JiraBlockerService`.

---

#### `jira-action.service.ts`

**Why it exists:** Human-in-the-loop Jira write operations (approve before executing).

**Key functions:**

| Function | Purpose |
|----------|---------|
| `proposeAddComment()` | Propose comment on SCRUM-8 |
| `proposeCreateIssue()` | Propose new issue from blocker |
| `approveAction()` | User clicks Approve in Slack → executes |
| `cancelAction()` | User cancels proposal |

**Database:** `JiraProposedAction`, `JiraAuditLog`

---

#### `jira-blocker.service.ts`

**Why it exists:** Creates `PulseBlocker` records from standup answers mentioning blockers.

**Key functions:** `createFromAnswer()`, `proposeJiraActionForBlocker()`, `listOpenBlockers()`

---

#### `jira-audit.service.ts`

**Why it exists:** Immutable audit trail of every proposed/approved/executed Jira action.

---

#### `jira-token.crypto.ts`

**Why it exists:** Encrypt OAuth tokens at rest; sign/verify OAuth state parameter.

**Functions:** `encryptSecret()`, `decryptSecret()`, `signOAuthState()`, `verifyOAuthState()`

**Algorithm:** AES-256-GCM with key derived from `JIRA_TOKEN_ENCRYPTION_KEY` or `JIRA_CLIENT_SECRET`.

---

#### `jira.types.ts`

**Why it exists:** TypeScript types for API responses and connection status DTOs.

---

#### `jira.module.ts`

**Why it exists:** NestJS module wiring — registers all controllers and providers, exports services for Slack module.

---

#### `blocker.controller.ts`

**Route prefix:** `/api/blockers`

**Endpoints:**

| Route | Purpose |
|-------|---------|
| `GET /api/blockers` | List open blockers |
| `GET /api/blockers/audit/:userId` | Jira action audit log |

---

### Backend — Slack integration

#### `slack/jira-slack.listener.ts`

**Why it exists:** Bolt event handlers for Jira pickers and actions in Slack.

**Registers:**

| Bolt handler | Trigger |
|-------------|---------|
| `app.options(/^checkin_issue_ref:/)` | ISSUE_REF dropdown options load |
| `app.options(/^checkin_link_jira:/)` | Link Jira Issue dropdown options load |
| `app.action(/^checkin_link_jira:/)` | User selected an issue to link |
| `app.action(/^checkin_issue_ref:/)` | User selected issue as answer |
| `app.action(/^jira_action_approve:/)` | Approve blocker Jira action |
| `app.action(/^jira_action_cancel:/)` | Cancel blocker Jira action |

**Communicates with:** `JiraService`, `JiraCacheService`, `AnswerJiraLinkService`, `SlackGateway`.

---

#### `slack/slack-checkin.views.ts`

**Why it exists:** Block Kit message builders for standup questions.

**Jira-related functions:**

| Function | Purpose |
|----------|---------|
| `buildJiraLinkBlocks()` | "Link Jira Issue" external_select block |
| `buildJiraLinkConfirmationBlocks()` | "✅ Linked: SCRUM-7" confirmation |
| `buildDmQuestionMessage()` | Embeds Jira blocks in question message |
| `buildCheckinIssueRefActionId()` | Action ID encoding submission+question |
| `buildJiraActionProposalBlocks()` | Approve/Cancel buttons for blocker actions |

---

#### `slack/slack.gateway.ts`

**Why it exists:** Main Slack orchestration — sends questions, handles answers.

**Jira integration points:**
- `postDmQuestionMessage()` → calls `JiraStandupHookService` to decide `includeJiraLink`
- `completeConversation()` → calls `afterSubmissionCompleted()` for blocker proposals

---

#### `slack/slack.module.ts`

**Why it exists:** Imports `JiraModule`, registers `JiraSlackListener`.

---

### Backend — Collection

#### `collection/collection.service.ts`

**Jira integration points:**
- `validateAnswerForQuestion()` — handles `QuestionType.ISSUE_REF`
- `enrichFreeTextAnswer()` — resolves SCRUM-6 from plain text
- `submitAnswer()` — calls `attachPendingLinksToAnswer()` after saving answer

---

### Backend — Admin

#### `admin/admin.service.ts`

**Jira integration:** Report detail API includes `jiraIssueLinks` per submission, mapped to `linkedJiraIssues` per answer in `buildParticipantsFromSubmissions()`.

---

### Backend — Config

#### `config/env.config.ts`

**Why it exists:** Resolves `.env` path and provides `getJiraEnvDiagnostics()` without exposing secret values.

#### `main.ts`

**Why it exists:** Loads env, logs which Jira vars are set (boolean only), sets global prefix `api`.

---

### Frontend

#### `frontend/src/components/dashboard/JiraIntegrationCard.tsx`

**Why it exists:** Dashboard UI for connect/disconnect/sync Jira.

**API calls:**
- `GET /api/auth/jira/status`
- `GET /api/auth/jira` (redirect for connect)
- `DELETE /api/auth/jira`
- `POST /api/jira/sync`

---

#### `frontend/src/pages/ReportDetailPage.tsx`

**Why it exists:** Shows standup report with linked Jira issues per answer.

**Displays:** `answer.linkedJiraIssues[]` with clickable `issueUrl`, summary, status.

---

### Database

#### `prisma/schema.prisma`

Added models: `JiraConnection`, `JiraIssueCacheEntry`, `PulseBlocker`, `JiraProposedAction`, `JiraAuditLog`, `AnswerJiraIssueLink`

Added enum value: `QuestionType.ISSUE_REF`

#### Migrations

| Migration | Purpose |
|-----------|---------|
| `20260815180000_jira_oauth_connection` | Initial `JiraConnection` (workspace-scoped) |
| `20260815190000_slack_jira_integration` | User-scoped connection, cache, blockers, actions, audit, ISSUE_REF |
| `20260816120000_answer_jira_issue_links` | `AnswerJiraIssueLink` for standup linking |

---

## 3. OAuth Implementation

### What is OAuth?

OAuth 2.0 is an authorization framework. Instead of giving Pulse your Atlassian password, you log into Atlassian directly and grant Pulse specific permissions. Pulse receives a **token** that represents your consent — not your password.

### Why OAuth instead of API tokens?

| API Token | OAuth 2.0 (3LO) |
|-----------|-----------------|
| Long-lived, manually created | Short-lived access token + refresh token |
| Full account access if leaked | Scoped to specific permissions |
| Hard to revoke per-app | Revocable per OAuth app |
| Not suitable for multi-user SaaS | Designed for "Sign in with Atlassian" |

Pulse is a multi-user product. Each workspace admin connects their Atlassian account on behalf of the team. OAuth is the Atlassian-recommended approach for cloud apps.

### Why is every user connected separately?

Originally, `JiraConnection` was workspace-scoped (one connection per workspace). It was migrated to **user-scoped** (`userId` unique) because:

1. OAuth tokens belong to an Atlassian **user account**, not an abstract workspace.
2. Jira permissions are evaluated per user — what Karam can see may differ from another team member.
3. Audit trails need to know **who** authorized write actions.

For Slack standups, `resolveJiraActingUserId()` falls back to the workspace's connected user if the Slack user hasn't connected personally — so one dashboard OAuth connection serves the whole team for read operations.

### Why is this more secure?

- Tokens never appear in the frontend JavaScript bundle.
- Tokens are encrypted at rest in PostgreSQL.
- OAuth `state` parameter is HMAC-signed to prevent CSRF.
- Scopes are limited to `read:jira-work`, `write:jira-work`, `read:jira-user`, `offline_access`.
- Write operations (comments, issue creation) require explicit Slack approval.

---

### Authorization URL

**Built by:** `JiraService.buildAuthorizationRedirectUrl()`

**Full URL pattern:**

```
GET https://auth.atlassian.com/authorize
  ?audience=api.atlassian.com
  &client_id={JIRA_CLIENT_ID}
  &scope=read:jira-work write:jira-work read:jira-user offline_access
  &redirect_uri=http://localhost:3000/api/auth/jira/callback
  &state={base64url-payload}.{hmac-signature}
  &response_type=code
  &prompt=consent
```

**State payload (before signing):**

```json
{
  "workspaceId": "0e4985cc-3955-4af5-8cba-d72f25f1a8ee",
  "userId": "bae237ed-e53d-4c5f-88e5-6e69945103f3",
  "nonce": "a1b2c3...",
  "exp": 1699999999999
}
```

**Why state exists:** Prevents CSRF — ensures the callback belongs to the OAuth request Pulse initiated.

---

### Callback

**Route:** `GET /api/auth/jira/callback?code=...&state=...`

**Steps in `handleOAuthCallback()`:**
1. Verify HMAC signature on `state`
2. Check expiry (`exp > Date.now()`)
3. Exchange `code` for tokens
4. Fetch accessible resources → get `cloudId`
5. Fetch user profile → get `accountId`, `displayName`
6. Encrypt and store tokens
7. Redirect browser to frontend success URL

**OAuth cancelled:** If Atlassian returns `?error=access_denied`, controller redirects to:

```
http://localhost:5173/overview?jira=error&message=access_denied
```

---

### Access Token

- Short-lived credential (typically ~1 hour via `expires_in`)
- Sent as `Authorization: Bearer {token}` on every Jira API call
- Stored encrypted in `JiraConnection.accessToken`
- Never sent to frontend

---

### Refresh Token

- Long-lived credential obtained via `offline_access` scope
- Used to obtain new access tokens without user re-login
- Stored encrypted in `JiraConnection.refreshToken`
- Rotated on each refresh (new refresh token may be returned)

---

### Expiration

Stored in `JiraConnection.expiresAt`.

`ensureValidAccessToken()` checks if token expires within 60 seconds. If so, triggers refresh before API call.

---

### Token Refresh

**Triggered by:** `callJiraApi()` when token is expiring, or on HTTP 401.

**Request:**

```
POST https://auth.atlassian.com/oauth/token
Content-Type: application/json

{
  "grant_type": "refresh_token",
  "client_id": "...",
  "client_secret": "...",
  "refresh_token": "..."
}
```

**On success:** Updates `accessToken`, `refreshToken`, `expiresAt` in database.

**On failure:** Returns `null` → caller throws `UnauthorizedException` → user must reconnect.

---

### Cloud ID

Atlassian Cloud uses a two-level URL structure:

```
https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/...
```

The `cloudId` identifies your specific Jira site (`karamwaleed70.atlassian.net`) among all Atlassian Cloud tenants.

**Retrieved from:** `GET https://api.atlassian.com/oauth/token/accessible-resources`

**Example response entry:**

```json
{
  "id": "e874a9c5-e5af-48e7-97cc-356cea9c3aa2",
  "url": "https://karamwaleed70.atlassian.net",
  "name": "pulse-team",
  "scopes": ["read:jira-work", "write:jira-work"]
}
```

Stored in `JiraConnection.cloudId`.

---

### Account ID

The Atlassian account identifier for the connected user (not email — Atlassian deprecated username/email in API v3).

**Retrieved from:** `GET /rest/api/3/myself`

**Example:**

```json
{
  "accountId": "712020:abc-def-...",
  "displayName": "Karam Waleed"
}
```

Stored in `JiraConnection.atlassianAccountId`.

Used for audit and display — not sent to frontend as a secret.

---

## 4. Environment Variables

| Variable | Who Provides | Where It Comes From | Why Required |
|----------|-------------|--------------------|----|
| `JIRA_CLIENT_ID` | Developer | Atlassian Developer Console → OAuth 2.0 app | Identifies Pulse to Atlassian OAuth |
| `JIRA_CLIENT_SECRET` | Developer | Same console, keep secret | Proves Pulse identity during token exchange |
| `JIRA_REDIRECT_URI` | Developer | Must match Atlassian app settings exactly | OAuth callback: `http://localhost:3000/api/auth/jira/callback` |
| `JIRA_AUTH_URL` | Atlassian (fixed) | `https://auth.atlassian.com/authorize` | OAuth authorization endpoint |
| `JIRA_TOKEN_URL` | Atlassian (fixed) | `https://auth.atlassian.com/oauth/token` | Token exchange and refresh |
| `JIRA_API_URL` | Atlassian (fixed) | `https://api.atlassian.com` | Base URL for all Jira REST calls |
| `JIRA_SCOPES` | Developer | Space-separated scope string | Permissions: read/write Jira, read user, offline refresh |
| `JIRA_TOKEN_ENCRYPTION_KEY` | Developer (optional) | Strong secret string | Dedicated AES key; falls back to `JIRA_CLIENT_SECRET` if unset |
| `FRONTEND_URL` | Developer | `http://localhost:5173` | OAuth success/error redirect target |

**Startup validation:** `main.ts` logs boolean flags for each var (never values). `GET /api/auth/jira/config-check` returns diagnostics object.

---

## 5. Backend Flow

Global prefix: `/api` (set in `main.ts`).

### OAuth Routes (`JiraController`)

#### `GET /api/auth/jira`

- **Request:** Optional query `?slackUserId=U0BLV9YR87J`
- **Response:** HTTP 302 redirect to Atlassian OAuth
- **Purpose:** Start connection flow
- **DB changes:** None yet
- **External calls:** None (redirect only)

#### `GET /api/auth/jira/callback`

- **Request:** `?code=...&state=...` or `?error=...`
- **Response:** HTTP 302 redirect to frontend
- **Purpose:** Complete OAuth, store connection
- **DB changes:** Upsert `JiraConnection`
- **External calls:** Token exchange, accessible-resources, /myself

#### `GET /api/auth/jira/status`

- **Response:**

```json
{
  "connected": true,
  "atlassianDisplayName": "Karam Waleed",
  "siteName": "pulse-team",
  "siteUrl": "https://karamwaleed70.atlassian.net",
  "lastSyncAt": "2026-08-16T09:57:45.716Z",
  "connectedAt": "2026-08-15T...",
  "tokenExpiresAt": "2026-08-16T..."
}
```

- **Purpose:** Dashboard status card
- **DB:** Read `JiraConnection`
- **External:** None

#### `DELETE /api/auth/jira`

- **Response:** `{ "disconnected": true }`
- **Purpose:** Remove connection
- **DB:** Delete `JiraConnection` rows for workspace

#### `GET /api/auth/jira/config-check`

- **Response:** Env diagnostics (booleans only, no secrets)

---

### Jira API Routes (`JiraApiController`)

#### `GET /api/jira/me`

- **External:** GET `/rest/api/3/myself`

#### `GET /api/jira/projects`

- **External:** GET `/rest/api/3/project/search?maxResults=50`

#### `GET /api/jira/issues?maxResults=20`

- **JQL:** `project in ("SCRUM") ORDER BY updated DESC`
- **External:** POST `/rest/api/3/search/jql`

#### `GET /api/jira/my-issues?maxResults=20`

- **JQL:** `assignee = currentUser() ORDER BY updated DESC`
- **Returns:** Only assigned issues (e.g. SCRUM-6 for Karam)

#### `GET /api/jira/issues/search?q=SCRUM-7`

- Empty query → my-issues
- Key pattern → `key = "SCRUM-7"`
- Text → `text ~ "..." ORDER BY updated DESC`

#### `POST /api/jira/sync`

- **DB:** Updates `lastSyncAt`, refreshes `JiraIssueCacheEntry`
- **External:** GET myself, GET projects, POST search/jql

---

### Blocker Routes (`BlockerController`)

- `GET /api/blockers?teamId=...` — list open blockers
- `GET /api/blockers/audit/:userId` — Jira audit log

---

### Slack Routes (No HTTP — Socket Mode)

Slack Jira pickers use Bolt `app.options()` and `app.action()` in `JiraSlackListener`, not HTTP endpoints.

---

## 6. Jira API Calls

All authenticated calls use:

```
Authorization: Bearer {decrypted_access_token}
Accept: application/json
```

Base URL pattern:

```
https://api.atlassian.com/ex/jira/{cloudId}{path}
```

### 1. Accessible Resources (OAuth setup)

| Field | Value |
|-------|-------|
| Endpoint | `GET /oauth/token/accessible-resources` |
| Method | GET |
| Why chosen | Required to get cloudId before any Jira REST call |

### 2. Current User Profile

| Field | Value |
|-------|-------|
| Endpoint | `GET /rest/api/3/myself` |
| Method | GET |

### 3. Project Search

| Field | Value |
|-------|-------|
| Endpoint | `GET /rest/api/3/project/search?maxResults=50` |
| Method | GET |
| Why chosen | Discovers project keys dynamically (SCRUM) without hardcoding |

### 4. Issue Search (JQL)

| Field | Value |
|-------|-------|
| Endpoint | `POST /rest/api/3/search/jql` |
| Method | POST |
| Body | `{ "jql": "...", "maxResults": 50, "fields": [...] }` |
| Why chosen | Current Atlassian JQL search endpoint |

**Example request body (picker cache refresh):**

```json
{
  "jql": "project in (\"SCRUM\") ORDER BY updated DESC",
  "maxResults": 50,
  "fields": ["summary", "status", "issuetype", "assignee", "project", "priority", "updated"]
}
```

**Example issue in response:**

```json
{
  "id": "10006",
  "key": "SCRUM-7",
  "fields": {
    "summary": "Slack Thread Integration",
    "status": { "name": "To Do" },
    "project": { "key": "SCRUM", "name": "pulse-team" }
  }
}
```

### 5. Single Issue Lookup

| Field | Value |
|-------|-------|
| Endpoint | `GET /rest/api/3/issue/SCRUM-8` |
| Method | GET |

### 6. Add Comment (blocker automation)

| Field | Value |
|-------|-------|
| Endpoint | `POST /rest/api/3/issue/SCRUM-8/comment` |
| Method | POST |
| Scope required | `write:jira-work` |

### 7. Create Issue (blocker automation)

| Field | Value |
|-------|-------|
| Endpoint | `POST /rest/api/3/issue` |
| Method | POST |

### 8. Token Exchange (OAuth)

| Field | Value |
|-------|-------|
| Endpoint | `POST https://auth.atlassian.com/oauth/token` |
| Body | `{ grant_type: "authorization_code", client_id, client_secret, code, redirect_uri }` |

### 9. Token Refresh

| Field | Value |
|-------|-------|
| Endpoint | `POST https://auth.atlassian.com/oauth/token` |
| Body | `{ grant_type: "refresh_token", client_id, client_secret, refresh_token }` |

---

## 7. Database

### `JiraConnection`

| Field | Type | Why Needed |
|-------|------|-----------|
| `id` | UUID | Primary key |
| `userId` | UUID (unique) | Which Pulse user owns this OAuth connection |
| `workspaceId` | UUID | Which Pulse workspace this connection serves |
| `cloudId` | String | Atlassian site identifier for API URL construction |
| `siteName` | String | Display name ("pulse-team") |
| `siteUrl` | String | Browser URL for issue links |
| `atlassianAccountId` | String | Connected Atlassian account ID |
| `atlassianDisplayName` | String | Display name in dashboard |
| `accessToken` | String (encrypted) | OAuth access token |
| `refreshToken` | String? (encrypted) | OAuth refresh token |
| `expiresAt` | DateTime? | When access token expires |
| `scopes` | String? | Granted OAuth scopes |
| `connectedAt` | DateTime | When user connected |
| `lastSyncAt` | DateTime | Last successful Jira API call |
| `updatedAt` | DateTime | Prisma auto timestamp |

### `JiraIssueCacheEntry`

| Field | Why Needed |
|-------|-----------|
| `userId` + `issueKey` (unique) | Cache key — issues cached per OAuth user |
| `issueId` | Jira internal ID (10006 for SCRUM-7) |
| `summary` | Display in picker and reports |
| `status` | "To Do", "In Progress" |
| `projectKey` / `projectName` | SCRUM / pulse-team |
| `issueUrl` | Clickable link in Slack and dashboard |
| `cachedAt` / `refreshedAt` | Cache freshness tracking |

### `AnswerJiraIssueLink`

| Field | Why Needed |
|-------|-----------|
| `submissionId` + `questionId` + `issueKey` (unique) | One link per issue per question per standup |
| `userId` | Which Pulse user linked the issue |
| `answerId` | Attached after user submits text reply (nullable until then) |
| `issueId` / `issueKey` / `summary` / `status` | Snapshot at link time |
| `issueUrl` | Report display |

### `PulseBlocker`

Stores blocker reports from standup answers. Links to Jira via `linkedIssueKey`, `linkedIssueId`, `linkedIssueUrl`.

### `JiraProposedAction`

Stores proposed Jira write actions awaiting Slack approval.

### `JiraAuditLog`

Immutable log of every Jira action state transition.

---

## 8. Slack Integration

### How the dropdown loads

1. Standup question message includes Block Kit `external_select` element.
2. User clicks dropdown → Slack sends `block_suggestion` via Socket Mode.
3. Bolt routes to `JiraSlackListener.handleIssuePickerOptions()`.
4. Handler resolves acting Jira user, refreshes cache, searches options.
5. Handler calls `ack({ options: [...] })` — Slack renders the list.

**Block Kit definition** (`buildJiraLinkBlocks()`):

```typescript
{
  type: 'external_select',
  action_id: 'checkin_link_jira:{submissionId}:{questionId}',
  placeholder: { text: 'Select Jira Issue' },
  min_query_length: 0
}
```

### How options are built

```json
{
  "text": { "type": "plain_text", "text": "SCRUM-7 • Slack Thread Integration" },
  "value": "SCRUM-7"
}
```

**Critical:** Option `value` must be ≤75 characters (Slack limit). Full JSON snapshots (~250 chars) were rejected silently, causing "No Issues".

### How issue selection is stored

1. User selects SCRUM-7 → Slack sends `block_actions`.
2. `resolvePickerValue('SCRUM-7')` looks up cache or live Jira API.
3. `AnswerJiraLinkService.linkIssueToQuestion()` upserts `AnswerJiraIssueLink`.
4. When user submits text answer, `attachPendingLinksToAnswer()` sets `answerId`.

### How the issue link is generated

```
issueUrl = https://karamwaleed70.atlassian.net/browse/SCRUM-7
```

### How it appears in the thread

```
✅ Linked:
• SCRUM-7          ← clickable Slack link
  Slack Thread Integration
```

---

## 9. Issue Selection — Complete Lifecycle

```
User clicks "Select Jira Issue"
         ↓
Slack → Socket Mode → block_suggestion event
         ↓
JiraSlackListener.handleIssuePickerOptions()
         ↓
JiraService.resolveJiraActingUserId(slackUserId)
         ↓
JiraCacheService.refreshUserCache(userId)
  → POST search/jql: project in ("SCRUM") ORDER BY updated DESC
         ↓
JiraCacheService.searchPickerOptions(userId, "")
         ↓
ack({ options: [{ text: "SCRUM-7 • ...", value: "SCRUM-7" }, ...] })
         ↓
User selects SCRUM-7
         ↓
resolvePickerValue("SCRUM-7") → JiraIssueSnapshot
         ↓
AnswerJiraLinkService.linkIssueToQuestion()
         ↓
SlackService.postMessage() → confirmation in thread
         ↓
User submits text answer
         ↓
attachPendingLinksToAnswer() → sets answerId
         ↓
ReportDetailPage displays linked SCRUM-7
```

### Functions involved

| Step | Function | File |
|------|----------|------|
| Show picker | `shouldShowJiraLinkPicker()` | jira-standup-hook.service.ts |
| Build blocks | `buildJiraLinkBlocks()` | slack-checkin.views.ts |
| Send message | `postDmQuestionMessage()` | slack.gateway.ts |
| Options load | `handleIssuePickerOptions()` | jira-slack.listener.ts |
| Resolve user | `resolveJiraActingUserId()` | jira.service.ts |
| Refresh cache | `refreshUserCache()` | jira-cache.service.ts |
| Fetch issues | `getVisibleIssuesForUser()` | jira.service.ts |
| Search cache | `searchPickerOptions()` | jira-cache.service.ts |
| Save link | `linkIssueToQuestion()` | answer-jira-link.service.ts |
| Attach answer | `attachPendingLinksToAnswer()` | answer-jira-link.service.ts |
| Report | `buildParticipantsFromSubmissions()` | admin.service.ts |

---

## 10. Security

### Why tokens are encrypted

OAuth tokens grant access to Jira data. AES-256-GCM encryption means a DB dump alone isn't enough to call Jira.

### Why refresh tokens are stored

Access tokens expire (~1 hour). `offline_access` scope enables silent renewal without daily re-login.

### Why OAuth scopes were limited

```
read:jira-work   → read issues, projects, search
write:jira-work  → add comments, create issues (with approval)
read:jira-user   → read connected user profile
offline_access   → refresh tokens
```

### Why users only see permitted issues

Jira enforces permissions server-side. Pulse uses the connected user's OAuth token. JQL only returns issues that user can browse in Jira.

---

## 11. Error Handling

| Case | Handling |
|------|----------|
| Expired token | `ensureValidAccessToken()` auto-refreshes |
| Invalid token / refresh fails | `UnauthorizedException`; user must reconnect |
| No Jira connection | Picker returns empty; no picker shown |
| No issues found | Empty options; logged |
| Network failure | `ServiceUnavailableException`; graceful empty picker |
| Missing cloudId | Fails at OAuth callback |
| OAuth cancelled | Redirect to frontend with error toast |
| Invalid OAuth state | `BadRequestException` → frontend error |
| Slack value too long | Fixed: issue key only (≤75 chars) |
| Blocker action failure | Status `failed`, audit log written |

---

## 12. Sequence Diagram

```
Browser          Backend           Atlassian OAuth    Jira API         Database         Slack
   |                |                     |                |                |               |
   |--GET /auth/jira->|                  |                |                |               |
   |<-302 redirect--|                     |                |                |               |
   |-----------------GET /authorize------->|                |                |               |
   |-----------------GET /callback?code---->|                |                |               |
   |                |--POST /oauth/token->|                |                |               |
   |                |--GET accessible-resources------------>|                |               |
   |                |--GET /myself----------------------->|                |               |
   |                |--UPSERT JiraConnection------------------------------->|               |
   |<-302 /overview?jira=connected--------|                |                |               |
   |                |                     |                |                |  DM question  |
   |                |<---block_suggestion (picker)----------------------------------------|
   |                |--POST search/jql------------------->|                |               |
   |                |--UPSERT cache rows-------------------------------->|               |
   |                |--ack options----------------------------------------------------->|
   |                |<---block_actions (SCRUM-7)---------------------------------------|
   |                |--UPSERT AnswerJiraIssueLink------------------------->|               |
   |                |--POST confirmation message---------------------------------------->|
   |--GET report--->|                     |                |                |               |
   |<-linkedJiraIssues---------------------|                |                |               |
```

---

## 13. Code Walkthrough

### `buildAuthorizationRedirectUrl(options?)`

- **Input:** Optional `{ slackUserId, userId }`
- **Logic:** Resolve workspace + user, build signed state, construct Atlassian URL
- **Output:** Redirect URL string
- **DB:** Read workspace, user
- **Jira API:** None

### `handleOAuthCallback(code, state)`

- **Input:** Authorization code + signed state
- **Logic:** Verify state, exchange code, fetch cloudId + profile, encrypt tokens, upsert connection
- **Output:** Frontend redirect URL
- **DB:** Upsert `JiraConnection`
- **Jira API:** Token exchange, accessible-resources, /myself

### `callJiraApi(path, options, connection?)`

- **Input:** REST path, HTTP options, optional connection
- **Logic:** Decrypt/refresh token, fetch with Bearer auth, retry on 401, update lastSyncAt
- **Output:** Typed JSON response

### `getVisibleIssuesForUser(userId, maxResults)`

- **Input:** Pulse user id
- **Logic:** Discover projects → build JQL → searchIssues
- **Output:** `{ total: 10, issues: [SCRUM-6, SCRUM-7, ...] }`

### `refreshUserCache(userId)`

- **Input:** Pulse user id
- **Logic:** Fetch visible issues, upsert each to cache
- **Output:** Count of cached issues

### `searchPickerOptions(userId, query)`

- **Input:** User id, search query
- **Logic:** Cache-first; live Jira fetch on miss
- **Output:** `JiraIssuePickerOption[]`

### `handleIssuePickerOptions(payload, actionPrefix)`

- **Input:** Bolt options payload
- **Logic:** Resolve user, refresh cache, map to Slack options, ack
- **Output:** Slack options acknowledgment

### `linkIssueToQuestion(params)`

- **Input:** submission, question, issue snapshot
- **Logic:** Upsert `AnswerJiraIssueLink`
- **Output:** `LinkedJiraIssueDto`

### `attachPendingLinksToAnswer(params)`

- **Input:** submissionId, questionId, answerId
- **Logic:** Set answerId on links created before text answer submitted

---

## 14. Final Summary

### What we had before

Pulse collected standup answers in Slack with no Jira connection. Answers were plain text with no structured link to work items.

### What problem existed

1. No Atlassian connection from dashboard.
2. No Jira issue picker in Slack standups.
3. No persistence of issue-to-answer relationships.
4. Reports couldn't show linked Jira context.
5. Blockers couldn't flow into Jira automatically.

**Picker bug ("No Issues"):**
- Option values exceeded Slack's 75-character limit.
- Cache used `assignee = currentUser()` (missed unassigned SCRUM-7–10).
- Empty cache + empty query skipped live Jira fetch.

### What we implemented

1. Full OAuth 2.0 (3LO) with encrypted tokens and auto-refresh.
2. Jira REST API for projects, search, lookup, comments, issue creation.
3. Slack `external_select` pickers in standup messages.
4. `AnswerJiraIssueLink` persistence with dashboard report display.
5. Issue cache for fast picker performance.
6. Blocker automation with human approval.
7. Audit logging for all Jira actions.

### Why it now works

- Valid encrypted tokens with auto-refresh.
- Picker loads all visible SCRUM issues dynamically.
- Slack option values use short issue keys within 75-char limit.
- Links stored on selection, attached to answers on submit.

### How the three systems communicate

```
Pulse Dashboard ←→ Backend API ←→ PostgreSQL
                      ↕
                 Atlassian OAuth + Jira REST API
                      ↕
                 Slack (Socket Mode / Bolt)
```

---

## 15. Learning Section

### Decision 1: OAuth instead of API key in `.env`

An API key would be one key for the whole app — not per user. When loading SCRUM-7, Jira checks Karam's permissions. Only Karam's token can answer that.

### Decision 2: Encrypt tokens in the database

DB backups and staging copies are common attack surfaces. Encryption means a dump alone isn't enough.

### Decision 3: `cloudId` in every API URL

Atlassian hosts thousands of sites. The API needs the cloud instance ID, not just the hostname.

### Decision 4: Discover projects instead of hardcoding `SCRUM`

Hardcoding breaks for customers with different project keys. `GET /project/search` returns whatever the connected user can see.

### Decision 5: Cache issues locally

Every picker open hitting Jira risks rate limits and latency. Cache makes the picker instant after first load.

### Decision 6: Issue key as Slack option value

Slack max 75 chars on option values. `SCRUM-7` is 7 chars. Full JSON was 250 chars → all options rejected → "No Issues".

### Decision 7: Separate `AnswerJiraIssueLink` table

Links can exist before answer text is submitted. Relational data simplifies report queries. Unique constraint prevents duplicates.

### Decision 8: Workspace fallback for Slack users

Admin connects Jira once from dashboard. `resolveJiraActingUserId()` uses workspace connection as fallback for team members who haven't OAuth'd individually.

### Decision 9: Human approval for Jira writes

Automatic issue creation from standup text could spam Jira. Approve/Cancel buttons ensure user confirmation.

### Decision 10: Two linking mechanisms

| Feature | When used |
|---------|-----------|
| `ISSUE_REF` question type | Question *is* "Which issue are you working on?" |
| `Link Jira Issue` addon | Optional link on any question type |

---

### How SCRUM-6, SCRUM-7, SCRUM-8 travel through the system

**SCRUM-6 — "Implement AI Report Generation" (assigned, In Progress)**

```
Jira → search/jql → cache → Slack picker → user selects → AnswerJiraIssueLink → thread confirmation → dashboard report
```

**SCRUM-7 — "Slack Thread Integration" (unassigned, To Do)**

```
Previously missing (assignee=currentUser() JQL)
Now included via project in ("SCRUM") JQL
```

**SCRUM-8 — "Reminder Scheduler Fix" (blocker scenario)**

```
Blocker answer → PulseBlocker → propose comment on SCRUM-8 → user approves → comment posted → audit log
```

---

### Interview-ready one-liner

> Pulse integrates Jira via OAuth 2.0 three-legged auth. Tokens are encrypted in PostgreSQL. The backend proxies all Jira REST calls using the connected user's permissions. Slack standups embed an external_select picker that loads issues via Socket Mode from a cache backed by live JQL search across discovered projects. Selected issues are stored in AnswerJiraIssueLink and surface in dashboard reports. Write operations require explicit Slack approval with full audit logging.

---

*Generated for the Pulse project. Last updated: August 2026.*
