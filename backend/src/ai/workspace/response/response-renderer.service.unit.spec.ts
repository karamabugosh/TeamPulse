import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from '@jest/globals';
import {
  BuiltContext,
  BuiltContextChunk,
  SourceReference,
  WorkspaceAiIntent,
} from '../types/workspace-ai.types';
import { ResponseRendererService } from './response-renderer.service';

function makeReference(
  overrides: Partial<SourceReference> = {},
): SourceReference {
  return {
    source: 'jira',
    entity: 'jira_issue',
    entityId: 'issue-1',
    timestamp: null,
    workspaceId: 'ws-1',
    url: 'https://jira.example/SCRUM-1',
    label: 'SCRUM-1',
    ...overrides,
  };
}

function makeChunk(
  overrides: Partial<BuiltContextChunk> = {},
): BuiltContextChunk {
  const reference = makeReference(overrides.reference);
  return {
    id: 'chunk-1',
    sourceType: 'jira',
    entity: 'jira_issue',
    title: 'Issue title',
    content: 'body',
    url: null,
    ...overrides,
    reference,
  };
}

function makeContext(overrides: Partial<BuiltContext> = {}): BuiltContext {
  return {
    intent: WorkspaceAiIntent.ISSUE_STATUS,
    chunks: [],
    sections: [],
    contextText: '',
    tokenEstimate: 0,
    insufficientData: false,
    references: [],
    finalSourcesUsed: [],
    ...overrides,
  };
}

describe('ResponseRendererService', () => {
  let service: ResponseRendererService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ResponseRendererService],
    }).compile();

    service = module.get(ResponseRendererService);
  });

  describe('buildCitations', () => {
    it('maps chunks to citations with labeled source types', () => {
      const context = makeContext({
        chunks: [
          makeChunk({
            id: 'c1',
            sourceType: 'slack',
            title: 'Standup note',
            url: 'https://slack.example/1',
          }),
        ],
      });

      const citations = service.buildCitations(context);

      expect(citations).toEqual([
        expect.objectContaining({
          id: 'c1',
          sourceType: 'slack',
          label: 'Slack 1',
          title: 'Standup note',
          url: 'https://slack.example/1',
        }),
      ]);
    });

    it('falls back to reference.url when chunk.url is null', () => {
      const citations = service.buildCitations(
        makeContext({
          chunks: [
            makeChunk({
              url: null,
              reference: makeReference({ url: 'https://from-ref.example' }),
            }),
          ],
        }),
      );

      expect(citations[0].url).toBe('https://from-ref.example');
    });

    it('uses raw sourceType in the label when it is not in SOURCE_LABEL', () => {
      const citations = service.buildCitations(
        makeContext({
          chunks: [
            makeChunk({
              sourceType: 'unknown_source' as never,
              title: 'X',
            }),
          ],
        }),
      );

      expect(citations[0].label).toBe('unknown_source 1');
    });

    it('returns an empty list when there are no chunks', () => {
      expect(service.buildCitations(makeContext())).toEqual([]);
    });
  });

  describe('render', () => {
    it('returns default insufficient message when rawMarkdown is empty', () => {
      const result = service.render({
        rawMarkdown: '   ',
        context: makeContext(),
        insufficientData: true,
      });

      expect(result.markdown).toBe("I couldn't find enough information.");
      expect(result.citations).toEqual([]);
      expect(result.sources).toEqual([]);
    });

    it('returns default message when rawMarkdown is falsy', () => {
      const result = service.render({
        rawMarkdown: '',
        context: makeContext(),
        insufficientData: false,
      });

      expect(result.markdown).toBe("I couldn't find enough information.");
    });

    it('does not append sources section when insufficientData is true', () => {
      const result = service.render({
        rawMarkdown: 'Not enough context.',
        context: makeContext({
          chunks: [makeChunk({ title: 'Hidden' })],
        }),
        insufficientData: true,
      });

      expect(result.markdown).toBe('Not enough context.');
      expect(result.markdown).not.toContain('### Sources');
      expect(result.citations).toHaveLength(1);
    });

    it('appends a Sources section when citations exist and data is sufficient', () => {
      const result = service.render({
        rawMarkdown: 'Here is the status.',
        context: makeContext({
          chunks: [
            makeChunk({
              sourceType: 'jira',
              title: 'SCRUM-1',
              url: 'https://jira.example/SCRUM-1',
            }),
          ],
        }),
        insufficientData: false,
      });

      expect(result.markdown).toContain('Here is the status.');
      expect(result.markdown).toContain('### Sources');
      expect(result.markdown).toContain(
        '- **Jira**: SCRUM-1 — https://jira.example/SCRUM-1',
      );
      expect(result.sources).toEqual(['jira']);
    });

    it('omits the URL suffix in Sources when citation.url is missing', () => {
      const result = service.render({
        rawMarkdown: 'Answer',
        context: makeContext({
          chunks: [
            makeChunk({
              url: null,
              reference: makeReference({ url: null }),
              title: 'No link',
            }),
          ],
        }),
        insufficientData: false,
      });

      expect(result.markdown).toContain('- **Jira**: No link');
      expect(result.markdown).not.toMatch(/No link —/);
    });

    it('deduplicates sources across multiple citations of the same type', () => {
      const result = service.render({
        rawMarkdown: 'Multi',
        context: makeContext({
          chunks: [
            makeChunk({ id: 'a', sourceType: 'slack', title: 'A' }),
            makeChunk({ id: 'b', sourceType: 'slack', title: 'B' }),
            makeChunk({ id: 'c', sourceType: 'reports', title: 'C' }),
          ],
        }),
        insufficientData: false,
      });

      expect(result.sources).toEqual(['slack', 'reports']);
    });

    it('strips markdown syntax in plainText output', () => {
      const result = service.render({
        rawMarkdown:
          '# Title\n\nSee `code` and [link](https://x.test) plus ```block``` text.',
        context: makeContext(),
        insufficientData: true,
      });

      expect(result.plainText).not.toContain('#');
      expect(result.plainText).not.toContain('`');
      expect(result.plainText).toContain('code');
      expect(result.plainText).toContain('link');
      expect(result.plainText).not.toContain('https://x.test');
    });

    it('uses unknown source label in Sources markdown when type is unmapped', () => {
      const result = service.render({
        rawMarkdown: 'Ans',
        context: makeContext({
          chunks: [
            makeChunk({
              sourceType: 'custom_src' as never,
              title: 'Custom',
              url: null,
              reference: makeReference({ url: null }),
            }),
          ],
        }),
        insufficientData: false,
      });

      expect(result.markdown).toContain('- **custom_src**: Custom');
    });
  });
});
