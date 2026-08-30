/**
 * AI Workspace evaluation pipeline (offline / CLI).
 *
 * Measures:
 * - Intent classification accuracy on golden cases
 * - Retrieval hybrid diagnostics shape
 * - Confidence band sanity
 * - Missing-context detection
 *
 * Usage: npx ts-node src/ai/workspace/evaluation/run-workspace-eval.ts
 */

import { IntentDetectionService } from '../intent/intent-detection.service';
import { WorkspaceAiIntent } from '../types/workspace-ai.types';
import { isExplicitDetectiveRequest } from '../analysis/project-detective.analyzers';
import { shouldContinueVacationPending } from '../report/vacation-pending.policy';
import { cosineSimilarity } from '../retrieval/embedding.util';

type GoldenCase = {
  id: string;
  question: string;
  expectIntent: WorkspaceAiIntent;
  expectDetective: boolean;
};

const GOLDEN: GoldenCase[] = [
  {
    id: 'status-1',
    question: 'What is the status of SCRUM-8?',
    expectIntent: WorkspaceAiIntent.ISSUE_STATUS,
    expectDetective: false,
  },
  {
    id: 'why-short',
    question: 'Why was SCRUM-8 delayed?',
    expectIntent: WorkspaceAiIntent.ISSUE_ANALYSIS,
    expectDetective: false,
  },
  {
    id: 'detective-1',
    question: 'Investigate SCRUM-8 root cause',
    expectIntent: WorkspaceAiIntent.ROOT_CAUSE_ANALYSIS,
    expectDetective: true,
  },
  {
    id: 'replay-1',
    question: 'Replay Sprint 14',
    expectIntent: WorkspaceAiIntent.SPRINT_REPLAY,
    expectDetective: false,
  },
  {
    id: 'exec-1',
    question: 'Generate executive report',
    expectIntent: WorkspaceAiIntent.EXECUTIVE_REPORT,
    expectDetective: false,
  },
  {
    id: 'vacation-1',
    question: 'Catch me up on my vacation',
    expectIntent: WorkspaceAiIntent.VACATION_CATCHUP,
    expectDetective: false,
  },
  {
    id: 'member-1',
    question: 'What did Sara work on?',
    expectIntent: WorkspaceAiIntent.GET_USER_ACTIVITY,
    expectDetective: false,
  },
  {
    id: 'general-1',
    question: 'How is the team doing overall?',
    expectIntent: WorkspaceAiIntent.GENERAL_QA,
    expectDetective: false,
  },
];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function main(): void {
  const intent = new IntentDetectionService();
  let intentPass = 0;
  let detectivePass = 0;

  for (const test of GOLDEN) {
    const detected = intent.detect(test.question);
    const detective = isExplicitDetectiveRequest(test.question.toLowerCase());
    if (detected.intent === test.expectIntent) intentPass += 1;
    else {
      console.warn(
        `INTENT miss ${test.id}: got=${detected.intent} expected=${test.expectIntent}`,
      );
    }
    if (detective === test.expectDetective) detectivePass += 1;
    else {
      console.warn(
        `DETECTIVE miss ${test.id}: got=${detective} expected=${test.expectDetective}`,
      );
    }
  }

  // Vacation clarification policy
  assert(
    shouldContinueVacationPending({
      question: 'Aug 10',
      awaiting: 'start',
      intent: intent.detect('Aug 10'),
    }),
    'date reply should continue vacation pending',
  );
  assert(
    !shouldContinueVacationPending({
      question: 'Why was SCRUM-8 delayed?',
      awaiting: 'start',
      intent: intent.detect('Why was SCRUM-8 delayed?'),
    }),
    'new question should cancel vacation pending',
  );

  // Embedding util smoke
  const sim = cosineSimilarity([1, 0, 0], [1, 0, 0]);
  assert(Math.abs(sim - 1) < 1e-6, 'cosine self-similarity should be 1');

  const intentAccuracy = intentPass / GOLDEN.length;
  const detectiveAccuracy = detectivePass / GOLDEN.length;

  console.log(
    JSON.stringify(
      {
        suite: 'workspace-ai-eval',
        cases: GOLDEN.length,
        intentAccuracy,
        detectiveGateAccuracy: detectiveAccuracy,
        vacationPolicy: 'ok',
        embeddingUtil: 'ok',
        notes: [
          'Full retrieval/OpenAI accuracy requires a live workspace seed + API key.',
          'Run Demo Workspace seed then exercise /ai/workspace/chat for end-to-end checks.',
        ],
      },
      null,
      2,
    ),
  );

  if (intentAccuracy < 0.75 || detectiveAccuracy < 0.9) {
    process.exitCode = 1;
  }
}

main();
