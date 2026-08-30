# Demo Workspace

Human-readable summary of the seeded Demo Workspace dataset.  
**Full report:** [`docs/DEMO_WORKSPACE_DATA_REPORT.md`](../../docs/DEMO_WORKSPACE_DATA_REPORT.md)  
Source of truth: `prisma/demo/data.ts` (static content) + `prisma/seed-demo.ts` (generated rows).  
Slack workspace id: `T_DEMO_PULSE_WS` · Timezone: `Asia/Riyadh` · Jira site: `https://demo.atlassian.net` · Project: `SCRUM`

Day offsets below are relative to seed day (`dayOffset = 0` = seed date). Larger offset = older.

## Volume targets (current seed)

| Model / metric | Count |
|----------------|------:|
| Workspace | 1 |
| User | 7 |
| Team / TeamMember | 2 / 12 |
| CheckIn / Participant / Question | 2 / 12 / 8 |
| StandupRun | 50 |
| StandupSubmission | **310** |
| Answer / ConversationState | 1240 / 310 |
| AiDigest | **50** |
| StandupThreadUpdate | 688 |
| InboundEvent | 90 |
| JiraConnection | 3 (Layla, Sara, Nora) |
| JiraIssueCacheEntry | 280 (40 × 7) |
| PulseBlocker / PulseBlockerUpdate | 30 / **28** (≥25) |
| BlockerFollowUpSession | 40 |
| JiraProposedAction | 30 |
| JiraAuditLog | **330** |
| AnswerJiraIssueLink | 833 |
| TeamMemoryDocument | **128** |
| SlackAiChatLog | **100** |
| AiConversation / Messages | **5** / **10** |
| AiEvalCase | **20** |

Other workspaces (Pulse / TeamPulse) are never modified by `npm run seed:demo`.

---

## Team Members

| Name | Role | Slack ID | Email | Team role |
|------|------|----------|-------|-----------|
| Layla Nasser | Tech Lead | `U0DMLAYL01` | layla.nasser@pulsedemo.io | lead |
| Sara Alami | Frontend Engineer | `U0DMSARA01` | sara.alami@pulsedemo.io | member |
| Nora Farid | Backend Engineer | `U0DMNORA01` | nora.farid@pulsedemo.io | member |
| Mariam Khaled | Full Stack Engineer | `U0DMMARI01` | mariam.khaled@pulsedemo.io | member |
| Yasmeen Adel | QA Engineer | `U0DMYASM01` | yasmeen.adel@pulsedemo.io | member |
| Haya Mohammed | DevOps Engineer | `U0DMHAYA01` | haya.mohammed@pulsedemo.io | member |
| Joud Salem | UI/UX Designer | `U0DMJOUD01` | joud.salem@pulsedemo.io | member |

**Nora PTO:** day offsets **18 → 12** (standups say Out of office / Continuing PTO).

---

## Teams

### 1. Pulse Demo Engineering
- Channel: `C_DEMO_STANDUP`
- Schedule: `5 9 * * *`
- Check-in: **Daily Standup**
- Members: all 7
- Standup days: **30** → **210** submissions

### 2. Pulse Demo Platform
- Channel: `C_DEMO_PLATFORM`
- Schedule: `0 10 * * 1,4`
- Check-in: **Platform Sync**
- Members: Layla, Sara, Nora, Mariam, Joud
- Extra standup days: **20** day offsets → **100** submissions

**Total submissions: 310** · **Total runs / digests: 50**

---

## Jira Issues

