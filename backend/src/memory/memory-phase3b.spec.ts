/**
 * Pulse V2 Phase 3B — Ask Pulse integration policy + authority merge tests.
 * Run: npm run test:memory-phase3b
 *
 * Default MEMORY_V2_ASK_MODE is LEGACY_ONLY — tests pass modeOverride explicitly.
 */
import {
  MemoryVisibility,
  PrismaClient,
} from '@prisma/client';
import { WorkspaceAiIntent } from '../ai/workspace/types/workspace-ai.types';
import type { KnowledgeDocument } from '../ai/workspace/types/workspace-ai.types';
import {
  buildMemoryRetrievalPlan,
  classifyMemoryAskCategory,
  isCompositeJiraMemoryQuestion,
  isHistoricalNarrativeQuestion,
  isPureCurrentJiraFieldQuestion,
} from './memory-retrieval-policy';
import { MemoryEvidenceMergeService } from './memory-evidence-merge.service';
import {
  adaptMemoryEvidenceToDocuments,
  documentAuthorityClass,
} from './memory-evidence.adapter';
import { MEMORY_SOURCE } from './memory-source.constants';
import { MemoryRetrievalService } from './memory-retrieval.service';
import { MemoryAclService } from './memory-acl.service';
import { MemoryFullTextSearchService } from './memory-fulltext-search.service';
import { MemoryVectorSearchService } from './memory-vector-search.service';
import { MemoryHybridRankingService } from './memory-hybrid-ranking.service';
import { MemoryEmbeddingService } from './memory-embedding.service';
import { WorkspacePromptBuilder } from '../ai/workspace/prompts/workspace-prompt.builder';
import { ContextBuilderService } from '../ai/workspace/context/context-builder.service';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function jiraDoc(assignee: string): KnowledgeDocument {
  return {
    id: 'jira-1',
    workspaceId: 'ws',
    source: 'jira',
    entity: 'jira_issue',
    title: 'SCRUM-9',
    content: `Answer Source: Live Jira API\nAssignee: ${assignee}\nStatus: In Progress`,
    timestamp: null,
    url: null,
    reference: {
      source: 'jira',
      entity: 'jira_issue',
      entityId: 'SCRUM-9',
      timestamp: null,
      workspaceId: 'ws',
      url: null,
      label: 'SCRUM-9',
    },
    score: 0.5,
    metadata: { authorityClass: 'LIVE_JIRA_CURRENT' },
  };
}

function poisonedMemoryDoc(): KnowledgeDocument {
  return {
    id: 'v2mem:poison',
    workspaceId: 'ws',
    source: 'team_memory',
    entity: 'team_memory',
    title: 'Poison',
    content:
      'Authority: TEAM_MEMORY_HISTORICAL\nSCRUM-9 is assigned to WRONG_MEMORY_ASSIGNEE.',
    timestamp: null,
    url: null,
    reference: {
      source: 'team_memory',
      entity: 'team_memory',
      entityId: 'x',
      timestamp: null,
      workspaceId: 'ws',
      url: null,
      label: 'Poison',
    },
    score: 0.99,
    metadata: {
      authorityClass: 'TEAM_MEMORY_HISTORICAL',
      v2MemoryChunkId: 'poison',
      memorySourceType: MEMORY_SOURCE.STANDUP_ANSWER,
      memorySourceId: 'ans-poison',
      memoryChunkIndex: 0,
    },
  };
}

