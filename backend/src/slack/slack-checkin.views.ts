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
export const CHECKIN_ISSUE_REF_ACTION = 'checkin_issue_ref';
export const CHECKIN_LINK_JIRA_ACTION = 'checkin_link_jira';
export const CHECKIN_JIRA_REFRESH_ACTION = 'checkin_jira_refresh';
export const JIRA_ACTION_APPROVE = 'jira_action_approve';
export const JIRA_ACTION_CANCEL = 'jira_action_cancel';
export const JIRA_ACTION_RETRY = 'jira_action_retry';
export const JIRA_ACTION_DISMISS = 'jira_action_dismiss';

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

export function buildCheckinIssueRefActionId(
  submissionId: string,
  questionId: string,
): string {
  return `${CHECKIN_ISSUE_REF_ACTION}:${submissionId}:${questionId}`;
}

export function parseCheckinIssueRefActionId(actionId: string): {
  submissionId: string;
  questionId: string;
} | null {
  const prefix = `${CHECKIN_ISSUE_REF_ACTION}:`;
  if (!actionId.startsWith(prefix)) {
    return null;
  }
  const parts = actionId.slice(prefix.length).split(':');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return { submissionId: parts[0], questionId: parts[1] };
}

export function buildCheckinLinkJiraActionId(
  submissionId: string,
  questionId: string,
): string {
  return `${CHECKIN_LINK_JIRA_ACTION}:${submissionId}:${questionId}`;
}

export function parseCheckinLinkJiraActionId(actionId: string): {
  submissionId: string;
  questionId: string;
} | null {
  const prefix = `${CHECKIN_LINK_JIRA_ACTION}:`;
  if (!actionId.startsWith(prefix)) {
    return null;
  }
  const parts = actionId.slice(prefix.length).split(':');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return { submissionId: parts[0], questionId: parts[1] };
}

export function buildCheckinJiraRefreshActionId(
  submissionId: string,
  questionId: string,
): string {
  return `${CHECKIN_JIRA_REFRESH_ACTION}:${submissionId}:${questionId}`;
}

export function parseCheckinJiraRefreshActionId(actionId: string): {
  submissionId: string;
  questionId: string;
} | null {
  const prefix = `${CHECKIN_JIRA_REFRESH_ACTION}:`;
  if (!actionId.startsWith(prefix)) {
    return null;
  }
  const parts = actionId.slice(prefix.length).split(':');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return { submissionId: parts[0], questionId: parts[1] };
}

export function buildJiraLinkBlocks(
  submissionId: string,
  questionId: string,
): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '🔗 *Link Jira Issue*',
      },
    },
    {
      type: 'actions',
      block_id: `jira_link_${questionId}`,
      elements: [
        {
          type: 'external_select',
          action_id: buildCheckinLinkJiraActionId(submissionId, questionId),
          placeholder: {
            type: 'plain_text',
            text: 'Select Jira Issue',
          },
          min_query_length: 0,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Refresh' },
          action_id: buildCheckinJiraRefreshActionId(submissionId, questionId),
          value: 'refresh',
        },
      ],
    },
  ];
}

export function buildJiraLinkConfirmationBlocks(
  issues: Array<{ issueKey: string; summary: string; issueUrl?: string | null }>,
): KnownBlock[] {
  const lines = issues
    .map((issue) => {
      const label = issue.issueUrl
        ? `<${issue.issueUrl}|${issue.issueKey}>`
        : issue.issueKey;
      return `• *${label}*\n  ${issue.summary}`;
    })
    .join('\n');

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `✅ *Linked:*\n${lines}`,
      },
    },
  ];
}

export function isBlockerQuestionText(questionText: string): boolean {
  const normalized = questionText.trim().toLowerCase();
  return (
    /\bare you blocked\b/.test(normalized) ||
    /\bare there any blockers?\b/.test(normalized) ||
    /\bany blockers?\b/.test(normalized)
  );
}

/**
 * Primary gate for opening the Blocker Details modal.
 * Prefer persisted QuestionType.BLOCKER. Legacy YES_NO (+ classic phrases)
 * remains supported so existing check-ins keep working.
 */
export function isBlockerCapableQuestion(params: {
  type?: QuestionType | string | null;
  text: string;
}): boolean {
  if (params.type === QuestionType.BLOCKER || params.type === 'BLOCKER') {
    return true;
  }
  if (
    params.type === QuestionType.YES_NO ||
    params.type === QuestionType.YES_NO_MAYBE ||
    params.type === 'YES_NO' ||
    params.type === 'YES_NO_MAYBE'
  ) {
    return isBlockerQuestionText(params.text);
  }
  // Unknown/missing type: do not open modal from free text
  return false;
}

