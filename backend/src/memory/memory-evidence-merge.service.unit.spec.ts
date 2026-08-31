import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { KnowledgeDocument } from '../ai/workspace/types/workspace-ai.types';
import { MemoryEvidenceMergeService } from './memory-evidence-merge.service';
import { MemoryRetrievalPlan } from './memory-retrieval-policy';

jest.mock('./memory-ask.config', () => ({
  MEMORY_ASK_CONTEXT_BUDGET: {
    maxDocuments: 3,
    maxV2Documents: 2,
    maxPerSourceId: 1,
  },
}));

function makeDoc(
  overrides: Partial<KnowledgeDocument> & Pick<KnowledgeDocument, 'id'>,
): KnowledgeDocument {
  const entityId = overrides.reference?.entityId ?? overrides.id;
  const reference = {
    source: overrides.source ?? 'team_memory',
    entity: overrides.entity ?? 'team_memory',
    entityId,
    timestamp: null,
    workspaceId: 'ws-1',
    url: null,
    label: overrides.id,
    ...overrides.reference,
  };

  return {
    workspaceId: 'ws-1',
    source: 'team_memory',
    entity: 'team_memory',
    title: overrides.title ?? overrides.id,
    content: overrides.content ?? 'body',
    timestamp: null,
    url: null,
    metadata: overrides.metadata ?? {},
    score: overrides.score ?? 0.5,
    ...overrides,
    reference,
  };
}

