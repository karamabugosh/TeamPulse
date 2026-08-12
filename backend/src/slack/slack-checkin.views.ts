import type { KnownBlock } from '@slack/types';
import { QuestionType } from '@prisma/client';
import { QuestionPayloadDto } from './dto/question-payload.dto';
import {
  formatColoredYesNoAnswer,
  getSemanticSentiment,
  getSlackButtonLabel,
  getSlackButtonStyle,
  inferYesNoPolarity,
} from '../common/question-semantics';

export const CHECKIN_ANSWER_ACTION = 'checkin_answer';
export const CHECKIN_ANSWER_SELECT_ACTION = 'checkin_answer_select';

export function buildCheckinAnswerActionId(
  submissionId: string,
  questionId: string,
  suffix?: string,
): string {
  const base = `${CHECKIN_ANSWER_ACTION}:${submissionId}:${questionId}`;
  return suffix ? `${base}:${suffix}` : base;
}

export function buildCheckinAnswerSelectActionId(
  submissionId: string,
  questionId: string,
): string {
  return `${CHECKIN_ANSWER_SELECT_ACTION}:${submissionId}:${questionId}`;
}

function truncatePlainText(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  if (maxLength <= 3) {
    return trimmed.slice(0, maxLength);
  }
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function truncateButtonValue(value: string): string {
  return value.length > 2000 ? value.slice(0, 2000) : value;
}

function truncateSelectValue(value: string, index: number): string {
  let normalized = value.trim();
  if (!normalized) {
    normalized = `option_${index + 1}`;
  }
  if (normalized.length > 150) {
    normalized = normalized.slice(0, 150);
  }
  return normalized;
}

/** Parses checkin_answer:{submissionId}:{questionId}[:suffix] */
export function parseCheckinAnswerActionId(actionId: string): {
  submissionId: string;
  questionId: string;
} | null {
  const prefix = `${CHECKIN_ANSWER_ACTION}:`;
  if (!actionId.startsWith(prefix)) {
    return null;
  }

  const parts = actionId.slice(prefix.length).split(':');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return null;
  }

  return {
    submissionId: parts[0],
    questionId: parts[1],
  };
}

export function parseCheckinAnswerSelectActionId(actionId: string): {
  submissionId: string;
  questionId: string;
} | null {
  const prefix = `${CHECKIN_ANSWER_SELECT_ACTION}:`;
  if (!actionId.startsWith(prefix)) {
    return null;
  }

  const parts = actionId.slice(prefix.length).split(':');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return null;
  }

  return {
    submissionId: parts[0],
    questionId: parts[1],
  };
}

