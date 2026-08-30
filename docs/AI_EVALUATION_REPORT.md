# AI Evaluation Framework — Report

**Date:** August 19, 2026  
**Module:** Pulse AI Workspace Evaluation  
**Constraint honored:** The live AI chat flow (`AiChatService` / RAG pipeline) was **not modified**. Evaluation calls `chat()` as an external client.

---

## Architecture

```
Gold templates (gold-dataset.ts)
        │
        ▼
AiEvalDatasetService.seedForWorkspace()
        │
        ▼
AiEvalCase (PostgreSQL, per workspaceId)
        │
        ▼
AiEvalRunnerService.run()
        │  (calls existing AiChatService.chat — no chat changes)
        ▼
Scoring + Hallucination + Missing-context detectors
        │
        ▼
AiEvalRun + AiEvalResult (audit log)
        │
        ├── Dashboard API / UI (/ai-evaluation)
        └── Export Markdown / CSV / PDF
```

**Isolation:** every case, run, and result row is keyed by `workspaceId`. Demo seeding resolves `T_DEMO_PULSE_WS`.

---

## Evaluation Flow

1. Seed gold cases into the active or Demo workspace (`POST /api/ai/eval/cases/seed`).
2. Start a run (`POST /api/ai/eval/runs`).
3. For each enabled case:
   - Ask via `AiChatService.chat({ workspaceId, conversationId: null, question })`.
   - Compare AI answer vs expected answer / sources / confidence.
   - Detect hallucinations and missing context.
   - Persist `AiEvalResult` (question, expected, AI answer, score, timestamp).
4. Aggregate pass/fail, averages, overall 0–100 on `AiEvalRun`.
5. Review in `/ai-evaluation` or export.

---

## Scoring Method

Deterministic heuristics (stable for regression; no LLM-as-judge):

| Metric | How it is computed |
|--------|--------------------|
| Answer Accuracy | Token Jaccard vs expected answer |
| Completeness / Context Coverage | Must-include phrase coverage |
| Retrieval Accuracy / Source Usage | Expected vs actual source label overlap |
| Confidence Calibration | Expected vs actual High/Medium/Low band |
| Hallucination Risk | `100 − penalty` from detector flags |
| Response Length Score | Soft band for too-short / too-long answers |
| **Overall (0–100)** | Weighted blend of the above |

**Pass rule:** `overallScore >= passThreshold` (default **60**).

### Hallucination detection

Flags when the answer:

- References unknown Jira keys
- References unknown people
- Asserts detail with zero sources
- Fails a gold “hallucination-trap” case (should deny missing entity)

### Missing context detection

Uses `insufficientData`, retrieval diagnostics, and answer phrasing to label:

- Missing Jira Issue  
- Missing Standup  
- Missing Slack Thread  
- Missing Blocker / Report / Team Memory / User  

---

## API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/ai/eval/health` | Module health |
| `GET` | `/api/ai/eval/cases/templates` | In-code gold templates |
| `GET` | `/api/ai/eval/cases` | Seeded cases for workspace |
| `POST` | `/api/ai/eval/cases/seed` | Upsert gold cases |
| `GET` | `/api/ai/eval/dashboard` | Dashboard aggregates |
| `GET` | `/api/ai/eval/runs` | Run history |
| `GET` | `/api/ai/eval/runs/:id` | Run + results |
| `POST` | `/api/ai/eval/runs` | Execute evaluation |
| `GET` | `/api/ai/eval/runs/:id/export?format=` | `markdown` \| `csv` \| `pdf` |

---

## Database changes

Migration `20260819160000_ai_evaluation_framework`:

- **`AiEvalCase`** — gold answers per workspace (`caseKey`, category, question, expectedAnswer, expectedSources, expectedConfidence, tags)
- **`AiEvalRun`** — run summary / regression history
- **`AiEvalResult`** — full per-question audit

---

## Files modified / created

### Backend (new)

- `src/ai/workspace/evaluation/gold-dataset.ts` (20 gold cases)
- `src/ai/workspace/evaluation/scoring.util.ts`
- `src/ai/workspace/evaluation/hallucination.detector.ts`
- `src/ai/workspace/evaluation/missing-context.detector.ts`
- `src/ai/workspace/evaluation/ai-eval-dataset.service.ts`
- `src/ai/workspace/evaluation/ai-eval-runner.service.ts`
- `src/ai/workspace/evaluation/ai-eval-export.service.ts`
- `src/ai/workspace/evaluation/ai-eval.controller.ts`
- `src/ai/workspace/evaluation/ai-eval-framework.spec.ts`
- `src/ai/workspace/evaluation/run-ai-eval-framework.ts`
- `prisma/migrations/20260819160000_ai_evaluation_framework/`

### Backend (modified)

- `prisma/schema.prisma`
- `src/ai/ai.module.ts`
- `package.json` (`test:ai-eval-framework`)

### Frontend

- `src/pages/AiEvaluationPage.tsx` **(new)**
- `src/app/App.tsx` — route `/ai-evaluation`
- `src/components/dashboard/AppSidebar.tsx` — nav link

### Docs

- `docs/AI_EVALUATION_REPORT.md`

**Not modified:** `AiChatService`, RAG pipeline, prompt builder, retrieval services.

---

## Regression testing

```bash
cd pulse/backend
npm run test:ai-eval-framework          # offline unit tests
AI_EVAL_LIVE=1 npm run test:ai-eval-framework   # live Demo/active run
AI_EVAL_LIVE=1 AI_EVAL_LIMIT=3 npm run test:ai-eval-framework
```

UI: **AI Evaluation** → Seed → Run evaluation → Export.

---

## Remaining improvements

- Optional LLM-as-judge for semantic answer grading
- Baseline snapshot / fail CI when score drops below last approved run
- Per-category scorecards and trend charts
- Exclude eval conversations from user-facing history UI
- Richer PDF layout (current PDF is minimal text)
- Expand gold set with production traces
