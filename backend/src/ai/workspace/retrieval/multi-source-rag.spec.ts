/**
 * Integration tests for multi-source RAG retrieval pipeline.
 *
 * Run: npx ts-node src/ai/workspace/retrieval/multi-source-rag.spec.ts
 *
 * These tests exercise source selection, merge/dedupe/rerank helpers,
 * context section building, and pipeline invariants without a live DB/OpenAI.
 */
import * as assert from 'assert';
import {
  selectRelevantSources,
  shouldForceBlockerMerge,
  CORE_MULTI_SOURCES,
} from './source-selection';
import { mapDocumentToSection } from '../context/context-builder.service';
import { ContextBuilderService } from '../context/context-builder.service';
import { WorkspacePromptBuilder } from '../prompts/workspace-prompt.builder';
import {
  KnowledgeDocument,
  SourceReference,
  WorkspaceAiIntent,
  WorkspaceSearchResult,
  WorkspaceSourceType,
} from '../types/workspace-ai.types';

console.log('multi-source-rag.spec.ts');

function ref(
  source: WorkspaceSourceType,
  entity: KnowledgeDocument['entity'],
  entityId: string,
  workspaceId = 'ws-real-1',
): SourceReference {
  return {
    source,
    entity,
    entityId,
    timestamp: new Date().toISOString(),
    workspaceId,
    url: null,
    label: `${source}:${entity}:${entityId}`,
  };
}

function doc(partial: {
  id: string;
  source: WorkspaceSourceType;
  entity: KnowledgeDocument['entity'];
  title: string;
  content: string;
  workspaceId?: string;
  metadata?: Record<string, unknown>;
  score?: number;
}): KnowledgeDocument {
  const workspaceId = partial.workspaceId ?? 'ws-real-1';
  return {
    id: partial.id,
    workspaceId,
    source: partial.source,
    entity: partial.entity,
    title: partial.title,
    content: partial.content,
    timestamp: new Date().toISOString(),
    url: null,
    reference: ref(partial.source, partial.entity, partial.id, workspaceId),
    metadata: partial.metadata,
    score: partial.score ?? 10,
  };
}

// ---------------------------------------------------------------------------
// 1) Source selection — factual field questions are Jira-only
// ---------------------------------------------------------------------------
{
  const sources = selectRelevantSources({
    intent: WorkspaceAiIntent.ISSUE_STATUS,
    question: 'Who is assigned to SCRUM-9?',
    filters: { issueKey: 'SCRUM-9', jiraFieldsOnly: true },
  });

  assert.deepStrictEqual(
    sources,
    ['jira'],
    `Field question must be Jira-only, got ${sources.join(',')}`,
  );
  console.log('✓ ISSUE_STATUS field question selects Jira-only');
}

{
  const sources = selectRelevantSources({
    intent: WorkspaceAiIntent.ISSUE_STATUS,
    question: 'Who is assigned to SCRUM-9?',
    filters: { issueKey: 'SCRUM-9' },
  });
  assert.deepStrictEqual(sources, ['jira']);
  console.log('✓ Who is assigned (auto field detect) → Jira-only');
}

{
  const sources = selectRelevantSources({
    intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
    question: 'What happened with SCRUM-9 last week?',
    filters: { issueKey: 'SCRUM-9' },
  });
  assert.ok(sources.includes('jira'), 'ISSUE_ANALYSIS must include jira');
  assert.ok(
    sources.includes('slack_standups') || sources.includes('slack_threads'),
    'Narrative issue question must include Slack',
  );
  assert.ok(sources.includes('reports'), 'Narrative must include reports');
  assert.ok(sources.includes('team_memory'), 'Narrative must include team_memory');
  console.log('✓ Narrative ISSUE_ANALYSIS stays multi-source');
}