describe('MemoryEvidenceMergeService', () => {
  let service: MemoryEvidenceMergeService;

  const basePlan: MemoryRetrievalPlan = {
    mode: 'HYBRID',
    category: 'HISTORICAL_NARRATIVE',
    useLiveJira: true,
    jiraFieldsOnly: false,
    useV2Memory: true,
    v2AffectsAnswer: true,
    useLegacyRetrieval: true,
    memorySourceTypes: [],
    reason: ['test'],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MemoryEvidenceMergeService],
    }).compile();

    service = module.get(MemoryEvidenceMergeService);
  });

  it('returns legacy hits only when V2 does not affect the answer', () => {
    const legacy = [
      makeDoc({
        id: 'legacy-1',
        entity: 'standup_submission',
        metadata: { authorityClass: 'LEGACY_SUPPORTING' },
      }),
    ];

    const result = service.merge({
      plan: { ...basePlan, v2AffectsAnswer: false },
      legacyHits: legacy,
      v2Documents: [makeDoc({ id: 'v2-1', metadata: { v2MemoryChunkId: 'c1' } })],
    });

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].id).toBe('legacy-1');
    expect(result.v2Count).toBe(0);
  });

  it('tags jira legacy docs with LIVE_JIRA authority banner when missing', () => {
    const result = service.merge({
      plan: { ...basePlan, v2AffectsAnswer: false },
      legacyHits: [
        makeDoc({
          id: 'jira-1',
          source: 'jira',
          entity: 'jira_issue',
          content: 'Issue summary',
        }),
      ],
      v2Documents: [],
    });

    expect(result.liveJiraCount).toBe(1);
    expect(result.documents[0].content).toContain(
      'Authority: LIVE_JIRA_CURRENT',
    );
  });

  it('preserves existing authority banner on jira docs', () => {
    const result = service.merge({
      plan: { ...basePlan, v2AffectsAnswer: false },
      legacyHits: [
        makeDoc({
          id: 'jira-1',
          source: 'jira',
          entity: 'jira_issue',
          content: 'Authority: LIVE_JIRA_CURRENT\nAlready tagged',
        }),
      ],
      v2Documents: [],
    });

    expect(result.documents[0].content).toBe(
      'Authority: LIVE_JIRA_CURRENT\nAlready tagged',
    );
  });

  it('drops overlapping legacy team memory in V2_PRIMARY mode', () => {
    const sharedIdentity = 'STANDUP_ANSWER:ans-1';
    const legacy = makeDoc({
      id: 'legacy-1',
      entity: 'standup_submission',
      reference: {
        source: 'team_memory',
        entity: 'standup_submission',
        entityId: 'ans-1',
        timestamp: null,
        workspaceId: 'ws-1',
        url: null,
        label: 'legacy-1',
      },
      metadata: {
        authorityClass: 'LEGACY_SUPPORTING',
        memorySourceType: 'STANDUP_ANSWER',
        memorySourceId: 'ans-1',
      },
    });
    const v2 = makeDoc({
      id: 'v2-1',
      metadata: {
        v2MemoryChunkId: 'chunk-1',
        memorySourceType: 'STANDUP_ANSWER',
        memorySourceId: 'ans-1',
        authorityClass: 'TEAM_MEMORY_HISTORICAL',
      },
    });

    const result = service.merge({
      plan: { ...basePlan, mode: 'V2_PRIMARY' },
      legacyHits: [legacy],
      v2Documents: [v2],
    });

    expect(result.droppedLegacyDuplicates).toBe(1);
    expect(result.documents.some((d) => d.id === 'v2-1')).toBe(true);
    expect(result.documents.some((d) => d.id === 'legacy-1')).toBe(false);
  });

  it('keeps live jira docs in V2_PRIMARY mode while dropping overlapping legacy', () => {
    const legacyJira = makeDoc({
      id: 'jira-live',
      source: 'jira',
      entity: 'jira_issue',
      metadata: { authorityClass: 'LIVE_JIRA_CURRENT' },
    });
    const legacyStandup = makeDoc({
      id: 'legacy-standup',
      entity: 'standup_submission',
      metadata: {
        authorityClass: 'LEGACY_SUPPORTING',
        memorySourceType: 'STANDUP_ANSWER',
        memorySourceId: 'ans-1',
      },
    });
    const v2 = makeDoc({
      id: 'v2-1',
      metadata: {
        v2MemoryChunkId: 'chunk-1',
        memorySourceType: 'STANDUP_ANSWER',
        memorySourceId: 'ans-1',
        authorityClass: 'TEAM_MEMORY_HISTORICAL',
      },
    });

    const result = service.merge({
      plan: { ...basePlan, mode: 'V2_PRIMARY' },
      legacyHits: [legacyJira, legacyStandup],
      v2Documents: [v2],
    });

    expect(result.documents.some((d) => d.id === 'jira-live')).toBe(true);
    expect(result.droppedLegacyDuplicates).toBe(1);
  });

  it('drops temporal out-of-scope legacy duplicates in HYBRID mode', () => {
    const legacy = makeDoc({
      id: 'legacy-1',
      entity: 'team_memory',
      reference: {
        source: 'team_memory',
        entity: 'team_memory',
        entityId: 'mem-9',
        timestamp: null,
        workspaceId: 'ws-1',
        url: null,
        label: 'legacy-1',
      },
      metadata: { authorityClass: 'LEGACY_SUPPORTING' },
    });
    const v2 = makeDoc({
      id: 'v2-other',
      metadata: {
        v2MemoryChunkId: 'chunk-2',
        memorySourceType: 'BLOCKER',
        memorySourceId: 'blk-1',
        authorityClass: 'TEAM_MEMORY_HISTORICAL',
      },
    });

    const result = service.merge({
      plan: basePlan,
      legacyHits: [legacy],
      v2Documents: [v2],
      temporalScoped: true,
    });

    expect(result.droppedLegacyDuplicates).toBe(1);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].id).toBe('v2-other');
  });

  it('drops duplicate legacy identity in HYBRID when V2 already claimed it', () => {
    const legacy = makeDoc({
      id: 'legacy-dup',
      entity: 'blocker',
      metadata: {
        authorityClass: 'LEGACY_SUPPORTING',
        memorySourceType: 'BLOCKER',
        memorySourceId: 'blk-1',
      },
    });
    const v2 = makeDoc({
      id: 'v2-1',
      metadata: {
        v2MemoryChunkId: 'chunk-1',
        memorySourceType: 'BLOCKER',
        memorySourceId: 'blk-1',
        authorityClass: 'TEAM_MEMORY_HISTORICAL',
      },
    });

    const result = service.merge({
      plan: basePlan,
      legacyHits: [legacy],
      v2Documents: [v2],
    });

    expect(result.droppedLegacyDuplicates).toBe(1);
    expect(result.documents.filter((d) => d.id === 'v2-1')).toHaveLength(1);
  });

  it('sorts live jira ahead of lower authority docs with equal priority by score', () => {
    const legacyLow = makeDoc({
      id: 'legacy-low',
      score: 0.9,
      metadata: { authorityClass: 'LEGACY_SUPPORTING' },
    });
    const legacyHigh = makeDoc({
      id: 'legacy-high',
      score: 0.2,
      metadata: { authorityClass: 'LEGACY_SUPPORTING' },
    });

    const result = service.merge({
      plan: { ...basePlan, v2AffectsAnswer: false },
      legacyHits: [legacyLow, legacyHigh],
      v2Documents: [],
    });

    expect(result.documents[0].id).toBe('legacy-low');
  });

  it('defers extra docs per source identity then fills from deferred when budget allows', () => {
    const first = makeDoc({
      id: 'same-source-1',
      reference: {
        source: 'team_memory',
        entity: 'team_memory',
        entityId: 'src-a',
        timestamp: null,
        workspaceId: 'ws-1',
        url: null,
        label: 'same-source-1',
      },
      score: 0.9,
    });
    const duplicateSource = makeDoc({
      id: 'same-source-2',
      reference: {
        source: 'team_memory',
        entity: 'team_memory',
        entityId: 'src-a',
        timestamp: null,
        workspaceId: 'ws-1',
        url: null,
        label: 'same-source-2',
      },
      score: 0.8,
    });
    const filler = makeDoc({
      id: 'other-source',
      reference: {
        source: 'team_memory',
        entity: 'team_memory',
        entityId: 'src-b',
        timestamp: null,
        workspaceId: 'ws-1',
        url: null,
        label: 'other-source',
      },
      score: 0.7,
    });

    const result = service.merge({
      plan: { ...basePlan, v2AffectsAnswer: false },
      legacyHits: [first, duplicateSource, filler],
      v2Documents: [],
    });

    expect(result.documents.map((d) => d.id)).toEqual([
      'same-source-1',
      'other-source',
      'same-source-2',
    ]);
  });

  it('tracks droppedByBudget when maxDocuments truncates diversified results', () => {
    const docs = Array.from({ length: 5 }, (_, index) =>
      makeDoc({
        id: `doc-${index}`,
        reference: {
          source: 'team_memory',
          entity: 'team_memory',
          entityId: `entity-${index}`,
          timestamp: null,
          workspaceId: 'ws-1',
          url: null,
          label: `doc-${index}`,
        },
        score: 1 - index * 0.1,
      }),
    );

    const result = service.merge({
      plan: { ...basePlan, v2AffectsAnswer: false },
      legacyHits: docs,
      v2Documents: [],
    });

    expect(result.documents).toHaveLength(3);
    expect(result.droppedByBudget).toBe(2);
  });

  it('keeps non-overlapping legacy docs in V2_PRIMARY mode', () => {
    const legacy = makeDoc({
      id: 'legacy-unique',
      entity: 'report',
      metadata: { authorityClass: 'LEGACY_SUPPORTING' },
    });
    const v2 = makeDoc({
      id: 'v2-1',
      metadata: {
        v2MemoryChunkId: 'chunk-1',
        memorySourceType: 'BLOCKER',
        memorySourceId: 'blk-1',
        authorityClass: 'TEAM_MEMORY_HISTORICAL',
      },
    });

    const result = service.merge({
      plan: { ...basePlan, mode: 'V2_PRIMARY' },
      legacyHits: [legacy],
      v2Documents: [v2],
    });

    expect(result.documents.some((d) => d.id === 'legacy-unique')).toBe(true);
  });

  it('keeps live jira legacy docs in HYBRID mode when temporal scoped', () => {
    const liveJira = makeDoc({
      id: 'jira-live',
      source: 'jira',
      entity: 'jira_issue',
      metadata: { authorityClass: 'LIVE_JIRA_CURRENT' },
    });
    const v2 = makeDoc({
      id: 'v2-1',
      metadata: {
        v2MemoryChunkId: 'chunk-1',
        memorySourceType: 'BLOCKER',
        memorySourceId: 'blk-1',
        authorityClass: 'TEAM_MEMORY_HISTORICAL',
      },
    });

    const result = service.merge({
      plan: basePlan,
      legacyHits: [liveJira],
      v2Documents: [v2],
      temporalScoped: true,
    });

    expect(result.documents.some((d) => d.id === 'jira-live')).toBe(true);
  });

  it('splices out a non-jira doc when reinserting live jira exceeds maxDocuments', () => {
    const livePrimary = makeDoc({
      id: 'jira-primary',
      source: 'jira',
      entity: 'jira_issue',
      reference: {
        source: 'jira',
        entity: 'jira_issue',
        entityId: 'SCRUM-1',
        timestamp: null,
        workspaceId: 'ws-1',
        url: null,
        label: 'jira-primary',
      },
      metadata: { authorityClass: 'LIVE_JIRA_CURRENT' },
      score: 0.99,
    });
    const liveDuplicateIdentity = makeDoc({
      id: 'jira-secondary',
      source: 'jira',
      entity: 'jira_issue',
      reference: {
        source: 'jira',
        entity: 'jira_issue',
        entityId: 'SCRUM-1',
        timestamp: null,
        workspaceId: 'ws-1',
        url: null,
        label: 'jira-secondary',
      },
      metadata: { authorityClass: 'LIVE_JIRA_CURRENT' },
      score: 0.98,
    });
    const fillers = Array.from({ length: 3 }, (_, index) =>
      makeDoc({
        id: `slot-${index}`,
        reference: {
          source: 'team_memory',
          entity: 'team_memory',
          entityId: `slot-${index}`,
          timestamp: null,
          workspaceId: 'ws-1',
          url: null,
          label: `slot-${index}`,
        },
        score: 0.5 - index * 0.01,
        metadata: { authorityClass: 'LEGACY_SUPPORTING' },
      }),
    );

    const result = service.merge({
      plan: { ...basePlan, v2AffectsAnswer: false },
      legacyHits: [livePrimary, liveDuplicateIdentity, ...fillers],
      v2Documents: [],
    });

    expect(result.documents.some((d) => d.id === 'jira-secondary')).toBe(true);
    expect(result.documents.some((d) => d.id === 'jira-primary')).toBe(true);
    expect(result.documents).toHaveLength(3);
    expect(result.liveJiraCount).toBe(2);
  });

  it('reinserts live jira docs dropped by budget by evicting lower-priority entries', () => {
    const liveJira = makeDoc({
      id: 'jira-priority',
      source: 'jira',
      entity: 'jira_issue',
      metadata: { authorityClass: 'LIVE_JIRA_CURRENT' },
      score: 0.1,
    });
    const fillers = Array.from({ length: 4 }, (_, index) =>
      makeDoc({
        id: `fill-${index}`,
        reference: {
          source: 'team_memory',
          entity: 'team_memory',
          entityId: `fill-${index}`,
          timestamp: null,
          workspaceId: 'ws-1',
          url: null,
          label: `fill-${index}`,
        },
        score: 0.9 - index * 0.01,
        metadata: { authorityClass: 'LEGACY_SUPPORTING' },
      }),
    );

    const result = service.merge({
      plan: { ...basePlan, v2AffectsAnswer: false },
      legacyHits: [...fillers, liveJira],
      v2Documents: [],
    });

    expect(result.documents.some((d) => d.id === 'jira-priority')).toBe(true);
    expect(result.liveJiraCount).toBeGreaterThan(0);
    expect(result.documents.length).toBeLessThanOrEqual(3);
  });

  it('caps v2 documents to maxV2Documents in merge', () => {
    const v2Docs = Array.from({ length: 4 }, (_, index) =>
      makeDoc({
        id: `v2-${index}`,
        metadata: {
          v2MemoryChunkId: `chunk-${index}`,
          memorySourceType: 'BLOCKER',
          memorySourceId: `blk-${index}`,
          authorityClass: 'TEAM_MEMORY_HISTORICAL',
        },
      }),
    );

    const result = service.merge({
      plan: basePlan,
      legacyHits: [],
      v2Documents: v2Docs,
    });

    expect(result.documents.filter((d) => d.metadata?.v2MemoryChunkId)).toHaveLength(
      2,
    );
  });

  it('assigns LEGACY_SUPPORTING authority to untagged non-jira legacy docs', () => {
    const legacy = makeDoc({
      id: 'legacy-plain',
      metadata: {},
    });

    const result = service.merge({
      plan: { ...basePlan, v2AffectsAnswer: false },
      legacyHits: [legacy],
      v2Documents: [],
    });

    expect(result.documents[0].metadata?.authorityClass).toBe('LEGACY_SUPPORTING');
    expect(result.legacyCount).toBe(1);
  });

  it('sorts documents with missing scores as zero', () => {
    const higher = makeDoc({
      id: 'scored',
      score: 0.8,
      metadata: { authorityClass: 'LEGACY_SUPPORTING' },
    });
    const unscored = makeDoc({
      id: 'unscored',
      score: undefined,
      metadata: { authorityClass: 'LEGACY_SUPPORTING' },
    });

    const result = service.merge({
      plan: { ...basePlan, v2AffectsAnswer: false },
      legacyHits: [unscored, higher],
      v2Documents: [],
    });

    expect(result.documents[0].id).toBe('scored');
  });

  it('tags jira legacy docs without metadata using tagLegacyAuthority', () => {
    const jira = makeDoc({
      id: 'jira-no-meta',
      source: 'jira',
      entity: 'jira_issue',
      metadata: undefined,
    });

    const result = service.merge({
      plan: { ...basePlan, v2AffectsAnswer: false },
      legacyHits: [jira],
      v2Documents: [],
    });

    expect(result.documents[0].metadata?.authorityClass).toBe('LIVE_JIRA_CURRENT');
  });

  it('treats blocker and report entities as legacy team memory for dedupe', () => {
    const blockerLegacy = makeDoc({
      id: 'legacy-blocker',
      entity: 'blocker',
      metadata: {
        authorityClass: 'LEGACY_SUPPORTING',
        memorySourceType: 'BLOCKER',
        memorySourceId: 'blk-1',
      },
    });
    const reportLegacy = makeDoc({
      id: 'legacy-report',
      entity: 'report',
      metadata: {
        authorityClass: 'LEGACY_SUPPORTING',
        memorySourceType: 'REPORT',
        memorySourceId: 'rep-1',
      },
    });
    const v2Blocker = makeDoc({
      id: 'v2-blocker',
      metadata: {
        v2MemoryChunkId: 'chunk-b',
        memorySourceType: 'BLOCKER',
        memorySourceId: 'blk-1',
        authorityClass: 'TEAM_MEMORY_HISTORICAL',
      },
    });
    const v2Report = makeDoc({
      id: 'v2-report',
      metadata: {
        v2MemoryChunkId: 'chunk-r',
        memorySourceType: 'REPORT',
        memorySourceId: 'rep-1',
        authorityClass: 'TEAM_MEMORY_HISTORICAL',
      },
    });

    const result = service.merge({
      plan: { ...basePlan, mode: 'V2_PRIMARY' },
      legacyHits: [blockerLegacy, reportLegacy],
      v2Documents: [v2Blocker, v2Report],
    });

    expect(result.droppedLegacyDuplicates).toBe(2);
    expect(result.v2Count).toBe(2);
  });

  it('dedupes team_memory source and blocker_update entities in V2_PRIMARY', () => {
    const teamMemoryLegacy = makeDoc({
      id: 'legacy-team',
      source: 'team_memory',
      entity: 'team_memory',
      metadata: {
        authorityClass: 'LEGACY_SUPPORTING',
        memorySourceType: 'TEAM_MEMORY',
        memorySourceId: 'tm-1',
      },
    });
    const blockerUpdateLegacy = makeDoc({
      id: 'legacy-update',
      entity: 'blocker_update',
      metadata: {
        authorityClass: 'LEGACY_SUPPORTING',
        memorySourceType: 'BLOCKER_RESOLUTION',
        memorySourceId: 'res-1',
      },
    });
    const v2Team = makeDoc({
      id: 'v2-team',
      metadata: {
        v2MemoryChunkId: 'chunk-t',
        memorySourceType: 'TEAM_MEMORY',
        memorySourceId: 'tm-1',
        authorityClass: 'TEAM_MEMORY_HISTORICAL',
      },
    });
    const v2Update = makeDoc({
      id: 'v2-update',
      metadata: {
        v2MemoryChunkId: 'chunk-u',
        memorySourceType: 'BLOCKER_RESOLUTION',
        memorySourceId: 'res-1',
        authorityClass: 'TEAM_MEMORY_HISTORICAL',
      },
    });

    const result = service.merge({
      plan: { ...basePlan, mode: 'V2_PRIMARY' },
      legacyHits: [teamMemoryLegacy, blockerUpdateLegacy],
      v2Documents: [v2Team, v2Update],
    });

    expect(result.droppedLegacyDuplicates).toBe(2);
  });

  it('preserves pre-tagged legacy authority metadata', () => {
    const tagged = makeDoc({
      id: 'tagged',
      metadata: { authorityClass: 'TEAM_MEMORY_HISTORICAL' },
    });

    const result = service.merge({
      plan: { ...basePlan, v2AffectsAnswer: false },
      legacyHits: [tagged],
      v2Documents: [],
    });

    expect(result.documents[0].metadata?.authorityClass).toBe(
      'TEAM_MEMORY_HISTORICAL',
    );
  });
});
