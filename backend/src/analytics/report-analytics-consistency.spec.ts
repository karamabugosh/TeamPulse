/**
 * Report analytics consistency — Reports / Overview / Blockers must share counts.
 * Run: npx ts-node src/analytics/report-analytics-consistency.spec.ts
 */
import * as assert from 'assert';
import {
  computeBlockerStats,
  isOpenBlockerStatus,
} from '../jira/blocker-stats.util';

console.log('report-analytics-consistency.spec.ts');

// Blocker open definition used by WorkspaceAnalyticsService (via JiraBlockerService)
const fixtures = [
  { status: 'open', priority: 'critical', createdAt: new Date(), resolvedAt: null },
  { status: 'waiting', priority: 'high', createdAt: new Date(), resolvedAt: null },
  { status: 'resolved', priority: 'low', createdAt: new Date(), resolvedAt: new Date() },
  { status: 'closed', priority: 'medium', createdAt: new Date(), resolvedAt: new Date() },
];

const stats = computeBlockerStats(fixtures);
assert.strictEqual(stats.openBlockers, 2);
assert.strictEqual(stats.total, 4);
assert.ok(isOpenBlockerStatus('investigating'));
assert.ok(!isOpenBlockerStatus('resolved'));
console.log('✓ Blocker stats align with Blockers page semantics');

// Report metrics must not use truncated take:200 for open count
const fullSet = Array.from({ length: 10 }, (_, i) => ({
  status: i < 8 ? 'open' : 'resolved',
  priority: 'medium',
  createdAt: new Date(),
  resolvedAt: i >= 8 ? new Date() : null,
}));
const fullStats = computeBlockerStats(fullSet);
const truncatedStats = computeBlockerStats(fullSet.slice(0, 4));
assert.strictEqual(fullStats.openBlockers, 8);
assert.notStrictEqual(truncatedStats.openBlockers, fullStats.openBlockers);
console.log('✓ Full blocker list required — truncation would diverge');

console.log('All report analytics consistency tests passed.');
