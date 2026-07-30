// backend/src/ai/ai.config.ts

const REQUIRED_AI_ACCURACY = 0.85;

export interface AiBaseline {
  measuredAccuracy: number | null;
  measuredCostPerRun: number | null;
  requiredAccuracy: number;
  lastMeasuredAt: string | null;
}

/**
 * Measured from a real evaluation run (backend/src/ai/evaluation/,
 * 8 hand-labeled cases, model: gpt-4o-mini) — not a placeholder.
 * See run-evaluation.ts output for the raw pass/fail breakdown.
 *
 * Caveat: 8 cases is a small sample. Revisit with a larger evaluation
 * set before treating this number as fully reliable (tracked for
 * week 3 — "Improve AI").
 */
export const AI_BASELINE: AiBaseline = {
  measuredAccuracy: 1.0,
  measuredCostPerRun: 0.00018,
  requiredAccuracy: REQUIRED_AI_ACCURACY,
  lastMeasuredAt: '2026-07-30T10:05:10.000Z',
};

export function isAiFeatureEnabled(): boolean {
  if (process.env.PULSE_AI_ENABLED !== 'true') return false;

  if (AI_BASELINE.measuredAccuracy === null) return false;
  return AI_BASELINE.measuredAccuracy >= AI_BASELINE.requiredAccuracy;
}