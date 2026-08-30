/**
 * Offline unit tests for AI evaluation scoring / detectors.
 * Does not call OpenAI or mutate the chat flow.
 *
 * Run: npm run test:ai-eval-framework
 */
import * as assert from 'assert';
import { GOLD_EVAL_DATASET } from './gold-dataset';
import { detectHallucinations } from './hallucination.detector';
import { detectMissingContext } from './missing-context.detector';
import {
  computeEvalScores,
  extractIssueKeys,
  sourceOverlap,
} from './scoring.util';

console.log('ai-eval-framework.spec.ts');

assert.ok(GOLD_EVAL_DATASET.length >= 15, 'gold dataset should have enough cases');
assert.ok(
  GOLD_EVAL_DATASET.some((item) => item.category === 'Project Detective'),
);
assert.ok(
  GOLD_EVAL_DATASET.some((item) => item.tags.includes('hallucination-trap')),
);

const good = computeEvalScores({
  expectedAnswer:
    'SCRUM-8 was delayed because Sara was blocked on OAuth callback SCRUM-12.',
  aiAnswer:
    'SCRUM-8 slipped while Sara waited on the OAuth callback owned by SCRUM-12.',
  expectedSources: ['jira', 'blockers'],
  aiSources: ['jira', 'blockers', 'standups'],
  expectedConfidence: 'High',
  aiConfidence: 'High',
  mustInclude: ['SCRUM-8', 'Sara', 'OAuth', 'SCRUM-12'],
  hallucinationPenalty: 0,
  missingContextPenalty: 0,
});
assert.ok(good.overall >= 55, `expected solid score, got ${good.overall}`);
assert.ok(good.answerAccuracy > 0);
assert.ok(good.retrievalAccuracy >= 80);

const hallucinated = detectHallucinations({
  aiAnswer: 'Zephyr Quantum closed SCRUM-9999 yesterday with no issues.',
  expectedAnswer: 'User not found.',
  knownIssueKeys: ['SCRUM-8', 'SCRUM-12'],
  knownUserNames: ['Sara Alami', 'Nora Farid'],
  aiSources: [],
  tags: ['hallucination-trap'],
});
assert.ok(hallucinated.flags.length >= 1);
assert.ok(hallucinated.penalty > 0);

const missing = detectMissingContext({
  question: 'What is the status of SCRUM-9999?',
  aiAnswer: 'I could not find SCRUM-9999 in Jira for this workspace.',
  insufficientData: true,
  tags: ['hallucination-trap'],
});
assert.ok(missing.detected);
assert.ok(
  missing.findings.some((finding) => finding.code === 'missing_jira_issue'),
);

assert.deepStrictEqual(extractIssueKeys('See SCRUM-8 and scrum-12'), [
  'SCRUM-8',
  'SCRUM-12',
]);
assert.ok(sourceOverlap(['jira'], ['Jira Issues']) >= 0.99);

console.log(
  `Gold cases=${GOLD_EVAL_DATASET.length} sampleOverall=${good.overall}`,
);
console.log('All AI evaluation framework unit tests passed.');