| Key | Summary | Assignee | Status | Priority | Type |
|-----|---------|----------|--------|----------|------|
| SCRUM-1 | Implement standup response aggregation API | Nora Farid | Done | High | Story |
| SCRUM-2 | Redesign dashboard KPI cards | Sara Alami | Done | Medium | Story |
| SCRUM-3 | Add Slack reminder retry backoff | Haya Mohammed | Done | Medium | Task |
| SCRUM-4 | Write QA checklist for check-in flows | Yasmeen Adel | Done | Low | Task |
| SCRUM-5 | Design sprint goal board visuals | Joud Salem | Done | High | Story |
| SCRUM-6 | Migrate digest storage to AiDigest schema | Nora Farid | Done | High | Story |
| SCRUM-7 | Polish AI Workspace empty state | Sara Alami | Done | Low | Task |
| SCRUM-8 | Ship Atlassian OAuth consent + marketplace copy | Sara Alami | In Review | High | Story |
| SCRUM-9 | Fix timezone drift in report cron | Mariam Khaled | Done | High | Bug |
| SCRUM-10 | Add health check for Slack socket mode | Haya Mohammed | Done | Medium | Task |
| SCRUM-11 | Build blocker dashboard filters | Sara Alami | In Progress | High | Story |
| SCRUM-12 | Stabilize Jira OAuth token refresh | Nora Farid | Blocked | Critical | Bug |
| SCRUM-13 | Implement RAG citation ranking | Nora Farid | In Progress | High | Story |
| SCRUM-14 | Add participant profile section to reports | Mariam Khaled | In Progress | Medium | Story |
| SCRUM-15 | Automate staging deploy pipeline | Haya Mohammed | In Progress | High | Story |
| SCRUM-16 | Regression suite for standup DM flow | Yasmeen Adel | In Progress | Medium | Task |
| SCRUM-17 | Prioritize AI Workspace prompts backlog | Joud Salem | In Progress | Medium | Task |
| SCRUM-18 | Cache Jira issue search results | Nora Farid | In Progress | Medium | Story |
| SCRUM-19 | Improve TopNav workspace switcher UX | Sara Alami | In Progress | Low | Task |
| SCRUM-20 | Investigate Slack rate limit spikes | Haya Mohammed | Blocked | High | Bug |
| SCRUM-21 | Design weekly digest email template | Joud Salem | To Do | Medium | Story |
| SCRUM-22 | Add multi-workspace admin scoping | Layla Nasser | To Do | High | Story |
| SCRUM-23 | Support SCALE_1_5 in analytics charts | Mariam Khaled | To Do | Medium | Task |
| SCRUM-24 | Write load test for collection service | Yasmeen Adel | To Do | Low | Task |
| SCRUM-25 | Encrypt bot tokens at rest | Haya Mohammed | To Do | Critical | Story |
| SCRUM-26 | Ship team memory search UI | Sara Alami | To Do | High | Story |
| SCRUM-27 | Handle deleted Slack users in sync | Nora Farid | To Do | Medium | Bug |
| SCRUM-28 | Add sprint burndown widget | Mariam Khaled | To Do | Medium | Story |
| SCRUM-29 | Clarify blocker severity taxonomy | Joud Salem | To Do | Low | Task |
| SCRUM-30 | Upgrade Prisma to latest 5.x | Layla Nasser | To Do | Low | Task |
| SCRUM-31 | Fix flaky e2e on reminder path | Yasmeen Adel | Blocked | High | Bug |
| SCRUM-32 | Resolve Postgres connection pool exhaustion | Haya Mohammed | Blocked | Critical | Bug |
| SCRUM-33 | Unblock Atlassian app review feedback | Layla Nasser | Blocked | High | Task |
| SCRUM-34 | Ship dark-theme accessibility pass | Joud Salem | Done | Medium | Task |
| SCRUM-35 | Index team memory by issue key | Nora Farid | In Progress | High | Story |
| SCRUM-36 | Add CSV export for blocker register | Mariam Khaled | To Do | Medium | Task |
| SCRUM-37 | Document RAG grounding guarantees | Joud Salem | Done | Medium | Task |
| SCRUM-38 | Optimize standup thread reply posting | Haya Mohammed | In Progress | Low | Task |
| SCRUM-39 | Create smoke tests for AI chat citations | Yasmeen Adel | To Do | High | Task |
| SCRUM-40 | Plan cross-team demo day agenda | Joud Salem | To Do | Low | Story |

**Done count by assignee:** Nora 2 · Sara 2 · Haya 2 · Yasmeen 1 · Joud 3 · Mariam 1 · Layla 0

