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

const VALID_SEVERITIES = Object.values(
  BlockerSeverity,
) as string[];

const ROOT_KEYS = new Set([
  'summary',
  'blockers',
  'themes',
]);

const BLOCKER_KEYS = new Set([
  'userId',
  'questionId',
  'description',
  'severity',
  'dependency',
  'confidence',
]);

const THEME_KEYS = new Set([
  'theme',
  'mentionCount',
  'summary',
]);

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isNonEmptyString(
  value: unknown,
): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0
  );
}

function hasOnlyAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
): boolean {
  return Object.keys(value).every((key) =>
    allowedKeys.has(key),
  );
}

function normaliseForComparison(
  value: string,
): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function parseAndValidateAiResponse(
  raw: string,
): ParsedAiResponse {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'AI response is not valid JSON',
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(
      'AI response must be a JSON object',
    );
  }

  if (!hasOnlyAllowedKeys(parsed, ROOT_KEYS)) {
    throw new Error(
      'AI response contains unexpected top-level fields',
    );
  }

  if (!isNonEmptyString(parsed.summary)) {
    throw new Error(
      'AI response missing a valid non-empty "summary" string',
    );
  }

  if (!Array.isArray(parsed.blockers)) {
    throw new Error(
      'AI response missing a "blockers" array',
    );
  }

  if (!Array.isArray(parsed.themes)) {
    throw new Error(
      'AI response missing a "themes" array',
    );
  }

  const blockerKeys = new Set<string>();

  const blockers: ExtractedBlocker[] =
    parsed.blockers.map(
      (rawBlocker: unknown, index: number) => {
        if (!isRecord(rawBlocker)) {
          throw new Error(
            `blockers[${index}] is not a valid object`,
          );
        }

        if (
          !hasOnlyAllowedKeys(
            rawBlocker,
            BLOCKER_KEYS,
          )
        ) {
          throw new Error(
            `blockers[${index}] contains unexpected fields`,
          );
        }

        if (
          !isNonEmptyString(rawBlocker.userId)
        ) {
          throw new Error(
            `blockers[${index}].userId must be a non-empty string`,
          );
        }

        if (
          !isNonEmptyString(
            rawBlocker.questionId,
          )
        ) {
          throw new Error(
            `blockers[${index}].questionId must be a non-empty string`,
          );
        }

        if (
          !isNonEmptyString(
            rawBlocker.description,
          )
        ) {
          throw new Error(
            `blockers[${index}].description must be a non-empty string`,
          );
        }

        if (
          typeof rawBlocker.severity !==
            'string' ||
          !VALID_SEVERITIES.includes(
            rawBlocker.severity,
          )
        ) {
          throw new Error(
            `blockers[${index}].severity is not a valid severity`,
          );
        }

        if (
          typeof rawBlocker.confidence !==
            'number' ||
          !Number.isFinite(
            rawBlocker.confidence,
          ) ||
          rawBlocker.confidence < 0 ||
          rawBlocker.confidence > 1
        ) {
          throw new Error(
            `blockers[${index}].confidence must be a finite number between 0 and 1`,
          );
        }

        if (
          rawBlocker.dependency !== null &&
          !isNonEmptyString(
            rawBlocker.dependency,
          )
        ) {
          throw new Error(
            `blockers[${index}].dependency must be a non-empty string or null`,
          );
        }

        const userId =
          rawBlocker.userId.trim();

        const questionId =
          rawBlocker.questionId.trim();

        const description =
          rawBlocker.description.trim();

        const dependency =
          typeof rawBlocker.dependency ===
          'string'
            ? rawBlocker.dependency.trim()
            : null;

        const duplicateKey = [
          normaliseForComparison(userId),
          normaliseForComparison(questionId),
          normaliseForComparison(
            description,
          ),
        ].join('|');

        if (blockerKeys.has(duplicateKey)) {
          throw new Error(
            `blockers[${index}] duplicates an existing blocker`,
          );
        }

        blockerKeys.add(duplicateKey);

        return {
          userId,
          questionId,
          description,
          severity:
            rawBlocker.severity as BlockerSeverity,
          dependency,
          confidence:
            rawBlocker.confidence,
        };
      },
    );

  const themeNames = new Set<string>();

  const themes: ThemeSummary[] =
    parsed.themes.map(
      (rawTheme: unknown, index: number) => {
        if (!isRecord(rawTheme)) {
          throw new Error(
            `themes[${index}] is not a valid object`,
          );
        }

        if (
          !hasOnlyAllowedKeys(
            rawTheme,
            THEME_KEYS,
          )
        ) {
          throw new Error(
            `themes[${index}] contains unexpected fields`,
          );
        }

        if (
          !isNonEmptyString(rawTheme.theme)
        ) {
          throw new Error(
            `themes[${index}].theme must be a non-empty string`,
          );
        }

        if (
          typeof rawTheme.mentionCount !==
            'number' ||
          !Number.isInteger(
            rawTheme.mentionCount,
          ) ||
          rawTheme.mentionCount < 1
        ) {
          throw new Error(
            `themes[${index}].mentionCount must be a positive integer`,
          );
        }

        if (
          !isNonEmptyString(rawTheme.summary)
        ) {
          throw new Error(
            `themes[${index}].summary must be a non-empty string`,
          );
        }

        const theme =
          rawTheme.theme.trim();

        const normalisedTheme =
          normaliseForComparison(theme);

        if (
          themeNames.has(normalisedTheme)
        ) {
          throw new Error(
            `themes[${index}] duplicates an existing theme`,
          );
        }

        themeNames.add(normalisedTheme);

        return {
          theme,
          mentionCount:
            rawTheme.mentionCount,
          summary:
            rawTheme.summary.trim(),
        };
      },
    );

  return {
    summary: parsed.summary.trim(),
    blockers,
    themes,
  };
}