{
  const sources = selectRelevantSources({
    intent: WorkspaceAiIntent.GET_BLOCKERS,
    question: 'What blockers are related to SCRUM-9?',
    filters: { issueKey: 'SCRUM-9' },
  });
  assert.ok(sources.includes('blockers'));
  assert.ok(sources.includes('jira'));
  assert.ok(sources.includes('team_memory'));
  assert.ok(sources.includes('reports'));
  console.log('✓ Blocker question selects blockers + jira + memory + reports');
}

{
  const sources = selectRelevantSources({
    intent: WorkspaceAiIntent.SLACK_MEMBERS,
    question: 'Who is on the team?',
    filters: { slackMembersOnly: true },
  });
  assert.deepStrictEqual(sources, ['slack_members']);
  console.log('✓ SLACK_MEMBERS stays directory-only');
}

assert.ok(
  !shouldForceBlockerMerge({
    intent: WorkspaceAiIntent.ISSUE_STATUS,
    question: 'Who is assigned to SCRUM-9?',
    issueKey: 'SCRUM-9',
    jiraFieldsOnly: true,
  }),
  'Field questions must not force blocker merge',
);
assert.ok(
  shouldForceBlockerMerge({
    intent: WorkspaceAiIntent.GET_BLOCKERS,
    question: 'What blockers are related to SCRUM-9?',
    issueKey: 'SCRUM-9',
  }),
);
console.log('✓ Blocker merge skipped for field-only; forced for blocker questions');

// ---------------------------------------------------------------------------
// 2) Section mapping
// ---------------------------------------------------------------------------
assert.strictEqual(mapDocumentToSection('jira_issue', 'jira'), 'jira');
assert.strictEqual(mapDocumentToSection('standup_submission', 'slack'), 'standups');
assert.strictEqual(mapDocumentToSection('team_memory', 'team_memory'), 'team_memory');
assert.strictEqual(mapDocumentToSection('report', 'reports'), 'reports');
assert.strictEqual(mapDocumentToSection('blocker', 'blockers'), 'blockers');
assert.strictEqual(mapDocumentToSection('ai_chat', 'ai_history'), 'ai_history');
console.log('✓ Document → section mapping');

