// backend/src/ai/ai.service.ts

import { Injectable, Logger } from '@nestjs/common';
import {
  AiDigestResult,
  RawResponseForAnalysis,
} from './dto/ai-result.dto';
import { AI_PROMPT } from './prompts/pulse-ai.prompts';
import { runRulesFallback } from './rules-fallback';
import { isAiFeatureEnabled } from './ai.config';
import {
  getOpenAiClient,
  getOpenAiModel,
} from './openai-client';
import { parseAndValidateAiResponse } from './ai-response-validator';
import { CostAccumulator } from './cost-tracker';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  private readonly costAccumulator =
    new CostAccumulator();

  private readonly maxAiAttempts = 2;

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async analyzeRun(
    teamId: string,
    runId: string,
    responses: RawResponseForAnalysis[],
    persist = true,
  ): Promise<AiDigestResult> {
    let result: AiDigestResult;

    if (!isAiFeatureEnabled()) {
      this.logger.log(
        `AI layer disabled — using rules fallback for run ${runId}`,
      );

      result = runRulesFallback(
        teamId,
        runId,
        responses,
      );
    } else if (responses.length === 0) {
      this.logger.warn(
        `No responses found for run ${runId}; using rules fallback`,
      );

      result = runRulesFallback(
        teamId,
        runId,
        responses,
      );
    } else {
      result = await this.analyzeWithFallback(
        teamId,
        runId,
        responses,
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
        `${this.maxAiAttempts} attempt(s). ` +
        `Using rules fallback: ${finalMessage}`,
    );

    return runRulesFallback(
      teamId,
      runId,
      responses,
    );
  }

  private async saveDigest(
    result: AiDigestResult,
  ): Promise<void> {
    try {
      await this.prisma.aiDigest.create({
        data: {
          teamId: result.teamId,
          runId: result.runId,
          generatedAt: new Date(
            result.generatedAt,
          ),
          source: result.source,
          summary: result.summary,

          /*
           * Prisma stores these fields as JSON.
           * We will improve this typing separately after
           * reviewing the Prisma AiDigest model.
           */
          blockers: result.blockers as any,
          themes: result.themes as any,
        },
      });

      this.logger.log(
        `Saved ${result.source} digest for run ${result.runId} to database`,
      );
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