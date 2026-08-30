import { Injectable, Logger } from '@nestjs/common';
import { isAiFeatureEnabled } from '../../ai.config';
import { getOpenAiClient } from '../../openai-client';
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
} from '../retrieval/embedding.util';

/**
 * OpenAI embeddings for hybrid RAG.
 * Disabled gracefully when PULSE_AI / API key are not configured.
 */
@Injectable()
export class OpenAiEmbeddingProvider {
  private readonly logger = new Logger(OpenAiEmbeddingProvider.name);

  isAvailable(): boolean {
    return isAiFeatureEnabled();
  }

  model(): string {
    return (
      process.env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL
    );
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (!this.isAvailable()) {
      return texts.map(() => []);
    }
    const cleaned = texts.map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 8000));
    if (cleaned.every((t) => !t)) {
      return cleaned.map(() => []);
    }

    const client = getOpenAiClient();
    const response = await client.embeddings.create({
      model: this.model(),
      input: cleaned.map((t) => t || ' '),
    });

    const byIndex = new Map<number, number[]>();
    for (const row of response.data) {
      byIndex.set(row.index, row.embedding);
    }

    const vectors = cleaned.map((_, index) => byIndex.get(index) ?? []);
    const dims = vectors.find((v) => v.length > 0)?.length ?? DEFAULT_EMBEDDING_DIMENSIONS;
    this.logger.log(
      `Embedded ${texts.length} text(s) model=${this.model()} dims=${dims}`,
    );
    return vectors;
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embedTexts([text]);
    return vector ?? [];
  }
}
