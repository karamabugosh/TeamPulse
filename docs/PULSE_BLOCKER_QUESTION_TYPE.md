# Pulse — Type-Driven BLOCKER Question (Preserve Existing Flow)

**Date:** 2026-08-22  
**Scope:** Add persisted `QuestionType.BLOCKER` so Slack blocker behavior is **type-driven**, not text/position heuristics.  
**Architecture:** Reuses existing Blocker Details modal, `JiraBlockerService.createFromAnswer`, Memory outbox, and resolution follow-up. No competing blocker system.

---

## Behavior

| Config | Slack |
|--------|-------|
| Type `BLOCKER` + any wording | 🔴 Yes / 🟢 No |
| Yes | Opens **existing** Blocker Details modal (does not advance yet) |
| Modal Save | Answer + `structuredValue.blocker` → on submission complete → `createFromAnswer` → `PulseBlocker` → `MemoryOutboxEvent` UPSERT (`BLOCKER`) |
| No | Answer only (`value: false`). **No** PulseBlocker. **No** BLOCKER MemoryChunk |

Legacy: `YES_NO` + classic phrases (`Are you blocked?`, …) still opens the modal for backward compatibility. Custom wording **requires** type `BLOCKER`.

---

## Fields collected (existing modal / PulseBlocker)

Supported at create: title, description, severity, category, ownerLabel, expectedResolution, preventingAllWork, canContinueOtherTask, linkedIssueKey (Jira picker).

`needsHelp` / `needsEscalation`: set on **follow-up resolution** flow, not on standup create → **NOT SUPPORTED** at create time (by design of existing schema usage).

---

## Dashboard

Question Builder includes type **Blocker (Yes → details)**. Default template Q3 is now `BLOCKER`.

---

## Tests

```bash
npm run test:blocker-question-type
```

Covers custom wording gate, YES idempotency, NO no-blocker, report No vs Yes distinction.

---

## Acceptance

| Criterion | Result |
|-----------|--------|
| Dynamic configured questions | PASS |
| BLOCKER behavior from persisted type | PASS |
| Custom blocker wording | PASS |
| YES opens blocker details | PASS (existing modal) |
| Blocker reason persisted | PASS |
| Severity persisted | PASS |
| Needs-help persisted | NOT SUPPORTED (follow-up only) |
| Expected resolution persisted | PASS |
| Jira link preserved | PASS |
| NO creates no blocker | PASS |
| Duplicate protection | PASS (`answerId` idempotency) |
| BLOCKER MemoryChunk | PASS (via existing outbox on create) |
| BLOCKER_RESOLUTION compatibility | PASS (unchanged follow-up path) |
| Report compatibility | PASS (type-aware profiles) |
