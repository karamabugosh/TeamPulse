/**
 * Report Slack user resolution tests.
 * Run: npx ts-node src/common/report-slack-resolution.spec.ts
 */
import * as assert from 'assert';
import {
  digestContainsSlackUserIds,
  resolveSlackIdsInDigest,
} from './report-slack-resolution.util';
import {
  resolveAllSlackIdsInText,
  textContainsSlackUserId,
  lookupSlackDisplayName,
} from './slack-member.util';
import { EMPTY_REPORT_SECTIONS, BlockerSeverity } from '../ai/dto/ai-result.dto';

console.log('report-slack-resolution.spec.ts');

const nameMap = new Map<string, string>([
  ['U0BLV9YR87J', 'Karam Waleed'],
  ['u0blv9yr87j', 'Karam Waleed'],
]);

{
  assert.strictEqual(
    resolveAllSlackIdsInText('U0BLV9YR87J completed SCRUM-1', nameMap),
    'Karam Waleed completed SCRUM-1',
  );
  assert.strictEqual(
    resolveAllSlackIdsInText('<@U0BLV9YR87J> needs help', nameMap),
    'Karam Waleed needs help',
  );
  assert.strictEqual(
    resolveAllSlackIdsInText('UUNKNOWN999 blocked', nameMap),
   'Unknown User blocked',
  );
  console.log('✓ resolveAllSlackIdsInText');
}

{
  const digest = resolveSlackIdsInDigest(
    {
      teamId: 't1',
      runId: 'r1',
      generatedAt: new Date().toISOString(),
      source: 'ai',
      summary: 'U0BLV9YR87J completed SCRUM-1',
      blockers: [
        {
          // Simulate stored JSON with missing userId (startup crash case).
          userId: undefined as unknown as string,
          questionId: 'q1',
          description: 'Waiting on API',
          severity: BlockerSeverity.HIGH,
          dependency: null,
          confidence: 0.9,
        },
      ],
      themes: [],
      reportSections: {
        ...EMPTY_REPORT_SECTIONS,
        overallProgress: 'U0BLV9YR87J should seek assistance',
        participantUpdates: [
          {
            slackUserId: 'U0BLV9YR87J',
            displayName: 'U0BLV9YR87J',
            answers: [
              {
                question: 'Today',
                answer: '<@U0BLV9YR87J> working on auth',
              },
            ],
          },
        ],
        namedBlockers: [
          {
            displayName: 'U0BLV9YR87J',
            items: ['Waiting on API access'],
          },
        ],
      },
    },
    nameMap,
  );

  assert.ok(!textContainsSlackUserId(digest.summary));
  assert.ok(!textContainsSlackUserId(digest.reportSections.overallProgress));
  assert.strictEqual(
    digest.reportSections.participantUpdates[0].displayName,
    'Karam Waleed',
  );
  assert.strictEqual(
    digest.reportSections.namedBlockers?.[0].displayName,
    'Karam Waleed',
  );
  assert.strictEqual(digest.blockers[0].userId, 'unknown');
  assert.ok(!digestContainsSlackUserIds(digest));
  console.log('✓ resolveSlackIdsInDigest');
}

{
  assert.strictEqual(lookupSlackDisplayName(undefined, nameMap), 'Unknown User');
  assert.strictEqual(lookupSlackDisplayName(null, nameMap), 'Unknown User');
  assert.strictEqual(lookupSlackDisplayName('', nameMap), 'Unknown User');
  assert.strictEqual(
    lookupSlackDisplayName('U0BLV9YR87J', nameMap),
    'Karam Waleed',
  );
  console.log('✓ lookupSlackDisplayName tolerates missing ids');
}

console.log('All report-slack-resolution tests passed.');
