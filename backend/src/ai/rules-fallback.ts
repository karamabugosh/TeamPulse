// backend/src/ai/rules-fallback.ts

import {
  AiDigestResult,
  RawResponseForAnalysis,
  ThemeSummary,
  ExtractedBlocker,
  EMPTY_REPORT_SECTIONS,
} from './dto/ai-result.dto';
import { QuestionType } from '@prisma/client';
import { buildSemanticAggregates } from '../common/question-semantics';

/** Rules-based fallback when the AI layer is disabled or fails. */
export function runRulesFallback(
  teamId: string,
  runId: string,
  responses: RawResponseForAnalysis[],
): AiDigestResult {
  const blockers: ExtractedBlocker[] = [];
  const themes: ThemeSummary[] = [];

  const participantsWithAnswers = responses.filter((response) =>
    response.answers.some(
      (answer) =>
        typeof answer.text === 'string' &&
        answer.text.trim().length > 0,
    ),
  );

  const answerCount = participantsWithAnswers.reduce(
    (total, response) =>
      total +
      response.answers.filter(
        (answer) =>
          typeof answer.text === 'string' &&
          answer.text.trim().length > 0,
      ).length,
    0,
  );

  const participantCount = participantsWithAnswers.length;
  const semanticAggregates = buildSemanticAggregates(
    participantsWithAnswers.map((response) => ({
      answers: response.answers.map((answer) => ({
        questionText: answer.questionText,
        questionType: answer.questionType ?? QuestionType.FREE_TEXT,
        text: answer.text,
      })),
    })),
  );

  const semanticSummary =
    semanticAggregates.length > 0
      ? semanticAggregates
          .map(({ label, count }) => {
            const memberLabel =
              count === 1 ? 'team member' : 'team members';
            return `${count} ${memberLabel} ${label.toLowerCase()}.`;
          })
          .join(' ')
      : null;

  const summary =
    answerCount === 0
      ? 'AI analysis is unavailable. No substantive standup answers were available for analysis.'
      : semanticSummary
        ? `AI analysis is unavailable. ${semanticSummary}`
        : `AI analysis is unavailable. Collected ${answerCount} substantive standup answer(s) from ${participantCount} participant(s).`;

  return {
    teamId,
    runId,
    generatedAt: new Date().toISOString(),
    source: 'rules_fallback',
    summary,
    blockers,
    themes,
    reportSections:
      answerCount === 0
        ? EMPTY_REPORT_SECTIONS
        : {
            keyAccomplishments: [],
            risks: semanticAggregates
              .filter(({ label }) =>
                /blocked|concern|not reviewed|needs help|uncertain/i.test(
                  label,
                ),
              )
              .map(({ label, count }) => `${count} ${label.toLowerCase()}`),
            aiInsights: [
              ...(semanticSummary ? [semanticSummary] : []),
              `Collected ${answerCount} substantive answer(s) from ${participantCount} participant(s).`,
            ],
            actionItems: [],
            participantUpdates: responses.map((response) => ({
              slackUserId: response.userId,
              displayName: response.displayName ?? response.userId,
              answers: response.answers.map((answer) => ({
                question: answer.questionText,
                answer: answer.text,
                formattedAnswer: answer.formattedAnswer,
                sentiment: answer.sentiment,
                semanticInterpretation: answer.semanticInterpretation,
              })),
            })),
            overallProgress:
              participantCount > 0
                ? `${participantCount} participant(s) submitted ${answerCount} answer(s).`
                : '',
          },
  };
}
