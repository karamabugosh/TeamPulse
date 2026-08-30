import { Injectable } from '@nestjs/common';
import { AiProvider } from './ai-provider.interface';
import {
  AiProviderRequest,
  AiProviderResponse,
} from '../types/workspace-ai.types';

/**
 * Fallback provider when no LLM is configured.
 * Never invents answers — returns the grounded insufficient-data message only.
 */
@Injectable()
export class UnavailableAiProvider implements AiProvider {
  readonly name = 'unavailable';

  private readonly insufficientMessage =
    "I couldn't find enough information.";

  isAvailable(): boolean {
    return false;
  }

  async complete(_request: AiProviderRequest): Promise<AiProviderResponse> {
    return {
      content: this.insufficientMessage,
      model: 'none',
      provider: this.name,
    };
  }
}
