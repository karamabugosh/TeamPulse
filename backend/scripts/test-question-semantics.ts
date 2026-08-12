import { QuestionType } from '@prisma/client';
import {
  formatColoredYesNoAnswer,
  getSemanticSentiment,
  inferYesNoPolarity,
} from '../src/common/question-semantics';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function testBlockedQuestion(): void {
  const question = 'Are you currently blocked?';

  assert(inferYesNoPolarity(question) === 'yes_negative', 'blocked question polarity');

  assert(
    formatColoredYesNoAnswer({
      question,
      type: QuestionType.YES_NO,
      text: 'Yes',
      structuredValue: { value: true },
    }) === '🔴 Yes',
    'blocked + Yes should be red',
  );

  assert(
    formatColoredYesNoAnswer({
      question,
      type: QuestionType.YES_NO,
      text: 'No',
      structuredValue: { value: false },
    }) === '🟢 No',
    'blocked + No should be green',
  );
}

function testReviewedQuestion(): void {
  const question = "Was yesterday's work reviewed?";

  assert(inferYesNoPolarity(question) === 'yes_positive', 'reviewed question polarity');

  assert(
    formatColoredYesNoAnswer({
      question,
      type: QuestionType.YES_NO,
      text: 'Yes',
      structuredValue: { value: true },
    }) === '🟢 Yes',
    'reviewed + Yes should be green',
  );

  assert(
    formatColoredYesNoAnswer({
      question,
      type: QuestionType.YES_NO,
      text: 'No',
      structuredValue: { value: false },
    }) === '🔴 No',
    'reviewed + No should be red',
  );
}

function testHelpQuestion(): void {
  const question = 'Do you need help from another team member?';

  assert(
    getSemanticSentiment({
      question,
      type: QuestionType.YES_NO,
      text: 'Yes',
      structuredValue: { value: true },
    }) === 'negative',
    'help + Yes should be negative sentiment',
  );

  assert(
    formatColoredYesNoAnswer({
      question,
      type: QuestionType.YES_NO,
      text: 'No',
      structuredValue: { value: false },
    }) === '🟢 No',
    'help + No should be green',
  );
}

function main(): void {
  testBlockedQuestion();
  testReviewedQuestion();
  testHelpQuestion();
  console.log('All question semantic tests passed.');
}

main();
