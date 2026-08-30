# PULSE — Workspace Untangle Report

**Date:** 2026-08-22  
**Scope:** Make **Pules project** self-contained so **TeamPulse Workspace** can later be deleted safely.  
**TeamPulse deleted in this task:** **NO**

---

## 1. Root Cause

Historical standup activity for real Pules users (Rami, Karam, Aroob) was recorded against TeamPulse’s seeded **General** team / **Daily Standup** check-in (`00000000-0000-0000-0000-000000000001` / `…000010`), while:

- `User.workspaceId` correctly stayed on **Pules project**
- V2 `MemoryChunk` rows were correctly workspace-scoped to **Pules**
- `PulseBlocker.workspaceId` was Pules, but `teamId` / `runId` / `checkInId` still pointed at TeamPulse

So Memory looked Pules-owned, but the **business source graph** (Submission → Run → CheckIn → Team) was TeamPulse-owned. Deleting TeamPulse would cascade-delete those parents and destroy ~335 Pules `Answer` rows (and their Memory sources).

Shared runs (Pules + TeamPulse authors on the same `StandupRun`) made blind reparenting unsafe.

---

## 2. Original Cross-Workspace Graph

| Workspace | ID | Notes |
|-----------|----|-------|
| Pules project | `0e4985cc-3955-4af5-8cba-d72f25f1a8ee` | Canonical preserve |
| TeamPulse Workspace | `09999ad5-a472-466a-89c2-a4c14744e9ab` | Delete later only |
| Demo Workspace | `b1ba6c87-0e8e-412e-b934-7c3b981d6982` | Untouched |

**Pre-repair (live re-query):**

| Item | Count |
|------|------:|
| Pules STANDUP_ANSWER chunks | 349 |
| Of which ancestry on TeamPulse | 335 |
| Already Pules-owned (legacy null-checkIn questions) | 14 |
| Entangled submissions | 80 |
| Entangled runs | 54 (34 shared, 20 exclusively Pules) |
| Source check-in | 1 TeamPulse Daily Standup |
| Source questions | 31 (10 shared with TP answers) |
| Pules blockers with TP FKs | 5 |
| BLOCKER_RESOLUTION sources | 7 (PulseBlockerUpdate) |
| REPORT digests | already on Pules Backend Team |
| Pules Jira links on TP submission graph | 56 |

---

## 3. Records Repaired

**Strategy:** reconstruct a Pules-owned graph; do **not** reparent shared TeamPulse parents; preserve Answer / Submission / Blocker / Update IDs.

| Action | Count |
|--------|------:|
| CheckIn created (`Daily Standup (Pules untangle)`) | 1 |
| Questions cloned (deterministic UUIDs) | 31 |
| Runs cloned (stage 1) | 54 |
| Additional runs cloned (stage 2 empty subs) | 17 |
| Submissions moved (with answers) | 80 |
| Empty residual submissions moved | 99 |
| Answers remapped to Pules questions | 335 |
| Blockers FK-repaired | 5 |
| Jira links `runId` retargeted | 56 |
| ConversationState question remaps | 22 |
| ThreadUpdate run retargets | 60 + 3 |
| TeamMemoryDocument `runId` retargets | 55 |
| CheckInParticipants ensured | 3 |

`User.workspaceId` **not** mass-updated. Authors already members of Pules **Backend Team**.

---

## 4. User / Author Preservation

| Author | User ID | Action |
|--------|---------|--------|
| Aroob Amr Abughoush | `c03fae07-…` | Preserved |
| Karam | `bae237ed-…` | Preserved |
| Rami Atrash | `84327077-…` | Preserved |

- Slack IDs unchanged  
- No duplicate users created  
- `MemoryChunk.ownerUserId == Answer.userId` for all 349 STANDUP_ANSWER chunks  

---

## 5. Standup Ownership

Post-repair invariant for every Pules STANDUP_ANSWER chunk:

`MemoryChunk → Answer → Submission → Run → CheckIn → Team(Backend Team) → Workspace(Pules)`

| Metric | Value |
|--------|------:|
| valid | **349** |
| invalid | **0** |
| cross-workspace | **0** |

---

## 6. Blocker / Resolution Ownership

All 5 Pules `PulseBlocker` rows now use:

- `workspaceId` = Pules (unchanged)
- `teamId` = Backend Team
- `checkInId` / `runId` = reconstructed Pules graph
- `answerId` / `submissionId` / content / timestamps preserved

All 7 `BLOCKER_RESOLUTION` chunks still point at original `PulseBlockerUpdate` IDs (content not rewritten).

