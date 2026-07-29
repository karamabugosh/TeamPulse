// backend/src/ai/rules-fallback.ts

import {
  AiDigestResult,
  RawResponseForAnalysis,
  ThemeSummary,
  ExtractedBlocker,
} from './dto/ai-result.dto';

const FALLBACK_SUMMARY_MESSAGE =
  'AI summary unavailable. Blocker detection requires the AI layer — no blockers were extracted.';

/**
 * Rules-based fallback (no model call).
 *
 * Unlike an earlier design, there is no structured blocker data collected
 * at answer time (see ai-result.dto.ts) — the Prisma schema stores only
 * free text per answer. Identifying blockers from free text requires
 * language understanding, which a rules-based fallback cannot do.
 *
 * So this fallback is intentionally honest about its limits: it always
 * returns an empty blockers list and an empty themes list rather than
 * faking a keyword-matching heuristic that would produce unreliable
 * results. When this path runs, the team simply doesn't get blocker/theme
 * detection for that run — they still get the raw responses elsewhere
 * (e.g. via Reports), just not the AI-derived structure.
 */
export function runRulesFallback(
  teamId: string,
  runId: string,
  _responses: RawResponseForAnalysis[],
): AiDigestResult {
  const blockers: ExtractedBlocker[] = [];
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