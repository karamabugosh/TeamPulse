import { memberDisplayLabel, resolveOwnerDisplayName, SLACK_MEMBER_ID_RE } from '../../../common/slack-member.util';

export type ResolvedBlockerOwner = {
  ownerName: string;
  ownerSlackId: string | null;
  ownerUserId: string | null;
};

const SLACK_MENTION_ID_RE = /<@([UWB][A-Z0-9]+)/i;

/**
 * Resolve blocker owner fields — never expose raw Slack IDs in ownerName.
 */
export function resolveBlockerOwner(params: {
  ownerLabel: string | null | undefined;
  nameBySlackId: Map<string, string>;
  userBySlackId?: Map<
    string,
    { id: string; slackDisplayName: string | null; slackRealName: string | null }
  >;
}): ResolvedBlockerOwner {
  const raw = params.ownerLabel?.trim() || null;
  if (!raw) {
    return { ownerName: 'Unknown User', ownerSlackId: null, ownerUserId: null };
  }

  let ownerSlackId: string | null = null;
  const mention = raw.match(SLACK_MENTION_ID_RE);
  if (mention?.[1]) {
    ownerSlackId = mention[1];
  } else if (SLACK_MEMBER_ID_RE.test(raw)) {
    ownerSlackId = raw;
  }

  let ownerName = resolveOwnerDisplayName(raw, params.nameBySlackId);
  if (ownerName && SLACK_MEMBER_ID_RE.test(ownerName)) {
    ownerName = null;
  }

  let ownerUserId: string | null = null;
  if (ownerSlackId && params.userBySlackId) {
    const user =
      params.userBySlackId.get(ownerSlackId) ??
      params.userBySlackId.get(ownerSlackId.toUpperCase()) ??
      params.userBySlackId.get(ownerSlackId.toLowerCase());
    if (user) {
      ownerUserId = user.id;
      ownerName = memberDisplayLabel({
        slackDisplayName: user.slackDisplayName,
        slackRealName: user.slackRealName,
        slackUserId: ownerSlackId,
      });
    }
  }

  if (!ownerName || SLACK_MEMBER_ID_RE.test(ownerName)) {
    ownerName = 'Unknown User';
  }

  return { ownerName, ownerSlackId, ownerUserId };
}
