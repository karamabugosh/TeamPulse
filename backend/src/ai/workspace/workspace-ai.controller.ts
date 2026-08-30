import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { WorkspaceAiService } from './workspace-ai.service';
import { AiChatService } from './chat/ai-chat.service';
import { ReportGenerationService } from './report/report-generation.service';
import { ConversationHistoryService } from './memory/conversation-history.service';
import { EmbeddingReindexService } from './retrieval/embedding-reindex.service';
import { KnowledgeEmbeddingService } from './retrieval/knowledge-embedding.service';
import { PgVectorSupportService } from './retrieval/pgvector-support.service';
import { AiSlackExportService } from './slack/ai-slack-export.service';
import { SlackExportSendRequest } from './slack/ai-slack-export.types';
import { getAiConfigStatus } from '../ai.config';
import {
  WorkspaceAskRequest,
  WorkspaceReportType,
} from './types/workspace-ai.types';

@Controller('ai/workspace')
export class WorkspaceAiController {
  constructor(
    private readonly workspaceAi: WorkspaceAiService,
    private readonly aiChat: AiChatService,
    private readonly reports: ReportGenerationService,
    private readonly history: ConversationHistoryService,
    private readonly embeddingReindex: EmbeddingReindexService,
    private readonly embeddings: KnowledgeEmbeddingService,
    private readonly pgvector: PgVectorSupportService,
    private readonly slackExport: AiSlackExportService,
  ) {}

  @Get('health')
  health() {
    const status = getAiConfigStatus();
    return {
      ok: true,
      architecture: 'rag-openai-chat+dynamic-reports+hybrid-embeddings+pgvector-ready',
      phase: 'vector-search',
      openai: {
        enabled: status.enabled,
        apiKeyConfigured: status.apiKeyConfigured,
        model: status.model,
      },
      vectorSearch: {
        embeddingsEnabled: this.embeddings.isEnabled(),
        backend: this.pgvector.getBackend(),
        pgvectorAvailable: this.pgvector.isPgVectorAvailable(),
      },
      layers: [
        'knowledge',
        'retrieval',
        'hybrid_embeddings',
        'pgvector_or_json',
        'embedding_reindex',
        'intent',
        'context',
        'prompt',
        'openai_provider',
        'response_formatter',
        'source_references',
        'report_generation',
        'vacation_catchup',
        'project_detective',
        'conversation_history',
        'send_to_slack',
        'evaluation',
      ],
      reportTypes: Object.values(WorkspaceReportType),
    };
  }

  @Get('conversations')
  listConversations(
    @Query('workspaceId') workspaceId?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
  ) {
    return this.history.list({
      workspaceId,
      limit: limit ? Number(limit) : 40,
      q,
    });
  }

  @Get('conversations/:id')
  getConversation(
    @Param('id') id: string,
    @Query('workspaceId') workspaceId?: string,
  ) {
    return this.history.get({ conversationId: id, workspaceId });
  }

  @Delete('conversations/:id')
  deleteConversation(
    @Param('id') id: string,
    @Query('workspaceId') workspaceId?: string,
  ) {
    return this.history.delete({ conversationId: id, workspaceId });
  }

  @Post('embeddings/reindex')
  reindexEmbeddings(@Body() body: { workspaceId?: string | null }) {
    if (!body?.workspaceId?.trim()) {
      throw new BadRequestException('workspaceId is required');
    }
    return this.embeddingReindex.reindexWorkspace(
      body.workspaceId.trim(),
      'api',
    );
  }

  @Get('slack/destinations')
  listSlackDestinations(@Query('workspaceId') workspaceId?: string) {
    return this.slackExport.listDestinations({ workspaceId });
  }

  @Post('slack/send')
  sendToSlack(@Body() body: SlackExportSendRequest) {
    if (!body?.destinationType) {
      throw new BadRequestException('destinationType is required');
    }
    if (!body?.contentType) {
      throw new BadRequestException('contentType is required');
    }
    if (!body?.title?.trim() && !body?.report) {
      throw new BadRequestException('title or report is required');
    }
    return this.slackExport.send(body);
  }

  /**
   * Production chat — RAG + OpenAI grounded answer (also routes report requests).
   */
  @Post('chat')
  chat(@Body() body: WorkspaceAskRequest) {
    if (!body?.question?.trim()) {
      throw new BadRequestException('question is required');
    }
    return this.aiChat.chat({
      workspaceId: body.workspaceId,
      conversationId: body.conversationId,
      question: body.question,
      reportType: body.reportType,
      focusUserName: body.focusUserName,
    });
  }

  /**
   * Explicit dynamic report generation from real workspace metrics.
   */
  @Post('reports/generate')
  async generateReport(
    @Body()
    body: WorkspaceAskRequest & { reportType?: WorkspaceReportType | null },
  ) {
    if (!body?.question?.trim() && !body?.reportType) {
      throw new BadRequestException('question or reportType is required');
    }
    const question =
      body.question?.trim() ||
      `Generate ${body.reportType ?? 'daily'} report`;
    return this.reports.generate({
      workspaceId: body.workspaceId,
      conversationId: body.conversationId,
      question,
      reportType: body.reportType,
    });
  }

  @Post('rag/prepare')
  prepare(@Body() body: WorkspaceAskRequest) {
    if (!body?.question?.trim()) {
      throw new BadRequestException('question is required');
    }
    return this.workspaceAi.prepareRag({
      workspaceId: body.workspaceId,
      conversationId: body.conversationId,
      question: body.question,
    });
  }

  /** Compatibility: same as /chat */
  @Post('ask')
  ask(@Body() body: WorkspaceAskRequest) {
    if (!body?.question?.trim()) {
      throw new BadRequestException('question is required');
    }
    return this.aiChat.chat({
      workspaceId: body.workspaceId,
      conversationId: body.conversationId,
      question: body.question,
      reportType: body.reportType,
      focusUserName: body.focusUserName,
    });
  }
}
