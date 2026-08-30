/**
 * Assignee list + blocker owner resolution tests.
 * Run: npx ts-node src/ai/workspace/retrieval/assignee-blocker-owner.spec.ts
 */
import * as assert from 'assert';
import {
  assigneeMatchesPersonQuery,
  extractAssigneeFromQuestion,
  isAssigneeListQuestion,
  normalizePersonName,
  rankAssigneeCandidateScore,
} from './assignee-match.util';
import { resolveBlockerOwner } from './blocker-owner.util';
import { SLACK_MEMBER_ID_RE } from '../../../common/slack-member.util';

console.log('assignee-blocker-owner.spec.ts');

// Assignee partial match
{
  const candidates = {
    query: 'Karam',
    displayNames: ['Karam Waleed'],
    accountIds: [],
    workspaceMemberNames: ['Karam Waleed'],
  };
  assert.ok(
    assigneeMatchesPersonQuery('Karam', 'Karam Waleed', null, candidates),
  );
  assert.ok(
    assigneeMatchesPersonQuery('Karam', 'Karam W.', null, candidates),
  );
  assert.ok(!assigneeMatchesPersonQuery('Karam', 'Rami Atrash', null, candidates));
  console.log('✓ Partial assignee match: Karam → Karam Waleed / Karam W.');
}

// Normalized names
{
  assert.strictEqual(normalizePersonName('Karam W.'), 'karam w');
  assert.strictEqual(normalizePersonName('Karam  Waleed'), 'karam waleed');
  console.log('✓ normalizePersonName');
}

// Workspace member ranked first
{
  const ws = rankAssigneeCandidateScore('Karam', 'Karam Waleed', true);
  const jira = rankAssigneeCandidateScore('Karam', 'Karam Waleed', false);
  assert.ok(ws > jira);
  console.log('✓ Workspace members rank above Jira-only names');
}

// Assignee list question detection
{
  assert.ok(isAssigneeListQuestion('Show all issues assigned to Karam'));
  assert.ok(isAssigneeListQuestion('List issues assigned to Rami'));
  assert.strictEqual(
    extractAssigneeFromQuestion('Show all issues assigned to Karam'),
    'Karam',
  );
  console.log('✓ Assignee list question detection');
}

// Blocker owner — never expose Slack ID
{
  const nameMap = new Map<string, string>([
    ['B0BLVE1NSSC', 'Rami Atrash'],
  ]);
  const userBySlackId = new Map([
    [
      'B0BLVE1NSSC',
      {
        id: 'user-1',
        slackDisplayName: 'Rami Atrash',
        slackRealName: 'Rami Atrash',
      },
    ],
  ]);

  const resolved = resolveBlockerOwner({
    ownerLabel: 'B0BLVE1NSSC',
    nameBySlackId: nameMap,
    userBySlackId,
  });
  assert.strictEqual(resolved.ownerName, 'Rami Atrash');
  assert.strictEqual(resolved.ownerSlackId, 'B0BLVE1NSSC');
  assert.strictEqual(resolved.ownerUserId, 'user-1');
  assert.ok(!SLACK_MEMBER_ID_RE.test(resolved.ownerName));

  const unknown = resolveBlockerOwner({
    ownerLabel: 'UUNKNOWN999',
    nameBySlackId: new Map(),
  });
  assert.strictEqual(unknown.ownerName, 'Unknown User');
  console.log('✓ Blocker owner resolves Slack ID → display name');
}

console.log('All assignee-blocker-owner tests passed.');
