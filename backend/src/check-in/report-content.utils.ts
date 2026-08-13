const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^ai analysis is unavailable/i,
  /no substantive standup answers were available/i,
  /^no blockers reported\.?$/i,
  /^no additional insights\.?$/i,
  /^no action items suggested\.?$/i,
  /^no accomplishments reported\.?$/i,
  /^no risks identified\.?$/i,
  /^collected \d+ substantive answer\(s\) from \d+ participant\(s\)\.?$/i,
];

export function isPlaceholderReportText(
  text: string | null | undefined,
): boolean {
  if (!text || typeof text !== 'string') {
    return true;
  }

  const normalized = text.trim();
  if (!normalized) {
    return true;
  }

  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isCanonicalAiDigest(record: {
  source: string;
  summary: string;
  generationError?: string | null;
  slackReportText?: string | null;
}): boolean {
  if (record.source !== 'ai') {
    return false;
  }

  if (record.generationError) {
    return false;
  }

  if (isPlaceholderReportText(record.summary)) {
    return false;
  }

  return true;
}

export function shouldRegenerateReport(record: {
  source: string;
  summary: string;
  generationError?: string | null;
  slackReportText?: string | null;
} | null): boolean {
  if (!record) {
    return true;
  }

  if (record.source === 'rules_fallback') {
    return true;
  }

  if (record.source === 'failed') {
    return true;
  }

  if (isPlaceholderReportText(record.summary)) {
    return true;
  }

  if (
    record.slackReportText &&
    isPlaceholderReportText(record.summary) === false &&
    record.source === 'ai'
  ) {
    return false;
  }

  return !isCanonicalAiDigest(record);
}