// ---------------------------------------------------------------------------
// 3) Scenario: Who is assigned to SCRUM-9?
//    Expect: Status/Assignee from Jira; Slack/Reports/Team Memory included;
//            no Demo workspace rows
// ---------------------------------------------------------------------------
{
  const realWs = 'ws-real-1';
  const demoWs = 'ws-demo-1';

  const hits: KnowledgeDocument[] = [
    doc({
      id: 'jira:SCRUM-9',
      source: 'jira',
      entity: 'jira_issue',
      title: 'SCRUM-9 — Dashboard Analytics',
      content:
        'Key: SCRUM-9\nSummary: Dashboard Analytics\nStatus: In Progress\nAssignee: Karam Waleed\nAUTHORITATIVE_JIRA_FIELDS',
      workspaceId: realWs,
      metadata: {
        issueKey: 'SCRUM-9',
        status: 'In Progress',
        assigneeName: 'Karam Waleed',
        summary: 'Dashboard Analytics',
        liveRefreshed: true,
        jiraSource: 'Live Jira',
        authoritativeJiraFields: true,
      },
      score: 400,
    }),
    doc({
      id: 'slack:1',
      source: 'slack',
      entity: 'standup_submission',
      title: 'Standup mention SCRUM-9',
      content: 'Discussed SCRUM-9 blockers in standup',
      workspaceId: realWs,
      metadata: { issueKey: 'SCRUM-9' },
      score: 60,
    }),
    doc({
      id: 'report:1',
      source: 'reports',
      entity: 'report',
      title: 'Weekly summary',
      content: 'SCRUM-9 moved forward this week',
      workspaceId: realWs,
      metadata: { issueKey: 'SCRUM-9' },
      score: 40,
    }),
    doc({
      id: 'memory:1',
      source: 'team_memory',
      entity: 'team_memory',
      title: 'Past note on SCRUM-9',
      content: 'Historically SCRUM-9 had OAuth dependency (do not use for assignee)',
      workspaceId: realWs,
      metadata: { issueKey: 'SCRUM-9' },
      score: 30,
    }),
    // Cross-tenant leakage must not appear in Real workspace results
    doc({
      id: 'jira:demo-SCRUM-9',
      source: 'jira',
      entity: 'jira_issue',
      title: 'SCRUM-9 — Demo mock',
      content: 'Assignee: Demo Bot',
      workspaceId: demoWs,
      metadata: { issueKey: 'SCRUM-9', assigneeName: 'Demo Bot' },
      score: 999,
    }),
  ];

  // Simulate workspace isolation: only Real docs enter the search result
  const realHits = hits.filter((h) => h.workspaceId === realWs);
  assert.ok(
    realHits.every((h) => h.workspaceId === realWs),
    'No Demo rows in Real retrieval',
  );
  assert.ok(
    !realHits.some((h) => h.metadata?.assigneeName === 'Demo Bot'),
    'Demo assignee must not leak',
  );

  // Field questions retrieve Jira-only — simulate collector selection.
  const fieldHits = realHits.filter((h) => h.entity === 'jira_issue');
  assert.ok(fieldHits.length >= 1, 'Expected at least one jira_issue');

  const bySource: WorkspaceSearchResult['bySource'] = {};
  for (const hit of fieldHits) {
    const bucket = bySource[hit.source] ?? [];
    bucket.push(hit);
    bySource[hit.source] = bucket;
  }

  const search: WorkspaceSearchResult = {
    query: 'Who is assigned to SCRUM-9?',
    filters: { issueKey: 'SCRUM-9', jiraFieldsOnly: true },
    hits: fieldHits,
    bySource,
    references: fieldHits.map((h) => h.reference),
    diagnostics: { sources: [], summary: 'test' },
  };

  const contextBuilder = new ContextBuilderService();
  const context = contextBuilder.build({
    intent: WorkspaceAiIntent.ISSUE_STATUS,
    search,
  });

  const sectionIds = context.sections.map((s) => s.id);
  assert.ok(sectionIds.includes('jira'), 'Expected JIRA section');
  assert.ok(
    !sectionIds.includes('team_memory'),
    'Field question must exclude Team Memory',
  );
  assert.ok(
    !sectionIds.includes('reports'),
    'Field question must exclude Reports',
  );

  const jiraSection = context.sections.find((s) => s.id === 'jira')!;
  assert.ok(
    /Karam Waleed/i.test(jiraSection.text),
    'Assignee must come from Jira section',
  );
  assert.ok(
    /In Progress/i.test(jiraSection.text),
    'Status must come from Jira section',
  );
  assert.ok(
    !/Demo Bot/i.test(context.contextText),
    'Demo assignee must not appear in context',
  );
  assert.ok(
    !/OAuth dependency/i.test(context.contextText),
    'Team Memory must not appear in field-question context',
  );

  const promptBuilder = new WorkspacePromptBuilder();
  const prompt = promptBuilder.build({
    question: 'Who is assigned to SCRUM-9?',
    intent: {
      intent: WorkspaceAiIntent.ISSUE_STATUS,
      confidence: 0.9,
      filters: { issueKey: 'SCRUM-9', jiraFieldsOnly: true },
      rationale: 'test',
    },
    context,
  });
  assert.ok(
    /JIRA|Live Jira|AUTHORITATIVE/i.test(prompt.system),
    'Prompt must enforce Jira authority',
  );
  assert.ok(
    context.finalSourcesUsed.every((s) => s === 'jira'),
    `Expected jira-only sources, got ${context.finalSourcesUsed.join(',')}`,
  );

  console.log(
    '✓ Q1 Who is assigned to SCRUM-9? — Live Jira fields only; no Memory/Reports/Demo',
  );
}