Issues are cached once per member (40 × 7 = 280 `JiraIssueCacheEntry` rows).

---

## Standups

### Volume
- Engineering Daily Standup: 30 days × 7 people = **210**
- Platform Sync: 20 days × 5 people = **100**
- **310 submissions** · 4 answers each (yesterday / today / blocked / confidence) · matching ConversationState rows

### Questions
1. What did you work on yesterday?
2. What will you work on today?
3. Is anything blocking your progress?
4. How confident are you about today’s plan? (SCALE_1_5)

### Text templates (rotated by day)

**Layla — Yesterday:** Reviewed SCRUM-12 OAuth refresh traces… · Unblocked Sara on SCRUM-8… · Spiked SCRUM-22 notes  
**Layla — Today:** Drive SCRUM-33 legal wording · Spike SCRUM-22 · Review Haya’s pool proposal  

**Sara — Yesterday:** Implemented OAuth login for SCRUM-8 · Built SCRUM-11 filters · Polished SCRUM-19 switcher  
**Sara — Today:** Waiting for OAuth callback (SCRUM-12) · Finish SCRUM-11 · Prototype SCRUM-26  

**Nora — Yesterday:** Fixed OAuth callback SCRUM-12 · BM25 ranking SCRUM-13 · Helped Sara OAuth wording  
**Nora — Today:** Citation recency SCRUM-13 · Stabilize OAuth refresh · Index digests into memory  

**Mariam — Yesterday:** Participant % SCRUM-14 · Burndown axes SCRUM-28 · Report markdown sync  
**Mariam — Today:** Complete SCRUM-14 · SCALE_1_5 chart colors · Help Joud digest outline  

**Yasmeen — Yesterday:** Flaky e2e SCRUM-31 · QA checklist ISSUE_REF · Citation smoke SCRUM-39  
**Yasmeen — Today:** Stabilize e2e · Add SCRUM fixtures · Run citation smoke pack  

**Haya — Yesterday:** Slack rate limits SCRUM-20 · Pool settings SCRUM-32 · Socket health logging  
**Haya — Today:** Pool fix SCRUM-32 · Slack backoff · Encryption spike SCRUM-25  

**Joud — Yesterday:** Dark-theme a11y SCRUM-34 · AI prompts SCRUM-17 · Digest email SCRUM-21  
**Joud — Today:** Demo day agenda SCRUM-40 · Severity labels SCRUM-29 · Review Sara memory UX  

### Special windows (exact text)

#### Sara · SCRUM-8 OAuth (day offsets 16 → 9)
| Field | Text |
|-------|------|
| Yesterday | Implemented OAuth login consent UI for SCRUM-8 |
| Today | Waiting for backend OAuth callback (SCRUM-12) — tracking SCRUM-8 |
| Blocked | Yes — OAuth callback not working; blocked on SCRUM-8 / SCRUM-12 |

#### Sara · after unblock (day offsets &lt; 9, when linked to SCRUM-8)
| Field | Text |
|-------|------|
| Yesterday | Finished OAuth marketplace copy revisions for SCRUM-8 after callback fix |
| Today | Moved SCRUM-8 to review / polishing consent screen |
| Blocked | No — OAuth callback unblocked; SCRUM-8 in review |

#### Nora · PTO (day offsets 18 → 12)
| Field | Text |
|-------|------|
| Yesterday | Out of office — PTO / vacation (day N of leave) |
| Today | Continuing PTO — no planned delivery today |
| Blocked | No — on vacation |

### By developer (how to read the 220 rows)

Each Engineering day `D` (offset 29…0) has one submission per member. Platform Sync adds rows for Layla/Sara/Nora/Mariam/Joud on offsets **14** and **7**.

