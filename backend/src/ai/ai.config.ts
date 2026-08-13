// backend/src/ai/ai.config.ts

const REQUIRED_AI_ACCURACY = 0.85;

export interface AiBaseline {
  measuredAccuracy: number | null;
  measuredCostPerRun: number | null;
  requiredAccuracy: number;
  lastMeasuredAt: string | null;
}

/**
 * Latest recorded AI evaluation baseline.
 *
 * These values are informational and should be updated after
 * running the evaluation suite.
 *
 * They must not be used as the runtime feature flag because
 * evaluation results may become stale as the dataset grows.
 */
export const AI_BASELINE: AiBaseline = {
  measuredAccuracy: 0.90,
  measuredCostPerRun: 0.000373,
  requiredAccuracy: REQUIRED_AI_ACCURACY,
  lastMeasuredAt: '2026-08-08T10:53:30.000Z',
};

/**
 * Controls whether the AI layer is allowed to run.
 *
 * Enabled when PULSE_AI_ENABLED=true and OPENAI_API_KEY is configured.
 * ConfigModule.forRoot() loads .env into process.env before services start.
 */
export function isAiFeatureEnabled(): boolean {
  const explicitlyEnabled = process.env.PULSE_AI_ENABLED === 'true';
  const apiKeyConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
  return explicitlyEnabled && apiKeyConfigured;
}

export function getAiConfigStatus(): {
  enabled: boolean;
  apiKeyConfigured: boolean;
  model: string;
  pulseAiFlag: string | undefined;
} {
  return {
    enabled: isAiFeatureEnabled(),
    apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini',
    pulseAiFlag: process.env.PULSE_AI_ENABLED,
  };
}

/**
 * Returns whether the latest measured evaluation accuracy
 * meets the project's required AI quality threshold.
 *
 * Returns false when no evaluation measurement exists.
 */
export function doesAiMeetQualityThreshold(): boolean {
  const accuracy = AI_BASELINE.measuredAccuracy;

  if (accuracy === null) {
    return false;
  }

  return accuracy >= AI_BASELINE.requiredAccuracy;
}