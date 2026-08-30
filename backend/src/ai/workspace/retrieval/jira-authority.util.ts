import { KnowledgeDocument } from '../types/workspace-ai.types';

/** Jira field lines that must only appear from Live Jira API evidence. */
const JIRA_FIELD_LINE =
  /^\s*(Status|Priority|Assignee|Reporter|Sprint|Fix Version|Issue Type)\s*:/i;

/**
 * True when the document carries current Jira fields from Live API refresh.
 */
export function isLiveJiraDocument(doc: KnowledgeDocument): boolean {
  return (
    (doc.entity === 'jira_issue' || doc.source === 'jira') &&
    doc.metadata?.liveRefreshed === true
  );
}

/**
 * True when this document may supply authoritative Jira field values in answers.
 * Live API refresh wins; offline cache is authoritative only when Live Jira is not connected.
 */
export function hasAuthoritativeJiraFields(doc: KnowledgeDocument): boolean {
  if (doc.metadata?.authoritativeJiraFields !== true) return false;
  if (doc.metadata?.liveRefreshed === true) return true;
  return doc.metadata?.hasLiveJiraConnection === false;
}

/**
 * Strip embedded Jira field metadata from conversational sources (standups, memory, slack).
 * Slack/standups may mention issue keys — that is fine; field values are not authoritative.
 */
export function sanitizeConversationalJiraFields(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  let stripped = false;

  for (const line of lines) {
    if (JIRA_FIELD_LINE.test(line)) {
      stripped = true;
      continue;
    }
    out.push(line);
  }

  if (!stripped) return content;

  return [
    '[Conversational context only — not authoritative for Jira status/assignee/priority]',
    ...out,
  ].join('\n');
}

export const CONVERSATIONAL_CONTEXT_BANNER =
  'CONVERSATIONAL CONTEXT ONLY — use for what was said in standups/Slack/memory. ' +
  'Do NOT use for current Jira status, assignee, priority, summary, reporter, or sprint.';
