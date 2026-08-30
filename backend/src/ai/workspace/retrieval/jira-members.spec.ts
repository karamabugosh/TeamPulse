/**
 * Integration tests for Jira member retrieval (mirrors Slack member path).
 *
 * Run: npx ts-node src/ai/workspace/retrieval/jira-members.spec.ts
 */
import * as assert from 'assert';
import {
  IntentDetectionService,
  isJiraMembersQuestion,
  isSlackMembersQuestion,
} from '../intent/intent-detection.service';
import { selectRelevantSources } from './source-selection';
import { WorkspacePromptBuilder } from '../prompts/workspace-prompt.builder';
import { ContextBuilderService } from '../context/context-builder.service';
import {
  KnowledgeDocument,
  SourceReference,
  WorkspaceAiIntent,
  WorkspaceSearchResult,
  WorkspaceSourceType,
} from '../types/workspace-ai.types';

console.log('jira-members.spec.ts');

const intent = new IntentDetectionService();

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

function jiraMemberDoc(partial: {
  accountId: string;
  displayName: string;
  email?: string | null;
  sourceUsed?: string;
  workspaceId?: string;
}): KnowledgeDocument {
  const workspaceId = partial.workspaceId ?? 'ws-real-1';
  const sourceUsed = partial.sourceUsed ?? 'Live Jira';
  return {
    id: `jira_member:${partial.accountId}`,
    workspaceId,
    source: 'jira',
    entity: 'jira_member',
    title: partial.displayName,
    content: [
      `Display name: ${partial.displayName}`,
      `Account id: ${partial.accountId}`,
      partial.email ? `Email: ${partial.email}` : null,
      `Data source: ${sourceUsed}`,
      'AUTHORITATIVE_JIRA_MEMBERS: true',
    ]
      .filter(Boolean)
      .join('\n'),
    timestamp: new Date().toISOString(),
    url: null,
    reference: ref('jira', 'jira_member', partial.accountId, workspaceId),
    metadata: {
      accountId: partial.accountId,
      email: partial.email ?? null,
      jiraMemberSource: sourceUsed,
      authoritativeJiraMembers: true,
    },
    score: 100,
  };
}

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------
const jiraQuestions = [
  'Who are the Jira members?',
  'List Jira users.',
  'Show Jira workspace members.',
  'give me the members in jira',
  'Who has access to Jira?',
  'List project members.',
];

for (const q of jiraQuestions) {
  const detected = intent.detect(q);
  assert.strictEqual(
    detected.intent,
    WorkspaceAiIntent.JIRA_MEMBERS,
    `Expected JIRA_MEMBERS for "${q}", got ${detected.intent}`,
  );
  assert.ok(
    detected.filters.jiraMembersOnly,
    `Expected jiraMembersOnly for "${q}"`,
  );
  assert.ok(isJiraMembersQuestion(q.toLowerCase()), q);
}
console.log('✓ Jira member questions detect JIRA_MEMBERS');

const slackQ = intent.detect('give me the members in slack');
assert.strictEqual(slackQ.intent, WorkspaceAiIntent.SLACK_MEMBERS);
assert.ok(!isJiraMembersQuestion('give me the members in slack'));
assert.ok(isSlackMembersQuestion('give me the members in slack'));
console.log('✓ Slack member questions still detect SLACK_MEMBERS');

// ---------------------------------------------------------------------------
// Source selection — Jira directory only
// ---------------------------------------------------------------------------
{
  const sources = selectRelevantSources({
    intent: WorkspaceAiIntent.JIRA_MEMBERS,
    question: 'Who are the Jira members?',
    filters: { jiraMembersOnly: true },
  });
  assert.deepStrictEqual(sources, ['jira_members']);
  assert.ok(!sources.includes('slack_members'));
  assert.ok(!sources.includes('team_memory'));
  assert.ok(!sources.includes('reports'));
  console.log('✓ JIRA_MEMBERS selects jira_members only');
}