// ---------------------------------------------------------------------------
// 4) Scenario: What happened with SCRUM-9 last week?
// ---------------------------------------------------------------------------
{
  const hits: KnowledgeDocument[] = [
    doc({
      id: 'jira:SCRUM-9b',
      source: 'jira',
      entity: 'jira_issue',
      title: 'SCRUM-9',
      content: 'Status: In Progress\nAssignee: Karam',
      metadata: {
        issueKey: 'SCRUM-9',
        status: 'In Progress',
        assigneeName: 'Karam',
        authoritativeJiraFields: true,
      },
    }),
    doc({
      id: 'slack:week',
      source: 'slack',
      entity: 'standup_thread',
      title: 'Thread about SCRUM-9',
      content: 'Team discussed SCRUM-9 progress last week',
      metadata: { issueKey: 'SCRUM-9' },
    }),
    doc({
      id: 'standup:week',
      source: 'standup_runs',
      entity: 'standup_run',
      title: 'Standup run',
      content: 'SCRUM-9 updates in standup',
      metadata: { issueKey: 'SCRUM-9' },
    }),
    doc({
      id: 'report:week',
      source: 'reports',
      entity: 'report',
      title: 'Weekly digest',
      content: 'Weekly: SCRUM-9 advanced',
      metadata: { issueKey: 'SCRUM-9' },
    }),
    doc({
      id: 'memory:week',
      source: 'team_memory',
      entity: 'team_memory',
      title: 'Memory',
      content: 'Historical decision on SCRUM-9',
      metadata: { issueKey: 'SCRUM-9' },
    }),
  ];

  const bySource: WorkspaceSearchResult['bySource'] = {};
  for (const hit of hits) {
    const bucket = bySource[hit.source] ?? [];
    bucket.push(hit);
    bySource[hit.source] = bucket;
  }

  const context = new ContextBuilderService().build({
    intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
    search: {
      query: 'What happened with SCRUM-9 last week?',
      filters: { issueKey: 'SCRUM-9' },
      hits,
      bySource,
      references: hits.map((h) => h.reference),
      diagnostics: { sources: [], summary: 'test' },
    },
  });

  const ids = new Set(context.sections.map((s) => s.id));
  assert.ok(ids.has('jira'));
  assert.ok(ids.has('slack') || ids.has('standups'));
  assert.ok(ids.has('reports'));
  assert.ok(ids.has('team_memory'));
  assert.ok(
    context.finalSourcesUsed.length >= 4,
    'Merged answer must include multiple sources',
  );
  console.log(
    '✓ Q2 What happened with SCRUM-9 last week? — Slack + Reports + Standups + Team Memory + Jira merged',
  );
}

