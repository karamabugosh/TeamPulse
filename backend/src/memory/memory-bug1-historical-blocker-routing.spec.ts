/**
 * Manual Test Bug #1 — historical blocker / resolution routing regressions.
 * Run: npx ts-node src/memory/memory-bug1-historical-blocker-routing.spec.ts
 */
import { MemoryVisibility, PrismaClient } from '@prisma/client';
import { IntentDetectionService } from '../ai/workspace/intent/intent-detection.service';
import { shouldUseJiraFieldsOnly } from '../ai/workspace/retrieval/jira-field-question';
import { WorkspaceAiIntent } from '../ai/workspace/types/workspace-ai.types';
import type { KnowledgeDocument } from '../ai/workspace/types/workspace-ai.types';
import { ContextBuilderService } from '../ai/workspace/context/context-builder.service';
import { WorkspacePromptBuilder } from '../ai/workspace/prompts/workspace-prompt.builder';
import {
  buildMemoryRetrievalPlan,
  classifyMemoryAskCategory,
} from './memory-retrieval-policy';
import { MemoryEvidenceMergeService } from './memory-evidence-merge.service';
import { adaptMemoryEvidenceToDocuments } from './memory-evidence.adapter';
import { MEMORY_SOURCE } from './memory-source.constants';
import { MemoryHybridRankingService } from './memory-hybrid-ranking.service';
import { MemorySearchCandidate } from './memory-retrieval.types';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function memDoc(params: {
  id: string;
  sourceType: string;
  sourceId: string;
  text: string;
}): KnowledgeDocument {
  return {
    id: `v2mem:${params.id}`,
    workspaceId: 'ws',
    source: 'team_memory',
    entity: 'team_memory',
    title: params.sourceType,
    content: `Authority: TEAM_MEMORY_HISTORICAL\n${params.text}`,
    timestamp: null,
    url: null,
    reference: {
      source: 'team_memory',
      entity: 'team_memory',
      entityId: params.sourceId,
      timestamp: null,
      workspaceId: 'ws',
      url: null,
      label: params.sourceType,
    },
    score: 0.9,
    metadata: {
      authorityClass: 'TEAM_MEMORY_HISTORICAL',
      v2MemoryChunkId: params.id,
      memorySourceType: params.sourceType,
      memorySourceId: params.sourceId,
      memoryChunkIndex: 0,
    },
  };
}

function cand(partial: Partial<MemorySearchCandidate> & { chunkId: string }): MemorySearchCandidate {
  return {
    sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
    sourceId: 's1',
    chunkIndex: 0,
    text: 'x',
    visibility: MemoryVisibility.WORKSPACE,
    teamId: null,
    ownerUserId: null,
    linkedIssueKey: null,
    ...partial,
  };
}