export function validateSlackBlocks(blocks: KnownBlock[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const actionIds = new Set<string>();
  const blockIds = new Set<string>();

  if (blocks.length > 50) {
    errors.push(`Too many blocks (${blocks.length}; max 50).`);
  }

  for (const [blockIndex, block] of blocks.entries()) {
    const blockId = (block as { block_id?: string }).block_id;
    if (blockId) {
      if (blockIds.has(blockId)) {
        errors.push(`Duplicate block_id "${blockId}" at block ${blockIndex}.`);
      }
      blockIds.add(blockId);
      if (blockId.length > 255) {
        errors.push(`block_id too long at block ${blockIndex}.`);
      }
    }

    if (block.type === 'section') {
      const text = (block as { text?: { text?: string } }).text?.text ?? '';
      if (!text.trim()) {
        errors.push(`Section block ${blockIndex} is missing text.`);
      }
      if (text.length > 3000) {
        errors.push(`Section block ${blockIndex} text exceeds 3000 chars.`);
      }
    }

    if (block.type === 'actions') {
      const elements =
        (
          block as unknown as {
            elements?: Array<Record<string, unknown>>;
          }
        ).elements ?? [];

      if (elements.length === 0) {
        errors.push(`Actions block ${blockIndex} has no elements.`);
      }
      if (elements.length > 5) {
        errors.push(
          `Actions block ${blockIndex} has ${elements.length} elements (max 5).`,
        );
      }

      const selectValues = new Set<string>();

      for (const [elementIndex, element] of elements.entries()) {
        const actionId = element.action_id;
        if (typeof actionId !== 'string' || !actionId.trim()) {
          errors.push(
            `Actions block ${blockIndex} element ${elementIndex} missing action_id.`,
          );
          continue;
        }
        if (actionId.length > 255) {
          errors.push(
            `action_id too long in block ${blockIndex} element ${elementIndex}.`,
          );
        }
        if (actionIds.has(actionId)) {
          errors.push(
            `Duplicate action_id "${actionId}" in block ${blockIndex} element ${elementIndex}.`,
          );
        }
        actionIds.add(actionId);

        if (element.type === 'button') {
          const label =
            (element.text as { text?: string } | undefined)?.text ?? '';
          if (!label.trim()) {
            errors.push(
              `Button label missing in block ${blockIndex} element ${elementIndex}.`,
            );
          }
          if (label.length > 75) {
            errors.push(
              `Button label too long in block ${blockIndex} element ${elementIndex}.`,
            );
          }
          const value = element.value;
          if (typeof value !== 'string' || !value.trim()) {
            errors.push(
              `Button value missing in block ${blockIndex} element ${elementIndex}.`,
            );
          } else if (value.length > 2000) {
            errors.push(
              `Button value too long in block ${blockIndex} element ${elementIndex}.`,
            );
          }
        }

        if (element.type === 'static_select') {
          const options =
            (element.options as Array<{ value?: string }> | undefined) ?? [];
          if (options.length === 0) {
            errors.push(
              `static_select missing options in block ${blockIndex} element ${elementIndex}.`,
            );
          }
          if (options.length > 100) {
            errors.push(
              `static_select has too many options in block ${blockIndex} element ${elementIndex}.`,
            );
          }
          for (const [optionIndex, option] of options.entries()) {
            const value = option.value;
            if (typeof value !== 'string' || !value.trim()) {
              errors.push(
                `Select option ${optionIndex} missing value in block ${blockIndex}.`,
              );
              continue;
            }
            if (value.length > 150) {
              errors.push(
                `Select option ${optionIndex} value too long in block ${blockIndex}.`,
              );
            }
            if (selectValues.has(value)) {
              errors.push(
                `Duplicate select option value "${value}" in block ${blockIndex}.`,
              );
            }
            selectValues.add(value);
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function parseQuestionOptionsFromJson(
  options: unknown,
): string[] | undefined {
  if (!Array.isArray(options)) {
    return undefined;
  }

  const parsed = options.filter(
    (option): option is string => typeof option === 'string',
  );

  return parsed.length > 0 ? parsed : undefined;
}

function buildQuestionInteractiveBlocks(
  question: QuestionPayloadDto,
  submissionId: string,
): KnownBlock[] {
  const questionId = question.questionId;
  const selectActionId = buildCheckinAnswerSelectActionId(
    submissionId,
    questionId,
  );

  switch (question.type) {
    case QuestionType.YES_NO: {
      const polarity = inferYesNoPolarity(question.text);
      const yesSentiment =
        polarity === 'yes_negative'
          ? 'negative'
          : polarity === 'yes_positive'
            ? 'positive'
            : 'neutral';
      const noSentiment =
        polarity === 'yes_negative'
          ? 'positive'
          : polarity === 'yes_positive'
            ? 'negative'
            : 'neutral';

      return [
        {
          type: 'actions',
          block_id: `checkin_q_${questionId}`,
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: getSlackButtonLabel('yes', yesSentiment),
                emoji: true,
              },
              action_id: buildCheckinAnswerActionId(
                submissionId,
                questionId,
                'yes',
              ),
              value: 'Yes',
              ...(getSlackButtonStyle(yesSentiment)
                ? { style: getSlackButtonStyle(yesSentiment) }
                : {}),
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: getSlackButtonLabel('no', noSentiment),
                emoji: true,
              },
              action_id: buildCheckinAnswerActionId(
                submissionId,
                questionId,
                'no',
              ),
              value: 'No',
              ...(getSlackButtonStyle(noSentiment)
                ? { style: getSlackButtonStyle(noSentiment) }
                : {}),
            },
          ],
        },
      ];
    }

    case QuestionType.YES_NO_MAYBE: {
      const polarity = inferYesNoPolarity(question.text);
      const yesSentiment =
        polarity === 'yes_negative'
          ? 'negative'
          : polarity === 'yes_positive'
            ? 'positive'
            : 'neutral';
      const noSentiment =
        polarity === 'yes_negative'
          ? 'positive'
          : polarity === 'yes_positive'
            ? 'negative'
            : 'neutral';

      return [
        {
          type: 'actions',
          block_id: `checkin_q_${questionId}`,
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: getSlackButtonLabel('yes', yesSentiment),
                emoji: true,
              },
              action_id: buildCheckinAnswerActionId(
                submissionId,
                questionId,
                'yes',
              ),
              value: 'Yes',
              ...(getSlackButtonStyle(yesSentiment)
                ? { style: getSlackButtonStyle(yesSentiment) }
                : {}),
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: getSlackButtonLabel('maybe', 'neutral'),
                emoji: true,
              },
              action_id: buildCheckinAnswerActionId(
                submissionId,
                questionId,
                'maybe',
              ),
              value: 'Maybe',
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: getSlackButtonLabel('no', noSentiment),
                emoji: true,
              },
              action_id: buildCheckinAnswerActionId(
                submissionId,
                questionId,
                'no',
              ),
              value: 'No',
              ...(getSlackButtonStyle(noSentiment)
                ? { style: getSlackButtonStyle(noSentiment) }
                : {}),
            },
          ],
        },
      ];
    }

    case QuestionType.SCALE_1_5:
      return [
        {
          type: 'actions',
          block_id: `checkin_q_${questionId}`,
          elements: [1, 2, 3, 4, 5].map((rating) => ({
            type: 'button' as const,
            text: {
              type: 'plain_text' as const,
              text: `⭐ ${rating}`,
              emoji: true,
            },
            action_id: buildCheckinAnswerActionId(
              submissionId,
              questionId,
              String(rating),
            ),
            value: String(rating),
          })),
        },
      ];

    case QuestionType.MULTIPLE_CHOICE: {
      const options = question.options ?? [];
      if (options.length === 0) {
        return [];
      }

      if (options.length <= 5) {
        return [
          {
            type: 'actions',
            block_id: `checkin_q_${questionId}`,
            elements: options.map((option, index) => ({
              type: 'button' as const,
              text: {
                type: 'plain_text' as const,
                text: truncatePlainText(option, 75),
                emoji: true,
              },
              action_id: buildCheckinAnswerActionId(
                submissionId,
                questionId,
                `opt${index}`,
              ),
              value: truncateButtonValue(option),
            })),
          },
        ];
      }

      const usedSelectValues = new Set<string>();
      const selectOptions = options.slice(0, 100).map((option, index) => {
        let value = truncateSelectValue(option, index);
        if (usedSelectValues.has(value)) {
          value = truncateSelectValue(`${index}:${option}`, index);
        }
        usedSelectValues.add(value);
        return {
          text: {
            type: 'plain_text' as const,
            text: truncatePlainText(option, 75),
          },
          value,
        };
      });

      return [
        {
          type: 'actions',
          block_id: `checkin_q_${questionId}`,
          elements: [
            {
              type: 'static_select',
              action_id: selectActionId,
              placeholder: {
                type: 'plain_text',
                text: 'Select an option',
              },
              options: selectOptions,
            },
          ],
        },
      ];
    }

    default:
      return [];
  }
}

