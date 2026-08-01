// backend/src/ai/ai-response-validator.ts

import {
  BlockerSeverity,
  ExtractedBlocker,
  ThemeSummary,
} from './dto/ai-result.dto';

export interface ParsedAiResponse {
  summary: string;
  blockers: ExtractedBlocker[];
  themes: ThemeSummary[];
}

const VALID_SEVERITIES = Object.values(BlockerSeverity) as string[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Parses and validates the raw text OpenAI returns. Throws a descriptive
 * error on any mismatch — the caller (AiService) already falls back to
 * rules-based extraction on any thrown error, so failing loudly here is
 * safe and preferred over silently accepting malformed data.
 *
 * Policy: "dependency" is always required in the shape (non-empty string
 * or null), never omitted — this matches the JSON schema given to the
 * model in the prompt (pulse-ai.prompts.ts).
 */
export function parseAndValidateAiResponse(raw: string): ParsedAiResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('AI response is not valid JSON');
  }

  if (!isRecord(parsed)) {
    throw new Error('AI response must be a JSON object');
  }

  const data = parsed;

  if (!isNonEmptyString(data.summary)) {
    throw new Error('AI response missing a valid non-empty "summary" string');
  }

  if (!Array.isArray(data.blockers)) {
    throw new Error('AI response missing a "blockers" array');
  }

  if (!Array.isArray(data.themes)) {
    throw new Error('AI response missing a "themes" array');
  }

  const blockers: ExtractedBlocker[] = data.blockers.map(
    (raw: unknown, i: number) => {
      if (!isRecord(raw)) {
        throw new Error(`blockers[${i}] is not a valid object`);
      }
      if (!isNonEmptyString(raw.userId)) {
        throw new Error(`blockers[${i}].userId must be a non-empty string`);
      }
      if (!isNonEmptyString(raw.questionId)) {
        throw new Error(`blockers[${i}].questionId must be a non-empty string`);
      }
      if (!isNonEmptyString(raw.description)) {
        throw new Error(`blockers[${i}].description must be a non-empty string`);
      }
      if (typeof raw.severity !== 'string' || !VALID_SEVERITIES.includes(raw.severity)) {
        throw new Error(`blockers[${i}].severity is not a valid severity`);
      }
      if (
        typeof raw.confidence !== 'number' ||
        raw.confidence < 0 ||
        raw.confidence > 1
      ) {
        throw new Error(`blockers[${i}].confidence must be a number between 0 and 1`);
      }
      if (raw.dependency !== null && !isNonEmptyString(raw.dependency)) {
        throw new Error(
          `blockers[${i}].dependency must be a non-empty string or null`,
        );
      }

      return {
        userId: raw.userId.trim(),
        questionId: raw.questionId.trim(),
        description: raw.description.trim(),
        severity: raw.severity as BlockerSeverity,
        dependency: typeof raw.dependency === 'string' ? raw.dependency.trim() : null,
        confidence: raw.confidence,
      };
    },
  );

  const themes: ThemeSummary[] = data.themes.map((raw: unknown, i: number) => {
    if (!isRecord(raw)) {
      throw new Error(`themes[${i}] is not a valid object`);
    }
    if (!isNonEmptyString(raw.theme)) {
      throw new Error(`themes[${i}].theme must be a non-empty string`);
    }
    if (
      typeof raw.mentionCount !== 'number' ||
      !Number.isInteger(raw.mentionCount) ||
      raw.mentionCount < 0
    ) {
      throw new Error(`themes[${i}].mentionCount must be a non-negative integer`);
    }
    if (!isNonEmptyString(raw.summary)) {
      throw new Error(`themes[${i}].summary must be a non-empty string`);
    }

    return {
      theme: raw.theme.trim(),
      mentionCount: raw.mentionCount,
      summary: raw.summary.trim(),
    };
  });

  return { summary: data.summary.trim(), blockers, themes };
}