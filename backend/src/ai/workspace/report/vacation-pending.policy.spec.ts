/**
 * Automated tests for synonym expansion + vacation pending clarification.
 *
 * Run: npx ts-node src/ai/workspace/report/vacation-pending.policy.spec.ts
 *      npx ts-node src/ai/workspace/retrieval/keyword.util.spec.ts
 */

import * as assert from 'assert';
import { IntentDetectionService } from '../intent/intent-detection.service';
import {
  isVacationClarificationReply,
  shouldContinueVacationPending,
} from './vacation-pending.policy';

const intent = new IntentDetectionService();

function assertContinue(question: string, expectContinue: boolean, label: string) {
  const detected = intent.detect(question);
  const actual = shouldContinueVacationPending({
    question,
    awaiting: 'start',
    intent: detected,
  });
  assert.strictEqual(
    actual,
    expectContinue,
    `${label}\n  question="${question}"\n  intent=${detected.intent} (${detected.confidence})\n  expected continue=${expectContinue} got=${actual}`,
  );
}

console.log('vacation-pending.policy.spec.ts');

assert.strictEqual(isVacationClarificationReply('Aug 10'), true);
assert.strictEqual(isVacationClarificationReply('August 10'), true);
assert.strictEqual(isVacationClarificationReply('2026-08-10'), true);
assert.strictEqual(isVacationClarificationReply('Last Monday'), true);
assertContinue('Aug 10', true, 'date Aug 10 continues');
assertContinue('2026-08-10', true, 'ISO date continues');
assertContinue('August 10', true, 'August 10 continues');
assertContinue('Last Monday', true, 'Last Monday continues');

assertContinue(
  'Why did SCRUM-8 get delayed despite having two developers assigned?',
  false,
  'SCRUM-8 delay cancels pending',
);
assertContinue('Why was SCRUM-8 delayed?', false, 'Why SCRUM-8 delayed cancels');
assertContinue('Generate sprint report', false, 'sprint report cancels');
assertContinue('generate a sprint report', false, 'generate sprint report cancels');
assertContinue('Who has the highest workload?', false, 'highest workload cancels');
assertContinue(
  'What architectural decisions were made last month?',
  false,
  'architecture Q cancels',
);
assertContinue(
  'Show all AI conversations related to OAuth',
  false,
  'OAuth AI chats cancel',
);

// Intent must not sticky-continue vacation for unrelated asks
const scrumIntent = intent.detect('Why was SCRUM-8 delayed?');
assert.notStrictEqual(
  scrumIntent.intent,
  'VACATION_CATCHUP',
  'SCRUM-8 delay must not detect as vacation',
);

// Catch-up hard overrides
const catchupCases = [
  'Catch me up on my vacation',
  'What happened while I was away?',
  'Summarize everything since Aug 8, 2026',
  'What did I miss',
  'Give me an update',
];
for (const q of catchupCases) {
  const detected = intent.detect(q);
  assert.strictEqual(
    detected.intent,
    'VACATION_CATCHUP',
    `expected VACATION_CATCHUP for "${q}" got ${detected.intent}`,
  );
}

const sinceIntent = intent.detect('Summarize everything since Aug 8, 2026');
assert.ok(
  sinceIntent.filters.dateFrom,
  'since-date catch-up should set dateFrom filter',
);

console.log('All vacation-pending policy tests passed.');