async function main() {
  console.log('memory-bug1-historical-blocker-routing.spec.ts');
  const intentSvc = new IntentDetectionService();

  const cases: Array<{
    q: string;
    expectCategory: string;
    expectV2: boolean;
    expectFieldsOnly: boolean;
  }> = [
    {
      q: 'What blockers affected SCRUM-9?',
      expectCategory: 'HISTORICAL_NARRATIVE',
      expectV2: true,
      expectFieldsOnly: false,
    },
    {
      q: 'How was the blocker related to SCRUM-9 resolved?',
      expectCategory: 'HISTORICAL_NARRATIVE',
      expectV2: true,
      expectFieldsOnly: false,
    },
    {
      q: 'Why was SCRUM-9 delayed?',
      expectCategory: 'HISTORICAL_NARRATIVE',
      expectV2: true,
      expectFieldsOnly: false,
    },
    {
      q: 'Why was SCRUM-9 delayed and what is its status now?',
      expectCategory: 'COMPOSITE_JIRA_MEMORY',
      expectV2: true,
      expectFieldsOnly: false,
    },
    {
      q: 'Who is assigned to SCRUM-9?',
      expectCategory: 'CURRENT_JIRA_FIELD',
      expectV2: false,
      expectFieldsOnly: true,
    },
    {
      q: 'What is the status of SCRUM-9?',
      expectCategory: 'CURRENT_JIRA_FIELD',
      expectV2: false,
      expectFieldsOnly: true,
    },
  ];

  for (const c of cases) {
    const detected = intentSvc.detect(c.q);
    const issueKey = detected.filters.issueKey ?? 'SCRUM-9';
    const fieldsOnly = shouldUseJiraFieldsOnly({
      intent: detected.intent,
      question: c.q,
      issueKey,
    });
    const category = classifyMemoryAskCategory({
      intent: detected.intent,
      question: c.q,
      issueKey,
    });
    const plan = buildMemoryRetrievalPlan({
      intent: detected.intent,
      question: c.q,
      issueKey,
      hasTrustedUserId: true,
      modeOverride: 'HYBRID',
    });
    assert(category === c.expectCategory, `${c.q} category=${category}`);
    assert(plan.useV2Memory === c.expectV2, `${c.q} useV2=${plan.useV2Memory}`);
    assert(
      plan.jiraFieldsOnly === c.expectFieldsOnly,
      `${c.q} fieldsOnly=${plan.jiraFieldsOnly}`,
    );
    assert(fieldsOnly === c.expectFieldsOnly, `${c.q} shouldUseJiraFieldsOnly`);
    if (c.expectCategory === 'COMPOSITE_JIRA_MEMORY') {
      assert(plan.useLiveJira === true, 'composite uses live jira');
    }
  }
  console.log('✓ Classification for blocker / resolution / field questions');

  // Evidence survives merge → context → prompt as TEAM_MEMORY_HISTORICAL
  const plan = buildMemoryRetrievalPlan({
    intent: WorkspaceAiIntent.GET_BLOCKERS,
    question: 'What blockers affected SCRUM-9?',
    issueKey: 'SCRUM-9',
    hasTrustedUserId: true,
    modeOverride: 'HYBRID',
  });
  assert(plan.useV2Memory && plan.v2AffectsAnswer, 'V2 enabled for blockers Q');

  const blockerDoc = memDoc({
    id: 'b1',
    sourceType: MEMORY_SOURCE.BLOCKER,
    sourceId: 'blocker-1',
    text: 'Blocker: waiting AOI completion. Related Jira issue key: SCRUM-9',
  });
  const resolutionDoc = memDoc({
    id: 'r1',
    sourceType: MEMORY_SOURCE.BLOCKER_RESOLUTION,
    sourceId: 'res-1',
    text: 'Blocker resolution: waiting AOI. Related Jira issue key: SCRUM-9',
  });

  const merge = new MemoryEvidenceMergeService();
  const mergedBlocker = merge.merge({
    plan,
    legacyHits: [],
    v2Documents: [blockerDoc],
  });
  assert(
    mergedBlocker.documents.some((d) =>
      String(d.metadata?.memorySourceType) === MEMORY_SOURCE.BLOCKER,
    ),
    'BLOCKER evidence survives merge',
  );

  const resPlan = buildMemoryRetrievalPlan({
    intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
    question: 'How was the blocker related to SCRUM-9 resolved?',
    issueKey: 'SCRUM-9',
    hasTrustedUserId: true,
    modeOverride: 'HYBRID',
  });
  const mergedRes = merge.merge({
    plan: resPlan,
    legacyHits: [],
    v2Documents: [resolutionDoc],
  });
  assert(
    mergedRes.documents.some(
      (d) =>
        String(d.metadata?.memorySourceType) ===
        MEMORY_SOURCE.BLOCKER_RESOLUTION,
    ),
    'BLOCKER_RESOLUTION evidence survives merge',
  );

  const contextText = mergedBlocker.documents
    .map((d) => d.content)
    .join('\n\n');
  assert(
    /TEAM_MEMORY_HISTORICAL/i.test(contextText),
    'BLOCKER carries TEAM_MEMORY_HISTORICAL authority',
  );
  assert(
    /waiting AOI/i.test(contextText),
    'BLOCKER text survives into merged context payload',
  );

  const prompt = new WorkspacePromptBuilder().build({
    question: 'What blockers affected SCRUM-9?',
    intent: {
      intent: WorkspaceAiIntent.GET_BLOCKERS,
      confidence: 0.9,
      filters: { issueKey: 'SCRUM-9' },
      rationale: 'test',
    },
    context: {
      intent: WorkspaceAiIntent.GET_BLOCKERS,
      chunks: [],
      sections: [],
      contextText,
      tokenEstimate: 10,
      insufficientData: false,
      references: [],
      finalSourcesUsed: ['team_memory', 'blockers'],
    },
    retrievalPlan: plan,
  });
  assert(
    /TEAM_MEMORY_HISTORICAL|waiting AOI/i.test(
      prompt.system + prompt.user,
    ),
    'historical evidence reaches prompt',
  );
  console.log('✓ BLOCKER / RESOLUTION evidence survives merge + context + prompt');

  // Ranking: linked issue + blocker source beats generic standup
  const hybridRank = new MemoryHybridRankingService();
  const ranked = hybridRank.merge({
    lexical: [
      cand({
        chunkId: 'blocker-scrum9',
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: 'b-scrum9',
        linkedIssueKey: 'SCRUM-9',
        text: 'waiting aoi',
        lexicalRank: 4,
      }),
    ],
    vector: [
      cand({
        chunkId: 'generic-standup',
        sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
        sourceId: 'sa-generic',
        linkedIssueKey: null,
        text: 'Are there any blockers in your way? no',
        vectorRank: 1,
        vectorSimilarity: 0.9,
      }),
      cand({
        chunkId: 'blocker-scrum9',
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: 'b-scrum9',
        linkedIssueKey: 'SCRUM-9',
        text: 'waiting aoi',
        vectorRank: 20,
        vectorSimilarity: 0.2,
      }),
    ],
    query: 'What blockers affected SCRUM-9?',
    linkedIssueKey: 'SCRUM-9',
    finalLimit: 5,
  });
  assert(
    ranked[0]?.chunkId === 'blocker-scrum9',
    `SCRUM-9 BLOCKER should rank first, got ${ranked[0]?.chunkId}`,
  );
  console.log('✓ Issue-key + blocker source ranking preference');

  // Field authority still intact via policy
  const assigneePlan = buildMemoryRetrievalPlan({
    intent: WorkspaceAiIntent.ISSUE_STATUS,
    question: 'Who is assigned to SCRUM-9?',
    issueKey: 'SCRUM-9',
    hasTrustedUserId: true,
    modeOverride: 'HYBRID',
  });
  assert(assigneePlan.jiraFieldsOnly && !assigneePlan.useV2Memory, 'assignee Jira-only');
  console.log('✓ Jira current-field authority preserved');

  void PrismaClient;
  void adaptMemoryEvidenceToDocuments;
  void ContextBuilderService;
  console.log('ALL BUG#1 ROUTING REGRESSIONS PASSED');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
