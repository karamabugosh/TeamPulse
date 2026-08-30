import { Injectable, Logger } from '@nestjs/common';
import { RagPipelineService } from './rag/rag-pipeline.service';
import { ConversationMemoryService } from './memory/conversation-memory.service';
import { ResponseRendererService } from './response/response-renderer.service';
import { WorkspacePromptBuilder } from './prompts/workspace-prompt.builder';
import {
  WorkspaceAskRequest,
  WorkspaceAskResponse,
} from './types/workspace-ai.types';

/**
 * Workspace AI façade.
 *
 * Current phase: RAG prepare only (knowledge → intent → retrieval → context → prompt).
 * OpenAI generation is intentionally NOT invoked here.
 */
@Injectable()
export class WorkspaceAiService {
  private readonly logger = new Logger(WorkspaceAiService.name);

  constructor(
    private readonly ragPipeline: RagPipelineService,
    private readonly memory: ConversationMemoryService,
    private readonly renderer: ResponseRendererService,
    private readonly promptBuilder: WorkspacePromptBuilder,
  ) {}

  /**
   * Prepare RAG package for a question. Does not generate an AI answer.
   */
  async prepareRag(request: WorkspaceAskRequest) {
    return this.ragPipeline.prepare(request);
  }

  /**
   * Legacy entrypoint — returns RAG prepare + empty answer stub.
   * No OpenAI / no fabricated summaries.
   */
  async ask(request: WorkspaceAskRequest): Promise<WorkspaceAskResponse> {
    const rag = await this.ragPipeline.prepare(request);

    const session = this.memory.getOrCreate({
      conversationId: request.conversationId,
      workspaceId: rag.workspaceId,
    });
    this.memory.appendUserTurn(session, request.question.trim());

    this.logger.log(
      `Workspace ask (RAG-only) intent=${rag.intent.intent} hits=${rag.retrieval.hitCount}`,
    );

    const answer = rag.context.insufficientData
      ? this.renderer.render({
          rawMarkdown: this.promptBuilder.insufficientMessage,
          context: rag.context,
          insufficientData: true,
        })
      : null;

    return {
      conversationId: session.id,
      intent: rag.intent.intent,
      answer,
      insufficientData: rag.context.insufficientData,
      provider: 'rag-prepare',
      model: null,
      rag,
    };
  }
}
