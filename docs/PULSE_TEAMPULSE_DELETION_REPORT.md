# PULSE — TeamPulse Workspace Final Deletion Report

**Date:** 2026-08-22  
**Scope:** Permanently delete **TeamPulse Workspace** from the local development database.  
**Architecture changes:** **NONE** (data cleanup only; Ask mode / V2 routing untouched)

---

## 1. Target Workspace

| Field | Value |
|-------|-------|
| Name | TeamPulse Workspace |
| ID (resolved live) | `09999ad5-a472-466a-89c2-a4c14744e9ab` |
| Slack ID | `T00000000` |

**Preserved:**

| Name | ID |
|------|----|
| Pules project | `0e4985cc-3955-4af5-8cba-d72f25f1a8ee` |
| Demo Workspace | `b1ba6c87-0e8e-412e-b934-7c3b981d6982` |

---

## 2. Pre-delete Safety Verification

Live re-query (not hardcoded authority):

| Guard | Result |
|-------|--------|
| Exactly 1 TeamPulse row | PASS |
| Pules Memory 366 / 349 / 5 / 7 / 5 | PASS |
| Embeddings 366/366 JSON + vec | PASS |
| Attribution 349 matching / 0 mismatch | PASS |
| Cross-workspace Pules source refs | **0** |
| Pules Answers/Subs/Blockers on TP graph | **0** |
| Pules JiraConnection exists | PASS |
| SCRUM-9 cache + chunks | PASS |
| Demo exists | PASS |

**Initial abort:** first dry-run hit `pulesLinksOnTp=58` because untangle had retargeted `runId` but left `AnswerJiraIssueLink.questionId` on TeamPulse questions (cascade would have deleted Pules links including SCRUM-9).

**FK hygiene applied (not ownership migration):**

- `retarget-pules-jira-link-fks.js --apply` → 58 question remaps + 2 run remaps onto existing Pules twins
- Delete script clears `ConversationState.currentQuestionId` still pointing at TP questions (Restrict FK)

Re-guard after hygiene: **PASS** → deletion executed.

---

## 3. Deleted Data Counts

| Record | Count |
|--------|------:|
| Workspace | 1 |
| Users (TeamPulse-only) | 7 |
| Teams | 2 |
| TeamMembers | 6 |
| CheckIns | 1 |
| CheckInParticipants | 2 |
| Questions | 31 |
| Runs | 74 |
| Submissions | 83 |
| Answers (TP users only) | 50 |
| AiDigest / Reports | 21 |
| PulseBlockers | 0 |
| PulseBlockerUpdates | 0 |
| JiraConnection | 1 |
| JiraIssueCacheEntry | 4 |
| JiraMemberCache | 3 |
| SlackMemberCache | 14 |
| MemoryChunk | 119 |
| MemoryOutboxEvent | 883 |
| KnowledgeEmbedding | 368 |
| TeamMemoryDocument | 0 |
| AiConversation | 21 |
| AiConversationMessage | 126 |
| StandupThreadUpdate | 80 |
| ConversationState deleted | 81 |
| ConversationState TP-question cleared | 99 |

---

## 4. Shared Data Preserved

| Item | Status |
|------|--------|
| Pules users (Rami, Karam, Aroob) | Preserved |
| Pules Backend Team membership | Preserved |
| Pules Answers (349) | Preserved |
| Pules Blockers / Resolutions | Preserved |
| Pules REPORT digests + Memory | Preserved |
| Pules Jira connections (2) + cache | Preserved |
| Pules AnswerJiraIssueLink (incl. SCRUM-9) | Preserved (after FK retarget) |
| Demo Workspace entire graph | Unchanged |
| Slack/Jira external identities | Not deleted as globals |

TeamPulse **General** membership rows for 2 Pules users were removed with TeamPulse; underlying Pules users remain and still belong to Backend Team.

---

## 5. Pules Verification

| Check | Result |
|-------|--------|
| Workspace exists | YES |
| Users | 3 (unchanged) |
| Teams | 1 Backend Team |
| Answers | 349 |
| Blockers | 5 |
| Digests | 4 |
| Standup source graph cross-TP | **0** |

---

## 6. V2 Memory Verification

| Type | Expected | Actual |
|------|---------:|-------:|
| STANDUP_ANSWER | 349 | **349** |
| BLOCKER | 5 | **5** |                          
| BLOCKER_RESOLUTION | 7 | **7** |
| REPORT | 5 | **5** |
| TOTAL | 366 | **366** |
| JSON embeddings | 366/366 | **366/366** |
| pgvector | 366/366 | **366/366** |
| Attribution match | 349 | **349** |
| Attribution mismatch | 0 | **0** |

---

## 7. Jira Verification

| Check | Result |
|-------|--------|
| TeamPulse JiraConnection | Deleted (1) |
| Pules JiraConnection | **2 preserved** |
| Live connection for Pules (`findLiveConnectionForWorkspace` filters) | **YES** (`karamwaleed70.atlassian.net`) |
| Demo Jira | Unchanged |

---

## 8. SCRUM-9 Verification

| Evidence | Result |
|----------|--------|
| Pules SCRUM-9 cache | Preserved (1) |
| Pules SCRUM-9 MemoryChunks | Preserved (4) |
| Standup / blocker / resolution evidence | Preserved |
| Authors | Unchanged |

---

## 9. Demo Verification

Before/after counts identical for users, teams, answers, blockers, digests, Jira, checkIns, runs, memory.

**DEMO_CHANGED = NO**

---

## 10. Workspace API / UI Verification

| Check | Result |
|-------|--------|
| Remaining workspaces | Pules project, Demo Workspace |
| TeamPulse by name | **0** |
| TeamPulse by id | **0** |
| Frontend name filter hack | **Not used** |
| `workspace-context` recovery | Already selects first accessible workspace when stored id missing |
| Settings placeholder | Removed stale `'TeamPulse Workspace'` fallback → `'—'` |

If `pulse.activeWorkspaceId` still holds the deleted UUID, the existing provider replaces it with a valid workspace from `/api/admin/workspaces` on load.

---

## 11. Tests

| Test | Result |
|------|--------|
| `npm run test:memory-phase2b` | PASS |
| `npm run test:memory-phase3a` | PASS |
| `npm run test:ai-retrieval` | PASS |
| Frontend `tsc --noEmit` | PASS |
| Prisma schema migration | NOT NEEDED |

---

## 12. Risks / Notes

1. One-time scripts are explicit and require `--execute` / `--apply`; default is dry-run.
2. Pre-delete Jira-link FK retarget was required due to an untangle gap (`questionId`); documented above.
3. Clearing `ConversationState.currentQuestionId` for TP questions is progress-pointer hygiene only.
4. Old TeamPulse digests / AI conversations / TP memory were deleted with TeamPulse as intended.
5. Do not treat `safe-delete-teampulse-workspace.js` (older detach/rehome path) as the canonical final deleter; use `delete-teampulse-workspace-final.js`.

### Scripts

```bash
node scripts/retarget-pules-jira-link-fks.js [--apply]
node scripts/delete-teampulse-workspace-final.js           # dry-run + guards
node scripts/delete-teampulse-workspace-final.js --execute # delete
```

---

## FINAL STATUS

**TEAM_PULSE_DELETED_SUCCESSFULLY**
