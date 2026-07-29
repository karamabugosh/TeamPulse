// backend/src/ai/rules-fallback.ts

import {
  AiDigestResult,
  BlockerSeverity,
  ExtractedBlocker,
  RawResponseForAnalysis,
  ThemeSummary,
} from './dto/ai-result.dto';

const FALLBACK_SUMMARY_MESSAGE =
  'AI summary unavailable. Structured blockers extracted using rules.';

export function runRulesFallback(
  teamId: string,
  runId: string,
  responses: RawResponseForAnalysis[],
): AiDigestResult {
  const blockers: ExtractedBlocker[] = [];

  for (const response of responses) {
    for (const answer of response.answers) {
      if (answer.answerType !== 'blocker' || !answer.answerText) continue;

      blockers.push({
        userId: response.userId,
        questionId: answer.questionId,
        description: answer.answerText,
        severity: answer.blockerSeverity ?? BlockerSeverity.MEDIUM,
        dependency: answer.blockerDependency ?? null,
        confidence: 1.0,
      });
    }
  }

  const themes: ThemeSummary[] = [];

  return {
    teamId,
    runId,
    generatedAt: new Date().toISOString(),
    source: 'rules_fallback',
    summary: FALLBACK_SUMMARY_MESSAGE,
    blockers,
    themes,
  };
}