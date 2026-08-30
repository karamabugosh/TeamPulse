import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { OpenAiEmbeddingProvider } from '../ai/workspace/retrieval/openai-embedding.provider';
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
} from '../ai/workspace/retrieval/embedding.util';
import { MemoryEmbeddingTransientError } from './memory-normalized.types';

export type MemoryEmbeddingResult = {
  embedding: number[];
  model: string;
  dimensions: number;
  reused: boolean;
};

@Injectable()
export class MemoryEmbeddingService {
  private readonly logger = new Logger(MemoryEmbeddingService.name);

  constructor(private readonly embeddings: OpenAiEmbeddingProvider) {}

  isAvailable(): boolean {
    return this.embeddings.isAvailable();
  }

  model(): string {
    return this.embeddings.model() || DEFAULT_EMBEDDING_MODEL;
  }

  async embedQuery(text: string): Promise<MemoryEmbeddingResult | null> {
    if (!this.isAvailable()) {
      return null;
    }
    try {
      const [vector] = await this.embeddings.embedTexts([text]);
      if (!vector || vector.length === 0) {
        throw new MemoryEmbeddingTransientError(
          'OpenAI query embedding returned empty vector',
        );
      }
      return {
        embedding: vector,
        model: this.model(),
        dimensions: vector.length || DEFAULT_EMBEDDING_DIMENSIONS,
        reused: false,
      };
    } catch (error) {
      if (error instanceof MemoryEmbeddingTransientError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new MemoryEmbeddingTransientError(message);
    }
  }

  /**
   * Embed chunk text. Reuses existing vector when hash/model/dims match.
   * When AI is disabled: returns null embedding (caller may still persist chunks).
   * When AI is enabled but API returns empty/throws: transient error for retry.
   */
  async embedChunk(params: {
    text: string;
    contentHash: string;
    existing?: {
      contentHash: string;
      embedding: unknown;
      embeddingModel: string | null;
      embeddingDimensions: number | null;
    } | null;
  }): Promise<MemoryEmbeddingResult | null> {
    const model = this.model();

    if (
      params.existing &&
      params.existing.contentHash === params.contentHash &&
      params.existing.embeddingModel === model &&
      Array.isArray(params.existing.embedding) &&
      params.existing.embedding.length > 0 &&
      (params.existing.embeddingDimensions ?? 0) ===
        (params.existing.embedding as number[]).length
    ) {
      const vector = params.existing.embedding as number[];
      return {
        embedding: vector,
        model,
        dimensions: vector.length,
        reused: true,
      };
    }

    if (!this.isAvailable()) {
      this.logger.warn(
        'Memory embeddings skipped — PULSE_AI / OPENAI_API_KEY not enabled',
      );
      return null;
    }

    try {
      const [vector] = await this.embeddings.embedTexts([params.text]);
      if (!vector || vector.length === 0) {
        throw new MemoryEmbeddingTransientError(
          'OpenAI embedding returned empty vector',
        );
      }
      return {
        embedding: vector,
        model,
        dimensions: vector.length || DEFAULT_EMBEDDING_DIMENSIONS,
        reused: false,
      };
    } catch (error) {
      if (error instanceof MemoryEmbeddingTransientError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new MemoryEmbeddingTransientError(message);
    }
  }
}

/** Stable int32 advisory lock key for same-source serialization. */
export function memorySourceAdvisoryLockKey(
  workspaceId: string,
  sourceType: string,
  sourceId: string,
): number {
  const hex = createHash('sha256')
    .update(`${workspaceId}|${sourceType}|${sourceId}`)
    .digest('hex')
    .slice(0, 8);
  // signed 32-bit
  return (parseInt(hex, 16) | 0);
}
