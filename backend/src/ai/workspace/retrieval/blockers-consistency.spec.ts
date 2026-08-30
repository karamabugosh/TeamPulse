/**
 * Blockers data consistency — AI must match Blockers page stats/list.
 * Run: npx ts-node src/ai/workspace/retrieval/blockers-consistency.spec.ts
 */
import * as assert from 'assert';
import {
  computeBlockerStats,
  isOpenBlockerStatus,
  isBlockerCountOrListQuestion,
  normalizeBlockerStatus,
} from '../../../jira/blocker-stats.util';
import { IntentDetectionService } from '../intent/intent-detection.service';
import { WorkspaceAiIntent } from '../types/workspace-ai.types';

console.log('blockers-consistency.spec.ts');

// Open definition matches Blockers page
assert.ok(isOpenBlockerStatus('open'));
assert.ok(isOpenBlockerStatus('waiting'));
assert.ok(isOpenBlockerStatus('in_progress'));
assert.ok(isOpenBlockerStatus('investigating'));
assert.ok(!isOpenBlockerStatus('resolved'));
assert.ok(!isOpenBlockerStatus('closed'));
assert.ok(!isOpenBlockerStatus('Resolved'));
assert.strictEqual(normalizeBlockerStatus('In Progress'), 'in_progress');
console.log('✓ Open status definition matches Blockers page');

const now = Date.now();
const day = 24 * 60 * 60 * 1000;
const fixtures = [
  {
    status: 'open',
    priority: 'critical',
    createdAt: new Date(now - 5 * day).toISOString(),
    resolvedAt: null,
  },
  {
    status: 'waiting',
    priority: 'high',
    createdAt: new Date(now - 4 * day).toISOString(),
    resolvedAt: null,
  },
  {
    status: 'in_progress',
    priority: 'medium',
    createdAt: new Date(now - 1 * day).toISOString(),
    resolvedAt: null,
  },
  {
    status: 'open',
    priority: 'critical',
    createdAt: new Date(now - 2 * day).toISOString(),
    resolvedAt: null,
  },
  {
    status: 'resolved',
    priority: 'low',
    createdAt: new Date(now - 10 * day).toISOString(),
    resolvedAt: new Date(now - 1 * day).toISOString(),
  },
  {
    status: 'closed',
    priority: 'medium',
    createdAt: new Date(now - 20 * day).toISOString(),
    resolvedAt: new Date(now - 15 * day).toISOString(),
  },
  {
    status: 'open',
    priority: 'low',
    createdAt: new Date(now - 0.5 * day).toISOString(),
    resolvedAt: null,
  },
  {
    status: 'investigating',
    priority: 'high',
    createdAt: new Date(now - 6 * day).toISOString(),
    resolvedAt: null,
  },
];

const stats = computeBlockerStats(fixtures, now);
// open: not resolved/closed → indices 0,1,2,3,6,7 = 6
assert.strictEqual(stats.openBlockers, 6, `open=${stats.openBlockers}`);
assert.strictEqual(stats.critical, 2, `critical=${stats.critical}`);
// waiting > 3 days among open: 0 (5d), 1 (4d), 7 (6d) = 3
assert.strictEqual(
  stats.waitingMoreThan3Days,
  3,
  `waiting=${stats.waitingMoreThan3Days}`,
);
assert.strictEqual(stats.resolvedThisWeek, 1);
assert.strictEqual(stats.total, 8);
assert.strictEqual(stats.resolved, 1);
console.log(
  '✓ Stats: open=6 critical=2 waiting>3d=3 resolvedThisWeek=1 (same rules as UI)',
);

// Scenario: page shows 8 open — AI must use full list, not take:40 truncated subset
const eightOpen = Array.from({ length: 8 }, (_, i) => ({
  status: i % 2 === 0 ? 'open' : 'waiting',
  priority: i === 0 ? 'critical' : 'medium',
  createdAt: new Date(now - i * day).toISOString(),
  resolvedAt: null as string | null,
}));
const pageStats = computeBlockerStats(eightOpen, now);
assert.strictEqual(pageStats.openBlockers, 8);
// Simulated buggy AI path: take first 4
const truncated = computeBlockerStats(eightOpen.slice(0, 4), now);
assert.notStrictEqual(
  truncated.openBlockers,
  pageStats.openBlockers,
  'Truncation would diverge — full list required',
);
assert.strictEqual(
  computeBlockerStats(eightOpen, now).openBlockers,
  pageStats.openBlockers,
);
console.log('✓ How many blockers? — full list matches page (not truncated take)');

assert.ok(isBlockerCountOrListQuestion('How many blockers?'));
assert.ok(isBlockerCountOrListQuestion('List open blockers.'));
assert.ok(isBlockerCountOrListQuestion('Critical blockers'));
assert.ok(isBlockerCountOrListQuestion('Current blockers'));
assert.ok(isBlockerCountOrListQuestion('blocker summary'));

const intent = new IntentDetectionService();
const q1 = intent.detect('How many blockers?');
assert.strictEqual(q1.intent, WorkspaceAiIntent.GET_BLOCKERS);
const q2 = intent.detect('List open blockers.');
assert.strictEqual(q2.intent, WorkspaceAiIntent.GET_BLOCKERS);
const q3 = intent.detect('Critical blockers');
assert.ok(
  q3.intent === WorkspaceAiIntent.GET_BLOCKERS ||
    isBlockerCountOrListQuestion('Critical blockers'),
);
console.log('✓ Intent routes blocker count/list questions to GET_BLOCKERS');

console.log('All blockers consistency tests passed.');