export const CHECKIN_BLOCKER_MODAL_CALLBACK = 'checkin_blocker_details_submit';

export type BlockerDetailsModalMetadata = {
  submissionId: string;
  questionId: string;
  channelId: string;
  threadTs: string;
};

export function buildBlockerDetailsModal(params: {
  submissionId: string;
  questionId: string;
  channelId: string;
  threadTs: string;
}): Record<string, unknown> {
  const metadata: BlockerDetailsModalMetadata = {
    submissionId: params.submissionId,
    questionId: params.questionId,
    channelId: params.channelId,
    threadTs: params.threadTs,
  };

  return {
    type: 'modal',
    callback_id: `${CHECKIN_BLOCKER_MODAL_CALLBACK}:${params.submissionId}:${params.questionId}`,
    private_metadata: JSON.stringify(metadata),
    title: { type: 'plain_text', text: 'Blocker Details' },
    submit: { type: 'plain_text', text: 'Save Blocker' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🚨 Blocker Details', emoji: true },
      },
      {
        type: 'input',
        block_id: 'blocker_title_block',
        label: { type: 'plain_text', text: 'Blocker Title *' },
        element: {
          type: 'plain_text_input',
          action_id: 'blocker_title',
        },
      },
      {
        type: 'input',
        block_id: 'blocker_description_block',
        label: { type: 'plain_text', text: 'Description *' },
        element: {
          type: 'plain_text_input',
          action_id: 'blocker_description',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'Describe what is blocking your work...',
          },
        },
      },
      {
        type: 'input',
        block_id: 'blocker_severity_block',
        label: { type: 'plain_text', text: 'Severity *' },
        element: {
          type: 'static_select',
          action_id: 'blocker_severity',
          placeholder: { type: 'plain_text', text: 'Select severity' },
          options: [
            { text: { type: 'plain_text', text: '🟢 Low' }, value: 'Low' },
            { text: { type: 'plain_text', text: '🟡 Medium' }, value: 'Medium' },
            { text: { type: 'plain_text', text: '🟠 High' }, value: 'High' },
            { text: { type: 'plain_text', text: '🔴 Critical' }, value: 'Critical' },
          ],
          initial_option: {
            text: { type: 'plain_text', text: '🟡 Medium' },
            value: 'Medium',
          },
        },
      },
      {
        type: 'input',
        block_id: 'blocker_category_block',
        label: { type: 'plain_text', text: 'Category *' },
        element: {
          type: 'static_select',
          action_id: 'blocker_category',
          placeholder: { type: 'plain_text', text: 'Select category' },
          options: [
            'Backend',
            'Frontend',
            'API',
            'Authentication',
            'Database',
            'QA',
            'DevOps',
            'Infrastructure',
            'Design',
            'Deployment',
            'Review',
            'Testing',
            'Documentation',
            'Other',
          ].map((label) => ({
            text: { type: 'plain_text', text: label },
            value: label,
          })),
        },
      },
      {
        type: 'input',
        block_id: 'blocker_category_other_block',
        optional: true,
        label: { type: 'plain_text', text: 'Specify category' },
        hint: {
          type: 'plain_text',
          text: 'Only needed when Category is Other',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'blocker_category_other',
          placeholder: { type: 'plain_text', text: 'Specify category' },
        },
      },
      {
        type: 'input',
        block_id: 'blocker_owner_block',
        optional: true,
        label: { type: 'plain_text', text: 'Who is blocking you?' },
        element: {
          type: 'users_select',
          action_id: 'blocker_owner',
          placeholder: { type: 'plain_text', text: 'Search teammate…' },
        },
      },
      {
        type: 'input',
        block_id: 'blocker_jira_block',
        optional: true,
        label: { type: 'plain_text', text: 'Related Jira Issue' },
        element: {
          type: 'external_select',
          action_id: buildCheckinLinkJiraActionId(
            params.submissionId,
            params.questionId,
          ),
          placeholder: {
            type: 'plain_text',
            text: 'Search Jira issue...',
          },
          min_query_length: 0,
        },
      },
      {
        type: 'input',
        block_id: 'blocker_resolution_block',
        optional: true,
        label: { type: 'plain_text', text: 'Expected Resolution' },
        element: {
          type: 'datepicker',
          action_id: 'blocker_resolution',
          placeholder: { type: 'plain_text', text: 'Select a date' },
        },
      },
      {
        type: 'input',
        block_id: 'blocker_preventing_block',
        optional: true,
        label: {
          type: 'plain_text',
          text: 'Is this blocker preventing all your work?',
        },
        element: {
          type: 'static_select',
          action_id: 'blocker_preventing',
          placeholder: { type: 'plain_text', text: 'Select Yes or No' },
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
        block_id: 'blocker_continue_block',
        optional: true,
        label: {
          type: 'plain_text',
          text: 'Can you continue working on another task?',
        },
        element: {
          type: 'radio_buttons',
          action_id: 'blocker_continue',
          options: [
            { text: { type: 'plain_text', text: 'Yes' }, value: 'Yes' },
            { text: { type: 'plain_text', text: 'No' }, value: 'No' },
          ],
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '_Screenshot attachments can be shared in the thread after saving. Critical severity and “preventing all work” will be highlighted in the success card._',
          },
        ],
      },
    ],
  };
}

