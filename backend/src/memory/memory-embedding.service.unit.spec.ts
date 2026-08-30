import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { OpenAiEmbeddingProvider } from '../ai/workspace/retrieval/openai-embedding.provider';
import { DEFAULT_EMBEDDING_MODEL } from '../ai/workspace/retrieval/embedding.util';
import { MemoryEmbeddingTransientError } from './memory-normalized.types';
import {
  MemoryEmbeddingService,
  memorySourceAdvisoryLockKey,
} from './memory-embedding.service';

describe('MemoryEmbeddingService', () => {
  let service: MemoryEmbeddingService;
  let embeddings: {
    isAvailable: jest.MockedFunction<() => boolean>;
    model: jest.MockedFunction<() => string>;
    embedTexts: jest.MockedFunction<(texts: string[]) => Promise<number[][]>>;
  };

  beforeEach(async () => {
    embeddings = {
      isAvailable: jest.fn<() => boolean>(),
      model: jest.fn<() => string>().mockReturnValue('text-embedding-3-small'),
      embedTexts: jest.fn<(texts: string[]) => Promise<number[][]>>(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryEmbeddingService,
        { provide: OpenAiEmbeddingProvider, useValue: embeddings },
      ],
    }).compile();

    service = module.get(MemoryEmbeddingService);
  });

  describe('isAvailable / model', () => {
    it('delegates availability', () => {
      embeddings.isAvailable.mockReturnValue(true);
      expect(service.isAvailable()).toBe(true);
    });

    it('returns provider model when set', () => {
      expect(service.model()).toBe('text-embedding-3-small');
    });

    it('falls back to DEFAULT_EMBEDDING_MODEL when provider model is empty', () => {
      embeddings.model.mockReturnValue('');
      expect(service.model()).toBe(DEFAULT_EMBEDDING_MODEL);
    });
  });

  describe('embedQuery', () => {
    it('returns null when embeddings are unavailable', async () => {
      embeddings.isAvailable.mockReturnValue(false);
      await expect(service.embedQuery('q')).resolves.toBeNull();
      expect(embeddings.embedTexts).not.toHaveBeenCalled();
    });

    it('returns an embedding result for a non-empty vector', async () => {
      embeddings.isAvailable.mockReturnValue(true);
      embeddings.embedTexts.mockResolvedValue([[0.1, 0.2, 0.3]]);

      const result = await service.embedQuery('hello');

      expect(result).toEqual({
        embedding: [0.1, 0.2, 0.3],
        model: 'text-embedding-3-small',
        dimensions: 3,
        reused: false,
      });
    });

    it('throws MemoryEmbeddingTransientError when the vector is empty', async () => {
      embeddings.isAvailable.mockReturnValue(true);
      embeddings.embedTexts.mockResolvedValue([[]]);

      await expect(service.embedQuery('q')).rejects.toBeInstanceOf(
        MemoryEmbeddingTransientError,
      );
    });

    it('rethrows MemoryEmbeddingTransientError unchanged', async () => {
      embeddings.isAvailable.mockReturnValue(true);
      const err = new MemoryEmbeddingTransientError('already transient');
      embeddings.embedTexts.mockRejectedValue(err);

      await expect(service.embedQuery('q')).rejects.toBe(err);
    });

    it('wraps generic Error messages as MemoryEmbeddingTransientError', async () => {
      embeddings.isAvailable.mockReturnValue(true);
      embeddings.embedTexts.mockRejectedValue(new Error('network down'));

      await expect(service.embedQuery('q')).rejects.toThrow('network down');
      await expect(service.embedQuery('q')).rejects.toBeInstanceOf(
        MemoryEmbeddingTransientError,
      );
    });

    it('wraps non-Error throwables as MemoryEmbeddingTransientError', async () => {
      embeddings.isAvailable.mockReturnValue(true);
      embeddings.embedTexts.mockRejectedValue('boom');

      await expect(service.embedQuery('q')).rejects.toThrow('boom');
    });
  });

  describe('embedChunk', () => {
    it('reuses an existing embedding when hash, model, and dims match', async () => {
      embeddings.isAvailable.mockReturnValue(true);
      const existing = {
        contentHash: 'hash-1',
        embedding: [1, 2, 3, 4],
        embeddingModel: 'text-embedding-3-small',
        embeddingDimensions: 4,
      };

      const result = await service.embedChunk({
        text: 'chunk',
        contentHash: 'hash-1',
        existing,
      });

      expect(result).toEqual({
        embedding: [1, 2, 3, 4],
        model: 'text-embedding-3-small',
        dimensions: 4,
        reused: true,
      });
      expect(embeddings.embedTexts).not.toHaveBeenCalled();
    });

    it('does not reuse when contentHash differs', async () => {
      embeddings.isAvailable.mockReturnValue(false);
      const result = await service.embedChunk({
        text: 'chunk',
        contentHash: 'new',
        existing: {
          contentHash: 'old',
          embedding: [1],
          embeddingModel: 'text-embedding-3-small',
          embeddingDimensions: 1,
        },
      });
      expect(result).toBeNull();
    });

    it('returns null when AI is unavailable and reuse does not apply', async () => {
      embeddings.isAvailable.mockReturnValue(false);
      await expect(
        service.embedChunk({ text: 'x', contentHash: 'h', existing: null }),
      ).resolves.toBeNull();
    });

    it('embeds a fresh chunk when available', async () => {
      embeddings.isAvailable.mockReturnValue(true);
      embeddings.embedTexts.mockResolvedValue([[9, 8]]);

      const result = await service.embedChunk({
        text: 'fresh',
        contentHash: 'h2',
      });

      expect(result).toEqual({
        embedding: [9, 8],
        model: 'text-embedding-3-small',
        dimensions: 2,
        reused: false,
      });
    });

    it('throws when OpenAI returns an empty chunk vector', async () => {
      embeddings.isAvailable.mockReturnValue(true);
      embeddings.embedTexts.mockResolvedValue([null as unknown as number[]]);

      await expect(
        service.embedChunk({ text: 'x', contentHash: 'h' }),
      ).rejects.toBeInstanceOf(MemoryEmbeddingTransientError);
    });

    it('wraps unexpected chunk embed failures', async () => {
      embeddings.isAvailable.mockReturnValue(true);
      embeddings.embedTexts.mockRejectedValue(new Error('rate limit'));

      await expect(
        service.embedChunk({ text: 'x', contentHash: 'h' }),
      ).rejects.toThrow('rate limit');
    });

    it('rethrows transient errors from chunk embed', async () => {
      embeddings.isAvailable.mockReturnValue(true);
      const err = new MemoryEmbeddingTransientError('transient');
      embeddings.embedTexts.mockRejectedValue(err);

      await expect(
        service.embedChunk({ text: 'x', contentHash: 'h' }),
      ).rejects.toBe(err);
    });

    it('wraps non-Error chunk failures', async () => {
      embeddings.isAvailable.mockReturnValue(true);
      embeddings.embedTexts.mockRejectedValue({ code: 42 });

      await expect(
        service.embedChunk({ text: 'x', contentHash: 'h' }),
      ).rejects.toThrow('[object Object]');
    });
  });
});

describe('memorySourceAdvisoryLockKey', () => {
  it('returns a stable signed 32-bit integer for the same inputs', () => {
    const a = memorySourceAdvisoryLockKey('ws', 'BLOCKER', 'id-1');
    const b = memorySourceAdvisoryLockKey('ws', 'BLOCKER', 'id-1');
    expect(a).toBe(b);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(-2147483648);
    expect(a).toBeLessThanOrEqual(2147483647);
  });

  it('differs for different source identities', () => {
    const a = memorySourceAdvisoryLockKey('ws', 'BLOCKER', 'a');
    const b = memorySourceAdvisoryLockKey('ws', 'BLOCKER', 'b');
    expect(a).not.toBe(b);
  });
});
