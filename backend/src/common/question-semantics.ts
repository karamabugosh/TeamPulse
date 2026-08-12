import { QuestionType } from '@prisma/client';

export type YesNoPolarity = 'yes_positive' | 'yes_negative' | 'neutral';

export type YesNoChoice = 'yes' | 'no' | 'maybe';

export type SemanticSentiment = 'positive' | 'negative' | 'neutral';

const YES_NEGATIVE_PATTERNS: RegExp[] = [
  /\bblock(ed|er|ing|s)?\b/i,
  /\bneed(s)?\s+(help|assistance|support)\b/i,
  /\bneed\s+help\s+from\b/i,
  /\bwaiting\s+(on|for)\b/i,
  /\bstuck\b/i,
  /\bimpediment/i,
  /\bobstacle/i,
  /\bany\s+(issues?|problems?|concerns?|trouble)\b/i,
  /\bbehind\s+(schedule|plan)\b/i,
  /\bat\s+risk\b/i,
  /\bunable\s+to\b/i,
  /\bdepend(ing|ent)?\s+on\b/i,
  /\bescalat/i,
];

const YES_POSITIVE_PATTERNS: RegExp[] = [
  /\breviewed\b/i,
  /\bcompleted?\b/i,
  /\bfinished\b/i,
  /\bdone\b/i,
  /\bshipped\b/i,
  /\bdeployed\b/i,
  /\bon\s+track\b/i,
  /\bmet\s+(the\s+)?(goal|target|deadline|plan)\b/i,
  /\bachieved\b/i,
  /\bready\b/i,
  /\bsuccessful\b/i,
  /\bdid\s+you\s+complete\b/i,
  /\bplanned\s+work\b/i,
  /\bwas\s+.*\breviewed\b/i,
  /\bhave\s+you\s+.*\bcomplete\b/i,
];

/** Infers whether "Yes" is positive, negative, or neutral for a question. */
export function inferYesNoPolarity(questionText: string): YesNoPolarity {
  const normalized = questionText.trim().toLowerCase();

  if (YES_NEGATIVE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'yes_negative';
  }

  if (YES_POSITIVE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'yes_positive';
  }

  return 'neutral';
}

export function parseYesNoChoice(params: {
  type: QuestionType;
  text: string;
  structuredValue?: unknown;
}): YesNoChoice | null {
  const normalized = params.text.trim().toLowerCase();

  if (params.type === QuestionType.YES_NO) {
    const value = (params.structuredValue as { value?: boolean } | null)?.value;
    if (value === true || normalized === 'yes' || normalized === 'y') {
      return 'yes';
    }
    if (value === false || normalized === 'no' || normalized === 'n') {
      return 'no';
    }
    return null;
  }

  if (params.type === QuestionType.YES_NO_MAYBE) {
    const value = (params.structuredValue as { value?: string } | null)?.value;
    if (value === 'yes' || normalized === 'yes' || normalized === 'y') {
      return 'yes';
    }
    if (
      value === 'maybe' ||
      normalized === 'maybe' ||
      normalized === 'm' ||
      normalized === 'unsure' ||
      normalized === 'not sure'
    ) {
      return 'maybe';
    }
    if (value === 'no' || normalized === 'no' || normalized === 'n') {
      return 'no';
    }
    return null;
  }

  return null;
}

/** Maps a yes/no answer to positive / negative / neutral sentiment. */
export function getSemanticSentiment(params: {
  question: string;
  type: QuestionType;
  text: string;
  structuredValue?: unknown;
}): SemanticSentiment {
  const choice = parseYesNoChoice(params);
  if (!choice) {
    return 'neutral';
  }

  if (choice === 'maybe') {
    return 'neutral';
  }

  const polarity = inferYesNoPolarity(params.question);
  const answeredYes = choice === 'yes';

  if (polarity === 'yes_negative') {
    return answeredYes ? 'negative' : 'positive';
  }

  if (polarity === 'yes_positive') {
    return answeredYes ? 'positive' : 'negative';
  }

  return 'neutral';
}

export function sentimentIndicator(sentiment: SemanticSentiment): string {
  switch (sentiment) {
    case 'positive':
      return '🟢';
    case 'negative':
      return '🔴';
    default:
      return '🟡';
  }
}

function capitalizeChoice(choice: YesNoChoice): string {
  return choice.charAt(0).toUpperCase() + choice.slice(1);
}