| Developer | Eng submissions | Platform extra | Notes |
|-----------|-----------------|----------------|-------|
| Layla Nasser | 30 | 20 | Lead; SCRUM-22 / SCRUM-33 focus |
| Sara Alami | 30 | 20 | SCRUM-8 OAuth narrative days 16–9 |
| Nora Farid | 30 | 20 | PTO days 18–12 |
| Mariam Khaled | 30 | 20 | Reports / SCRUM-14 |
| Yasmeen Adel | 30 | 0 | QA / SCRUM-31 |
| Haya Mohammed | 30 | 0 | DevOps / SCRUM-20, 32 |
| Joud Salem | 30 | 20 | Design / SCRUM-40 |

Full per-day answer text lives in the database (`StandupSubmission` + `Answer`); templates above are the seed inputs.

---

## Slack Conversations

### Channel thread snippets (`THREAD_DISCUSSION_SNIPPETS`)
Seeded as `StandupThreadUpdate` type `discussion` on each run (~6–9/day eng):

1. Sara: I am blocked waiting for OAuth callback on SCRUM-8.
2. Nora: Pushing a fix for SCRUM-12 refresh — should unblock Sara today.
3. Seeing the same Slack 429s — bumping retry delay to 2s.
4. Weekly report looks good; blockers section needs SCRUM-8 callout.
5. QA: reminder flake reproduced on CI run #4821.
6. Deploy to staging queued — waiting on migration lock.
7. Citation ranking improved recall on Layla's blocker question.
8. Anyone free to pair on burndown chart axes?
9. Team memory index caught up through yesterday's digests.
10. Reminder: demo day dry-run Friday 2pm.
11. SCRUM-8 moved to In Review after callback landed.
12. Sprint 14 checkpoint: OAuth delay was the top risk.

Also: per-member **standup_summary** thread posts (Yesterday / Today / Blocked).

### Slack AI chat corpus (`SlackAiChatLog` × 100)
See `DEMO_AI_CHAT_SAMPLES` in `data.ts` (OAuth, Sprint 14, architecture, blockers, vacation, executive report, etc.). Conversation threads are grouped by `conversationId` / topic.

---

## Blockers

30 `PulseBlocker` rows (linked to Engineering team / runs).

| # | Owner | Title | Issue | Severity | Status | Created offset | Resolved offset | Update? | Resolved by |
|---|-------|-------|-------|----------|--------|----------------|-----------------|---------|-------------|
| 1 | Sara | OAuth callback not working in staging | SCRUM-8 | critical | resolved | 16 | 9 | yes | Nora |
| 2 | Sara | SCRUM-8 delayed by OAuth marketplace review | SCRUM-8 | high | open | 14 | — | yes | — |
| 3 | Nora | Jira OAuth refresh failing in staging | SCRUM-12 | critical | open | 15 | — | yes | Nora* |
| 4 | Haya | Slack API rate limits during morning collection | SCRUM-20 | high | open | 5 | — | yes | — |
| 5 | Haya | Postgres pool exhaustion on report generation | SCRUM-32 | critical | open | 2 | — | yes | — |
| 6 | Yasmeen | Flaky e2e on reminder path | SCRUM-31 | high | open | 7 | — | yes | — |
| 7 | Layla | Atlassian app review feedback unresolved | SCRUM-33 | high | open | 10 | — | yes | — |
| 8 | Nora | OpenAI latency spikes on digest generation | SCRUM-13 | medium | monitoring→open | 4 | — | yes | — |
| 9 | Sara | Blocker filter chip overflow on mobile | SCRUM-11 | medium | open | 6 | — | yes | — |
| 10 | Mariam | Participant profile missing completion % | SCRUM-14 | medium | open | 8 | — | yes | — |
| 11 | Nora | Citation ranking ignores recency | SCRUM-13 | high | open | 1 | — | yes | — |
| 12 | Haya | Staging deploy stuck on migrations | SCRUM-15 | high | open | 4 | — | yes | — |
| 13 | Yasmeen | Missing fixture for ISSUE_REF questions | SCRUM-16 | medium | resolved | 18 | 14 | yes | Yasmeen |
| 14 | Joud | Dark theme contrast on muted labels | SCRUM-34 | medium | resolved | 20 | 16 | yes | Joud |
| 15 | Mariam | Timezone drift in report cron | SCRUM-9 | high | resolved | 22 | 19 | yes | Mariam |
| 16 | Layla | Onboarding runbook outdated for new hires | SCRUM-37 | low | resolved | 25 | 21 | yes | Layla |
| 17 | Nora | Digest schema migration dual-write window | SCRUM-6 | medium | resolved | 24 | 20 | yes | Nora |
| 18 | Haya | Socket mode disconnect after deploy | SCRUM-10 | medium | resolved | 15 | 12 | yes | Haya |
| 19 | Joud | Sprint goals not visible in standup intro | SCRUM-5 | low | resolved | 28 | 23 | yes | Joud |
| 20 | Mariam | Waiting on design tokens for burndown chart | SCRUM-28 | medium | open | 9 | — | yes | — |
| 21 | Nora | Jira search cache stampede | SCRUM-18 | medium | open | 5 | — | yes | — |
| 22 | Layla | Multi-workspace scoping incomplete | SCRUM-22 | high | open | 6 | — | yes | — |
| 23 | Yasmeen | Need AI chat citation smoke pack | SCRUM-39 | medium | open | 3 | — | yes | — |
| 24 | Sara | Team memory search UI not started | SCRUM-26 | high | open | 2 | — | yes | — |
| 25 | Haya | Bot token encryption not scheduled | SCRUM-25 | critical | open | 11 | — | yes | — |
| 26 | Joud | Demo day agenda needs eng sign-off | SCRUM-40 | low | open | 1 | — | no | — |
| 27 | Mariam | CSV export schema undecided | SCRUM-36 | low | open | 3 | — | no | — |
| 28 | Yasmeen | Load test environment capacity unknown | SCRUM-24 | low | open | 8 | — | no | — |
| 29 | Layla | Prisma upgrade blocked on breaking changes | SCRUM-30 | low | open | 12 | — | no | — |
| 30 | Nora | Deleted Slack user sync edge case | SCRUM-27 | medium | open | 11 | — | no | — |