async function main() {
  console.log('memory-phase3b.spec.ts');

  // --- Policy classification ---
  assert(
    isPureCurrentJiraFieldQuestion({
      intent: WorkspaceAiIntent.ISSUE_STATUS,
      question: 'Who is assigned to SCRUM-9?',
      issueKey: 'SCRUM-9',
    }),
    'assignee is pure field',
  );
  assert(
    classifyMemoryAskCategory({
      intent: WorkspaceAiIntent.ISSUE_STATUS,
      question: 'What is the status of SCRUM-9?',
      issueKey: 'SCRUM-9',
    }) === 'CURRENT_JIRA_FIELD',
    'status category',
  );
  assert(
    isHistoricalNarrativeQuestion({
      intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
      question: 'Why was SCRUM-9 delayed?',
      issueKey: 'SCRUM-9',
    }),
    'why delayed is narrative',
  );
  assert(
    classifyMemoryAskCategory({
      intent: WorkspaceAiIntent.GET_BLOCKERS,
      question: 'What blockers affected SCRUM-9?',
      issueKey: 'SCRUM-9',
    }) === 'HISTORICAL_NARRATIVE',
    'blockers affected is historical',
  );
  assert(
    classifyMemoryAskCategory({
      intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
      question: 'How was the blocker related to SCRUM-9 resolved?',
      issueKey: 'SCRUM-9',
    }) === 'HISTORICAL_NARRATIVE',
    'blocker resolved is historical',
  );
  assert(
    isPureCurrentJiraFieldQuestion({
      intent: WorkspaceAiIntent.ISSUE_STATUS,
      question: 'What blockers affected SCRUM-9?',
      issueKey: 'SCRUM-9',
    }) === false,
    'what blockers must not be pure jira field',
  );
  assert(
    isCompositeJiraMemoryQuestion({
      intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
      question: 'Why was SCRUM-9 delayed and what is its status now?',
      issueKey: 'SCRUM-9',
    }),
    'composite detected',
  );
  console.log('✓ Intent / category classification');

  // --- Modes ---
  const fieldPlan = buildMemoryRetrievalPlan({
    intent: WorkspaceAiIntent.ISSUE_STATUS,
    question: 'Who is assigned to SCRUM-9?',
    issueKey: 'SCRUM-9',
    hasTrustedUserId: true,
    modeOverride: 'HYBRID',
  });
  assert(fieldPlan.useV2Memory === false, 'field Q never calls V2 even in HYBRID');
  assert(fieldPlan.jiraFieldsOnly === true, 'jiraFieldsOnly');
  assert(fieldPlan.v2AffectsAnswer === false, 'V2 does not affect field answer');

  const legacyOnly = buildMemoryRetrievalPlan({
    intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
    question: 'Why was SCRUM-9 delayed?',
    issueKey: 'SCRUM-9',
    hasTrustedUserId: true,
    modeOverride: 'LEGACY_ONLY',
  });
  assert(legacyOnly.useV2Memory === false, 'LEGACY_ONLY skips V2');

  const shadow = buildMemoryRetrievalPlan({
    intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
    question: 'Why was SCRUM-9 delayed?',
    issueKey: 'SCRUM-9',
    hasTrustedUserId: true,
    modeOverride: 'V2_SHADOW',
  });
  assert(shadow.useV2Memory === true, 'shadow invokes V2');
  assert(shadow.v2AffectsAnswer === false, 'shadow does not affect answer');

  const hybrid = buildMemoryRetrievalPlan({
    intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
    question: 'Why was SCRUM-9 delayed?',
    issueKey: 'SCRUM-9',
    hasTrustedUserId: true,
    modeOverride: 'HYBRID',
  });
  assert(hybrid.useV2Memory && hybrid.v2AffectsAnswer, 'HYBRID affects answer');

  const primary = buildMemoryRetrievalPlan({
    intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
    question: 'Why was SCRUM-9 delayed?',
    issueKey: 'SCRUM-9',
    hasTrustedUserId: true,
    modeOverride: 'V2_PRIMARY',
  });
  assert(primary.useV2Memory && primary.v2AffectsAnswer, 'V2_PRIMARY');

  const noUser = buildMemoryRetrievalPlan({
    intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
    question: 'Why was SCRUM-9 delayed?',
    issueKey: 'SCRUM-9',
    hasTrustedUserId: false,
    modeOverride: 'HYBRID',
  });
  assert(noUser.useV2Memory === false, 'missing userId fail-closed');

  const composite = buildMemoryRetrievalPlan({
    intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
    question: 'Why was SCRUM-9 delayed and what is its status now?',
    issueKey: 'SCRUM-9',
    hasTrustedUserId: true,
    modeOverride: 'HYBRID',
  });
  assert(composite.category === 'COMPOSITE_JIRA_MEMORY', 'composite category');
  assert(composite.useV2Memory && composite.useLiveJira, 'composite both');
  console.log('✓ Rollout mode policy');

  // --- Authority over ranking ---
  const merge = new MemoryEvidenceMergeService();
  const authMerge = merge.merge({
    plan: hybrid,
    legacyHits: [jiraDoc('Karam Waleed')],
    v2Documents: [poisonedMemoryDoc()],
  });
  assert(
    authMerge.documents.some((d) => d.content.includes('Karam Waleed')),
    'live jira retained',
  );
  assert(
    documentAuthorityClass(authMerge.documents.find((d) => d.source === 'jira')!) ===
      'LIVE_JIRA_CURRENT',
    'jira authority class',
  );
  // Prompt rules for field-only: V2 must not be in field plan
  assert(fieldPlan.useV2Memory === false, 'poisoned memory never retrieved for field Q');
  console.log('✓ Authority-over-ranking / poisoned memory bypass');

  // --- Dedup + budget ---
  const manyV2: KnowledgeDocument[] = [];
  for (let i = 0; i < 20; i += 1) {
    manyV2.push({
      ...poisonedMemoryDoc(),
      id: `v2mem:${i}`,
      metadata: {
        ...poisonedMemoryDoc().metadata,
        v2MemoryChunkId: `c${i}`,
        memorySourceId: i < 5 ? 'same-source' : `src-${i}`,
        memorySourceType: MEMORY_SOURCE.REPORT,
        memoryChunkIndex: i,
      },
      score: 1 - i * 0.01,
      content: `Authority: TEAM_MEMORY_HISTORICAL\nReport chunk ${i}`,
    });
  }
  const budgeted = merge.merge({
    plan: primary,
    legacyHits: [jiraDoc('Karam Waleed')],
    v2Documents: manyV2,
  });
  assert(budgeted.documents.length <= 24, 'context budget capped');
  assert(
    budgeted.documents.some((d) => d.source === 'jira'),
    'live jira preserved under budget',
  );
  console.log('✓ Evidence merge + budget');

  // --- Citation adapter ---
  const adapted = adaptMemoryEvidenceToDocuments({
    query: 'why',
    workspaceId: 'ws',
    evidence: [
      {
        chunkId: 'chunk-1',
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: 'blocker-abc',
        chunkIndex: 0,
        text: 'Dashboard blocked on API',
        linkedIssueKey: 'SCRUM-9',
        teamId: 't1',
        ownerUserId: null,
        visibility: MemoryVisibility.TEAM,
        retrieval: { rrfScore: 0.5 },
        citation: {
          sourceType: MEMORY_SOURCE.BLOCKER,
          sourceId: 'blocker-abc',
          chunkIndex: 0,
        },
      },
    ],
  });
  assert(adapted[0].metadata?.v2MemoryChunkId === 'chunk-1', 'chunk id preserved');
  assert(adapted[0].reference.entityId === 'blocker-abc', 'sourceId citation');
  assert(adapted[0].title.includes('Blocker'), 'user-facing label');
  console.log('✓ Citation / adapter');

  // --- Prompt authority rules ---
  const promptBuilder = new WorkspacePromptBuilder();
  const prompt = promptBuilder.build({
    question: 'Why was SCRUM-9 delayed and what is its status now?',
    intent: {
      intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
      confidence: 0.9,
      filters: { issueKey: 'SCRUM-9' },
      rationale: 'test',
    },
    context: {
      intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
      chunks: [],
      sections: [],
      contextText: 'Authority: LIVE_JIRA_CURRENT\nStatus: Done\n\nAuthority: TEAM_MEMORY_HISTORICAL\nwas blocked last week',
      tokenEstimate: 10,
      insufficientData: false,
      references: [],
      finalSourcesUsed: ['jira', 'blockers'],
    },
    retrievalPlan: composite,
  });
  assert(prompt.system.includes('LIVE_JIRA_CURRENT'), 'prompt authority');
  assert(prompt.system.includes('TEAM_MEMORY_HISTORICAL'), 'prompt historical');
  assert(prompt.user.includes('COMPOSITE'), 'composite user guidance');
  console.log('✓ Prompt authority rules');

  // --- End-to-end ACL into context (HYBRID) ---
  const prisma = new PrismaClient();
  const workspace = await prisma.workspace.findFirst({
    orderBy: { installedAt: 'asc' },
  });
  assert(workspace, 'need workspace');
  const user = await prisma.user.findFirst({
    where: { workspaceId: workspace.id },
  });
  assert(user, 'need user');
  const team = await prisma.team.findFirst({
    where: { workspaceId: workspace.id },
  });
  assert(team, 'need team');
  let membership = await prisma.teamMember.findFirst({
    where: { userId: user.id, teamId: team.id },
  });
  if (!membership) {
    membership = await prisma.teamMember.create({
      data: { userId: user.id, teamId: team.id },
    });
  }

  const otherWorkspace = await prisma.workspace.findFirst({
    where: { id: { not: workspace.id } },
  });

  const suffix = Date.now();
  const chunkIds: string[] = [];
  let createdOtherUser = false;
  let otherUserId: string | null = null;
  try {
    const allowed = await prisma.memoryChunk.create({
      data: {
        workspaceId: workspace.id,
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: `3b-allow-${suffix}`,
        chunkIndex: 0,
        text: `Allowed narrative TOKEN3B${suffix} delayed by API contract`,
        contentHash: `h-3b-a-${suffix}`,
        visibility: MemoryVisibility.TEAM,
        teamId: team.id,
        linkedIssueKey: 'SCRUM-3B',
      },
    });
    chunkIds.push(allowed.id);

    let otherUser = await prisma.user.findFirst({
      where: { workspaceId: workspace.id, id: { not: user.id } },
    });
    if (!otherUser) {
      otherUser = await prisma.user.create({
        data: {
          workspaceId: workspace.id,
          slackUserId: `U_3B_${suffix}`,
          slackDisplayName: `Other 3B ${suffix}`,
        },
      });
      createdOtherUser = true;
    }
    otherUserId = otherUser.id;

    const privateOther = await prisma.memoryChunk.create({
      data: {
        workspaceId: workspace.id,
        sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
        sourceId: `3b-priv-${suffix}`,
        chunkIndex: 0,
        text: `SECRET3B${suffix} private only`,
        contentHash: `h-3b-p-${suffix}`,
        visibility: MemoryVisibility.PRIVATE,
        ownerUserId: otherUser.id,
      },
    });
    chunkIds.push(privateOther.id);

    if (otherWorkspace) {
      const leaked = await prisma.memoryChunk.create({
        data: {
          workspaceId: otherWorkspace.id,
          sourceType: MEMORY_SOURCE.BLOCKER,
          sourceId: `3b-leak-${suffix}`,
          chunkIndex: 0,
          text: `LEAK3B${suffix} must never appear`,
          contentHash: `h-3b-l-${suffix}`,
          visibility: MemoryVisibility.WORKSPACE,
        },
      });
      chunkIds.push(leaked.id);
    }

    const embeddings = new MemoryEmbeddingService({
      isAvailable: () => false,
      model: () => 'test',
      embedTexts: async () => [],
    } as any);
    const acl = new MemoryAclService(prisma as any);
    const fullText = new MemoryFullTextSearchService(prisma as any, acl);
    const vector = new MemoryVectorSearchService(prisma as any, acl, embeddings);
    await vector.detectBackend();
    const retrieval = new MemoryRetrievalService(
      acl,
      fullText,
      vector,
      new MemoryHybridRankingService(),
    );

    const v2 = await retrieval.retrieve({
      workspaceId: workspace.id,
      userId: user.id,
      query: `TOKEN3B${suffix} delayed`,
      debug: true,
    });
    assert(
      v2.evidence.some((e) => e.text.includes(`TOKEN3B${suffix}`)),
      'allowed chunk retrieved',
    );
    assert(
      !v2.evidence.some((e) => e.text.includes(`SECRET3B${suffix}`)),
      'private other excluded',
    );
    assert(
      !v2.evidence.some((e) => e.text.includes(`LEAK3B${suffix}`)),
      'cross-workspace excluded',
    );

    const docs = adaptMemoryEvidenceToDocuments(v2);
    const mergedCtx = merge.merge({
      plan: hybrid,
      legacyHits: [jiraDoc('Karam Waleed')],
      v2Documents: docs,
    });
    const context = new ContextBuilderService().build({
      intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
      search: {
        query: 'why',
        filters: { issueKey: 'SCRUM-3B' },
        hits: mergedCtx.documents,
        bySource: {},
        references: mergedCtx.documents.map((d) => d.reference),
        diagnostics: { sources: [], summary: 'test' },
      },
    });
    assert(
      context.contextText.includes(`TOKEN3B${suffix}`),
      'allowed in final context',
    );
    assert(
      !context.contextText.includes(`SECRET3B${suffix}`),
      'private not in context',
    );
    assert(
      !context.contextText.includes(`LEAK3B${suffix}`),
      'leak not in context',
    );
    assert(context.contextText.includes('Karam Waleed'), 'jira in context');
    console.log('✓ End-to-end ACL into ContextBuilder');

    // Malformed
    const badTeam = await prisma.memoryChunk.create({
      data: {
        workspaceId: workspace.id,
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: `3b-bad-${suffix}`,
        chunkIndex: 0,
        text: `BADTEAM3B${suffix}`,
        contentHash: `h-3b-bad-${suffix}`,
        visibility: MemoryVisibility.TEAM,
        teamId: null,
      },
    });
    chunkIds.push(badTeam.id);
    const badRes = await retrieval.retrieve({
      workspaceId: workspace.id,
      userId: user.id,
      query: `BADTEAM3B${suffix}`,
    });
    assert(
      !badRes.evidence.some((e) => e.text.includes(`BADTEAM3B${suffix}`)),
      'malformed TEAM excluded',
    );
    console.log('✓ Malformed ACL');

    // Shadow failure isolation (policy unit)
    assert(shadow.v2AffectsAnswer === false, 'shadow isolation');
    console.log('✓ Shadow failure isolation (policy)');

    // V2_PRIMARY fallback keeps legacy when V2 empty
    const primaryEmpty = merge.merge({
      plan: primary,
      legacyHits: [jiraDoc('Karam Waleed')],
      v2Documents: [],
    });
    assert(primaryEmpty.documents.length >= 1, 'V2_PRIMARY falls back to legacy');
    console.log('✓ V2_PRIMARY legacy fallback');
  } finally {
    if (chunkIds.length) {
      await prisma.memoryChunk.deleteMany({ where: { id: { in: chunkIds } } });
    }
    if (createdOtherUser && otherUserId) {
      await prisma.user.delete({ where: { id: otherUserId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }

  console.log('All Phase 3B Ask Pulse integration tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
