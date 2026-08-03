// backend/src/ai/ai.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { AiDigestResult, RawResponseForAnalysis } from './dto/ai-result.dto';
import { AI_PROMPT } from './prompts/pulse-ai.prompts';
import { runRulesFallback } from './rules-fallback';
import { isAiFeatureEnabled } from './ai.config';
import { getOpenAiClient, getOpenAiModel } from './openai-client';
import { parseAndValidateAiResponse } from './ai-response-validator';
import { CostAccumulator } from './cost-tracker';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly costAccumulator = new CostAccumulator();

  constructor(private readonly prisma: PrismaService) {}

  async analyzeRun(
    teamId: string,
    runId: string,
    responses: RawResponseForAnalysis[],
  ): Promise<AiDigestResult> {
    let result: AiDigestResult;

    if (!isAiFeatureEnabled()) {
      this.logger.log(`AI layer disabled — using rules fallback for run ${runId}`);
      result = runRulesFallback(teamId, runId, responses);
    } else if (responses.length === 0) {
      this.logger.warn(`No responses found for run ${runId}; using rules fallback`);
      result = runRulesFallback(teamId, runId, responses);
    } else {
      try {
        result = await this.runAiExtraction(teamId, runId, responses);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `AI extraction failed for run ${runId}, falling back to rules: ${message}`,
        );
        result = runRulesFallback(teamId, runId, responses);
      }
    }

    await this.saveDigest(result);
    return result;
  }

  private async saveDigest(result: AiDigestResult): Promise<void> {
    try {
      await this.prisma.aiDigest.create({
        data: {
          teamId: result.teamId,
          runId: result.runId,
          generatedAt: new Date(result.generatedAt),
          source: result.source,
          summary: result.summary,
          blockers: result.blockers as any,
          themes: result.themes as any,
        },
      });
      this.logger.log(`Saved AI digest for run ${result.runId} to database`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to save AI digest for run ${result.runId}: ${message}`);
      // Do not throw — saving history is not critical enough to fail the whole request.
    }
  }

  getCostSummary(): { totalCost: number; callCount: number; averageCostPerCall: number | null } {
    return {
      totalCost: this.costAccumulator.getTotalCost(),
      callCount: this.costAccumulator.getCallCount(),
      averageCostPerCall: this.costAccumulator.getAverageCostPerCall(),
    };
  }

  private async runAiExtraction(
    teamId: string,
    runId: string,
    responses: RawResponseForAnalysis[],
  ): Promise<AiDigestResult> {
    const client = getOpenAiClient();
    const model = getOpenAiModel();
    const userPrompt = AI_PROMPT.buildUserPrompt(teamId, runId, responses);

    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: AI_PROMPT.system },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const choice = completion.choices[0];
    if (!choice) {
      throw new Error('OpenAI returned no completion choices');
    }
    if (choice.finish_reason !== 'stop') {
      throw new Error(`OpenAI response did not finish normally: ${choice.finish_reason}`);
    }

    const usage = completion.usage;
    if (usage) {
      const cost = this.costAccumulator.record(model, {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
      });
      this.logger.debug(
        `OpenAI usage for run ${runId}: prompt=${usage.prompt_tokens}, completion=${usage.completion_tokens}, total=${usage.total_tokens}` +
          (cost !== null ? `, cost=$${cost.toFixed(6)}` : ''),
      );
    }

    const rawContent = choice.message.content;
    if (!rawContent) {
      throw new Error('OpenAI returned an empty response');
    }

    const parsed = parseAndValidateAiResponse(rawContent);

    this.logger.log(
      `AI analysis completed successfully for run ${runId} using model ${model}`,
    );

    return {
      teamId,
      runId,
      generatedAt: new Date().toISOString(),
      source: 'ai',
      summary: parsed.summary,
      blockers: parsed.blockers,
      themes: parsed.themes,
    };
  }
}