import { createHash } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { MemoryVisibility } from '@prisma/client';
import {
  hashChunkContent,
  MemoryChunkerService,
  sectionsFromNormalized,
} from './memory-chunker.service';
import { MEMORY_WORKER_CONFIG } from './memory.config';
import { MEMORY_SOURCE } from './memory-source.constants';
import { NormalizedMemorySource } from './memory-normalized.types';

function makeSource(
  overrides: Partial<NormalizedMemorySource> = {},
): NormalizedMemorySource {
  return {
    workspaceId: 'ws-1',
    sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
    sourceId: 'src-1',
    title: 'Standup Answer',
    text: 'Default body text for memory chunking.',
    ownerUserId: 'user-1',
    teamId: 'team-1',
    linkedIssueKey: null,
    visibility: MemoryVisibility.WORKSPACE,
    metadata: {},
    ...overrides,
  };
}

/** Strip the `title\n\nbody` header prefix from prepared chunk text. */
function chunkBody(chunkText: string): string {
  const separator = chunkText.indexOf('\n\n');
  return separator >= 0 ? chunkText.slice(separator + 2) : chunkText;
}

describe('MemoryChunkerService', () => {
  let service: MemoryChunkerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MemoryChunkerService],
    }).compile();

    service = module.get(MemoryChunkerService);
  });

  describe('prepareChunks', () => {
    describe('normal inputs', () => {
      it('returns a single chunk for short body text under the max character limit', () => {
        // Arrange
        const source = makeSource({
          text: 'Shipped the auth fix and started on reporting.',
        });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks).toHaveLength(1);
        expect(chunks[0].chunkIndex).toBe(0);
        expect(chunks[0].title).toBe('Standup Answer');
        expect(chunks[0].text).toBe(
          'Standup Answer\n\nShipped the auth fix and started on reporting.',
        );
        expect(chunks[0].contentHash).toBe(hashChunkContent(chunks[0].text));
      });

      it('chunks each non-empty section separately when sections are provided', () => {
        // Arrange
        const source = makeSource({
          text: 'ignored when sections exist',
          sections: [
            { key: 'summary', title: 'Summary', text: 'Team is on track.' },
            { key: 'blockers', title: 'Blockers', text: 'Waiting on design review.' },
          ],
        });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks).toHaveLength(2);
        expect(chunks[0].title).toBe('Summary');
        expect(chunks[0].text).toContain('Team is on track.');
        expect(chunks[1].title).toBe('Blockers');
        expect(chunks[1].text).toContain('Waiting on design review.');
        expect(chunks[0].chunkIndex).toBe(0);
        expect(chunks[1].chunkIndex).toBe(1);
      });

      it('uses the source title when a section has no title', () => {
        // Arrange
        const source = makeSource({
          title: 'Daily Report',
          sections: [{ key: 'body', text: 'Report content here.' }],
        });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks[0].title).toBe('Daily Report');
      });
    });

    describe('empty input', () => {
      it('returns an empty array when body text is blank and no sections are provided', () => {
        // Arrange
        const source = makeSource({ text: '   ' });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks).toEqual([]);
      });

      it('returns an empty array when all sections contain only whitespace', () => {
        // Arrange
        const source = makeSource({
          sections: [
            { key: 'a', title: 'A', text: '  ' },
            { key: 'b', title: 'B', text: '\n\t' },
          ],
        });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks).toEqual([]);
      });

      it('falls back to body text when sections array is empty', () => {
        // Arrange
        const source = makeSource({
          text: 'Body-only content.',
          sections: [],
        });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks).toHaveLength(1);
        expect(chunks[0].text).toContain('Body-only content.');
      });
    });

    describe('null or undefined handling', () => {
      it('treats undefined sections as body-only input', () => {
        // Arrange
        const source = makeSource({
          text: 'Standalone body.',
          sections: undefined,
        });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks).toHaveLength(1);
        expect(chunks[0].text).toContain('Standalone body.');
      });

      it('throws when source is null at runtime', () => {
        // Arrange
        const invalidSource = null as unknown as NormalizedMemorySource;

        // Act & Assert
        expect(() => service.prepareChunks(invalidSource)).toThrow();
      });

      it('throws when source is undefined at runtime', () => {
        // Arrange
        const invalidSource = undefined as unknown as NormalizedMemorySource;

        // Act & Assert
        expect(() => service.prepareChunks(invalidSource)).toThrow();
      });
    });

    describe('boundary conditions', () => {
      it('keeps text in a single chunk when length equals maxChunkChars exactly', () => {
        // Arrange
        const exactLengthText = 'x'.repeat(MEMORY_WORKER_CONFIG.maxChunkChars);
        const source = makeSource({ text: exactLengthText });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks).toHaveLength(1);
        expect(chunkBody(chunks[0].text)).toHaveLength(
          MEMORY_WORKER_CONFIG.maxChunkChars,
        );
      });

      it('splits into multiple chunks when text exceeds maxChunkChars by one character', () => {
        // Arrange
        const overLimitText = 'x'.repeat(MEMORY_WORKER_CONFIG.maxChunkChars + 1);
        const source = makeSource({ text: overLimitText });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks[0].title).toMatch(/part 1\//);
      });
    });

    describe('large text and chunk overlap', () => {
      it('splits long body text into multiple numbered parts', () => {
        // Arrange
        const longText = `${'Long segment. '.repeat(300)}Final sentence.`;
        const source = makeSource({ text: longText });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks[0].title).toMatch(
          /Standup Answer \(body part 1\/\d+\)/,
        );
        expect(chunks.at(-1)?.title).toMatch(/part \d+\/\d+\)$/);
      });

      it('applies configured overlap between consecutive chunk bodies', () => {
        // Arrange
        const longText = 'alpha '.repeat(700);
        const source = makeSource({ text: longText });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks.length).toBeGreaterThan(1);
        const firstBody = chunkBody(chunks[0].text);
        const secondBody = chunkBody(chunks[1].text);
        const overlap = MEMORY_WORKER_CONFIG.chunkOverlapChars;
        const firstTail = firstBody.slice(-overlap);
        expect(secondBody.startsWith(firstTail.trim().slice(0, 20))).toBe(true);
      });

      it('normalizes Windows line endings before splitting', () => {
        // Arrange
        const crlfText = `intro\r\n\r\n${'detail '.repeat(500)}`;
        const source = makeSource({ text: crlfText });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks.every((chunk) => !chunk.text.includes('\r\n'))).toBe(true);
      });
    });

    describe('deterministic split break points', () => {
      it('prefers paragraph breaks when splitting long section text', () => {
        // Arrange
        const prefix = 'A'.repeat(MEMORY_WORKER_CONFIG.maxChunkChars - 40);
        const sectionText = `${prefix}\n\nSecond paragraph with more content. ${'word '.repeat(200)}`;
        const source = makeSource({
          sections: [{ key: 'report', title: 'Report', text: sectionText }],
        });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunkBody(chunks[0].text)).toMatch(/\n\nSecond paragraph/);
      });

      it('falls back to hard splits when no break point exceeds 40% of the window', () => {
        // Arrange
        const noBreakText = 'z'.repeat(MEMORY_WORKER_CONFIG.maxChunkChars + 500);
        const source = makeSource({ text: noBreakText });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks[0].title).toMatch(/part 1\//);
      });

      it('breaks on single newlines when no paragraph break is available', () => {
        // Arrange
        const line = `${'L'.repeat(200)}\n`;
        const sectionText = line.repeat(12);
        const source = makeSource({ text: sectionText });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks.length).toBeGreaterThan(1);
      });

      it('breaks on sentence boundaries when spaces are sparse in the window tail', () => {
        // Arrange
        const sentence = `${'S'.repeat(150)}. `;
        const sectionText = sentence.repeat(20);
        const source = makeSource({ text: sectionText });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks.length).toBeGreaterThan(1);
      });
    });

    describe('hash generation', () => {
      it('assigns a SHA-256 hex digest as contentHash for each chunk', () => {
        // Arrange
        const source = makeSource({ text: 'Hash me.' });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
        expect(chunks[0].contentHash).toBe(
          createHash('sha256').update(chunks[0].text).digest('hex'),
        );
      });

      it('produces different hashes for different chunk text', () => {
        // Arrange
        const sourceA = makeSource({ text: 'Chunk A content.' });
        const sourceB = makeSource({ text: 'Chunk B content.' });

        // Act
        const [chunkA] = service.prepareChunks(sourceA);
        const [chunkB] = service.prepareChunks(sourceB);

        // Assert
        expect(chunkA.contentHash).not.toBe(chunkB.contentHash);
      });
    });

    describe('edge cases', () => {
      it('trims surrounding whitespace from body text before chunking', () => {
        // Arrange
        const source = makeSource({ text: '  trimmed content  ' });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks[0].text).toBe('Standup Answer\n\ntrimmed content');
      });

      it('trims surrounding whitespace from section text before chunking', () => {
        // Arrange
        const source = makeSource({
          sections: [{ key: 'note', title: 'Note', text: '  section body  ' }],
        });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks[0].text).toBe('Note\n\nsection body');
      });

      it('uses a trimmed section title when provided with surrounding whitespace', () => {
        // Arrange
        const source = makeSource({
          sections: [{ key: 'note', title: '  Trimmed Title  ', text: 'Body' }],
        });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks[0].title).toBe('Trimmed Title');
      });

      it('assigns sequential chunkIndex values across multiple sections', () => {
        // Arrange
        const longPart = 'segment '.repeat(400);
        const source = makeSource({
          sections: [
            { key: 'first', title: 'First', text: longPart },
            { key: 'second', title: 'Second', text: 'Short section.' },
          ],
        });

        // Act
        const chunks = service.prepareChunks(source);

        // Assert
        expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual(
          chunks.map((_, index) => index),
        );
      });
    });
  });
});

