// backend/src/ai/ai.config.ts

const REQUIRED_AI_ACCURACY = 0.85;

export interface AiBaseline {
  measuredAccuracy: number | null;
  measuredCostPerRun: number | null;
  requiredAccuracy: number;
  lastMeasuredAt: string | null;
}

export const AI_BASELINE: AiBaseline = {
  measuredAccuracy: 0.9,
  measuredCostPerRun: null,
  requiredAccuracy: REQUIRED_AI_ACCURACY,
  lastMeasuredAt: null,
};

export function isAiFeatureEnabled(): boolean {
  if (process.env.PULSE_AI_ENABLED !== 'true') return false;

  if (AI_BASELINE.measuredAccuracy === null) return false;
  return AI_BASELINE.measuredAccuracy >= AI_BASELINE.requiredAccuracy;
}