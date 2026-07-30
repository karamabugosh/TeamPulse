// backend/src/ai/ai.service.ts

import { Injectable, Logger } from '@nestjs/common';
import { AiDigestResult, RawResponseForAnalysis } from './dto/ai-result.dto';
import { AI_PROMPT } from './prompts/pulse-ai.prompts';
import { runRulesFallback } from './rules-fallback';
import { isAiFeatureEnabled } from './ai.config';
import { getOpenAiClient, getOpenAiModel } from './openai-client';
import { parseAndValidateAiResponse } from './ai-response-validator';
import { CostAccumulator } from './cost-tracker';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly costAccumulator = new CostAccumulator();

  async analyzeRun(
    teamId: string,
    runId: string,
    responses: RawResponseForAnalysis[],
  ): Promise<AiDigestResult> {
    if (!isAiFeatureEnabled()) {
      this.logger.log(`AI layer disabled — using rules fallback for run ${runId}`);
      return runRulesFallback(teamId, runId, responses);
    }

    if (responses.length === 0) {
      this.logger.warn(`No responses found for run ${runId}; using rules fallback`);
      return runRulesFallback(teamId, runId, responses);
    }

    try {
      return await this.runAiExtraction(teamId, runId, responses);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `AI extraction failed for run ${runId}, falling back to rules: ${message}`,
      );
      return runRulesFallback(teamId, runId, responses);
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