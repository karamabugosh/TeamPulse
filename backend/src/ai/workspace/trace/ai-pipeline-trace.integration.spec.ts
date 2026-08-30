/**
 * Integration: RAG prepare emits trace metrics; pipeline trace builds for real queries.
 * Run: npx ts-node src/ai/workspace/trace/ai-pipeline-trace.integration.spec.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import { RagPipelineService } from '../rag/rag-pipeline.service';
import { buildAiPipelineTraceSafe } from './ai-pipeline-trace.builder';
import { buildMemoryRetrievalPlan } from '../../../memory/memory-retrieval-policy';
import { runWithWorkspaceId } from '../../../common/workspace-context';

const PULES = '0e4985cc-3955-4af5-8cba-d72f25f1a8ee';
const KARAM = 'bae237ed-e53d-4c5f-88e5-6e69945103f3';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    await runWithWorkspaceId(PULES, async () => {
      const rag = app.get(RagPipelineService);

      const latestPrep = await rag.prepare({
        workspaceId: PULES,
        userId: KARAM,
        question: 'What blocker did Karam report in the latest standup?',
      });
      assert(latestPrep.traceMetrics, 'trace metrics on latest standup prepare');
      const latestTrace = buildAiPipelineTraceSafe({
        metrics: latestPrep.traceMetrics!,
        intent: latestPrep.intent,
        plan: buildMemoryRetrievalPlan({
          intent: latestPrep.intent.intent,
          question: latestPrep.question,
          issueKey: latestPrep.retrieval.filters.issueKey,
          hasTrustedUserId: true,
        }),
        diagnostics: latestPrep.retrieval.diagnostics,
        context: latestPrep.context,
        documents: latestPrep.retrieval.hits,
        openai: {
          durationMs: 1000,
          model: 'test-model',
          provider: 'openai',
        },
        answer: {
          confidence: 'High',
          evidenceCount: latestPrep.retrieval.hitCount,
          insufficientData: false,
          provider: 'openai',
          model: 'test-model',
        },
      });
      assert(latestTrace, 'latest trace built');
      assert(
        latestTrace!.stages.find((s) => s.key === 'temporal_scope')?.status ===
          'SUCCESS',
        'temporal scope success',
      );
      assert(
        latestTrace!.stages.find((s) => s.key === 'live_jira')?.status ===
          'SKIPPED',
        'live jira skipped',
      );

      const jiraPrep = await rag.prepare({
        workspaceId: PULES,
        userId: KARAM,
        question: 'Who is assigned to SCRUM-9?',
      });
      const jiraTrace = buildAiPipelineTraceSafe({
        metrics: jiraPrep.traceMetrics!,
        intent: jiraPrep.intent,
        plan: buildMemoryRetrievalPlan({
          intent: jiraPrep.intent.intent,
          question: jiraPrep.question,
          issueKey: jiraPrep.retrieval.filters.issueKey,
          hasTrustedUserId: true,
        }),
        diagnostics: jiraPrep.retrieval.diagnostics,
        context: jiraPrep.context,
        documents: jiraPrep.retrieval.hits,
        openai: {
          durationMs: 800,
          model: 'test-model',
          provider: 'openai',
        },
        answer: {
          confidence: 'High',
          evidenceCount: jiraPrep.retrieval.hitCount,
          insufficientData: false,
          provider: 'openai',
          model: 'test-model',
        },
      });
      assert(
        jiraTrace!.stages.find((s) => s.key === 'v2_memory')?.status ===
          'SKIPPED',
        'v2 skipped for jira field',
      );
      assert(
        jiraTrace!.stages.find((s) => s.key === 'live_jira')?.status !==
          'FAILED',
        'live jira not failed',
      );
    });

    console.log('✓ ai-pipeline-trace.integration.spec.ts passed');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
