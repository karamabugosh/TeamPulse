import { DetectedIntent } from '../types/workspace-ai.types';

/**
 * Policy for vacation date-collection follow-ups.
 * Pending clarification only continues when the next user message
 * clearly answers with a date / relative date — never for a new intent.
 */

const WEEKDAYS =
  'monday|tuesday|wednesday|thursday|friday|saturday|sunday';

/** True when the message is primarily a date / relative-date clarification reply. */
export function isVacationClarificationReply(question: string): boolean {
  const q = question.trim();
  if (!q) return false;

  // New questions always cancel the pending vacation flow.
  if (
    /^(why|what|who|how|where|which|generate|show|list|summarize|replay|explain|tell\s+me|can\s+you|could\s+you|please)\b/i.test(
      q,
    )
  ) {
    return false;
  }

  if (/\b(scrum|jira)-\d+\b/i.test(q) && q.length > 24) {
    return false;
  }

  const lower = q.toLowerCase();

  if (extractClarificationDatePair(q)) return true;

  if (
    /^(last\s+week|since\s+last\s+week|yesterday|today|last\s+\d+\s+days?)$/i.test(
      lower,
    )
  ) {
    return true;
  }

  if (
    new RegExp(`^last\\s+(${WEEKDAYS})\\b`, 'i').test(lower) &&
    q.length <= 40
  ) {
    return true;
  }

  if (/\blast\s+\d+\s+days?\b/i.test(lower) && q.length <= 40) {
    return true;
  }

  const single = extractClarificationSingleDate(q);
  if (!single) return false;

  // Bare / short date answers only (e.g. "Aug 10", "2026-08-10", "August 10, 2026").
  return q.length <= 48;
}

/**
 * Intent is evaluated by the caller before this decision.
 * Continue only when the message clearly answers the date clarification.
 * Short date strings must not be blocked by noisy intent scores (e.g. "Aug 10").
 */
export function shouldContinueVacationPending(params: {
  question: string;
  awaiting: 'start' | 'end';
  intent: DetectedIntent;
}): boolean {
  void params.awaiting;
  void params.intent;
  return isVacationClarificationReply(params.question);
}

function extractClarificationDatePair(
  text: string,
): { from: Date; to: Date } | null {
  const patterns = [
    /(?:from\s+)?([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?)\s*(?:→|->|to|until|through|-)\s*([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?)/i,
    /(\d{4}-\d{2}-\d{2})\s*(?:→|->|to|until|through|-)\s*(\d{4}-\d{2}-\d{2})/i,
    /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*(?:→|->|to|until|through|-)\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const from = parseFlexibleClarificationDate(match[1]);
    const to = parseFlexibleClarificationDate(match[2]);
    if (from && to) return { from, to };
  }
  return null;
}

function extractClarificationSingleDate(text: string): Date | null {
  const patterns = [
    /\b([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?)\b/,
    /\b(\d{4}-\d{2}-\d{2})\b/,
    /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const parsed = parseFlexibleClarificationDate(match[1]);
    if (parsed) return parsed;
  }
  return null;
}

function parseFlexibleClarificationDate(raw: string): Date | null {
  const value = raw.trim();
  const year = new Date().getFullYear();
  const monthDay = value.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (monthDay) {
    const candidate = new Date(
      `${monthDay[1]} ${monthDay[2]}, ${monthDay[3] ?? year}`,
    );
    if (!Number.isNaN(candidate.getTime())) return candidate;
  }
  const iso = new Date(value);
  if (!Number.isNaN(iso.getTime())) return iso;
  return null;
}
