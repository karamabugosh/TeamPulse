# AI Context Export

Utility for dumping the latest Pulse workspace context into a single JSON file so another LLM (ChatGPT, Claude, etc.) can answer the same questions as the internal AI Workspace.

## How to run

From `pulse/backend`:

```bash
npm run export:context -- --workspace="TeamPulse Workspace" --limit=20
```

or:

```bash
npx ts-node scripts/export-ai-context.ts --workspace=<workspaceId-or-name> --limit=20
```

`--workspace` accepts a UUID or a Slack workspace name (`Workspace.slackWorkspaceName`). `--limit` is the number of latest standup **runs** (default 20).

Output file (pretty-printed, 2-space indent):

```
backend/exports/ai-context.json
```

The script uses the same Prisma / `DATABASE_URL` as the NestJS backend.

---

## What each exported section contains

| JSON section | Contents | Why it is readable |
|--------------|----------|--------------------|
| `workspace` | `id`, `name` | Tenant identity for the dump |
| `users` | `id`, `name`, `email`, `slackUserId` | Roster used to resolve people in later sections |
| `standupRuns` | Latest N runs: standup name, team, schedule, status, submission counts | Temporal frame for “latest standup” questions |
| `standupSubmissions` | One object per submission: member name, submittedAt, Q/A pairs | Primary evidence for “what did X work on?” |
| `blockers` | Title, description, owner name, reporter, severity, status, linked Jira | Open/historical blocker questions |
| `jiraIssues` | Issue key, summary, status, assignee, priority, reporter, sprint | Current Jira field questions |
| `teamMemory` | `TeamMemoryDocument` title, content, tags | Legacy indexed narrative memory |
| `teamMemoryChunks` | Pulse V2 `MemoryChunk` text + tags + owner/team | Actual RAG Team Memory used by Ask Pulse |
| `aiDigests` | Executive summary, recommendations, highlights | Report / weekly / sprint narrative |

Foreign keys are resolved to names. Example:

```json
{
  "member": "Karam Waleed",
  "submittedAt": "2026-08-21T06:12:00.000Z",
  "answers": [
    {
      "question": "What did you complete yesterday?",
      "answer": "Finished Dashboard Analytics"
    },
    {
      "question": "What are you working on today?",
      "answer": "Testing OAuth"
    },
    {
      "question": "Any blockers?",
      "answer": "Waiting for API review"
    }
  ]
}
```

Slack mentions (`<@U…>`) and bare Slack IDs in text are replaced with display / real names before write.

---

## Prisma models queried

| Section | Model(s) |
|---------|----------|
| Workspace | `Workspace` |
| Users | `User` |
| Standup runs + submissions | `StandupRun` → `Team`, `CheckIn`, `StandupSubmission` → `User`, `Answer` → `Question` |
| Blockers | `PulseBlocker` → `User` (`ownerLabel` resolved via Slack name map) |
| Jira issues | `JiraIssueCacheEntry` |
| Team memory | `TeamMemoryDocument` |
| Team memory (V2 RAG) | `MemoryChunk` → `User` (owner), `Team` |
| AI reports | `AiDigest` → `Team`, `StandupRun` → `CheckIn` (`summary` + `reportSections`) |

Notes:

- `Workspace` has no `name` column; export `name` is `slackWorkspaceName`.
- `JiraIssueCacheEntry` stores assignee, status, summary, and priority. **Reporter** and **sprint** are not persisted on that table, so those fields are exported as `null` unless a later cache schema adds them. Do not invent them.
- `TeamMemoryDocument` has no `tags` column; tags are taken from `metadata.tags` / `metadata.labels` when present.

---

## Why each section is needed for RAG evaluation

The AI Workspace answers from several sources. A ChatGPT comparison is only fair if the dump includes the same classes of evidence:

1. **Standup submissions** — authoritative answers for “what did Karam complete?”, “latest standup”, personal status.
2. **Standup runs** — which run is latest, which check-in / team it belongs to (without this, “latest” is ambiguous).
3. **Blockers** — owner, severity, status, linked issue. Matches Blockers page + Ask Pulse blocker retrieval.
4. **Jira issues** — current issue fields (status / assignee / priority). Live Jira is still the product authority; the cache is what the workspace currently has stored.
5. **Team memory / memory chunks** — historical narrative (standups, blockers, reports) that RAG retrieves. Chunks are the Pulse V2 retrieval unit; documents are the older index.
6. **AI digests** — already-generated executive summaries, highlights, and recommendations. Needed to compare “what did Pulse already conclude?” vs a fresh ChatGPT summary.
7. **Users** — name resolution so the other LLM does not see Slack IDs.

Without submissions + blockers + Jira + memory, ChatGPT will hallucinate or under-answer relative to Ask Pulse.

---

## Using the JSON to compare ChatGPT vs AI Workspace

1. Export the workspace:

   ```bash
   cd pulse/backend
   npm run export:context -- --workspace="<your workspace name>" --limit=20
   ```

2. Open `backend/exports/ai-context.json`. Confirm names are human-readable and Slack IDs are gone from narrative fields.

3. Paste the JSON (or a section) into ChatGPT with instructions such as:

   > You are answering as Pulse AI Workspace. Use ONLY the attached JSON. Do not invent people, issues, dates, or statuses. If the JSON does not contain the answer, say you could not find it.

4. Ask the same questions in the Pulse AI Workspace UI, for example:

   - Show all issues assigned to Karam.
   - Who owns the open blockers?
   - What did the team complete in the latest standup?
   - Summarize this week’s risks and recommendations.

5. Score side by side:

   | Check | Pulse AI Workspace | ChatGPT + JSON |
   |-------|--------------------|----------------|
   | Names human-readable | | |
   | Jira fields match cache | | |
   | Blocker owners match | | |
   | Latest standup (not an older run) | | |
   | No invented issues / people | | |

6. If answers diverge, inspect which JSON section the fact lives in. Gaps usually mean:

   - `--limit` too small (older standups missing)
   - Jira reporter/sprint not in cache
   - Memory chunks not backfilled for that source

Do not treat ChatGPT + this dump as Live Jira. The export is a **snapshot of PostgreSQL context**, not a live Atlassian call.
