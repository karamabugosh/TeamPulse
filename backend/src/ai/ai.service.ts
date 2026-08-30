// backend/src/ai/ai.service.ts

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  AiDigestResult,
  RawResponseForAnalysis,
  EMPTY_REPORT_SECTIONS,
} from './dto/ai-result.dto';
import { AI_PROMPT } from './prompts/pulse-ai.prompts';
import { runRulesFallback } from './rules-fallback';
import { isAiFeatureEnabled, getAiConfigStatus } from './ai.config';
import {
  getOpenAiClient,
  getOpenAiModel,
} from './openai-client';
import { parseAndValidateAiResponse } from './ai-response-validator';
import { CostAccumulator } from './cost-tracker';
import { PrismaService } from '../prisma/prisma.service';
import { AiReportGenerationError } from './ai-report-generation.error';
import { WORKSPACE_KNOWLEDGE_CHANGED } from './workspace/retrieval/knowledge-events';
import { MemoryOutboxService } from '../memory/memory-outbox.service';
import { MEMORY_SOURCE } from '../memory/memory-source.constants';
import { isMemoryEligibleDigest } from '../memory/memory-ingestion.policy';

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);

  private readonly costAccumulator =
    new CostAccumulator();

  private readonly maxAiAttempts = 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly memoryOutbox: MemoryOutboxService,
  ) {}

  onModuleInit(): void {
    const status = getAiConfigStatus();
    this.logger.log(
      `[AI] Config loaded — enabled=${status.enabled}, apiKeyConfigured=${status.apiKeyConfigured}, model=${status.model}, PULSE_AI_ENABLED=${status.pulseAiFlag ?? 'unset'}`,
    );

    if (!status.apiKeyConfigured) {
      this.logger.error(
        '[AI] OPENAI_API_KEY is not loaded from environment — reports will fail until it is set in .env',
      );
    } else if (!status.enabled) {
      this.logger.warn(
        '[AI] OPENAI_API_KEY is present but PULSE_AI_ENABLED is not true — set PULSE_AI_ENABLED=true to enable AI reports',
      );
    }
  }

  async analyzeRun(
    teamId: string,
    runId: string,
    responses: RawResponseForAnalysis[],
    persist = false,
    options?: { allowRulesFallback?: boolean },
  ): Promise<AiDigestResult> {
    const allowRulesFallback = options?.allowRulesFallback ?? false;
    let result: AiDigestResult;

    if (!isAiFeatureEnabled()) {
      if (allowRulesFallback) {
        this.logger.log(
          `AI layer disabled — using rules fallback for run ${runId}`,
        );
        result = runRulesFallback(teamId, runId, responses);
      } else {
        throw new AiReportGenerationError(
          'AI report generation is disabled. Set PULSE_AI_ENABLED=true and configure OPENAI_API_KEY.',
        );
      }
    } else if (responses.length === 0) {
      if (allowRulesFallback) {
        this.logger.warn(
          `No responses found for run ${runId}; using rules fallback`,
        );
        result = runRulesFallback(teamId, runId, responses);
      } else {
        throw new AiReportGenerationError(
          'No submitted standup answers were found for this run.',
        );
      }
    } else {
      result = await this.analyzeWithFallback(
        teamId,
        runId,
        responses,
        allowRulesFallback,
      );
    }

    /*
     * Normal application calls persist the digest.
     * Evaluation calls can pass persist=false so test cases
     * do not pollute the AiDigest history table.
     */
    if (persist) {
      await this.saveDigest(result);
    }

    return result;
  }

  private async analyzeWithFallback(
    teamId: string,
    runId: string,
    responses: RawResponseForAnalysis[],
    allowRulesFallback: boolean,
  ): Promise<AiDigestResult> {
    let lastError: unknown = null;

    for (
      let attempt = 1;
      attempt <= this.maxAiAttempts;
      attempt += 1
    ) {
      try {
        if (attempt > 1) {
          this.logger.warn(
            `Retrying AI extraction for run ${runId} ` +
              `(attempt ${attempt}/${this.maxAiAttempts})`,
          );
        }

        return await this.runAiExtraction(
          teamId,
          runId,
          responses,
        );
      } catch (error: unknown) {
        lastError = error;

        const message =
          error instanceof Error
            ? error.message
            : String(error);

        this.logger.warn(
          `AI extraction attempt ${attempt}/${this.maxAiAttempts} ` +
            `failed for run ${runId}: ${message}`,
        );
      }
    }

    const finalMessage =
      lastError instanceof Error
        ? lastError.message
        : String(lastError);

    this.logger.error(
      `AI extraction failed for run ${runId} after ` +
        `${this.maxAiAttempts} attempt(s): ${finalMessage}`,
    );

    if (allowRulesFallback) {
      return runRulesFallback(teamId, runId, responses);
    }

    throw new AiReportGenerationError(finalMessage);
  }

  private async saveDigest(
    result: AiDigestResult,
  ): Promise<void> {
    try {
      const team = await this.prisma.team.findUnique({
        where: { id: result.teamId },
        select: { workspaceId: true },
      });
      if (!team?.workspaceId) {
        throw new Error(
          `Cannot save AiDigest — team ${result.teamId} has no workspaceId`,
        );
      }

      const existing = await this.prisma.aiDigest.findUnique({
        where: { runId: result.runId },
        select: {
          slackReportText: true,
          slackReportBlocks: true,
          nonResponderNames: true,
        },
      });

      const digest = await this.prisma.$transaction(async (tx) => {
        const row = await tx.aiDigest.upsert({
          where: { runId: result.runId },
          create: {
            teamId: result.teamId,
            runId: result.runId,
            generatedAt: new Date(result.generatedAt),
            source: result.source,
            summary: result.summary,
            blockers: result.blockers as any,
            themes: result.themes as any,
            reportSections: result.reportSections as any,
          },
          update: {
            generatedAt: new Date(result.generatedAt),
            source: result.source,
            summary: result.summary,
            blockers: result.blockers as any,
            themes: result.themes as any,
            reportSections: result.reportSections as any,
            generationError: result.generationError ?? null,
            ...(existing?.slackReportText && result.source === 'ai'
              ? {
                  slackReportText: existing.slackReportText,
                  slackReportBlocks: existing.slackReportBlocks as any,
                  nonResponderNames: existing.nonResponderNames as any,
                }
              : {}),
          },
        });

        if (
          isMemoryEligibleDigest({
            source: result.source,
            summary: result.summary,
            generationError: result.generationError,
          })
        ) {
          await this.memoryOutbox.enqueueUpsert({
            tx,
            workspaceId: team.workspaceId,
            sourceType: MEMORY_SOURCE.REPORT,
            sourceId: row.id,
          });
        }

        return row;
      });

      this.logger.log(
        `Saved ${result.source} digest ${digest.id} for run ${result.runId} to database`,
      );

      this.events.emit(WORKSPACE_KNOWLEDGE_CHANGED, {
        workspaceId: team.workspaceId,
        reason: `ai_digest:${result.runId}`,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.error(
        `Failed to save AI digest for run ${result.runId}: ${message}`,
      );

      /*
       * Persistence failure should not prevent the current
       * AI result from being returned to the caller.
       */
    }
  }

  getCostSummary(): {
    totalCost: number;
    callCount: number;
    averageCostPerCall: number | null;
    pricedCallCount: number;
    unknownPricingCallCount: number;
  } {
    return {
      totalCost:
        this.costAccumulator.getTotalCost(),

      callCount:
        this.costAccumulator.getCallCount(),

      averageCostPerCall:
        this.costAccumulator.getAverageCostPerCall(),

      pricedCallCount:
        this.costAccumulator.getPricedCallCount(),

      unknownPricingCallCount:
        this.costAccumulator.getUnknownPricingCallCount(),
    };
  }

  private async runAiExtraction(
    teamId: string,
    runId: string,
    responses: RawResponseForAnalysis[],
  ): Promise<AiDigestResult> {
    const client = getOpenAiClient();
    const model = getOpenAiModel();

    const userPrompt =
      AI_PROMPT.buildUserPrompt(
        teamId,
        runId,
        responses,
      );

    const answerCount = responses.reduce(
      (total, response) => total + response.answers.length,
      0,
    );

    this.logger.log(
      `[AI] Calling OpenAI model ${model} for run ${runId} — ${responses.length} participant(s), ${answerCount} answer(s)`,
    );

    const completion =
      await client.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: AI_PROMPT.system,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        response_format: {
          type: 'json_object',
        },
        temperature: 0.2,
      });

    const choice = completion.choices[0];

    if (!choice) {
      throw new Error(
        'OpenAI returned no completion choices',
      );
    }

    if (choice.finish_reason !== 'stop') {
      throw new Error(
        `OpenAI response did not finish normally: ${choice.finish_reason}`,
      );
    }

    this.recordUsage(
      model,
      runId,
      completion.usage,
    );

    const rawContent =
      choice.message.content;

    if (!rawContent?.trim()) {
      throw new Error(
        'OpenAI returned an empty response',
      );
    }

    const parsed =
      parseAndValidateAiResponse(
        rawContent,
      );

    this.logger.log(
      `AI analysis completed successfully for run ${runId} using model ${model}`,
    );

    return {
      teamId,
      runId,
      generatedAt:
        new Date().toISOString(),
      source: 'ai',
      summary: parsed.summary,
      blockers: parsed.blockers,
      themes: parsed.themes,
      reportSections: parsed.reportSections,
    };
  }

  private recordUsage(
    model: string,
    runId: string,
    usage:
      | {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        }
      | null
      | undefined,
  ): void {
    if (!usage) {
      this.logger.debug(
        `OpenAI did not return token usage for run ${runId}`,
      );

      return;
    }

    const cost =
      this.costAccumulator.record(
        model,
        {
          promptTokens:
            usage.prompt_tokens,
          completionTokens:
            usage.completion_tokens,
        },
      );

    const costText =
      cost !== null
        ? `, estimatedCost=$${cost.toFixed(6)}`
        : ', estimatedCost=unavailable';

    this.logger.debug(
      `OpenAI usage for run ${runId}: ` +
        `prompt=${usage.prompt_tokens}, ` +
        `completion=${usage.completion_tokens}, ` +
        `total=${usage.total_tokens}` +
        costText,
    );
  }
}