import type { KnownBlock } from '@slack/types';
import type { ActiveBlockerForFollowUp } from '../jira/blocker-follow-up.service';

export const BLOCKER_FOLLOWUP_RESOLVED = 'blocker_followup_resolved';
export const BLOCKER_FOLLOWUP_WORKING = 'blocker_followup_working';
export const BLOCKER_FOLLOWUP_BLOCKED = 'blocker_followup_blocked';

export const BLOCKER_FOLLOWUP_RESOLVED_MODAL = 'blocker_followup_resolved_submit';
export const BLOCKER_FOLLOWUP_WORKING_MODAL = 'blocker_followup_working_submit';
export const BLOCKER_FOLLOWUP_BLOCKED_MODAL = 'blocker_followup_blocked_submit';

export type BlockerFollowUpModalMetadata = {
  submissionId: string;
  blockerId: string;
  channelId: string;
  threadTs: string;
  choice: 'resolved' | 'working' | 'blocked';
};

export function buildFollowUpActionId(
  prefix: string,
  submissionId: string,
  blockerId: string,
): string {
  return `${prefix}:${submissionId}:${blockerId}`;
}

export function parseFollowUpActionId(
  actionId: string,
): { prefix: string; submissionId: string; blockerId: string } | null {
  const parts = actionId.split(':');
  if (parts.length < 3) return null;
  const [prefix, submissionId, blockerId] = parts;
  if (!prefix || !submissionId || !blockerId) return null;
  return { prefix, submissionId, blockerId };
}

export function parseFollowUpModalMetadata(
  raw: string | undefined,
): BlockerFollowUpModalMetadata | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as BlockerFollowUpModalMetadata;
    if (
      !parsed.submissionId ||
      !parsed.blockerId ||
      !parsed.channelId ||
      !parsed.threadTs ||
      !parsed.choice
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function formatCreatedDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildBlockerFollowUpIntroBlocks(params: {
  checkInName: string;
  count: number;
}): { text: string; blocks: KnownBlock[] } {
  const text = `🚧 Blocker Follow-up — before ${params.checkInName}`;
  return {
    text,
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🚧 Blocker Follow-up', emoji: true },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Before today's standup (*${params.checkInName}*), please update *${params.count}* active blocker${params.count === 1 ? '' : 's'}.\n\nAfter you finish, standup questions will start automatically.`,
        },
      },
    ],
  };
}

export function buildBlockerFollowUpCardBlocks(params: {
  submissionId: string;
  blocker: ActiveBlockerForFollowUp;
}): { text: string; blocks: KnownBlock[] } {
  const { blocker, submissionId } = params;
  const jiraLine = blocker.linkedIssueKey
    ? blocker.linkedIssueUrl
      ? `*Jira:* <${blocker.linkedIssueUrl}|${blocker.linkedIssueKey}>`
      : `*Jira:* ${blocker.linkedIssueKey}`
    : '*Jira:* _Not linked_';

  const text = `🚧 Blocker Follow-up: ${blocker.title}`;
  return {
    text,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🚧 Blocker Follow-up',
          emoji: true,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Yesterday you reported:\n*${blocker.title}*`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: jiraLine },
          {
            type: 'mrkdwn',
            text: `*Created:* ${formatCreatedDate(blocker.createdAt)}`,
          },
          {
            type: 'mrkdwn',
            text: `*Days open:* ${blocker.daysOpen}`,
          },
          {
            type: 'mrkdwn',
            text: `*Status:* ${blocker.status}`,
          },
          {
            type: 'mrkdwn',
            text: `*Severity:* ${blocker.severity}`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Has this blocker been resolved?*',
        },
      },
      {
        type: 'actions',
        block_id: `blocker_followup_actions_${blocker.id}`,
        elements: [
          {
            type: 'button',
            action_id: buildFollowUpActionId(
              BLOCKER_FOLLOWUP_RESOLVED,
              submissionId,
              blocker.id,
            ),
            text: { type: 'plain_text', text: '🟢 Yes, Resolved', emoji: true },
            style: 'primary',
            value: 'resolved',
          },
          {
            type: 'button',
            action_id: buildFollowUpActionId(
              BLOCKER_FOLLOWUP_WORKING,
              submissionId,
              blocker.id,
            ),
            text: {
              type: 'plain_text',
              text: '🟡 Still Working',
              emoji: true,
            },
            value: 'working',
          },
          {
            type: 'button',
            action_id: buildFollowUpActionId(
              BLOCKER_FOLLOWUP_BLOCKED,
              submissionId,
              blocker.id,
            ),
            text: {
              type: 'plain_text',
              text: '🔴 Still Blocked',
              emoji: true,
            },
            style: 'danger',
            value: 'blocked',
          },
        ],
      },
    ],
  };
}