describe('hashChunkContent', () => {
  it('returns a deterministic SHA-256 hex digest for the same input', () => {
    // Arrange
    const input = 'deterministic-chunk-content';

    // Act
    const first = hashChunkContent(input);
    const second = hashChunkContent(input);

    // Assert
    expect(first).toBe(second);
    expect(first).toBe(
      createHash('sha256').update(input).digest('hex'),
    );
  });

  it('returns different digests for different inputs', () => {
    // Arrange & Act
    const hashA = hashChunkContent('input-a');
    const hashB = hashChunkContent('input-b');

    // Assert
    expect(hashA).not.toBe(hashB);
  });

  it('returns the known SHA-256 digest for a canonical string', () => {
    // Arrange
    const input = 'hello';

    // Act
    const digest = hashChunkContent(input);

    // Assert
    expect(digest).toBe(
      createHash('sha256').update(input).digest('hex'),
    );
  });
});

describe('sectionsFromNormalized', () => {
  it('returns existing sections when the source has one or more sections', () => {
    // Arrange
    const sections = [
      { key: 'summary', title: 'Summary', text: 'Summary text.' },
    ];
    const source = makeSource({ sections });

    // Act
    const result = sectionsFromNormalized(source);

    // Assert
    expect(result).toBe(sections);
  });

  it('returns a synthetic body section when sections are absent', () => {
    // Arrange
    const source = makeSource({
      title: 'Fallback Title',
      text: 'Fallback body.',
      sections: undefined,
    });

    // Act
    const result = sectionsFromNormalized(source);

    // Assert
    expect(result).toEqual([
      { key: 'body', title: 'Fallback Title', text: 'Fallback body.' },
    ]);
  });

  it('returns a synthetic body section when sections array is empty', () => {
    // Arrange
    const source = makeSource({
      title: 'Empty Sections',
      text: 'Uses body fallback.',
      sections: [],
    });

    // Act
    const result = sectionsFromNormalized(source);

    // Assert
    expect(result).toEqual([
      { key: 'body', title: 'Empty Sections', text: 'Uses body fallback.' },
    ]);
  });
});
