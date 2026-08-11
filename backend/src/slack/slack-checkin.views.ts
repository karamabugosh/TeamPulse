import { KnownBlock } from '@slack/bolt';

export function formatRunDate(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: timezone,
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function buildParentMessageBlocks(params: {
  checkInName: string;
  description?: string | null;
  dateLabel: string;
  completedCount: number;
  totalCount: number;
}): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `${params.checkInName} — ${params.dateLabel}`,
        emoji: true,
      },
    },
  ];

  if (params.description?.trim()) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: params.description.trim(),
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `*Reported:* ${params.completedCount} of ${params.totalCount}`,
      },
    ],
  });

  return blocks;
}

export function buildParentMessageText(params: {
  checkInName: string;
  dateLabel: string;
  completedCount: number;
  totalCount: number;
}): string {
  return `${params.checkInName} — ${params.dateLabel}\n\nReported: ${params.completedCount} of ${params.totalCount}`;
}

export function buildParticipantSummaryBlocks(params: {
  displayName: string;
  checkInName: string;
  qaPairs: Array<{ question: string; answer: string }>;
}): KnownBlock[] {
  const lines = params.qaPairs.map(
    (pair) => `*${pair.question}*\n${pair.answer || '_No answer_'}`,
  );

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${params.displayName}* posted an update for *${params.checkInName}*`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: lines.join('\n\n'),
      },
    },
  ];
}

export function buildParticipantSummaryText(params: {
  displayName: string;
  checkInName: string;
  qaPairs: Array<{ question: string; answer: string }>;
}): string {
  const lines = params.qaPairs.map(
    (pair) => `${pair.question}\n${pair.answer || '—'}`,
  );
  return `${params.displayName} posted an update for ${params.checkInName}\n\n${lines.join('\n\n')}`;
}

export function buildAdditionalUpdateButtonBlocks(runId: string): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Finished your check-in? You can add another update anytime.',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Add Additional Update', emoji: true },
          action_id: `checkin_additional_update:${runId}`,
          style: 'primary',
        },
      ],
    },
  ];
}

export function buildAdditionalUpdateModal(runId: string): Record<string, unknown> {
  return {
    type: 'modal',
    callback_id: `checkin_additional_update_submit:${runId}`,
    title: { type: 'plain_text', text: 'Additional Update' },
    submit: { type: 'plain_text', text: 'Post Update' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'additional_update_block',
        label: { type: 'plain_text', text: 'Your update' },
        element: {
          type: 'plain_text_input',
          action_id: 'additional_update_text',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'Share anything else the team should know…',
          },
        },
      },
    ],
  };
}

export function buildAdditionalUpdatePostedBlocks(params: {
  displayName: string;
  text: string;
}): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${params.displayName}* added an additional update`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: params.text,
      },
    },
  ];
}

export function buildSlackThreadUrl(
  slackWorkspaceId: string,
  channelId: string,
  threadTs: string,
): string {
  const tsForUrl = threadTs.replace('.', '');
  return `https://app.slack.com/client/${slackWorkspaceId}/${channelId}/thread/${channelId}-${tsForUrl}`;
}

/** Fallback archive URL when workspace subdomain is known. */
export function buildSlackArchiveUrl(
  workspaceDomain: string,
  channelId: string,
  messageTs: string,
): string {
  const tsForUrl = messageTs.replace('.', '');
  return `https://${workspaceDomain}.slack.com/archives/${channelId}/p${tsForUrl}`;
}