/** Colored display label for yes/no style answers. */
export function formatColoredYesNoAnswer(params: {
  question: string;
  type: QuestionType;
  text: string;
  structuredValue?: unknown;
}): string {
  const choice = parseYesNoChoice(params);
  if (!choice) {
    return params.text.trim();
  }

  const sentiment = getSemanticSentiment(params);
  return `${sentimentIndicator(sentiment)} ${capitalizeChoice(choice)}`;
}

export function getSlackButtonStyle(
  sentiment: SemanticSentiment,
): 'primary' | 'danger' | undefined {
  if (sentiment === 'positive') {
    return 'primary';
  }
  if (sentiment === 'negative') {
    return 'danger';
  }
  return undefined;
}

export function getSlackButtonLabel(
  choice: YesNoChoice,
  sentiment: SemanticSentiment,
): string {
  const emoji = sentimentIndicator(sentiment);
  return `${emoji} ${capitalizeChoice(choice)}`;
}

/** Human-readable interpretation for AI and reports. */
export function describeSemanticAnswer(params: {
  question: string;
  type: QuestionType;
  text: string;
  structuredValue?: unknown;
}): string | null {
  const choice = parseYesNoChoice(params);
  if (!choice) {
    return null;
  }

  const polarity = inferYesNoPolarity(params.question);
  const normalizedQuestion = params.question.replace(/\?+$/, '').trim().toLowerCase();

  if (polarity === 'yes_negative') {
    if (choice === 'yes') {
      if (/\bblock/.test(normalizedQuestion)) {
        return 'Reported being blocked';
      }
      if (/\bneed(s)?\s+(help|assistance|support)\b/.test(normalizedQuestion)) {
        return 'Needs help from another team member';
      }
      return 'Reported a concern';
    }
    if (choice === 'no') {
      if (/\bblock/.test(normalizedQuestion)) {
        return 'Not blocked';
      }
      if (/\bneed(s)?\s+(help|assistance|support)\b/.test(normalizedQuestion)) {
        return 'Does not need help';
      }
      return 'No concern reported';
    }
    return 'Uncertain / needs follow-up';
  }

  if (polarity === 'yes_positive') {
    if (choice === 'yes') {
      if (/\breviewed\b/.test(normalizedQuestion)) {
        return 'Work was reviewed';
      }
      if (/\bcomplete|finished|done\b/.test(normalizedQuestion)) {
        return 'Completed planned work';
      }
      return 'Positive confirmation';
    }
    if (choice === 'no') {
      if (/\breviewed\b/.test(normalizedQuestion)) {
        return 'Work was not reviewed';
      }
      if (/\bcomplete|finished|done\b/.test(normalizedQuestion)) {
        return 'Did not complete planned work';
      }
      return 'Negative confirmation';
    }
    return 'Uncertain / needs follow-up';
  }

  return null;
}

export function enrichAnswerForAnalysis(params: {
  questionText: string;
  questionType: QuestionType;
  text: string;
  structuredValue?: unknown;
}): {
  text: string;
  formattedAnswer: string;
  semanticInterpretation: string | null;
  sentiment: SemanticSentiment;
} {
  const formattedAnswer =
    params.questionType === QuestionType.YES_NO ||
    params.questionType === QuestionType.YES_NO_MAYBE
      ? formatColoredYesNoAnswer({
          question: params.questionText,
          type: params.questionType,
          text: params.text,
          structuredValue: params.structuredValue,
        })
      : params.text.trim();

  return {
    text: params.text.trim(),
    formattedAnswer,
    semanticInterpretation: describeSemanticAnswer({
      question: params.questionText,
      type: params.questionType,
      text: params.text,
      structuredValue: params.structuredValue,
    }),
    sentiment: getSemanticSentiment({
      question: params.questionText,
      type: params.questionType,
      text: params.text,
      structuredValue: params.structuredValue,
    }),
  };
}

export type SemanticAggregate = {
  label: string;
  count: number;
};

/** Builds aggregate insights like "3 team members reported blockers". */
export function buildSemanticAggregates(
  responses: Array<{
    answers: Array<{
      questionText: string;
      questionType: QuestionType;
      text: string;
      structuredValue?: unknown;
    }>;
  }>,
): SemanticAggregate[] {
  const counts = new Map<string, number>();

  for (const response of responses) {
    for (const answer of response.answers) {
      const interpretation = describeSemanticAnswer({
        question: answer.questionText,
        type: answer.questionType,
        text: answer.text,
        structuredValue: answer.structuredValue,
      });

      if (!interpretation) {
        continue;
      }

      counts.set(interpretation, (counts.get(interpretation) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}
