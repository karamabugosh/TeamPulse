import type { KnownBlock } from '@slack/bolt';
import type { AppHomeSummary } from '../collection/collection.service';

function formatStatus(summary: AppHomeSummary): string {
  if (summary.activeCheckIns.length > 1) {
    return `${summary.activeCheckIns.length} active CheckIns — choose one in your DM.`;
  }

  if (summary.activeCheckIns.length === 1) {
    const name = summary.activeCheckIns[0].checkInName;
    return summary.focusedCheckInName
      ? `In progress: ${summary.focusedCheckInName}`
      : `Active: ${name}`;
  }

  switch (summary.status) {
    case 'in_progress':
      return 'In progress — finish your check-in in the app DM.';
    case 'completed':
      return 'Completed for this session.';
    default:
      return 'Not started yet.';
  }
}

function formatLastCompleted(completedAt: Date | null): string {
  if (!completedAt) {
    return 'No completed check-in on record yet.';
  }
  return completedAt.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function buildAppHomeBlocks(summary: AppHomeSummary): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Pulse CheckIns', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Answer your team CheckIns in a direct message with Pulse.',
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Status*\n${formatStatus(summary)}`,
        },
        {
          type: 'mrkdwn',
          text: `*Active CheckIns*\n${summary.activeCheckIns.length}`,
        },
      ],
    },
  ];

  if (summary.activeCheckIns.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: summary.activeCheckIns
          .map((option) => `${option.index}. *${option.checkInName}* (${option.questionNumber}/${option.totalQuestions})`)
          .join('\n'),
      },
    });
  }

  blocks.push(
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Last completion*\n${formatLastCompleted(summary.lastCompletedAt)}`,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Open your DM with Pulse and reply inside the 📋 CheckIn thread for each active standup.',
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Open CheckIns', emoji: true },
        action_id: 'start_standup',
        style: 'primary',
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Reply inside the 📋 CheckIn thread in your DM — each active CheckIn has its own thread.',
        },
      ],
    },
  );

  return blocks;
}