/** DM question message with type-specific Block Kit controls. */
export function buildDmQuestionMessage(params: {
  question: QuestionPayloadDto;
  submissionId: string;
  checkInName?: string;
  isParent?: boolean;
}): { text: string; blocks: KnownBlock[]; usedBlocks: boolean } {
  const { question, submissionId, checkInName, isParent } = params;
  const questionNumber = question.questionNumber ?? 1;
  const totalQuestions = question.totalQuestions ?? 1;

  const headerLines =
    isParent && checkInName
      ? [
          `📋 *${checkInName}*`,
          '',
          'This thread will contain all questions and your answers.',
          '',
        ]
      : [];

  const questionBody = truncatePlainText(question.text, 2800);
  let text = [
    ...headerLines,
    `*Question ${questionNumber}/${totalQuestions}*`,
    questionBody,
  ].join('\n');

  const sectionBlock: KnownBlock = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: truncatePlainText(text, 3000),
    },
  };

  const interactiveBlocks = buildQuestionInteractiveBlocks(
    question,
    submissionId,
  );

  if (interactiveBlocks.length === 0) {
    return { text, blocks: [sectionBlock], usedBlocks: false };
  }

  const blocks: KnownBlock[] = [sectionBlock, ...interactiveBlocks];
  const validation = validateSlackBlocks(blocks);

  if (validation.valid) {
    return { text, blocks, usedBlocks: true };
  }

  text = [
    text,
    '',
    '_Please reply with your answer in this thread._',
  ].join('\n');

  return {
    text,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: truncatePlainText(text, 3000),
        },
      },
    ],
    usedBlocks: false,
  };
}

/** Maps a Prisma Question row to the Slack question payload. */
export function mapDbQuestionToPayload(
  question: {
    id: string;
    question: string;
    type: QuestionType;
    options: unknown;
  },
  questionNumber: number,
  totalQuestions: number,
): QuestionPayloadDto {
  return {
    questionId: question.id,
    text: question.question,
    type: question.type,
    options: parseQuestionOptionsFromJson(question.options),
    questionNumber,
    totalQuestions,
  };
}

