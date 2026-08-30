import {
  AiProviderRequest,
  AiProviderResponse,
} from '../types/workspace-ai.types';

/**
 * Abstract AI provider contract.
 * Swap OpenAI / Anthropic / local models without changing the UI or orchestrator.
 */
export interface AiProvider {
  readonly name: string;

  isAvailable(): boolean;

  complete(request: AiProviderRequest): Promise<AiProviderResponse>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');