export function parseBlockerDetailsModalMetadata(
  raw: string | undefined,
): BlockerDetailsModalMetadata | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<BlockerDetailsModalMetadata>;
    if (
      !parsed.submissionId ||
      !parsed.questionId ||
      !parsed.channelId ||
      !parsed.threadTs
    ) {
      return null;
    }
    return {
      submissionId: parsed.submissionId,
      questionId: parsed.questionId,
      channelId: parsed.channelId,
      threadTs: parsed.threadTs,
    };
  } catch {
    return null;
  }
}

export function formatBlockerAnswerText(params: {
  title: string;
  description: string;
  severity: string;
  category: string;
  expectedResolution?: string | null;
  issueKey?: string | null;
  preventingAllWork?: boolean;
  canContinueOtherTask?: string | null;
  ownerLabel?: string | null;
}): string {
  const lines = [
    params.title.trim(),
    '',
    params.description.trim(),
    '',
    `Severity: ${params.severity}`,
    `Category: ${params.category}`,
  ];
  if (params.ownerLabel) {
    lines.push(`Blocked by: ${params.ownerLabel}`);
  }
  if (params.expectedResolution) {
    lines.push(`Expected Resolution: ${params.expectedResolution}`);
  }
  if (params.issueKey) {
    lines.push(`Linked Jira: ${params.issueKey}`);
  }
  if (params.preventingAllWork) {
    lines.push('Preventing all work: Yes');
  }
  if (params.canContinueOtherTask) {
    lines.push(`Can continue other task: ${params.canContinueOtherTask}`);
  }
  return lines.join('\n');
}

export function buildBlockerSavedSuccessBlocks(params: {
  title: string;
  description?: string | null;
  severity: string;
  category?: string | null;
  issueKey?: string | null;
  expectedResolution?: string | null;
  preventingAllWork?: boolean;
  ownerLabel?: string | null;
}): KnownBlock[] {
  const lines = ['✅ *Blocker saved successfully*', '', `*Title:*\n${params.title}`];

  if (params.description?.trim()) {
    lines.push('', `*Reason:*\n${params.description.trim()}`);
  }

  if (params.severity?.trim()) {
    lines.push('', `*Severity:*\n${params.severity}`);
  }

  if (params.category?.trim()) {
    lines.push('', `*Category:*\n${params.category.trim()}`);
  }

  if (params.expectedResolution?.trim()) {
    lines.push(
      '',
      `*Expected resolution:*\n${params.expectedResolution.trim()}`,
    );
  }

  if (params.ownerLabel?.trim()) {
    lines.push('', `*Blocked by:*\n${params.ownerLabel.trim()}`);
  }

  if (params.issueKey?.trim()) {
    lines.push('', `*Linked Jira:*\n${params.issueKey.trim()}`);
  }

  if (params.preventingAllWork) {
    lines.push('', '🚨 *Critical blocker affecting current work.*');
  }

  if (params.severity.toLowerCase() === 'critical') {
    lines.push('', '_This blocker requires immediate attention._');
  }

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: lines.join('\n'),
      },
    },
  ];
}

export function parseJiraActionId(
  actionId: string,
  prefix: string,
): { actionId: string } | null {
  const fullPrefix = `${prefix}:`;
  if (!actionId.startsWith(fullPrefix)) {
    return null;
  }
  const actionValue = actionId.slice(fullPrefix.length);
  return actionValue ? { actionId: actionValue } : null;
}

export function buildJiraActionProposalBlocks(params: {
  actionId: string;
  actionType: string;
  issueKey?: string | null;
  summaryText: string;
}): KnownBlock[] {
  const issueLine = params.issueKey ? `\n*Issue:* ${params.issueKey}` : '';
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Suggested Jira action*\n${params.summaryText}${issueLine}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Approve' },
          style: 'primary',
          action_id: `${JIRA_ACTION_APPROVE}:${params.actionId}`,
          value: params.actionId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Cancel' },
          action_id: `${JIRA_ACTION_CANCEL}:${params.actionId}`,
          value: params.actionId,
        },
      ],
    },
  ];
}

