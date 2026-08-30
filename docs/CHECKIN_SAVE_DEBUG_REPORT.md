# Check-in Save Debug Report

**Product:** Pulse  
**Date:** 2026-08-20  
**Scope:** Create / Edit Check-in persistence (UI → NestJS → Prisma → PostgreSQL → UI refresh)

---

## 1. Root cause

Several compounding issues made saves appear broken even when Prisma could write:

1. **Workspace mismatch (primary UX failure)**  
   `GET /api/check-ins` was scoped to `X-Workspace-Id`, but **CheckInsPage did not reload when the workspace switched**. The UI kept stale teams/check-ins from the previous workspace while `apiFetch` sent the new workspace header. Creates then failed with “Team not found” (or succeeded into the wrong mental model), so refresh looked like “nothing persisted.”

2. **Update ignored `teamId`**  
   The form always sent `teamId`, but `UpdateCheckInDto` / `CheckInService.update` never applied it. Participants were validated against the **old** team, so team changes + participant edits failed with 400s.

3. **Participant picker used raw `fetch`**  
   `/api/admin/teams/:id/members` was called without `X-Workspace-Id` and errors were swallowed → empty member list → participants never saved from the UI.

4. **Disabled questions dropped on reload**  
   Edit load filtered `isActive !== false`, so toggling a question off, saving, then reopening lost those rows and the next save deleted them.

5. **Incomplete workspace isolation on mutations**  
   `findOne` / `update` / `remove` / `setEnabled` were not always scoped to the active workspace (list was), which made cross-workspace confusion easy.

Prisma nested writes for create/update were largely correct; the pipeline broke above and around them (workspace + DTO + UI reload).

---

## 2. Files inspected

| Area | Paths |
|------|--------|
| Frontend form | `frontend/src/components/checkins/CheckInFormDialog.tsx` |
| Participants | `frontend/src/components/checkins/ParticipantPicker.tsx` |
| Questions | `frontend/src/components/checkins/QuestionBuilder.tsx` |
| Page | `frontend/src/pages/CheckInsPage.tsx` |
| API client | `frontend/src/lib/api.ts`, `frontend/src/lib/workspace-context.tsx` |
| Backend | `backend/src/check-in/check-in.controller.ts`, `check-in.service.ts` |
| DTOs | `backend/src/check-in/dto/create-check-in.dto.ts`, `update-check-in.dto.ts` |
| Schema | `backend/prisma/schema.prisma` (`CheckIn`, `Question`, `CheckInParticipant`) |
| Workspace ALS | `backend/src/common/workspace-context.ts`, `backend/src/main.ts` |

---

## 3. Files modified

- `backend/src/check-in/check-in.service.ts`
- `backend/src/check-in/check-in.controller.ts`
- `backend/src/check-in/dto/update-check-in.dto.ts`
- `frontend/src/pages/CheckInsPage.tsx`
- `frontend/src/components/checkins/CheckInFormDialog.tsx`
- `frontend/src/components/checkins/ParticipantPicker.tsx`
- `frontend/src/lib/api.ts`
- `docs/CHECKIN_SAVE_DEBUG_REPORT.md` (this file)

---

## 4. Database tables affected

| Table | Role |
|-------|------|
| `CheckIn` | Core config: name, schedule (`collectionCron`, `timezone`, `scheduleEnabled`), reminders, report fields, `enabled`, `publishStatus`, `teamId` |
| `Question` | Nested create / sync on update (`order`, `type`, `isRequired`, `isActive`, `options`) |
| `CheckInParticipant` | Replace-all on update when `participantIds` sent |
| `Team` / `TeamMember` | Validation that team + participants belong to active workspace |

**Note:** Schedule / reminders / reports are **columns on `CheckIn`**, not separate `CheckInSchedule` / `CheckInReminder` tables.

---

## 5. API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/check-ins` | Create (workspace-scoped team) |
| `PATCH` | `/api/check-ins/:id` | Update including `teamId`, questions, participants, schedule, reminders, reports |
| `GET` | `/api/check-ins` | List for active workspace |
| `GET` | `/api/check-ins/:id` | Read-back after save (workspace-scoped) |
| `DELETE` | `/api/check-ins/:id` | Delete (workspace-scoped) |
| `GET` | `/api/admin/teams` | Teams for form |
| `GET` | `/api/admin/teams/:teamId/members` | Participant picker |

All frontend calls use `apiFetch` → header `X-Workspace-Id`.

---

## 6. Prisma queries

**Create** (`$transaction`):

- `checkIn.create` with nested `questions.create` and `participants.create`
- `checkIn.findUnique` + `includeRelations` for response

**Update** (`$transaction`):

- Optional `checkInParticipant.deleteMany` + `createMany`
- `syncCheckInQuestions`: update by id / create new / soft-deactivate (if answers) or delete removed questions
- `checkIn.update` including `teamId` when provided
- `findUnique` + includes for response

**Read / isolate:**

- `findMany` / `findFirst` with `team: { workspaceId }` from `resolveActiveWorkspaceId`

---

## 7. Validation fixes

- Update validates non-empty `teamId` when provided
- Participants validated against **effective** team (after team change)
- Team must belong to active workspace on create and team change
- Check-in must belong to active workspace on find/update/delete/enable
- Frontend pre-validates team, name, and non-empty question text before POST/PATCH
- `ApiError` formats Nest array `message` values cleanly

---

## 8. Frontend fixes

- **CheckInsPage** reloads list + teams when `workspaceId` changes; after save always re-fetches from API
- **CheckInFormDialog** builds an explicit DTO payload (no silent drop of fields); keeps disabled questions on load
- **ParticipantPicker** uses `apiFetch` + surfaces load errors
- Team load failures show a toast instead of failing silently

---

## 9. Backend fixes

- Workspace helpers: `assertTeamInActiveWorkspace`, `assertCheckInInActiveWorkspace`
- `UpdateCheckInDto.teamId` + persistence in `update`
- Workspace scope on `findOne` / `update` / `remove` / `setEnabled`
- Controller + service logging for create/update (workspace, team, question/participant counts)

---

## 10. Test results

Automated live API + Prisma verification against workspace **Pules project**:

| Test | Result |
|------|--------|
| Create with questions + participants + schedule + reminders + report cron | Pass — row present in PostgreSQL |
| Update name, enabled, schedule, reminders, report mode, participants | Pass |
| Delete question / reorder / add question / toggle required & active | Pass |
| GET read-back matches DB | Pass |
| List includes created check-in for same workspace | Pass |
| Cross-workspace GET/list isolation (Demo workspace) | Pass |
| DELETE removes row | Pass |

---

## 11. Remaining issues

- **Daily Standup Form** (`/checkins/standup`) is still **UI-only** by design (badge: “UI only”). It does not POST answers to the API; that is separate from Check-in **configuration** save.
- Scheduler reconciliation after save still soft-fails (logged) if job refresh errors; configuration remains in PostgreSQL and `/scheduler/refresh` can recover.
- No automated Jest suite was added for this flow; verification was via live HTTP + Prisma script during this debug pass.

---

## Flow (fixed)

```
CheckInFormDialog.handleSubmit
  → apiFetch POST/PATCH /api/check-ins (+ X-Workspace-Id)
  → CheckInController (logged)
  → CheckInService.create/update (workspace assert + validate + $transaction)
  → Prisma nested writes → PostgreSQL commit
  → GET /api/check-ins/:id read-back
  → onSaved → CheckInsPage.loadData (PostgreSQL list for active workspace)
```
