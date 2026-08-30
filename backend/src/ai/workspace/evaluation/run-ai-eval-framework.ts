/**
 * Regression entrypoint for AI evaluation framework.
 * 1) Offline scoring/detector unit tests (always)
 * 2) Optional live run: AI_EVAL_LIVE=1 npx ts-node ...
 *
 * Usage:
 *   npm run test:ai-eval-framework
 *   AI_EVAL_LIVE=1 npm run test:ai-eval-framework
 */
import 'dotenv/config';
import 'reflect-metadata';

async function main() {
  // Unit suite
  require('./ai-eval-framework.spec');

  if (process.env.AI_EVAL_LIVE !== '1') {
    console.log(
      'Skipping live workspace eval (set AI_EVAL_LIVE=1 to run against Demo/active workspace).',
    );
    return;
  }

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../../app.module');
  const { AiEvalRunnerService } = await import('./ai-eval-runner.service');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const runner = app.get(AiEvalRunnerService);
    const preferDemo = process.env.AI_EVAL_DEMO !== '0';
    const limit = process.env.AI_EVAL_LIMIT
      ? Number(process.env.AI_EVAL_LIMIT)
      : 5;
    const run = await runner.run({
      preferDemo,
      limit,
      label: 'cli-regression',
      seedIfEmpty: true,
    });
    console.log(
      JSON.stringify(
        {
          runId: run.id,
          workspaceId: run.workspaceId,
          overallScore: run.overallScore,
          passed: run.passed,
          failed: run.failed,
          totalQuestions: run.totalQuestions,
          averageResponseTimeMs: run.averageResponseTimeMs,
        },
        null,
        2,
      ),
    );
    if (run.overallScore < (run.passThreshold ?? 60) * 0.5) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
