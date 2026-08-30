/**
 * Shared Slack member helpers — single source of truth for
 * placeholder / test account detection and display-name resolution.
 */

export const PULSE_SLACK_BOT_LABEL = 'Pulse Slack Bot';

const PLACEHOLDER_SLACK_USER_IDS = new Set([
  'verify-slack-user',
  'uslackbot',
  'slackbot',
]);

const BOT_SLACK_USER_IDS = new Set(['uslackbot', 'slackbot']);

/** Matches bare Slack member IDs: U… (user), W… (workspace), B… (bot/app). */
export const SLACK_MEMBER_ID_RE = /^[UWB][A-Z0-9]+$/i;

/** Matches <@U123ABC> and <@W123ABC|displayname> Slack mention forms. */
const SLACK_MENTION_RE = /<@([UWB][A-Z0-9]+)(?:\|[^>]+)?>/gi;

/**
 * Returns true for synthetic / test / placeholder accounts that must never
 * appear in member pickers or filters (regardless of workspace).
 * Demo roster IDs (U0DM*) are real Demo Workspace members and are kept.
 */
export function isPlaceholderSlackUser(params: {
  slackUserId: string | null | undefined;
  slackDisplayName?: string | null;
  email?: string | null;
}): boolean {
  const id = (params.slackUserId ?? '').trim().toLowerCase();
  const name = (params.slackDisplayName ?? '').trim().toLowerCase();
  const email = (params.email ?? '').trim().toLowerCase();

  if (!id) return true;
  if (PLACEHOLDER_SLACK_USER_IDS.has(id)) return true;
  if (id.startsWith('flow-test-')) return true;
  if (id.startsWith('verify-')) return true;
  if (id.startsWith('test-') || id.startsWith('u_test')) return true;

  if (name === 'flow test user') return true;
  if (name.includes('verify-slack')) return true;
  if (name.includes('flow test')) return true;
  if (/\btest user\b/.test(name)) return true;
  if (name === 'test' || name.startsWith('test ')) return true;

  if (email.endsWith('@example.invalid')) return true;
  if (email.includes('flow-test')) return true;
  if (email.includes('verify-slack')) return true;

  return false;
}

export function isUsableSlackBotToken(token: string | null | undefined): boolean {
  if (!token?.trim()) return false;
  if (!token.startsWith('xoxb-')) return false;
  if (token.includes('demo') || token.includes('placeholder')) return false;
  return true;
}

export function isSlackBotUserId(slackUserId: string | null | undefined): boolean {
  if (!slackUserId?.trim()) return false;
  return BOT_SLACK_USER_IDS.has(slackUserId.trim().toLowerCase());
}

/**
 * Prefer full real name → Slack display name → Slack ID.
 * Slack bots always render as "Pulse Slack Bot".
 */
export function memberDisplayLabel(params: {
  slackDisplayName?: string | null;
  slackRealName?: string | null;
  slackUserId: string;
}): string {
  if (isSlackBotUserId(params.slackUserId)) {
    return PULSE_SLACK_BOT_LABEL;
  }
  return (
    params.slackRealName?.trim() ||
    params.slackDisplayName?.trim() ||
    params.slackUserId
  );
}

/** Extract raw Slack user IDs from text containing <@U…> mentions. */
export function extractSlackUserIds(text: string | null | undefined): string[] {
  if (!text) return [];
  const ids = new Set<string>();
  const re = new RegExp(SLACK_MENTION_RE.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[1]) ids.add(match[1]);
  }
  // Also catch bare owner labels that are just a Slack ID.
  const bare = text.trim();
  if (SLACK_MEMBER_ID_RE.test(bare)) {
    ids.add(bare);
  }
  return [...ids];
}

/**
 * Replace <@U…> mentions (and bare Slack IDs used as owner labels)
 * with human display names from a workspace-scoped map.
 */
export function resolveSlackMentionsInText(
  text: string | null | undefined,
  nameBySlackId: Map<string, string>,
): string {
  if (!text) return '';

  let resolved = text.replace(SLACK_MENTION_RE, (_full, rawId: string) => {
    const id = String(rawId);
    if (isSlackBotUserId(id)) return PULSE_SLACK_BOT_LABEL;
    return (
      nameBySlackId.get(id) ||
      nameBySlackId.get(id.toUpperCase()) ||
      nameBySlackId.get(id.toLowerCase()) ||
      'Unknown User'
    );
  });

  // Bare Slack ID as the entire string (common for ownerLabel).
  const trimmed = resolved.trim();
  if (SLACK_MEMBER_ID_RE.test(trimmed)) {
    if (isSlackBotUserId(trimmed)) return PULSE_SLACK_BOT_LABEL;
    const mapped =
      nameBySlackId.get(trimmed) ||
      nameBySlackId.get(trimmed.toUpperCase()) ||
      nameBySlackId.get(trimmed.toLowerCase());
    return mapped ?? 'Unknown User';
  }

  return resolved;
}

/**
 * Look up a display label for a Slack user id; never returns the raw id.
 * Safe when slackUserId is missing (stored digests / partial blocker JSON).
 */
export function lookupSlackDisplayName(
  slackUserId: string | null | undefined,
  nameBySlackId: Map<string, string>,
): string {
  if (!slackUserId?.trim()) return 'Unknown User';
  if (isSlackBotUserId(slackUserId)) return PULSE_SLACK_BOT_LABEL;
  const id = slackUserId.trim();
  return (
    nameBySlackId.get(id) ||
    nameBySlackId.get(id.toUpperCase()) ||
    nameBySlackId.get(id.toLowerCase()) ||
    'Unknown User'
  );
}

/**
 * Replace <@U…> mentions and every embedded bare Slack member id in text.
 * Never leaves raw U/W/B ids in the output.
 */
export function resolveAllSlackIdsInText(
  text: string | null | undefined,
  nameBySlackId: Map<string, string>,
): string {
  if (!text) return '';

  let resolved = resolveSlackMentionsInText(text, nameBySlackId);
  resolved = resolved.replace(/\b([UWB][A-Z0-9]{8,})\b/gi, (_full, id: string) =>
    lookupSlackDisplayName(id, nameBySlackId),
  );
  return resolved;
}

/** True when text still contains Slack mention syntax or bare member ids. */
export function textContainsSlackUserId(
  text: string | null | undefined,
): boolean {
  if (!text?.trim()) return false;
  if (SLACK_MEMBER_ID_RE.test(text.trim())) return true;
  if (/<@[UWB][A-Z0-9]+/i.test(text)) return true;
  return /\b[UWB][A-Z0-9]{8,}\b/i.test(text);
}

/**
 * Resolve an owner field that may be `<@U…>`, a bare Slack ID, or already a name.
 */
export function resolveOwnerDisplayName(
  ownerLabel: string | null | undefined,
  nameBySlackId: Map<string, string>,
): string | null {
  if (!ownerLabel?.trim()) return null;
  const resolved = resolveAllSlackIdsInText(ownerLabel, nameBySlackId).trim();
  return resolved || null;
}
