/**
 * Jira issue summaries must be a single line — newlines cause 400 errors.
 */
export function sanitizeJiraSummary(raw: string): string {
  const cleaned = raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return 'Pulse blocker';
  }

  // Jira summary practical limit
  if (cleaned.length <= 255) {
    return cleaned;
  }

  return `${cleaned.slice(0, 252)}...`;
}

export function buildJiraDescriptionAdf(description: string): {
  type: 'doc';
  version: 1;
  content: Array<{
    type: 'paragraph';
    content: Array<{ type: 'text'; text: string }>;
  }>;
} {
  const lines = description
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line.length > 0 || (index > 0 && all[index - 1].length > 0));

  const paragraphs =
    lines.length > 0
      ? lines.map((line) => ({
          type: 'paragraph' as const,
          content: [
            {
              type: 'text' as const,
              text: line.length > 0 ? line : ' ',
            },
          ],
        }))
      : [
          {
            type: 'paragraph' as const,
            content: [{ type: 'text' as const, text: 'Created from Pulse standup blocker.' }],
          },
        ];

  return {
    type: 'doc',
    version: 1,
    content: paragraphs,
  };
}

export type ExtractedBlockerDetails = {
  title: string;
  description: string;
  severity: string;
  category: string | null;
  expectedResolution: string | null;
  preventingAllWork: boolean;
  ownerLabel: string | null;
  canContinueOtherTask: string | null;
  jiraIssue: string | null;
};

export function extractBlockerDetailsFromAnswer(params: {
  text: string;
  structuredValue: unknown;
}): ExtractedBlockerDetails {
  const structured = params.structuredValue;
  if (structured && typeof structured === 'object' && !Array.isArray(structured)) {
    const blocker = (structured as { blocker?: Record<string, unknown> }).blocker;
    if (blocker && typeof blocker === 'object') {
      const title = String(blocker.title ?? '').trim();
      const description = String(blocker.description ?? '').trim();
      const severity = String(blocker.severity ?? 'medium').trim() || 'medium';
      const categoryRaw = String(blocker.category ?? '').trim();
      const expectedResolution = String(blocker.expectedResolution ?? '').trim();
      const ownerLabel = String(blocker.owner ?? '').trim();
      const canContinueOtherTask = String(
        blocker.canContinueOtherTask ?? '',
      ).trim();
      const jiraIssueRaw = blocker.jiraIssue;
      const jiraIssue =
        typeof jiraIssueRaw === 'string' && jiraIssueRaw.trim()
          ? jiraIssueRaw.trim()
          : null;

      return {
        title: title || fallbackTitleFromText(params.text),
        description: description || params.text.trim(),
        severity,
        category: categoryRaw || null,
        expectedResolution: expectedResolution || null,
        preventingAllWork: blocker.preventingAllWork === true,
        ownerLabel: ownerLabel || null,
        canContinueOtherTask: canContinueOtherTask || null,
        jiraIssue,
      };
    }
  }

  return {
    title: fallbackTitleFromText(params.text),
    description: params.text.trim(),
    severity: 'medium',
    category: null,
    expectedResolution: null,
    preventingAllWork: false,
    ownerLabel: null,
    canContinueOtherTask: null,
    jiraIssue: null,
  };
}

function fallbackTitleFromText(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return '';
  }

  // Skip the YES_NO polarity line when present
  if (lines[0].toLowerCase() === 'yes' && lines[1]) {
    // Prefer an explicit "Title:" line from formatted display text
    const titled = lines.find((line) => /^title:\s*/i.test(line));
    if (titled) {
      return titled.replace(/^title:\s*/i, '').trim();
    }
    return lines[1];
  }

  return lines[0];
}

/**
 * Maps raw Jira API error payloads to a short Slack-friendly reason.
 * Full payload should be logged separately by the caller.
 */
export function toFriendlyJiraErrorMessage(raw: string): string {
  const normalized = raw.trim();
  if (!normalized) {
    return 'Jira rejected the request.';
  }

  try {
    const parsed = JSON.parse(normalized) as {
      errorMessages?: string[];
      errors?: Record<string, string>;
      message?: string;
    };

    const fieldErrors = parsed.errors ? Object.values(parsed.errors) : [];
    const messages = [
      ...(parsed.errorMessages ?? []),
      ...fieldErrors,
      ...(parsed.message ? [parsed.message] : []),
    ]
      .map((item) => String(item).trim())
      .filter(Boolean);

    if (messages.length > 0) {
      return humanizeJiraError(messages[0]);
    }
  } catch {
    // not JSON — fall through
  }

  return humanizeJiraError(normalized);
}

function humanizeJiraError(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('newline')) {
    return 'Summary contains invalid characters.';
  }
  if (lower.includes('summary')) {
    return 'Summary is invalid.';
  }
  if (lower.includes('project')) {
    return 'No valid Jira project was available.';
  }
  if (lower.includes('permission') || lower.includes('forbidden')) {
    return 'Missing permission to create issues in Jira.';
  }
  if (lower.includes('unauthorized') || lower.includes('token')) {
    return 'Jira connection expired. Reconnect Jira and try again.';
  }

  // Strip HTTP wrapper prefixes like "Jira API request failed (400): ..."
  const stripped = message
    .replace(/^Jira API request failed \(\d+\):\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();

  if (stripped.length > 160) {
    return `${stripped.slice(0, 157)}...`;
  }

  return stripped || 'Jira rejected the request.';
}