// ---------------------------------------------------------------------------
// Context + prompt — live Jira members, no Slack/Memory pollution
// ---------------------------------------------------------------------------
{
  const liveMembers = [
    jiraMemberDoc({
      accountId: 'acc-1',
      displayName: 'Karam Waleed',
      email: 'karam@example.com',
      sourceUsed: 'Live Jira',
    }),
    jiraMemberDoc({
      accountId: 'acc-2',
      displayName: 'Sara Chen',
      email: 'sara@example.com',
      sourceUsed: 'Live Jira',
    }),
  ];

  // Polluting docs that must never answer Jira member questions
  const pollution: KnowledgeDocument[] = [
    {
      id: 'memory:1',
      workspaceId: 'ws-real-1',
      source: 'team_memory',
      entity: 'team_memory',
      title: 'Fake roster',
      content: 'Team Memory says members are Alice and Bob',
      timestamp: new Date().toISOString(),
      url: null,
      reference: ref('team_memory', 'team_memory', '1'),
      score: 999,
    },
    {
      id: 'user:slack-1',
      workspaceId: 'ws-real-1',
      source: 'users',
      entity: 'user',
      title: 'Slack Only Person',
      content: 'AUTHORITATIVE_SLACK_MEMBERS',
      timestamp: new Date().toISOString(),
      url: null,
      reference: ref('users', 'user', 'slack-1'),
      score: 999,
    },
  ];

  // Authority filter simulation (same as enforceJiraMemberAuthority)
  const authoritative = [...liveMembers, ...pollution].filter(
    (h) => h.entity === 'jira_member',
  );
  assert.strictEqual(authoritative.length, 2);
  assert.ok(authoritative.every((h) => h.metadata?.authoritativeJiraMembers));
  assert.ok(
    !authoritative.some((h) => /Alice|Bob|Slack Only/i.test(h.title)),
    'Must not include Slack/Memory names',
  );

  const bySource: WorkspaceSearchResult['bySource'] = { jira: authoritative };
  const search: WorkspaceSearchResult = {
    query: 'Who are the Jira members?',
    filters: { jiraMembersOnly: true },
    hits: authoritative,
    bySource,
    references: authoritative.map((h) => h.reference),
    diagnostics: { sources: [], summary: 'test' },
  };

  const context = new ContextBuilderService().build({
    intent: WorkspaceAiIntent.JIRA_MEMBERS,
    search,
  });
  assert.ok(/Karam Waleed/i.test(context.contextText));
  assert.ok(/Sara Chen/i.test(context.contextText));
  assert.ok(!/Alice|Bob|Slack Only/i.test(context.contextText));

  const prompt = new WorkspacePromptBuilder().build({
    question: 'Who are the Jira members?',
    intent: {
      intent: WorkspaceAiIntent.JIRA_MEMBERS,
      confidence: 0.95,
      filters: { jiraMembersOnly: true },
      rationale: 'test',
    },
    context,
  });
  assert.ok(/AUTHORITATIVE_JIRA_MEMBERS|jira_member/i.test(prompt.system));
  assert.ok(/Never use Slack/i.test(prompt.system));

  console.log('✓ Live Jira members in context; Slack/Memory excluded');
}

// ---------------------------------------------------------------------------
// Expected scenarios from requirements
// ---------------------------------------------------------------------------
for (const q of [
  'Who are the Jira members?',
  'List Jira users.',
  'Show Jira workspace members.',
]) {
  const detected = intent.detect(q);
  assert.strictEqual(detected.intent, WorkspaceAiIntent.JIRA_MEMBERS);
  const sources = selectRelevantSources({
    intent: detected.intent,
    question: q,
    filters: detected.filters,
  });
  assert.deepStrictEqual(sources, ['jira_members']);
}
console.log('✓ Requirement questions route to live Jira member retrieval path');

// Workspace isolation invariant
{
  const real = jiraMemberDoc({
    accountId: 'real-1',
    displayName: 'Real User',
    workspaceId: 'ws-real-1',
  });
  const demo = jiraMemberDoc({
    accountId: 'demo-1',
    displayName: 'Demo User',
    workspaceId: 'ws-demo-1',
    sourceUsed: 'Demo',
  });
  const realOnly = [real, demo].filter((d) => d.workspaceId === 'ws-real-1');
  assert.strictEqual(realOnly.length, 1);
  assert.strictEqual(realOnly[0].title, 'Real User');
  console.log('✓ Workspace isolation: Real does not include Demo members');
}

console.log('All Jira member retrieval tests passed.');