export function formatRunDate(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: timezone,
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function formatRunDateShort(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: timezone,
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export type ParticipantSummaryQaPair = {
  question: string;
  answer: string;
  type: QuestionType;
  structuredValue?: unknown;
};

function normalizeQuestionLabel(question: string): string {
  return question.replace(/\?+$/, '').trim();
}

function quoteAnswerLines(answer: string): string {
  const lines = answer.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return '>_No answer_';
  }
  return lines.map((line) => `>${line}`).join('\n');
}

/** Formats an answer for the public thread summary based on question type. */
export function formatSummaryAnswer(params: {
  question?: string;
  type: QuestionType;
  text: string;
  structuredValue?: unknown;
}): string {
  const { type, text, structuredValue, question } = params;

  switch (type) {
    case QuestionType.YES_NO:
    case QuestionType.YES_NO_MAYBE:
      return formatColoredYesNoAnswer({
        question: question ?? '',
        type,
        text,
        structuredValue,
      });

    case QuestionType.SCALE_1_5: {
      const value = (structuredValue as { value?: number } | null)?.value;
      const rating =
        typeof value === 'number' && value >= 1 && value <= 5
          ? value
          : Number.parseInt(text, 10);

      if (Number.isFinite(rating) && rating >= 1 && rating <= 5) {
        const filled = '⭐'.repeat(rating);
        const empty = '☆'.repeat(5 - rating);
        return `${filled}${empty} (${rating}/5)`;
      }
      return text.trim();
    }

    case QuestionType.MULTIPLE_CHOICE:
    case QuestionType.FREE_TEXT:
    default:
      return text.trim() || '_No answer_';
  }
}

function formatQaPairForSummary(pair: ParticipantSummaryQaPair): string {
  const question = normalizeQuestionLabel(pair.question);
  const answer = formatSummaryAnswer({
    question: pair.question,
    type: pair.type,
    text: pair.answer,
    structuredValue: pair.structuredValue,
  });

  return `*${question}*\n${quoteAnswerLines(answer)}`;
}

function buildParticipantSummaryContentBlocks(
  qaPairs: ParticipantSummaryQaPair[],
): KnownBlock[] {
  if (qaPairs.length === 0) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '_No answers recorded._',
        },
      },
    ];
  }

  const blocks: KnownBlock[] = [];
  let current = '';

  for (const pair of qaPairs) {
    const section = formatQaPairForSummary(pair);
    const candidate = current ? `${current}\n\n${section}` : section;

    if (candidate.length > 2900) {
      if (current) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: current },
        });
      }
      current = section;
      continue;
    }

    current = candidate;
  }

  if (current) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: current },
    });
  }

  return blocks;
}

/** Public channel parent message — the only "Good morning" in the whole flow. */
export function buildParentMessageBlocks(params: {
  checkInName: string;
  runDateLabel: string;
  completedCount: number;
  totalCount: number;
}): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: buildParentMessageText(params),
      },
    },
  ];
}

export function buildParentMessageText(params: {
  checkInName: string;
  runDateLabel: string;
  completedCount: number;
  totalCount: number;
}): string {
  return [
    `🌞 Good morning team! *${params.checkInName}* for ${params.runDateLabel} has started.`,
    '',
    `*Reported:* ${params.completedCount}/${params.totalCount}`,
  ].join('\n');
}

