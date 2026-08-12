/**
 * Validates Block Kit payloads for all interactive question types.
 * Run: npx ts-node scripts/test-slack-blocks.ts
 */
import { QuestionType } from '@prisma/client';
import {
  buildDmQuestionMessage,
  buildParticipantSummaryBlocks,
  buildParticipantSummaryText,
  formatSummaryAnswer,
  parseCheckinAnswerActionId,
  parseCheckinAnswerSelectActionId,
  validateSlackBlocks,
} from '../src/slack/slack-checkin.views';
import { QuestionPayloadDto } from '../src/slack/dto/question-payload.dto';

const submissionId = '00000000-0000-0000-0000-000000000001';
const questionId = '00000000-0000-0000-0000-000000000099';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function testQuestionType(
  type: QuestionType,
  options?: string[],
): void {
  const question: QuestionPayloadDto = {
    questionId,
    text: `Sample question for ${type}`,
    type,
    options,
    questionNumber: 3,
    totalQuestions: 7,
  };

  const result = buildDmQuestionMessage({ question, submissionId });
  const validation = validateSlackBlocks(result.blocks);

  console.log(`\n=== ${type} ===`);
  console.log(`usedBlocks: ${result.usedBlocks}`);
  console.log(`validation.valid: ${validation.valid}`);

  if (!validation.valid) {
    console.log('errors:', validation.errors);
  }

  if (type === QuestionType.FREE_TEXT) {
    assert(!result.usedBlocks, 'FREE_TEXT must not use interactive blocks');
    assert(
      result.blocks.length === 1 && result.blocks[0].type === 'section',
      'FREE_TEXT should only have a section block',
    );
    return;
  }

  assert(result.usedBlocks, `${type} should use interactive blocks`);
  assert(validation.valid, `${type} blocks failed validation`);

  const actionsBlock = result.blocks.find((b) => b.type === 'actions');
  assert(!!actionsBlock, `${type} should include an actions block`);

  const elements =
    (actionsBlock as { elements?: Array<{ action_id?: string }> }).elements ??
    [];
  const actionIds = elements.map((el) => el.action_id).filter(Boolean);
  const uniqueActionIds = new Set(actionIds);
  assert(
    actionIds.length === uniqueActionIds.size,
    `${type} has duplicate action_ids: ${actionIds.join(', ')}`,
  );

  for (const actionId of actionIds) {
    const parsed =
      parseCheckinAnswerActionId(actionId!) ??
      parseCheckinAnswerSelectActionId(actionId!);
    assert(parsed !== null, `Could not parse action_id: ${actionId}`);
    assert(
      parsed!.submissionId === submissionId,
      `Wrong submissionId in ${actionId}`,
    );
    assert(
      parsed!.questionId === questionId,
      `Wrong questionId in ${actionId} (got ${parsed!.questionId})`,
    );
  }
}

function testDuplicateActionIdRegression(): void {
  const question: QuestionPayloadDto = {
    questionId,
    text: 'Is anything blocking your progress?',
    type: QuestionType.YES_NO,
    questionNumber: 3,
    totalQuestions: 3,
  };

  const { blocks, usedBlocks } = buildDmQuestionMessage({
    question,
    submissionId,
  });

  assert(usedBlocks, 'YES_NO should use blocks');
  const validation = validateSlackBlocks(blocks);
  assert(validation.valid, `YES_NO regression: ${validation.errors.join('; ')}`);

  const elements =
    (
      blocks.find((b) => b.type === 'actions') as {
        elements?: Array<{ action_id?: string }>;
      }
    )?.elements ?? [];

  assert(elements.length === 2, 'YES_NO should have Yes and No buttons');
  assert(
    elements[0].action_id !== elements[1].action_id,
    'YES_NO buttons must have unique action_ids (invalid_blocks regression)',
  );

  console.log('\n=== YES_NO regression (Q3) ===');
  console.log('action_ids:', elements.map((e) => e.action_id).join(', '));
  console.log('PASS');
}

function testParticipantSummaryFormat(): void {
  const qaPairs = [
    {
      question: 'What did you work on yesterday?',
      answer: 'Finished the API integration and fixed auth bugs.',
      type: QuestionType.FREE_TEXT,
    },
    {
      question: 'Are you currently blocked?',
      answer: 'No',
      type: QuestionType.YES_NO,
      structuredValue: { value: false },
    },
    {
      question: 'Do you need help from another team member?',
      answer: 'Maybe',
      type: QuestionType.YES_NO_MAYBE,
      structuredValue: { value: 'maybe' },
    },
    {
      question: 'What is your current task status?',
      answer: 'on track',
      type: QuestionType.MULTIPLE_CHOICE,
    },
    {
      question: "Was yesterday's work reviewed?",
      answer: 'Yes',
      type: QuestionType.YES_NO,
      structuredValue: { value: true },
    },
    {
      question: 'How confident are you that you will finish today?',
      answer: '4',
      type: QuestionType.SCALE_1_5,
      structuredValue: { value: 4 },
    },
  ];

  assert(
    formatSummaryAnswer({
      question: 'Are you currently blocked?',
      type: QuestionType.YES_NO,
      text: 'No',
      structuredValue: { value: false },
    }) === '🟢 No',
    'blocked question No should be green',
  );
  assert(
    formatSummaryAnswer({
      question: "Was yesterday's work reviewed?",
      type: QuestionType.YES_NO,
      text: 'Yes',
      structuredValue: { value: true },
    }) === '🟢 Yes',
    'reviewed question Yes should be green',
  );

  const blocks = buildParticipantSummaryBlocks({
    displayName: 'Karam',
    checkInName: 'Daily Standup',
    qaPairs,
  });
  const validation = validateSlackBlocks(blocks);
  assert(validation.valid, `Summary blocks invalid: ${validation.errors.join('; ')}`);
  assert(blocks[0].type === 'section', 'Header section expected');
  assert(blocks[1].type === 'divider', 'Top divider expected');
  assert(blocks[blocks.length - 1].type === 'divider', 'Bottom divider expected');

  const text = buildParticipantSummaryText({
    displayName: 'Karam',
    checkInName: 'Daily Standup',
    qaPairs,
  });
  assert(
    text.includes('Karam posted an update for Daily Standup'),
    'Summary text header missing',
  );
  assert(!text.includes('Yesterday'), 'Old Today/Yesterday labels must be removed');
  assert(!text.includes('Today\n'), 'Old Today/Yesterday labels must be removed');

  console.log('\n=== Participant summary (Geekbot style) ===');
  console.log(text);
  console.log('PASS');
}

function main(): void {
  testQuestionType(QuestionType.FREE_TEXT);
  testQuestionType(QuestionType.YES_NO);
  testQuestionType(QuestionType.YES_NO_MAYBE);
  testQuestionType(QuestionType.SCALE_1_5);
  testQuestionType(QuestionType.MULTIPLE_CHOICE, ['Option A', 'Option B', 'Option C']);
  testQuestionType(
    QuestionType.MULTIPLE_CHOICE,
    Array.from({ length: 8 }, (_, i) => `Long option number ${i + 1}`),
  );
  testDuplicateActionIdRegression();
  testParticipantSummaryFormat();

  console.log('\nAll Slack Block Kit tests passed.');
}

main();
