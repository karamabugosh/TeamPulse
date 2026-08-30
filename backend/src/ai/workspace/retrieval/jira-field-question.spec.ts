/**
 * Composite Jira + standup field question routing tests.
 * Run: npx ts-node src/ai/workspace/retrieval/jira-field-question.spec.ts
 */
import {
  isJiraFieldQuestion,
  shouldUseJiraFieldsOnly,
} from './jira-field-question';
import { buildMemoryRetrievalPlan } from '../../../memory/memory-retrieval-policy';
import { selectRelevantSources } from './source-selection';
import { WorkspaceAiIntent } from '../types/workspace-ai.types';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function main() {
  const compositeQ =
    "What did Karam say about SCRUM-9 in his latest standup, and what is SCRUM-9's current status, assignee, and priority in Jira?";

  assert(
    !isJiraFieldQuestion(compositeQ, 'SCRUM-9'),
    'composite question is not jira-fields-only',
  );
  assert(
    !shouldUseJiraFieldsOnly({
      intent: WorkspaceAiIntent.ISSUE_STATUS,
      question: compositeQ,
      issueKey: 'SCRUM-9',
    }),
    'composite ISSUE_STATUS not fields-only',
  );

  const plan = buildMemoryRetrievalPlan({
    intent: WorkspaceAiIntent.ISSUE_STATUS,
    question: compositeQ,
    issueKey: 'SCRUM-9',
    hasTrustedUserId: true,
    modeOverride: 'HYBRID',
  });
  assert(plan.category === 'COMPOSITE_JIRA_MEMORY', 'composite category');
  assert(!plan.jiraFieldsOnly, 'composite plan not jiraFieldsOnly');
  assert(plan.useLiveJira, 'composite uses live jira');

  const sources = selectRelevantSources({
    intent: WorkspaceAiIntent.ISSUE_STATUS,
    question: compositeQ,
    filters: {
      issueKey: 'SCRUM-9',
      jiraFieldsOnly: false,
      memoryAskCategory: 'COMPOSITE_JIRA_MEMORY',
    },
  });
  assert(sources.includes('jira'), 'composite includes jira');
  assert(sources.includes('team_memory'), 'composite includes team_memory');
  assert(sources.includes('standup_runs'), 'composite includes standup_runs');
  assert(sources.length > 1, 'composite is multi-source');

  const pureQ = 'Who is assigned to SCRUM-9?';
  assert(isJiraFieldQuestion(pureQ, 'SCRUM-9'), 'pure assignee is field question');
  const purePlan = buildMemoryRetrievalPlan({
    intent: WorkspaceAiIntent.ISSUE_STATUS,
    question: pureQ,
    issueKey: 'SCRUM-9',
    hasTrustedUserId: true,
    modeOverride: 'HYBRID',
  });
  assert(purePlan.jiraFieldsOnly, 'pure field plan is jiraFieldsOnly');
  const pureSources = selectRelevantSources({
    intent: WorkspaceAiIntent.ISSUE_STATUS,
    question: pureQ,
    filters: {
      issueKey: 'SCRUM-9',
      jiraFieldsOnly: true,
      memoryAskCategory: 'CURRENT_JIRA_FIELD',
    },
  });
  assert(
    pureSources.length === 1 && pureSources[0] === 'jira',
    'pure field jira only',
  );

  console.log('✓ jira-field-question.spec.ts passed');
}

main();