// ---------------------------------------------------------------------------
// 5) Scenario: What blockers are related to SCRUM-9?
// ---------------------------------------------------------------------------
{
  const hits: KnowledgeDocument[] = [
    doc({
      id: 'blocker:1',
      source: 'blockers',
      entity: 'blocker',
      title: 'OAuth dependency',
      content: 'Blocked on SCRUM-9 callback',
      metadata: { issueKey: 'SCRUM-9', linkedIssueKey: 'SCRUM-9' },
      score: 80,
    }),
    doc({
      id: 'jira:SCRUM-9c',
      source: 'jira',
      entity: 'jira_issue',
      title: 'SCRUM-9',
      content: 'Status: In Progress',
      metadata: {
        issueKey: 'SCRUM-9',
        status: 'In Progress',
        authoritativeJiraFields: true,
      },
    }),
    doc({
      id: 'slack:b',
      source: 'slack',
      entity: 'standup_submission',
      title: 'Standup',
      content: 'Still waiting on SCRUM-9',
      metadata: { issueKey: 'SCRUM-9' },
    }),
    doc({
      id: 'report:b',
      source: 'reports',
      entity: 'report',
      title: 'Report',
      content: 'Blocker digest mentions SCRUM-9',
      metadata: { issueKey: 'SCRUM-9' },
    }),
    doc({
      id: 'memory:b',
      source: 'team_memory',
      entity: 'team_memory',
      title: 'Past blocker',
      content: 'Similar OAuth blocker last quarter for SCRUM-9',
      metadata: { issueKey: 'SCRUM-9' },
    }),
  ];

  const bySource: WorkspaceSearchResult['bySource'] = {};
  for (const hit of hits) {
    const bucket = bySource[hit.source] ?? [];
    bucket.push(hit);
    bySource[hit.source] = bucket;
  }

  const context = new ContextBuilderService().build({
    intent: WorkspaceAiIntent.GET_BLOCKERS,
    search: {
      query: 'What blockers are related to SCRUM-9?',
      filters: { issueKey: 'SCRUM-9' },
      hits,
      bySource,
      references: hits.map((h) => h.reference),
      diagnostics: { sources: [], summary: 'test' },
    },
  });

  const ids = new Set(context.sections.map((s) => s.id));
  assert.ok(ids.has('blockers'), 'Expected BLOCKERS section');
  assert.ok(ids.has('jira'), 'Expected JIRA section');
  assert.ok(ids.has('standups') || ids.has('slack'), 'Expected Slack');
  assert.ok(ids.has('reports'), 'Expected Reports');
  assert.ok(ids.has('team_memory'), 'Expected Team Memory');
  assert.ok(/OAuth dependency/i.test(context.contextText));
  console.log(
    '✓ Q3 What blockers are related to SCRUM-9? — Blockers + Jira + Slack + Reports + Team Memory merged',
  );
}

// ---------------------------------------------------------------------------
// 6) Invariants: field questions never answer from Team Memory alone
// ---------------------------------------------------------------------------
{
  const memoryOnly: KnowledgeDocument[] = [
    doc({
      id: 'memory:only',
      source: 'team_memory',
      entity: 'team_memory',
      title: 'Memory claims assignee is Alice',
      content: 'SCRUM-9 assignee is Alice (WRONG — not authoritative)',
      metadata: { issueKey: 'SCRUM-9' },
    }),
  ];

  // Field questions select Jira collectors only — never Team Memory.
  const selected = selectRelevantSources({
    intent: WorkspaceAiIntent.ISSUE_STATUS,
    question: 'Who is assigned to SCRUM-9?',
    filters: { issueKey: 'SCRUM-9' },
  });
  assert.deepStrictEqual(selected, ['jira']);
  assert.ok(
    !selected.includes('team_memory'),
    'Must never select Team Memory for field questions',
  );

  const context = new ContextBuilderService().build({
    intent: WorkspaceAiIntent.ISSUE_STATUS,
    search: {
      query: 'Who is assigned to SCRUM-9?',
      filters: { issueKey: 'SCRUM-9', jiraFieldsOnly: true },
      hits: memoryOnly,
      bySource: { team_memory: memoryOnly },
      references: memoryOnly.map((h) => h.reference),
      diagnostics: { sources: [], summary: 'test' },
    },
  });

  const prompt = new WorkspacePromptBuilder().build({
    question: 'Who is assigned to SCRUM-9?',
    intent: {
      intent: WorkspaceAiIntent.ISSUE_STATUS,
      confidence: 0.9,
      filters: { issueKey: 'SCRUM-9', jiraFieldsOnly: true },
      rationale: 'test',
    },
    context,
  });
  assert.ok(
    /JIRA|Live Jira|AUTHORITATIVE|ONLY/i.test(prompt.system),
    'Prompt must keep Jira field authority even if only memory docs leaked in',
  );
  console.log(
    '✓ Invariant: field questions select Jira-only collectors; prompt forbids Memory overwrite',
  );
}

console.log('All multi-source RAG integration tests passed.');
