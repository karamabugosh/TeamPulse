// backend/src/ai/openai-client.ts

import OpenAI from 'openai';

let cachedClient: OpenAI | null = null;

const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

/**
 * Returns a shared OpenAI client instance.
 *
 * The client is created lazily on the first AI request and reused
 * for subsequent requests.
 */
export function getOpenAiClient(): OpenAI {
  if (cachedClient) {
    return cachedClient;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is missing. Set it in the backend environment before enabling the AI feature.',
    );
  }

  cachedClient = new OpenAI({
    apiKey,
  });

  return cachedClient;
}

/**
 * Returns the configured OpenAI model.
 * Falls back to the project default when OPENAI_MODEL is not set.
 */
export function getOpenAiModel(): string {
  const configuredModel =
    process.env.OPENAI_MODEL?.trim();

  return configuredModel || DEFAULT_OPENAI_MODEL;
}