---

## 7. Report Ownership

REPORT chunks (5) already referenced Pules `AiDigest` rows on Backend Team. **No report text regenerated. No OpenAI calls.**

---

## 8. Jira Link Preservation

- Pules `JiraConnection` count: **2** (preserved)
- SCRUM-9 cache on Pules: **preserved**
- AnswerJiraIssueLink rows kept; `runId` retargeted to Pules twin runs
- Live Jira not modified
- Issue keys including SCRUM-9 preserved on links and Memory metadata

---

## 9. MemoryChunk Verification

| Type | Count |
|------|------:|
| STANDUP_ANSWER | 349 |
| BLOCKER | 5 |
| BLOCKER_RESOLUTION | 7 |
| REPORT | 5 |
| **TOTAL** | **366** |

| Coverage | Result |
|----------|--------|
| JSON embeddings | **366/366** |
| `embedding_vec` | **366/366** |

Answer IDs unchanged → no outbox rebuild required for standup chunks.

Attribution: **349 matching / 0 mismatching**.

---

## 10. SCRUM-9 Verification

| Evidence | Status |
|----------|--------|
| Live Jira connection | PRESERVED |
| SCRUM-9 cache | PRESERVED |
| STANDUP_ANSWER evidence | PRESERVED (authors Rami) |
| BLOCKER evidence | PRESERVED (author Karam) |
| BLOCKER_RESOLUTION evidence | PRESERVED (author Karam) |
| REPORT evidence | PRESERVED (Pules digests) |

---

## 11. Demo Verification

| Metric | Before | After |
|--------|-------:|------:|
| users | 3 | 3 |
| teams | 2 | 2 |
| chunks | 60 | 60 |
| blockers | 10 | 10 |
| digests | 36 | 36 |
| answers | 504 | 504 |
| checkIns | 2 | 2 |
| runs | 44 | 44 |

**DEMO_CHANGED = NO**

---

## 12. Remaining Cross-Workspace References

Intentional / non-blocking leftovers (not Pules business-source ancestry):

1. **TeamMember:** 2 Pules users remain members of TeamPulse **General** (membership rows owned by TP; Users themselves stay on Pules).
2. **TeamMember:** some TP test users remain on Pules Backend Team (pre-existing; out of scope).
3. **TeamPulse parents left intact:** original Daily Standup, shared questions, TP-only answers (50), TP digests on old runs.
4. **Orphan TP questions** that only had Pules answers are now answer-less on TP (safe for later TP delete).

No remaining Pules Answer / Submission / Blocker / MemoryChunk source graph depends on TeamPulse.

---

## 13. TeamPulse Delete Readiness

Simulated impact if TeamPulse deleted **now** (not executed):

| Pules-owned asset at risk | Count |
|---------------------------|------:|
| Answers | **0** |
| STANDUP_ANSWER chunks | **0** |
| Blockers on TP runs/subs | **0** |
| Jira links on entangled graph | **0** |
| Pules submissions on TP runs | **0** |

**TeamPulse Workspace still exists: YES**

---

## 14. Validation Results

| Check | Result |
|-------|--------|
| Dry-run (ambiguous critical) | PASS (0) |
| Apply | YES |
| Idempotent re-dry-run | 0 answers requiring repair |
| Prisma schema touched | NO |
| `test:memory-phase2b` | PASS |
| `test:memory-phase3a` | PASS |
| `test:ai-retrieval` | PASS |

Scripts:

```bash
node scripts/untangle-pules-from-teampulse.js          # dry-run
node scripts/untangle-pules-from-teampulse.js --apply  # apply
node scripts/untangle-pules-residual-empty-subs.js [--apply]
```

---

## 15. Risks

1. **Historical CheckIn disabled:** reconstructed check-in is `enabled=false` / `scheduleEnabled=false` to avoid double scheduling against the archival graph.
2. **Shared-run digests** remain on TeamPulse (their text may historically mention Pules answers). Pules REPORT Memory does not depend on them.
3. **Cross TeamMember rows** to TeamPulse will disappear when TP is deleted; Pules users/auth are unaffected.
4. **Legacy null-`checkInId` questions** (14 answers) remain on Pules runs without a CheckIn link — pre-existing, not introduced by this migration.
5. Future TeamPulse deletion should still use a safe delete script that skips any unexpected Pules FKs.

---

## FINAL DELETE READINESS

**SAFE_TO_DELETE_TEAMPULSE** (from a Pules ownership / Memory source-graph perspective)

Do **not** delete in this task — delete only after an explicit follow-up with the safe-delete script and a final dry-run.
