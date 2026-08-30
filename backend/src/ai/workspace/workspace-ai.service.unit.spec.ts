import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { ConversationMemoryService } from './memory/conversation-memory.service';
import { WorkspacePromptBuilder } from './prompts/workspace-prompt.builder';
import { RagPipelineService } from './rag/rag-pipeline.service';
import { ResponseRendererService } from './response/response-renderer.service';
import {
  BuiltContext,
  RagPrepareResponse,
  RenderedAiResponse,
  WorkspaceAiIntent,
  WorkspaceAskRequest,
} from './types/workspace-ai.types';
import { WorkspaceAiService } from './workspace-ai.service';

describe('WorkspaceAiService', () => {
  let service: WorkspaceAiService;
  let ragPipeline: {
    prepare: jest.MockedFunction<
      (req: WorkspaceAskRequest) => Promise<RagPrepareResponse>
    >;
  };
  let memory: {
    getOrCreate: jest.MockedFunction<
      (args: {
        conversationId?: string | null;
        workspaceId: string;
      }) => { id: string }
    >;
    appendUserTurn: jest.MockedFunction<
      (session: { id: string }, text: string) => void
    >;
  };
  let renderer: {
    render: jest.MockedFunction<
      (args: {
        rawMarkdown: string;
        context: BuiltContext;
        insufficientData: boolean;
      }) => RenderedAiResponse
    >;
  };
  let promptBuilder: { insufficientMessage: string };

  const baseRequest: WorkspaceAskRequest = {
    workspaceId: 'ws-1',
    question: '  What is blocked?  ',
    conversationId: 'conv-1',
  };

  function makeContext(
    overrides: Partial<BuiltContext> = {},
  ): BuiltContext {
    return {
      intent: WorkspaceAiIntent.GET_BLOCKERS,
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

  function makeRag(
    overrides: Partial<RagPrepareResponse> = {},
  ): RagPrepareResponse {
    const { context: contextOverride, ...rest } = overrides;
    return {
      workspaceId: 'ws-1',
      question: 'What is blocked?',
      intent: {
        intent: WorkspaceAiIntent.GET_BLOCKERS,
        confidence: 0.9,
        filters: {},
        rationale: 'blockers',
      },
      retrieval: {
        hitCount: 2,
        filters: {},
        hits: [],
        references: [],
        diagnostics: { sources: [], summary: 'ok' },
      },
      prompt: {
        system: 'sys',
        user: 'usr',
        intent: WorkspaceAiIntent.GET_BLOCKERS,
        messages: [],
      },
      generation: {
        status: 'ready_for_openai',
        message: 'not called',
      },
      ...rest,
      context: makeContext(contextOverride),
    };
  }

  beforeEach(async () => {
    ragPipeline = {
      prepare: jest.fn<(req: WorkspaceAskRequest) => Promise<RagPrepareResponse>>(),
    };
    memory = {
      getOrCreate: jest
        .fn<
          (args: {
            conversationId?: string | null;
            workspaceId: string;
          }) => { id: string }
        >()
        .mockReturnValue({ id: 'session-1' }),
      appendUserTurn: jest.fn<(session: { id: string }, text: string) => void>(),
    };
    renderer = {
      render: jest.fn<
        (args: {
          rawMarkdown: string;
          context: BuiltContext;
          insufficientData: boolean;
        }) => RenderedAiResponse
      >(),
    };
    promptBuilder = { insufficientMessage: 'NO_INFO' };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceAiService,
        { provide: RagPipelineService, useValue: ragPipeline },
        { provide: ConversationMemoryService, useValue: memory },
        { provide: ResponseRendererService, useValue: renderer },
        { provide: WorkspacePromptBuilder, useValue: promptBuilder },
      ],
    }).compile();

    service = module.get(WorkspaceAiService);
  });

  describe('prepareRag', () => {
    it('delegates to ragPipeline.prepare and returns its result', async () => {
      const rag = makeRag();
      ragPipeline.prepare.mockResolvedValue(rag);

      const result = await service.prepareRag(baseRequest);

      expect(result).toBe(rag);
      expect(ragPipeline.prepare).toHaveBeenCalledWith(baseRequest);
      expect(memory.getOrCreate).not.toHaveBeenCalled();
    });

    it('propagates pipeline failures', async () => {
      ragPipeline.prepare.mockRejectedValue(new Error('rag failed'));

      await expect(service.prepareRag(baseRequest)).rejects.toThrow(
        'rag failed',
      );
    });
  });

  describe('ask', () => {
    it('returns a null answer when context has sufficient data', async () => {
      const rag = makeRag({
        context: makeContext({ insufficientData: false, contextText: 'data' }),
      });
      ragPipeline.prepare.mockResolvedValue(rag);

      const result = await service.ask(baseRequest);

      expect(result).toEqual({
        conversationId: 'session-1',
        intent: WorkspaceAiIntent.GET_BLOCKERS,
        answer: null,
        insufficientData: false,
        provider: 'rag-prepare',
        model: null,
        rag,
      });
      expect(memory.getOrCreate).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        workspaceId: 'ws-1',
      });
      expect(memory.appendUserTurn).toHaveBeenCalledWith(
        { id: 'session-1' },
        'What is blocked?',
      );
      expect(renderer.render).not.toHaveBeenCalled();
    });

    it('renders an insufficient-data answer when context.insufficientData is true', async () => {
      const rag = makeRag({
        context: makeContext({
          intent: WorkspaceAiIntent.ISSUE_STATUS,
          insufficientData: true,
        }),
        intent: {
          intent: WorkspaceAiIntent.ISSUE_STATUS,
          confidence: 0.5,
          filters: {},
          rationale: 'status',
        },
      });
      const rendered: RenderedAiResponse = {
        markdown: 'NO_INFO',
        plainText: 'NO_INFO',
        citations: [],
        sources: [],
      };
      ragPipeline.prepare.mockResolvedValue(rag);
      renderer.render.mockReturnValue(rendered);

      const result = await service.ask({
        workspaceId: 'ws-1',
        question: 'status?',
      });

      expect(result.answer).toBe(rendered);
      expect(result.insufficientData).toBe(true);
      expect(result.intent).toBe(WorkspaceAiIntent.ISSUE_STATUS);
      expect(renderer.render).toHaveBeenCalledWith({
        rawMarkdown: 'NO_INFO',
        context: rag.context,
        insufficientData: true,
      });
    });

    it('propagates prepare failures from ask', async () => {
      ragPipeline.prepare.mockRejectedValue(new Error('prepare boom'));

      await expect(service.ask(baseRequest)).rejects.toThrow('prepare boom');
      expect(memory.getOrCreate).not.toHaveBeenCalled();
    });
  });
});
