/**
 * Latest standup temporal retrieval tests.
 * Run: npx ts-node src/ai/workspace/retrieval/temporal-retrieval.util.spec.ts
 */
import {
  detectTemporalRetrievalScope,
  documentMatchesLatestStandupScope,
} from './temporal-retrieval.util';
import type { KnowledgeDocument } from '../types/workspace-ai.types';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function doc(partial: Partial<KnowledgeDocument> & { id: string }): KnowledgeDocument {
  return {
    workspaceId: 'ws',
    source: 'team_memory',
    entity: 'standup_submission',
    title: 't',
    content: 'c',
    timestamp: null,
    url: null,
    reference: {
      source: 'team_memory',
      entity: 'standup_submission',
      entityId: partial.reference?.entityId ?? partial.id,
      timestamp: null,
      workspaceId: 'ws',
      url: null,
      label: 'l',
    },
    metadata: partial.metadata ?? {},
    ...partial,
  };
}

function main() {
  assert(
    detectTemporalRetrievalScope('What did Karam say in the latest standup?') ===
      'LATEST_STANDUP',
    'latest standup phrase detected',
  );
  assert(
    detectTemporalRetrievalScope('What blocker did Karam report in the most recent check-in?') ===
      'LATEST_STANDUP',
    'most recent check-in detected',
  );
  assert(
    detectTemporalRetrievalScope('What blockers has Karam reported?') === null,
    'historical question has no temporal scope',
  );

  const scope = {
    temporalScope: 'LATEST_STANDUP' as const,
    workspaceId: 'ws',
    checkInId: 'ci',
    teamId: 'team',
    runId: 'run-new',
    submissionId: 'sub-new',
    subjectUserId: 'user-karam',
    subjectDisplayName: 'Karam',
    runStartedAt: null,
    runCompletedAt: null,
    submissionCompletedAt: new Date(),
    scopedSourceIds: ['ans-new', 'blk-new'],
  };

  assert(
    documentMatchesLatestStandupScope(
      doc({
        id: '1',
        metadata: { runId: 'run-new', userId: 'user-karam', memorySourceId: 'ans-new' },
      }),
      scope,
    ),
    'in-scope by runId + user',
  );

  assert(
    !documentMatchesLatestStandupScope(
      doc({
        id: '2',
        content: 'None. Everything is on schedule.',
        metadata: { runId: 'run-old', userId: 'user-karam' },
      }),
      scope,
    ),
    'old run excluded',
  );

  assert(
    documentMatchesLatestStandupScope(
      doc({
        id: '3',
        entity: 'blocker',
        metadata: { memorySourceId: 'blk-new' },
      }),
      scope,
    ),
    'blocker matched by scoped source id',
  );

  assert(
    detectTemporalRetrievalScope("What did Karam say about SCRUM-9 in the latest standup?") ===
      'LATEST_STANDUP',
    'latest + issue key detected',
  );
  assert(
    detectTemporalRetrievalScope("today's standup blockers for Karam") === 'LATEST_STANDUP',
    "today's standup detected",
  );

  assert(
    !documentMatchesLatestStandupScope(
      doc({
        id: '4',
        metadata: { runId: 'run-new', userId: 'other-user' },
      }),
      scope,
    ),
    'same run different user excluded when userId mismatches',
  );

  assert(
    documentMatchesLatestStandupScope(
      doc({
        id: '5',
        reference: { entityId: 'ans-new' } as any,
        metadata: {},
      }),
      scope,
    ),
    'legacy entityId in scopedSourceIds matches',
  );

  console.log('✓ temporal-retrieval.util.spec.ts passed');
}

main();
