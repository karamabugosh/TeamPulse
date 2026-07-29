// backend/src/ai/openai-client.ts

import OpenAI from 'openai';

let cachedClient: OpenAI | null = null;

/**
 * Returns a single shared OpenAI client instance (created once, reused
 * after that — no need to rebuild it on every call).
 */
export function getOpenAiClient(): OpenAI {
  if (cachedClient) return cachedClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set. Check that backend/.env exists and dotenv is loaded in main.ts.',
    );
  }

  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

export function getOpenAiModel(): string {
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
}