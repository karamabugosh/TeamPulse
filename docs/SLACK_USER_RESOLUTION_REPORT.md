# Slack User Resolution in Reports

Reports must never expose raw Slack user IDs (`U0BLV9YR87J`, `<@U0BLV9YR87J>`). All report surfaces now resolve Slack IDs to human-readable workspace member names before AI analysis, persistence, and display.

---

## Root cause

1. **Standup AI input used Slack IDs as identity** — `CheckInReportService` sent `userId: slackUserId` to OpenAI without `displayName`. The prompt required display names, so the model echoed raw IDs in Executive Summary, Recommendations, Participant Updates, and blockers.

2. **No post-AI resolution** — `AiDigest` text was persisted and posted to Slack/admin UI without passing through any Slack mention resolver.

3. **Fallback paths exposed IDs** — `rules-fallback.ts`, `ai-response-validator.ts`, `groupBlockersByPerson()`, and `formatDigestForSlack()` fell back to raw `userId` when display names were missing.

4. **Workspace dynamic reports** — `ReportMetricsService` embedded raw answer text (including `<@U…>` mentions) into highlights and reused stored digest summaries that already contained IDs.

5. **Incomplete ID pattern** — Bare IDs embedded in sentences (`U0BLV9YR87J completed SCRUM-1`) were not replaced; only whole-string or `<@…>` mentions were handled.

---

## Files modified

| File | Change |
|------|--------|
| `backend/src/common/slack-member.util.ts` | `lookupSlackDisplayName`, `resolveAllSlackIdsInText`, `textContainsSlackUserId`; `resolveOwnerDisplayName` uses full resolver |
| `backend/src/common/report-slack-resolution.util.ts` | **New** — `resolveSlackIdsInDigest`, `resolveSlackIdsInRawResponses`, `digestContainsSlackUserIds` |
| `backend/src/common/workspace-members.service.ts` | `buildReportNameMap()`; `getDisplayNameMap` includes `slackRealName`; `resolveDisplayName` → `"Unknown User"` fallback |
| `backend/src/common/report-slack-resolution.spec.ts` | **New** unit tests |
| `backend/src/ai/dto/ai-result.dto.ts` | Optional `displayName` on `RawResponseForAnalysis` |
| `backend/src/ai/prompts/pulse-ai.prompts.ts` | Sends `displayName` in standup JSON payload |
| `backend/src/ai/rules-fallback.ts` | Uses `displayName` when present |
| `backend/src/check-in/check-in-report.service.ts` | Pre/post-AI resolution; live Slack sync retry; persist-time resolution |
| `backend/src/check-in/check-in.module.ts` | Imports `SlackMemberCacheModule` |
| `backend/src/check-in/report-participant.utils.ts` | `groupBlockersByPerson` never falls back to raw ID |
| `backend/src/reports/reports.service.ts` | Plain-text blocker list omits raw Slack IDs |
| `backend/src/ai/workspace/report/report-metrics.service.ts` | Resolves highlights, digest summaries, risks before metrics bundle |
| `backend/src/ai/workspace/report/report-generation.service.ts` | Resolves all section markdown + final markdown |
| `backend/src/admin/admin.service.ts` | Resolve-on-read for legacy stored reports in `getReportDetail` |
| `backend/package.json` | `test:report-slack-resolution` script |

---

## Slack user mapping flow

```
Slack message / standup answer
    ↓
Extract Slack User ID (<@U…> or bare U…)
    ↓
buildReportNameMap(workspaceId)
    ├── 1. User table (slackRealName → slackDisplayName)
    ├── 2. SlackMemberCache (realName → displayName)
    ├── 3. Live Slack users.list (syncFromLive retry when IDs remain)
    ├── 4. Participant profile overrides (submission display names)
    └── 5. Fallback: "Unknown User"
    ↓
resolveAllSlackIdsInText / resolveSlackIdsInDigest
    ↓
Human-readable report output
```

---

## Lookup strategy

`WorkspaceMembersService.buildReportNameMap()`:

| Priority | Source | Label preference |
|----------|--------|------------------|
| 1 | `User` (workspace members) | `slackRealName` → `slackDisplayName` |
| 2 | `SlackMemberCache` | `realName` → `displayName` |
| 3 | Live Slack API | Triggered via `SlackMemberCacheService.syncFromLive()` when digest still contains IDs after first pass |
| 4 | Participant submission profile | `slackDisplayName` from standup submission |
| 5 | Fallback | `"Unknown User"` — never raw ID |

`resolveAllSlackIdsInText()` replaces:

- `<@U0BLV9YR87J>` → `Karam Waleed`
- `<@U0BLV9YR87J|karam>` → `Karam Waleed`
- Bare `U0BLV9YR87J` (whole string or embedded in sentence)

---

## Report generation flow

### Standup reports (`CheckInReportService`)

```
collect submissions
    ↓
buildReportNameMap + resolveSlackIdsInRawResponses (pre-OpenAI)
    ↓
OpenAI analyzeRun (payload includes displayName)
    ↓
resolveSlackIdsInDigest (post-OpenAI)
    ↓
optional syncFromLive + re-resolve
    ↓
enrichDigestWithParticipants (resolve answer text)
    ↓
persistReportForRun → slackReportText / DB / memory
```

### Workspace reports (`ReportGenerationService`)

```
ReportMetricsService.collect
    → resolve highlights, digest summaries, risks
    ↓
buildSections + OpenAI narrative
    ↓
resolveAllSlackIdsInText on every section + markdown
```

### Admin UI (legacy digests)

`AdminService.getReportDetail` resolves stored digests on read so older reports without re-generation also display names.

---

## Validation results

### Automated (`npm run test:report-slack-resolution`)

| Test | Result |
|------|--------|
| `U0BLV9YR87J completed SCRUM-1` → `Karam Waleed completed SCRUM-1` | ✓ |
| `<@U0BLV9YR87J> needs help` → `Karam Waleed needs help` | ✓ |
| Unmapped ID → `Unknown User` | ✓ |
| Full digest resolution (summary, overallProgress, participantUpdates, namedBlockers) | ✓ |
| `digestContainsSlackUserIds` returns false after resolution | ✓ |
| Typecheck (`npx tsc --noEmit`) | ✓ |

### Expected behavior (manual)

| Surface | Before | After |
|---------|--------|-------|
| Executive Summary | `U0BLV9YR87J completed SCRUM-1` | `Karam Waleed completed SCRUM-1` |
| Participant Updates | `Participant: U0BLV9YR87J` | `Participant: Karam Waleed` |
| Blockers owner | `Owner: U0BLV9YR87J` | `Owner: Karam Waleed` |
| Recommendations | IDs in action items | Real names only |
| Weekly/Sprint/Executive reports | IDs in AI narrative | Resolved markdown |
| Slack export / CSV | Raw IDs in body | Resolved text (standup path) |

---

## Run tests

```bash
cd pulse/backend
npx tsc --noEmit
npm run test:report-slack-resolution
npm run test:assignee-blocker-owner
```