export function buildResolvedFollowUpModal(
  metadata: BlockerFollowUpModalMetadata,
): Record<string, unknown> {
  return {
    type: 'modal',
    callback_id: BLOCKER_FOLLOWUP_RESOLVED_MODAL,
    private_metadata: JSON.stringify(metadata),
    title: { type: 'plain_text', text: 'Resolved' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'resolution_notes_block',
        label: { type: 'plain_text', text: 'Resolution Notes *' },
        element: {
          type: 'plain_text_input',
          action_id: 'resolution_notes',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'How did you resolve it?',
          },
        },
      },
      {
        type: 'input',
        block_id: 'resolution_type_block',
        optional: true,
        label: { type: 'plain_text', text: 'Resolution type' },
        element: {
          type: 'static_select',
          action_id: 'resolution_type',
          placeholder: { type: 'plain_text', text: 'Optional' },
          options: [
            'Fixed',
            'Dependency completed',
            'Waiting removed',
            'Workaround',
            'Other',
          ].map((label) => ({
            text: { type: 'plain_text', text: label },
            value: label,
          })),
        },
      },
    ],
  };
}

export function buildWorkingFollowUpModal(
  metadata: BlockerFollowUpModalMetadata,
): Record<string, unknown> {
  return {
    type: 'modal',
    callback_id: BLOCKER_FOLLOWUP_WORKING_MODAL,
    private_metadata: JSON.stringify(metadata),
    title: { type: 'plain_text', text: 'Still Working' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'progress_notes_block',
        label: { type: 'plain_text', text: 'Progress Update *' },
        element: {
          type: 'plain_text_input',
          action_id: 'progress_notes',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'What changed since yesterday?',
          },
        },
      },
    ],
  };
}

export function buildBlockedFollowUpModal(
  metadata: BlockerFollowUpModalMetadata,
): Record<string, unknown> {
  return {
    type: 'modal',
    callback_id: BLOCKER_FOLLOWUP_BLOCKED_MODAL,
    private_metadata: JSON.stringify(metadata),
    title: { type: 'plain_text', text: 'Still Blocked' },
    submit: { type: 'plain_text', text: 'Save' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'blocked_notes_block',
        label: { type: 'plain_text', text: 'What is still blocking you? *' },
        element: {
          type: 'plain_text_input',
          action_id: 'blocked_notes',
          multiline: true,
        },
      },
      {
        type: 'input',
        block_id: 'needs_help_block',
        label: { type: 'plain_text', text: 'Need help?' },
        element: {
          type: 'static_select',
          action_id: 'needs_help',
          options: [
            { text: { type: 'plain_text', text: 'Yes' }, value: 'Yes' },
            { text: { type: 'plain_text', text: 'No' }, value: 'No' },
          ],
          initial_option: {
            text: { type: 'plain_text', text: 'No' },
            value: 'No',
          },
        },
      },
      {
        type: 'input',
        block_id: 'needs_escalation_block',
        label: { type: 'plain_text', text: 'Need escalation?' },
        element: {
          type: 'static_select',
          action_id: 'needs_escalation',
          options: [
            { text: { type: 'plain_text', text: 'Yes' }, value: 'Yes' },
            { text: { type: 'plain_text', text: 'No' }, value: 'No' },
          ],
          initial_option: {
            text: { type: 'plain_text', text: 'No' },
            value: 'No',
          },
        },
      },
    ],
  };
}
