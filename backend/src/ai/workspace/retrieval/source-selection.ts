import {
  WorkspaceAiIntent,
  WorkspaceSearchFilters,
} from '../types/workspace-ai.types';
import { shouldUseJiraFieldsOnly } from './jira-field-question';

/**
 * Collector keys used by WorkspaceKnowledgeService.collectSnapshot.
 * Multi-source RAG selects a set of these — never a single narrative source alone
 * EXCEPT for factual Jira field questions (assignee/status/priority/…).
 */
export type RetrievalSourceKey =
  | 'jira'
  | 'jira_audit'
  | 'slack_standups'
  | 'slack_threads'
  | 'standup_runs'
  | 'check_ins'
  | 'blockers'
  | 'blocker_updates'
  | 'reports'
  | 'team_memory'
  | 'ai_conversations'
  | 'slack_ai_chat'
  | 'slack_members'
  | 'jira_members'
  | 'slack_channels';

/** Core sources queried for almost every grounded question. */
export const CORE_MULTI_SOURCES: RetrievalSourceKey[] = [
  'jira',
  'jira_audit',
  'slack_standups',
  'slack_threads',
  'standup_runs',
  'blockers',
  'blocker_updates',
  'reports',
  'team_memory',
  'ai_conversations',
  'slack_ai_chat',
];

const BLOCKER_SIGNAL =
  /\b(blocked|blocker|blockers|blocking|dependency|dependencies|waiting|stuck|impediment)\b/i;

/**
 * Determine which collectors to run for this question.
 *
 * Rules:
 * - Factual Jira field questions (status/assignee/priority/…) → Jira ONLY.
 * - Investigation / narrative issue questions → multi-source (Jira still field authority).
 * - SLACK_MEMBERS / LIST_MEMBERS stay Slack-directory-only.
 * - JIRA_MEMBERS stays Jira-directory-only.
 */
export function selectRelevantSources(params: {
  intent: WorkspaceAiIntent;
  question: string;
  filters: WorkspaceSearchFilters;
}): RetrievalSourceKey[] {
  const { intent, question, filters } = params;
  const issueKey = filters.issueKey?.trim() || null;

  if (
    intent === WorkspaceAiIntent.JIRA_MEMBERS ||
    Boolean(filters.jiraMembersOnly)
  ) {
    return ['jira_members'];
  }

  if (Boolean(filters.jiraAssigneeList)) {
    return ['jira'];
  }

  if (
    intent === WorkspaceAiIntent.SLACK_MEMBERS ||
    intent === WorkspaceAiIntent.LIST_MEMBERS ||
    Boolean(filters.slackMembersOnly)
  ) {
    return ['slack_members'];
  }

  // Composite: narrative + current Jira fields → always multi-source.
  if (filters.memoryAskCategory === 'COMPOSITE_JIRA_MEMORY') {
    // fall through to multi-source selection below
  } else if (Boolean(filters.jiraFieldsOnly)) {
    return ['jira'];
  }

  const wantsBlockers =
    BLOCKER_SIGNAL.test(question) ||
    intent === WorkspaceAiIntent.GET_BLOCKERS ||
    Boolean(issueKey);

  const selected = new Set<RetrievalSourceKey>(CORE_MULTI_SOURCES);

  if (wantsBlockers) {
    selected.add('blockers');
    selected.add('blocker_updates');
  }

  if (
    intent === WorkspaceAiIntent.GET_USER_ACTIVITY ||
    intent === WorkspaceAiIntent.EXECUTIVE_REPORT ||
    intent === WorkspaceAiIntent.GENERATE_REPORT
  ) {
    selected.add('slack_members');
  }

  if (
    intent === WorkspaceAiIntent.SUMMARIZE_STANDUP ||
    intent === WorkspaceAiIntent.VACATION_CATCHUP ||
    intent === WorkspaceAiIntent.SPRINT_REPLAY
  ) {
    selected.add('check_ins');
  }

  // Narrative / investigation issue questions: full multi-source set.
  if (
    issueKey ||
    intent === WorkspaceAiIntent.ISSUE_ANALYSIS ||
    intent === WorkspaceAiIntent.PROJECT_DETECTIVE ||
    intent === WorkspaceAiIntent.ROOT_CAUSE_ANALYSIS
  ) {
    for (const key of CORE_MULTI_SOURCES) selected.add(key);
    selected.add('blockers');
    selected.add('blocker_updates');
  }

  return [...selected];
}

/** True when blockers should be merged even if ranking is weak. */
export function shouldForceBlockerMerge(params: {
  intent: WorkspaceAiIntent;
  question: string;
  issueKey?: string | null;
  jiraFieldsOnly?: boolean | null;
}): boolean {
  if (params.jiraFieldsOnly) return false;
  return (
    params.intent === WorkspaceAiIntent.GET_BLOCKERS ||
    Boolean(params.issueKey?.trim()) ||
    BLOCKER_SIGNAL.test(params.question)
  );
}