\* Seed stores `resolvedByKey: nora` on #3 for update attribution; blocker **status remains open**.

**Preventing all work:** #5 Postgres pool (Haya / SCRUM-32).

---

## Blocker Updates

**25** primary updates (blockers with `withUpdate: true`) plus **3** SCRUM-12 reopen follow-ups → **28** `PulseBlockerUpdate` rows.

- Resolved blockers: `previousStatus=open` → `newStatus=resolved`
- Open/monitoring: follow-up notes
- SCRUM-12 reopen notes support “Which blockers kept reopening?”
- No primary updates for blockers #26–#30

Also seeded:

- **40** `BlockerFollowUpSession` rows (from “Yes” blocked answers)
- **30** `JiraProposedAction` AI recommendations (transition / comment / flag / escalate)

---

## Reports

**50** `AiDigest` rows (one per standup run: 30 Engineering + 20 Platform).

### Kinds (Engineering)
- **daily** — most weekdays  
- **weekly** — Fridays outside Sprint 14 window  
- **sprint** — Fridays inside Sprint 14, or selected Mondays  

### Recurring themes
- Jira OAuth stability  
- AI citation quality  
- Infra rate limits  
- Report UX  

### Attention section (typical)
- SCRUM-12 OAuth refresh (Nora)  
- SCRUM-8 delayed — Sara waiting on OAuth callback  
- SCRUM-32 Postgres pool (Haya)  
- SCRUM-20 Slack rate limits (Haya)  

### Sprint 14 checkpoint summary pattern
> Sprint 14 checkpoint: N Done / N In Progress / N Blocked. SCRUM-8 delayed by OAuth callback / marketplace review (Sara); Nora on PTO mid-sprint.

Platform Sync runs also get digests labeled **Pulse Demo Platform**.

---

## Team Memory

**128** `TeamMemoryDocument` rows:

| Source | Content |
|--------|---------|
| `jira_link` × 40 | One doc per SCRUM issue |
| `report` | Engineering digests (every 3rd) + Sprint 14 replay |
| `ai_summary` | Blocker memories + architecture/decision notes (`DEMO_ARCHITECTURE_NOTES`) |
| `standup_answer` | Workload profiles + standup signals |

