export type JiraIssueSnapshot = {
  type: 'issue_ref';
  issueKey: string;
  issueId: string;
  summary: string;
  status: string | null;
  projectKey: string | null;
  projectName: string | null;
  issueType: string | null;
  priority: string | null;
  issueUrl: string | null;
  capturedAt: string;
  assigneeName?: string | null;
  assigneeAccountId?: string | null;
};

export type JiraIssuePickerOption = {
  issueKey: string;
  issueId: string;
  summary: string;
  status: string | null;
  projectKey: string | null;
  issueUrl: string | null;
};

export const JIRA_ISSUE_KEY_PATTERN = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

export function formatIssueRefDisplay(snapshot: JiraIssueSnapshot): string {
  const status = snapshot.status ? ` · ${snapshot.status}` : '';
  return `${snapshot.issueKey} · ${snapshot.summary}${status}`;
}

export function parseIssueRefPayload(raw: string): JiraIssueSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as Partial<JiraIssueSnapshot>;
    if (
      parsed.type === 'issue_ref' &&
      parsed.issueKey &&
      parsed.issueId &&
      parsed.summary
    ) {
      return {
        type: 'issue_ref',
        issueKey: parsed.issueKey,
        issueId: parsed.issueId,
        summary: parsed.summary,
        status: parsed.status ?? null,
        projectKey: parsed.projectKey ?? null,
        projectName: parsed.projectName ?? null,
        issueType: parsed.issueType ?? null,
        priority: parsed.priority ?? null,
        issueUrl: parsed.issueUrl ?? null,
        capturedAt: parsed.capturedAt ?? new Date().toISOString(),
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function readSnapshotFromStructuredValue(
  structuredValue: unknown,
): JiraIssueSnapshot | null {
  if (!structuredValue || typeof structuredValue !== 'object') {
    return null;
  }

  const value = structuredValue as Partial<JiraIssueSnapshot>;
  if (value.type === 'issue_ref' && value.issueKey && value.summary) {
    return {
      type: 'issue_ref',
      issueKey: value.issueKey,
      issueId: value.issueId ?? value.issueKey,
      summary: value.summary,
      status: value.status ?? null,
      projectKey: value.projectKey ?? null,
      projectName: value.projectName ?? null,
      issueType: value.issueType ?? null,
      priority: value.priority ?? null,
      issueUrl: value.issueUrl ?? null,
      capturedAt: value.capturedAt ?? new Date().toISOString(),
    };
  }

  return null;
}

export function formatAnswerForDisplay(answer: {
  text: string;
  structuredValue?: unknown;
}): string {
  const snapshot = readSnapshotFromStructuredValue(answer.structuredValue);
  if (snapshot) {
    return formatIssueRefDisplay(snapshot);
  }

  return answer.text;
}

export function extractJiraIssueKeys(text: string): string[] {
  const matches = text.match(JIRA_ISSUE_KEY_PATTERN) ?? [];
  return [...new Set(matches.map((key) => key.toUpperCase()))];
}
