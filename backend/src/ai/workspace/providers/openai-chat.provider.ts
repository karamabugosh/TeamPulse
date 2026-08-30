import { Injectable, Logger } from '@nestjs/common';
import { isAiFeatureEnabled, getAiConfigStatus } from '../../ai.config';
import { getOpenAiClient, getOpenAiModel } from '../../openai-client';
import { AiProvider } from './ai-provider.interface';
import {
  AiProviderRequest,
  AiProviderResponse,
} from '../types/workspace-ai.types';

/**
 * OpenAI chat completions provider for workspace Q&A.
 * Only used when PULSE_AI_ENABLED=true and OPENAI_API_KEY is set.
 */
@Injectable()
export class OpenAiChatProvider implements AiProvider {
  readonly name = 'openai';
  private readonly logger = new Logger(OpenAiChatProvider.name);

  isAvailable(): boolean {
    return isAiFeatureEnabled();
  }

  async complete(request: AiProviderRequest): Promise<AiProviderResponse> {
    if (!this.isAvailable()) {
      const status = getAiConfigStatus();
      throw new Error(
        `OpenAI provider unavailable (enabled=${status.enabled}, apiKeyConfigured=${status.apiKeyConfigured})`,
      );
    }

    const client = getOpenAiClient();
    const model = getOpenAiModel();

    const history = request.history ?? [];
    const messages = [...history, ...request.messages].map((message) => ({
      role: message.role,
      content: message.content,
    }));

    this.logger.log(
      `OpenAI workspace chat model=${model} messages=${messages.length}`,
    );

    const completion = await client.chat.completions.create({
      model,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? 1200,
      messages,
    });

    const content = completion.choices[0]?.message?.content?.trim() ?? '';
    if (!content) {
      throw new Error('OpenAI returned an empty response');
    }

    return {
      content,
      model,
      provider: this.name,
      usage: {
        promptTokens: completion.usage?.prompt_tokens,
        completionTokens: completion.usage?.completion_tokens,
        totalTokens: completion.usage?.total_tokens,
      },
    };
  }
}