Architecture topics include: OAuth callback ownership, `X-Workspace-Id`, AiDigest store, team memory indexing, Slack backoff, pool caps, citation recency, bot-token encryption, Sprint 14 OAuth decision, reopen policy.

### Key narrative documents

**Why SCRUM-8 was delayed**  
Owned by Sara. Causes: (1) OAuth callback / SCRUM-12 401s, (2) marketplace consent rejection, (3) legal SCRUM-33. Path: To Do → In Progress → Blocked → In Progress → In Review. Nora resolved callback; Sara moved to Review.

**Who worked on OAuth**  
Sara (SCRUM-8 UI) · Nora (SCRUM-12 callback) · Layla (SCRUM-33 legal/review).

**Nora vacation**  
PTO offsets 18→12. While away: Sara blocked on OAuth, Sprint 14 reports, Haya on SCRUM-20/32.

**Sara last week**  
OAuth login, blocked on callback, SCRUM-11 filters, SCRUM-19 switcher, then In Review. Slack: “I am blocked waiting for OAuth callback.”

---

## Sprint Timeline

### Sprint 14 window
- Name: **Sprint 14**  
- Day offsets: **21 → 7**  
- Goals: OAuth (SCRUM-8 Sara / SCRUM-12 Nora), blocker filters (SCRUM-11), citation ranking (SCRUM-13)  
- Top delay: OAuth callback blocker on SCRUM-8  
- Nora PTO overlaps mid-sprint (18→12)  
- Infra remain open: SCRUM-20, SCRUM-32  

### Jira status-change audit trail (`JiraAuditLog`)

**330** audit rows total: narrative SCRUM-8/12/1/6 transitions + bulk history across all issues (status_change, comment, assignment_view, issue_viewed, link_from_standup, …) + proposed-action audits.

| Offset | Issue | Transition | Note |
|--------|-------|------------|------|
| 22 | SCRUM-1 | In Progress → Done | Standup aggregation API shipped |
| 20 | SCRUM-8 | To Do → In Progress | Sara started OAuth consent UI |
| 19 | SCRUM-6 | In Progress → Done | AiDigest migration completed |
| 16 | SCRUM-8 | In Progress → Blocked | Waiting for OAuth callback / SCRUM-12 |
| 15 | SCRUM-12 | In Progress → Blocked | OAuth refresh 401s after credential rotation |
| 9 | SCRUM-8 | Blocked → In Progress | Nora fixed callback; Sara resumes |
| 7 | SCRUM-8 | In Progress → In Review | Callback landed; Sprint 14 delay noted in reports |

Also: **90** `InboundEvent` rows (Slack + Jira webhooks) scoped to Demo Workspace only.

### SCRUM-8 story arc
1. Sara implements OAuth consent (standups + SCRUM-8 In Progress)  
2. Slack: “I am blocked waiting for OAuth callback”  
3. Blocker #1 critical; SCRUM-8 → Blocked  
4. Nora fixes callback (blocker resolved offset 9)  
5. SCRUM-8 → In Review; digests mention the delay  

---

## AI Test Questions

Suggested questions to ask against this dataset:

1. Why was SCRUM-8 delayed?
2. What did Sara work on last week?
3. Who worked on OAuth?
4. Who has unresolved blockers?
5. Summarize Sprint 14.
6. Replay Sprint 14.
7. Generate a sprint report for Sprint 14.
8. Who completed the most Jira issues?
9. What happened while I was on vacation? *(Nora)*
10. Which blocker affected Sprint 14 the most?
11. Which developer resolved the most blockers?
12. Who has the highest workload?
13. Who is blocked on Jira OAuth / SCRUM-12?
14. What is the status of SCRUM-8?
15. List open critical blockers.
16. What did Nora do before her PTO?
17. How did SCRUM-8’s status change over Sprint 14?
18. What are Haya’s open infrastructure blockers?
19. Which team members are on Pulse Demo Platform?
20. Summarize today’s / latest Daily Standup for Demo Engineering.