export function buildJiraActionResultBlocks(executed: {
  id?: string;
  status: string;
  jiraIssueKey?: string | null;
  result?: unknown;
  errorMessage?: string | null;
  actionType?: string;
}): KnownBlock[] {
  if (executed.status === 'executed') {
    const issueKey =
      executed.jiraIssueKey ||
      ((executed.result as { issueKey?: string } | null)?.issueKey ?? 'Issue');
    const successText =
      executed.actionType === 'create_issue'
        ? `✅ *Jira issue created successfully*\n${issueKey}`
        : `✅ *Jira updated*\n${issueKey}`;
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: successText,
        },
      },
    ];
  }

  if (executed.status === 'cancelled') {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '_Jira action dismissed._',
        },
      },
    ];
  }

  const reason =
    executed.errorMessage?.trim() || 'Jira rejected the request.';
  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '⚠ *Could not create Jira issue.*',
          '',
          '*Reason:*',
          reason,
        ].join('\n'),
      },
    },
  ];

  if (executed.id) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Retry' },
          style: 'primary',
          action_id: `${JIRA_ACTION_RETRY}:${executed.id}`,
          value: executed.id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Dismiss' },
          action_id: `${JIRA_ACTION_DISMISS}:${executed.id}`,
          value: executed.id,
        },
      ],
    });
  }

  return blocks;
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

        if (
          element.type === 'external_select' ||
          element.type === 'multi_external_select'
        ) {
          const placeholder =
            (element.placeholder as { text?: string } | undefined)?.text ?? '';
          if (!placeholder.trim()) {
            errors.push(
              `${element.type} missing placeholder in block ${blockIndex} element ${elementIndex}.`,
            );
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
    case QuestionType.BLOCKER: {
      // Always 🔴 Yes / 🟢 No — blocker Yes is a negative outcome regardless of wording.
      return [
        {
          type: 'actions',
          block_id: `checkin_q_${questionId}`,
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: getSlackButtonLabel('yes', 'negative'),
                emoji: true,
              },
              action_id: buildCheckinAnswerActionId(
                submissionId,
                questionId,
                'yes',
              ),
              value: 'Yes',
              ...(getSlackButtonStyle('negative')
                ? { style: getSlackButtonStyle('negative') }
                : {}),
            },
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: getSlackButtonLabel('no', 'positive'),
                emoji: true,
              },
              action_id: buildCheckinAnswerActionId(
                submissionId,
                questionId,
                'no',
              ),
              value: 'No',
              ...(getSlackButtonStyle('positive')
                ? { style: getSlackButtonStyle('positive') }
                : {}),
            },
          ],
        },
      ];
    }

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

    case QuestionType.ISSUE_REF:
      return [
        {
          type: 'actions',
          block_id: `checkin_q_${questionId}`,
          elements: [
            {
              type: 'external_select',
              action_id: buildCheckinIssueRefActionId(submissionId, questionId),
              placeholder: {
                type: 'plain_text',
                text: 'Search your issues...',
              },
              min_query_length: 0,
            },
          ],
        },
      ];

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
  includeJiraLink?: boolean;
}): { text: string; blocks: KnownBlock[]; usedBlocks: boolean } {
  const { question, submissionId, checkInName, isParent, includeJiraLink } =
    params;
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

  const jiraLinkBlocks =
    includeJiraLink && question.type !== QuestionType.ISSUE_REF
      ? buildJiraLinkBlocks(submissionId, question.questionId)
      : [];

  if (interactiveBlocks.length === 0 && jiraLinkBlocks.length === 0) {
    return { text, blocks: [sectionBlock], usedBlocks: false };
  }

  const blocks: KnownBlock[] = [
    sectionBlock,
    ...interactiveBlocks,
    ...jiraLinkBlocks,
  ];

  if (jiraLinkBlocks.length > 0) {
    return { text, blocks, usedBlocks: true };
  }

  const validation = validateSlackBlocks(blocks);

  if (validation.valid) {
    return { text, blocks, usedBlocks: true };
  }

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
    case QuestionType.BLOCKER:
    case QuestionType.YES_NO:
    case QuestionType.YES_NO_MAYBE:
      return formatColoredYesNoAnswer({
        question: question ?? '',
        type: type === QuestionType.BLOCKER ? QuestionType.YES_NO : type,
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
    '✅ Standup completed successfully',
    '',
    `Your *${params.checkInName}* has been submitted.`,
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
