// backend/src/ai/rules-fallback.ts

import {
  AiDigestResult,
  RawResponseForAnalysis,
  ThemeSummary,
  ExtractedBlocker,
  EMPTY_REPORT_SECTIONS,
} from './dto/ai-result.dto';

/**
 * Rules-based fallback used when the AI layer is disabled,
 * unavailable, or fails.
 *
 * Standup answers are stored as free text, so reliably identifying
 * blockers, dependencies, severity, or themes requires semantic
 * language understanding.
 *
 * This fallback therefore does not attempt keyword-based blocker
 * detection or theme extraction. Instead, it returns a deterministic
 * summary of the amount of standup data that was collected and leaves
 * semantic fields empty.
 */
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

  const summary =
    answerCount === 0
      ? 'AI analysis is unavailable. No substantive standup answers were available for analysis.'
      : `AI analysis is unavailable. Collected ${answerCount} substantive standup answer(s) from ${participantCount} participant(s). No blockers or themes were extracted because semantic analysis requires the AI layer.`;

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
            keyAccomplishments: themes.map((theme) => theme.theme),
            risks: [],
            aiInsights: [
              `Collected ${answerCount} substantive answer(s) from ${participantCount} participant(s).`,
            ],
            actionItems: [],
            participantUpdates: responses.map((response) => ({
              slackUserId: response.userId,
              displayName: response.userId,
              answers: response.answers.map((answer) => ({
                question: answer.questionText,
                answer: answer.text,
              })),
            })),
            overallProgress:
              participantCount > 0
                ? `${participantCount} participant(s) submitted ${answerCount} answer(s).`
                : '',
          },
  };
}