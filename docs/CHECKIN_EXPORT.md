# Check-in (Standup) CSV Export

Export standup / check-in runs from PostgreSQL into a human-readable CSV. Foreign keys are resolved to names, question titles, and answer text — the file does not use raw IDs as the primary content.

## Output

| Path | Description |
|------|-------------|
| `backend/exports/checkins.csv` | UTF-8 CSV (BOM) with one row per participant submission |

## How to regenerate

From `pulse/backend` (uses `DATABASE_URL` from `.env`):

```bash
cd backend
npm run export:checkins
```

or:

```bash
npx ts-node scripts/export-standups.ts
npx ts-node scripts/export-standups.ts --workspace="Pules project" --limit=20
```

| Flag | Meaning |
|------|---------|
| `--workspace=<id or name>` | Optional. Limit to one workspace. |
| `--limit=N` | Optional. Latest N standup runs. Default: all runs. |

The script creates `backend/exports/` if needed and overwrites `checkins.csv`.

## Prisma models queried

| Model | Role |
|-------|------|
| `StandupRun` | Root rows — ordered by `scheduledFor` / `startedAt` (latest first) |
| `Team` | Team that owns the run (`StandupRun.teamId`) |
| `Workspace` | Workspace display name (`Team.workspaceId` → `slackWorkspaceName`) |
| `CheckIn` | Check-in config on the run; used to discover configured questions |
| `Question` | Question text, type, and order |
| `StandupSubmission` | Per-member participation (status, timestamps) |
| `User` | Member name (`slackRealName` → `slackDisplayName`) |
| `Answer` | Response text + `structuredValue` |
| `AnswerJiraIssueLink` | Linked Jira issue keys when present |

IDs are followed through these relations. CSV cells contain dates, workspace/member names, and answer text.

## How answers are resolved (Question + Answer)

Each `Answer` belongs to a `Question` (`Answer.questionId`) and a `StandupSubmission` (`Answer.submissionId`).

1. Load each run with `team.workspace`, `checkIn.questions`, and `submissions` including `user`, `answers.question`, and `jiraIssueLinks`.
2. Sort answers by `Question.order`.
3. Classify each question into a role using **question type** and **question text** (same idea as report generation):

   | Role | How it is detected | CSV column |
   |------|--------------------|------------|
   | Yesterday | Text matches yesterday / completed / since last update, etc. | `Yesterday` |
   | Today | Text matches today / working on / plan, etc. | `Today` |
   | Blockers | `QuestionType.BLOCKER` or text matches blocker language | `Blockers` |
   | Jira | `QuestionType.ISSUE_REF`, Jira-like question text, and/or `AnswerJiraIssueLink` | `Jira Issue` |
   | Other | Anything else configured or answered | Dynamic column named after the question text |

4. Display text comes from `Answer.text`, with `structuredValue` used for Jira issue refs (`formatAnswerForDisplay` / `enrichAnswerForAnalysis`).
5. Jira keys prefer `AnswerJiraIssueLink.issueKey`, then ISSUE_REF snapshots, then keys parsed from the answer text. Multiple keys are joined with `; `.

Submissions with no answers are skipped.

## CSV structure

**Fixed columns**

| Column | Source |
|--------|--------|
| `Run Date` | `StandupRun.scheduledFor` (fallback `startedAt`) as `YYYY-MM-DD` |
| `Workspace` | `Workspace.slackWorkspaceName` (fallback `Team.name`) |
| `Member` | `User.slackRealName` or `User.slackDisplayName` |
| `Submission Time` | `StandupSubmission.completedAt` (fallback `startedAt` / `createdAt`) |
| `Yesterday` | Answer classified as yesterday |
| `Today` | Answer classified as today |
| `Blockers` | Answer classified as blockers |
| `Jira Issue` | Linked / ISSUE_REF / parsed issue key(s) |

**Dynamic columns**

Any other Check-in question (from `CheckIn.questions` or answered `Question` rows that are not yesterday/today/blockers/jira) becomes an extra header using the full question text. The cell is empty when that participant did not answer that question.

Example:

```csv
Run Date,Workspace,Member,Submission Time,Yesterday,Today,Blockers,Jira Issue
2026-08-23,TeamPulse,Karam Waleed,2026-08-23 09:15:00 UTC,"Finished Dashboard","Testing OAuth","Waiting API review",SCRUM-9
2026-08-23,TeamPulse,Rami Atrash,2026-08-23 09:18:00 UTC,"Implemented OAuth","Testing login",None,SCRUM-8
```

## Script location

`backend/scripts/export-standups.ts` — uses `PrismaClient` directly (no Nest bootstrap).
