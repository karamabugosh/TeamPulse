import { WorkspaceAiIntent } from '../types/workspace-ai.types';

/**
 * Factual Jira field questions for a known issue key.
 * These MUST answer from Live Jira only (never Team Memory / Reports / Slack / Demo / history).
 */
const JIRA_FIELD_SIGNAL =
  /\b(status|assignee|assigned|priority|summary|title|reporter|sprint|owner|owns|who\s+is\s+working|working\s+on)\b/i;

/**
 * Historical / narrative / investigation language — must NOT force Live-Jira-only.
 * Includes blocker/resolution wording used in Team Memory questions.
 */
const INVESTIGATION_SIGNAL =
  /\b(why|what\s+happened|root\s+cause|delayed|delay|blocked|blocker|blockers|blocking|timeline|history|previous|before|after|discuss|conversation|standup|report|memory|investigate|detective|resolved|resolution|affected|prevented|dependency|impediment)\b/i;

/**
 * True when the question asks for a concrete Jira field on an issue key
 * (status / assignee / priority / summary / reporter / sprint).
 */
export function isJiraFieldQuestion(
  question: string,
  issueKey?: string | null,
): boolean {
  const key = issueKey?.trim();
  if (!key) return false;
  const q = question?.trim() ?? '';
  if (!q) return true; // bare issue key → treat as field lookup

  // Composite / narrative + current Jira fields → multi-source (not Live-Jira-only).
  if (INVESTIGATION_SIGNAL.test(q) && JIRA_FIELD_SIGNAL.test(q)) {
    return false;
  }
  if (
    /\b(latest|most recent|last|today'?s|current)\b/i.test(q) &&
    JIRA_FIELD_SIGNAL.test(q)
  ) {
    return false;
  }

  // Explicit investigation / narrative → multi-source allowed
  // (even when the question also contains "what" + an issue key).
  if (INVESTIGATION_SIGNAL.test(q) && !JIRA_FIELD_SIGNAL.test(q)) {
    return false;
  }

  if (JIRA_FIELD_SIGNAL.test(q)) return true;

  // "Who is assigned to SCRUM-9?" / "What is SCRUM-9?" — short field-like forms only.
  // Do NOT treat "What blockers affected SCRUM-9?" as a field lookup.
  if (
    /\b(who|what|which)\b/i.test(q) &&
    new RegExp(`\\b${escapeRegExp(key)}\\b`, 'i').test(q)
  ) {
    const stripped = q
      .replace(new RegExp(escapeRegExp(key), 'ig'), '')
      .replace(/\b(who|what|which|is|the|of|for|to|on|a|an)\b/gi, '')
      .replace(/[?\s.!,:-]+/g, '')
      .toLowerCase();
    // Remaining content beyond stop-words → not a pure field question
    if (stripped.length > 0) return false;
    return true;
  }

  // Short questions that are only the issue key (+ punctuation)
  const stripped = q
    .replace(new RegExp(escapeRegExp(key), 'ig'), '')
    .replace(/[?\s.!,:-]+/g, '');
  if (!stripped) return true;

  return false;
}

export function shouldUseJiraFieldsOnly(params: {
  intent: WorkspaceAiIntent;
  question: string;
  issueKey?: string | null;
}): boolean {
  if (!params.issueKey?.trim()) return false;
  if (
    params.intent === WorkspaceAiIntent.PROJECT_DETECTIVE ||
    params.intent === WorkspaceAiIntent.ROOT_CAUSE_ANALYSIS ||
    params.intent === WorkspaceAiIntent.GET_BLOCKERS ||
    params.intent === WorkspaceAiIntent.ISSUE_ANALYSIS ||
    params.intent === WorkspaceAiIntent.TEAM_MEMORY_SEARCH ||
    params.intent === WorkspaceAiIntent.SUMMARIZE_STANDUP
  ) {
    return false;
  }
  // ISSUE_STATUS (and others): only fields-only when the question text is a field lookup.
  // Do not treat "issue key present" alone as Live-Jira-only.
  return isJiraFieldQuestion(params.question, params.issueKey);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
