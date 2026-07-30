// backend/src/ai/evaluation/run-evaluation.ts

import 'dotenv/config';
import 'reflect-metadata';
import { AiService } from '../ai.service';
import { AI_BASELINE } from '../ai.config';
import { EVAL_DATASET, EvalCase } from './eval-dataset';
import { AiDigestResult } from '../dto/ai-result.dto';

interface CaseResult {
  id: string;
  description: string;
  passed: boolean;
  reason: string;
  actual: AiDigestResult;
}

function scoreCase(evalCase: EvalCase, actual: AiDigestResult): CaseResult {
  const actualHasBlocker = actual.blockers.length > 0;

  if (actualHasBlocker !== evalCase.expected.hasBlocker) {
    return {
      id: evalCase.id,
      description: evalCase.description,
      passed: false,
      reason: `Expected hasBlocker=${evalCase.expected.hasBlocker}, got ${actualHasBlocker}`,
      actual,
    };
  }

  if (evalCase.expected.hasBlocker && evalCase.expected.blockerKeyword) {
    const keywordFound = actual.blockers.some((b) =>
      b.description.toLowerCase().includes(evalCase.expected.blockerKeyword!.toLowerCase()),
    );
    if (!keywordFound) {
      return {
        id: evalCase.id,
        description: evalCase.description,
        passed: false,
        reason: `Expected blocker description to mention "${evalCase.expected.blockerKeyword}", but it didn't`,
        actual,
      };
    }
  }

  return { id: evalCase.id, description: evalCase.description, passed: true, reason: 'Matched expected outcome', actual };
}

async function main() {
  process.env.PULSE_AI_ENABLED = 'true';
  AI_BASELINE.measuredAccuracy = 1;

  const service = new AiService();
  const results: CaseResult[] = [];
  let totalCases = 0;
  let passedCases = 0;

  console.log(`Running evaluation on ${EVAL_DATASET.length} cases...\n`);

  for (const evalCase of EVAL_DATASET) {
    totalCases++;
    process.stdout.write(`[${evalCase.id}] `);
    try {
      const actual = await service.analyzeRun('eval-team', evalCase.id, evalCase.input);
      const result = scoreCase(evalCase, actual);
      results.push(result);
      if (result.passed) {
        passedCases++;
        console.log('PASS');
      } else {
        console.log(`FAIL — ${result.reason}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`ERROR — ${message}`);
      results.push({
        id: evalCase.id,
        description: evalCase.description,
        passed: false,
        reason: `Threw an error: ${message}`,
        actual: { teamId: 'eval-team', runId: evalCase.id, generatedAt: new Date().toISOString(), source: 'rules_fallback', summary: '', blockers: [], themes: [] },
      });
    }
  }

  const accuracy = passedCases / totalCases;

  console.log('\n--- Detailed results ---');
  for (const r of results) {
    console.log(`\n${r.passed ? '✅' : '❌'} ${r.id}: ${r.description}`);
    console.log(`   ${r.reason}`);
    console.log(`   AI summary: "${r.actual.summary}"`);
    console.log(`   Blockers found: ${r.actual.blockers.length}`);
  }

  const costSummary = service.getCostSummary();

  console.log('\n--- Final score ---');
  console.log(`${passedCases}/${totalCases} cases passed`);
  console.log(`Measured accuracy: ${(accuracy * 100).toFixed(1)}%`);

  console.log('\n--- Cost summary (calculated automatically, not by hand) ---');
  console.log(`Total AI calls: ${costSummary.callCount}`);
  console.log(`Total cost: $${costSummary.totalCost.toFixed(6)}`);
  console.log(`Average cost per run: $${costSummary.averageCostPerCall?.toFixed(6) ?? 'N/A'}`);

  console.log(
    `\nNext step: if accuracy meets the required baseline (${AI_BASELINE.requiredAccuracy * 100}%), ` +
      `update AI_BASELINE in ai.config.ts with measuredAccuracy=${accuracy.toFixed(2)} and measuredCostPerRun=${costSummary.averageCostPerCall?.toFixed(6) ?? 'N/A'}.`,
  );
}

main().catch((e) => {
  console.error('Evaluation script failed:', e);
  process.exit(1);
});