/** Participant update posted inside the public thread (Geekbot-style). */
export function buildParticipantSummaryBlocks(params: {
  displayName: string;
  checkInName: string;
  qaPairs: ParticipantSummaryQaPair[];
}): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${params.displayName}* posted an update for *${params.checkInName}*`,
      },
    },
    { type: 'divider' },
    ...buildParticipantSummaryContentBlocks(params.qaPairs),
    { type: 'divider' },
  ];
}

export function buildParticipantSummaryText(params: {
  displayName: string;
  checkInName: string;
  qaPairs: ParticipantSummaryQaPair[];
}): string {
  const divider = '━━━━━━━━━━━━━━━━━━━━';
  const body =
    params.qaPairs.length > 0
      ? params.qaPairs.map(formatQaPairForSummary).join('\n\n')
      : '_No answers recorded._';

  return [
    `${params.displayName} posted an update for ${params.checkInName}`,
    divider,
    body,
    divider,
  ].join('\n');
}

/** Parent message for a CheckIn DM thread — one per Standup run. */
export function buildDmThreadParentText(params: {
  checkInName: string;
  questionNumber: number;
  totalQuestions: number;
  questionText: string;
}): string {
  return [
    `📋 *${params.checkInName}*`,
    '',
    'This thread will contain all questions and your answers.',
    '',
    `*Question ${params.questionNumber}/${params.totalQuestions}*`,
    params.questionText,
  ].join('\n');
}

export function buildDmThreadQuestionText(params: {
  questionNumber: number;
  totalQuestions: number;
  questionText: string;
}): string {
  return [
    `*Question ${params.questionNumber}/${params.totalQuestions}*`,
    params.questionText,
  ].join('\n');
}

export function buildDmThreadCompletionText(params: {
  checkInName: string;
}): string {
  return [
    '✅ Thank you.',
    '',
    `Your *${params.checkInName}* has been submitted successfully.`,
  ].join('\n');
}

export function buildReplyInThreadReminderText(params: {
  checkInName: string;
}): string {
  return [
    `Please reply inside the *📋 ${params.checkInName}* thread.`,
    '',
    'Open the thread on the CheckIn message above and reply there so your answers stay together.',
  ].join('\n');
}

/** @deprecated Use buildDmThreadParentText — flat DM messages are no longer used. */
export function buildDmKickoffText(params: {
  firstName: string;
  checkInName: string;
  questionNumber: number;
  totalQuestions: number;
  questionText: string;
}): string {
  return [
    `*${params.checkInName}*`,
    '',
    `*Question ${params.questionNumber}/${params.totalQuestions}*`,
    params.questionText,
  ].join('\n');
}

export function buildConcurrentCheckInNotificationText(params: {
  checkInName: string;
}): string {
  return [
    `*${params.checkInName}* has started.`,
    '',
    'You currently have multiple active CheckIns.',
    'Choose which one to continue below, or reply with its number.',
  ].join('\n');
}

export function buildMultipleCheckInsPromptText(
  options: Array<{ index: number; checkInName: string }>,
): string {
  const lines = options.map(
    (option) => `${option.index}. ${option.checkInName}`,
  );

  return [
    'You currently have multiple active CheckIns.',
    '',
    ...lines,
    '',
    'Reply with:',
    '',
    options.map((option) => `${option.index}`).join('\n'),
    '',
    'Or use the buttons below to continue.',
  ].join('\n');
}

export function buildCheckInSelectionBlocks(
  options: Array<{ index: number; submissionId: string; checkInName: string }>,
): KnownBlock[] {
  const buttons = options.slice(0, 5).map((option) => ({
    type: 'button' as const,
    text: {
      type: 'plain_text' as const,
      text: `${option.index}. ${option.checkInName}`,
      emoji: true,
    },
    action_id: `checkin_select:${option.submissionId}`,
  }));

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: buildMultipleCheckInsPromptText(options),
      },
    },
    {
      type: 'actions',
      elements: buttons,
    },
  ];
}

export function buildFocusedCheckInResumeText(params: {
  checkInName: string;
  questionNumber: number;
  totalQuestions: number;
  questionText: string;
}): string {
  return [
    `Continuing *${params.checkInName}*.`,
    '',
    `*Question ${params.questionNumber}/${params.totalQuestions}*`,
    params.questionText,
  ].join('\n');
}

export function buildDmQuestionText(params: {
  questionNumber: number;
  totalQuestions: number;
  questionText: string;
}): string {
  return [
    `*Question ${params.questionNumber}/${params.totalQuestions}*`,
    params.questionText,
  ].join('\n');
}

export function buildQueuedCheckInKickoffText(params: {
  firstName: string;
  checkInName: string;
  questionNumber: number;
  totalQuestions: number;
  questionText: string;
}): string {
  return [
    `Hi ${params.firstName} 👋`,
    '',
    `${params.checkInName} has started.`,
    '',
    `*Question ${params.questionNumber}/${params.totalQuestions}*`,
    params.questionText,
  ].join('\n');
}

export function buildAiReportHeader(params: {
  checkInName: string;
  completedCount: number;
  totalCount: number;
}): string {
  return [
    `📊 *${params.checkInName} Report*`,
    '',
    `*Reported:* ${params.completedCount}/${params.totalCount}`,
  ].join('\n');
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
  checkInName: string;
  text: string;
}): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${params.displayName}* posted an additional update for *${params.checkInName}*`,
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: quoteAnswerLines(params.text.trim()),
      },
    },
    { type: 'divider' },
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

export function buildSlackArchiveUrl(
  workspaceDomain: string,
  channelId: string,
  messageTs: string,
): string {
  const tsForUrl = messageTs.replace('.', '');
  return `https://${workspaceDomain}.slack.com/archives/${channelId}/p${tsForUrl}`;
}
