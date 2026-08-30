// backend/src/ai/evaluation/run-evaluation.ts

import 'dotenv/config';
import 'reflect-metadata';

import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiService } from '../ai.service';
import { AI_BASELINE } from '../ai.config';
import {
  EVAL_DATASET,
  EvalCase,
  ExpectedBlocker,
  ExpectedTheme,
} from './eval-dataset';
import {
  AiDigestResult,
  EMPTY_REPORT_SECTIONS,
  ExtractedBlocker,
  ThemeSummary,
} from '../dto/ai-result.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { MemoryOutboxService } from '../../memory/memory-outbox.service';

interface CheckResult {
  name: string;
  passed: boolean;
  reason: string;
}

interface CaseResult {
  id: string;
  description: string;
  passed: boolean;
  score: number;
  checks: CheckResult[];
  actual: AiDigestResult;
}

function normalize(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function containsKeyword(
  value: string,
  keyword: string,
): boolean {
  return normalize(value).includes(
    normalize(keyword),
  );
}

function findMatchingBlocker(
  expected: ExpectedBlocker,
  actualBlockers: ExtractedBlocker[],
): ExtractedBlocker | undefined {
  return actualBlockers.find(
    (blocker) =>
      blocker.userId === expected.userId &&
      blocker.questionId ===
        expected.questionId &&
      containsKeyword(
        blocker.description,
        expected.descriptionKeyword,
      ),
  );
}

function scoreExpectedBlockers(
  evalCase: EvalCase,
  actual: AiDigestResult,
): CheckResult[] {
  const checks: CheckResult[] = [];
  const expected =
    evalCase.expected.blockers;

  if (expected.length === 0) {
    checks.push({
      name: 'no-unexpected-blockers',
      passed: actual.blockers.length === 0,
      reason:
        actual.blockers.length === 0
          ? 'No blockers were expected or returned.'
          : `Expected no blockers, but AI returned ${actual.blockers.length}.`,
    });

    return checks;
  }

  checks.push({
    name: 'blocker-count',
    passed:
      actual.blockers.length ===
      expected.length,
    reason:
      `Expected ${expected.length} blocker(s), ` +
      `AI returned ${actual.blockers.length}.`,
  });

  for (const expectedBlocker of expected) {
    const actualBlocker =
      findMatchingBlocker(
        expectedBlocker,
        actual.blockers,
      );

    const blockerLabel =
      `${expectedBlocker.userId}/` +
      `${expectedBlocker.questionId}/` +
      `${expectedBlocker.descriptionKeyword}`;

    checks.push({
      name: `blocker-match:${blockerLabel}`,
      passed: Boolean(actualBlocker),
      reason: actualBlocker
        ? `Matched blocker "${expectedBlocker.descriptionKeyword}".`
        : `Could not find expected blocker "${expectedBlocker.descriptionKeyword}" for ${expectedBlocker.userId}.`,
    });

    if (!actualBlocker) {
      continue;
    }

    if (expectedBlocker.severity) {
      checks.push({
        name: `severity:${blockerLabel}`,
        passed:
          actualBlocker.severity ===
          expectedBlocker.severity,
        reason:
          `Expected severity=${expectedBlocker.severity}, ` +
          `got ${actualBlocker.severity}.`,
      });
    }

    if (
      expectedBlocker.dependencyKeyword !==
      undefined
    ) {
      const expectedDependency =
        expectedBlocker.dependencyKeyword;

      const dependencyMatches =
        expectedDependency === null
          ? actualBlocker.dependency === null
          : typeof actualBlocker.dependency ===
              'string' &&
            containsKeyword(
              actualBlocker.dependency,
              expectedDependency,
            );

      checks.push({
        name: `dependency:${blockerLabel}`,
        passed: dependencyMatches,
        reason:
          `Expected dependency=${String(
            expectedDependency,
          )}, got ${String(
            actualBlocker.dependency,
          )}.`,
      });
    }

    if (
      expectedBlocker.minConfidence !==
      undefined
    ) {
      checks.push({
        name: `confidence:${blockerLabel}`,
        passed:
          actualBlocker.confidence >=
          expectedBlocker.minConfidence,
        reason:
          `Expected confidence >= ${expectedBlocker.minConfidence}, ` +
          `got ${actualBlocker.confidence}.`,
      });
    }
  }

  return checks;
}

function findMatchingTheme(
  expected: ExpectedTheme,
  actualThemes: ThemeSummary[],
): ThemeSummary | undefined {
  return actualThemes.find(
    (theme) =>
      containsKeyword(
        theme.theme,
        expected.themeKeyword,
      ) ||
      containsKeyword(
        theme.summary,
        expected.themeKeyword,
      ),
  );
}

function scoreExpectedThemes(
  evalCase: EvalCase,
  actual: AiDigestResult,
): CheckResult[] {
  const expectedThemes =
    evalCase.expected.themes;

  if (!expectedThemes) {
    return [];
  }

  if (expectedThemes.length === 0) {
    return [
      {
        name: 'no-unexpected-themes',
        passed: actual.themes.length === 0,
        reason:
          actual.themes.length === 0
            ? 'No themes were expected or returned.'
            : `Expected no themes, but AI returned ${actual.themes.length}.`,
      },
    ];
  }

  const checks: CheckResult[] = [];

  for (const expectedTheme of expectedThemes) {
    const actualTheme =
      findMatchingTheme(
        expectedTheme,
        actual.themes,
      );

    checks.push({
      name: `theme:${expectedTheme.themeKeyword}`,
      passed: Boolean(actualTheme),
      reason: actualTheme
        ? `Matched expected theme "${expectedTheme.themeKeyword}".`
        : `Could not find expected theme "${expectedTheme.themeKeyword}".`,
    });

    if (
      actualTheme &&
      expectedTheme.mentionCount !==
        undefined
    ) {
      checks.push({
        name:
          `theme-mention-count:` +
          expectedTheme.themeKeyword,
        passed:
          actualTheme.mentionCount ===
          expectedTheme.mentionCount,
        reason:
          `Expected mentionCount=${expectedTheme.mentionCount}, ` +
          `got ${actualTheme.mentionCount}.`,
      });
    }
  }

  return checks;
}

function scoreSummary(
  evalCase: EvalCase,
  actual: AiDigestResult,
): CheckResult[] {
  const keywords =
    evalCase.expected.summaryKeywords;

  if (!keywords?.length) {
    return [];
  }

  return keywords.map((keyword) => ({
    name: `summary:${keyword}`,
    passed: containsKeyword(
      actual.summary,
      keyword,
    ),
    reason: containsKeyword(
      actual.summary,
      keyword,
    )
      ? `Summary contains "${keyword}".`
      : `Summary does not contain expected concept "${keyword}".`,
  }));
}

function scoreCase(
  evalCase: EvalCase,
  actual: AiDigestResult,
): CaseResult {
  const checks = [
    ...scoreExpectedBlockers(
      evalCase,
      actual,
    ),
    ...scoreExpectedThemes(
      evalCase,
      actual,
    ),
    ...scoreSummary(
      evalCase,
      actual,
    ),
  ];

  const passedChecks =
    checks.filter(
      (check) => check.passed,
    ).length;

  const score =
    checks.length === 0
      ? 1
      : passedChecks / checks.length;

  return {
    id: evalCase.id,
    description: evalCase.description,
    passed: checks.every(
      (check) => check.passed,
    ),
    score,
    checks,
    actual,
  };
}

async function main(): Promise<void> {
  process.env.PULSE_AI_ENABLED = 'true';

  const prisma = new PrismaService();
  const service = new AiService(
    prisma,
    new EventEmitter2(),
    new MemoryOutboxService(prisma),
  );

  const results: CaseResult[] = [];

  let totalChecks = 0;
  let passedChecks = 0;
  let passedCases = 0;

  console.log(
    `Running AI evaluation on ${EVAL_DATASET.length} case(s)...\n`,
  );

  try {
    for (const evalCase of EVAL_DATASET) {
      process.stdout.write(
        `[${evalCase.id}] `,
      );

      try {
        /*
         * persist=false prevents evaluation cases
         * from being written to AiDigest history.
         */
        const actual =
          await service.analyzeRun(
            'eval-team',
            evalCase.id,
            evalCase.input,
            false,
          );

        const result = scoreCase(
          evalCase,
          actual,
        );

        results.push(result);

        totalChecks +=
          result.checks.length;

        passedChecks +=
          result.checks.filter(
            (check) => check.passed,
          ).length;

        if (result.passed) {
          passedCases += 1;

          console.log(
            `PASS (${(
              result.score * 100
            ).toFixed(1)}%)`,
          );
        } else {
          console.log(
            `FAIL (${(
              result.score * 100
            ).toFixed(1)}%)`,
          );
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        console.log(
          `ERROR — ${message}`,
        );

        results.push({
          id: evalCase.id,
          description:
            evalCase.description,
          passed: false,
          score: 0,
          checks: [
            {
              name: 'execution',
              passed: false,
              reason:
                `Evaluation threw an error: ${message}`,
            },
          ],
          actual: {
            teamId: 'eval-team',
            runId: evalCase.id,
            generatedAt:
              new Date().toISOString(),
            source: 'rules_fallback',
            summary: '',
            blockers: [],
            themes: [],
            reportSections: EMPTY_REPORT_SECTIONS,
          },
        });

        totalChecks += 1;
      }
    }

    console.log(
      '\n--- Detailed results ---',
    );

    for (const result of results) {
      console.log(
        `\n${result.passed ? '✅' : '❌'} ` +
          `${result.id}: ${result.description}`,
      );

      console.log(
        `   Case score: ${(
          result.score * 100
        ).toFixed(1)}%`,
      );

      for (const check of result.checks) {
        console.log(
          `   ${check.passed ? '✓' : '✗'} ` +
            `${check.name}: ${check.reason}`,
        );
      }

      console.log(
        `   Source: ${result.actual.source}`,
      );

      console.log(
        `   AI summary: "${result.actual.summary}"`,
      );

      console.log(
        `   Blockers found: ${result.actual.blockers.length}`,
      );

      console.log(
        `   Themes found: ${result.actual.themes.length}`,
      );
    }

    const caseAccuracy =
      EVAL_DATASET.length === 0
        ? 0
        : passedCases /
          EVAL_DATASET.length;

    const checkAccuracy =
      totalChecks === 0
        ? 0
        : passedChecks / totalChecks;

    const costSummary =
      service.getCostSummary();

    console.log(
      '\n--- Final score ---',
    );

    console.log(
      `Cases passed: ${passedCases}/${EVAL_DATASET.length}`,
    );

    console.log(
      `Strict case accuracy: ${(
        caseAccuracy * 100
      ).toFixed(1)}%`,
    );

    console.log(
      `Check-level accuracy: ${(
        checkAccuracy * 100
      ).toFixed(1)}%`,
    );

    console.log(
      `Required accuracy: ${(
        AI_BASELINE.requiredAccuracy *
        100
      ).toFixed(1)}%`,
    );

    console.log(
      '\n--- Cost summary ---',
    );

    console.log(
      `Total AI calls: ${costSummary.callCount}`,
    );

    console.log(
      `Total estimated cost: $${costSummary.totalCost.toFixed(
        6,
      )}`,
    );

    console.log(
      `Average estimated cost per priced call: $${
        costSummary.averageCostPerCall?.toFixed(
          6,
        ) ?? 'N/A'
      }`,
    );

    console.log(
      '\n--- Quality status ---',
    );

    if (
      checkAccuracy >=
      AI_BASELINE.requiredAccuracy
    ) {
      console.log(
        '✅ AI evaluation meets the required quality threshold.',
      );
    } else {
      console.log(
        '❌ AI evaluation is below the required quality threshold.',
      );
    }

    console.log(
      '\nUse the measured results above to update AI_BASELINE only after the final evaluation dataset is approved.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    'Evaluation script failed:',
    error,
  );

  process.exit(1);
});