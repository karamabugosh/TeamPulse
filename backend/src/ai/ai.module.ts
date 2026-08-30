// backend/src/ai/ai.module.ts

import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { WorkspaceAiController } from './workspace/workspace-ai.controller';
import { WorkspaceAiService } from './workspace/workspace-ai.service';
import { AiChatService } from './workspace/chat/ai-chat.service';
import { WorkspaceKnowledgeService } from './workspace/knowledge/workspace-knowledge.service';
import { WorkspaceRetrievalService } from './workspace/retrieval/workspace-retrieval.service';
import { WorkspaceSearchService } from './workspace/search/workspace-search.service';
import { IntentDetectionService } from './workspace/intent/intent-detection.service';
import { ContextBuilderService } from './workspace/context/context-builder.service';
import { WorkspacePromptBuilder } from './workspace/prompts/workspace-prompt.builder';
import { ConversationMemoryService } from './workspace/memory/conversation-memory.service';
import { ResponseRendererService } from './workspace/response/response-renderer.service';
import { ChatResponseFormatter } from './workspace/response/chat-response.formatter';
import { RagPipelineService } from './workspace/rag/rag-pipeline.service';
import { LatestStandupResolverService } from './workspace/retrieval/latest-standup-resolver.service';
import { OpenAiChatProvider } from './workspace/providers/openai-chat.provider';
import { UnavailableAiProvider } from './workspace/providers/unavailable-ai.provider';
import { ReportGenerationService } from './workspace/report/report-generation.service';
import { ReportMetricsService } from './workspace/report/report-metrics.service';
import { VacationCatchupService } from './workspace/report/vacation-catchup.service';
import { EvidenceCollectorService } from './workspace/analysis/evidence-collector.service';
import { TimelineBuilderService } from './workspace/analysis/timeline-builder.service';
import { PatternDetectorService } from './workspace/analysis/pattern-detector.service';
import {
  DecisionReplayAnalyzer,
  ProjectDetectiveAnalyzer,
} from './workspace/analysis/project-detective.analyzers';
import { AnalysisOrchestratorService } from './workspace/analysis/analysis-orchestrator.service';
import { OpenAiEmbeddingProvider } from './workspace/retrieval/openai-embedding.provider';
import { KnowledgeEmbeddingService } from './workspace/retrieval/knowledge-embedding.service';
import { EmbeddingReindexService } from './workspace/retrieval/embedding-reindex.service';
import { ConversationHistoryService } from './workspace/memory/conversation-history.service';
import { AiSlackExportService } from './workspace/slack/ai-slack-export.service';
import { AiEvalDatasetService } from './workspace/evaluation/ai-eval-dataset.service';
import { AiEvalRunnerService } from './workspace/evaluation/ai-eval-runner.service';
import { AiEvalExportService } from './workspace/evaluation/ai-eval-export.service';
import { AiEvalController } from './workspace/evaluation/ai-eval.controller';
import { PgVectorSupportService } from './workspace/retrieval/pgvector-support.service';
import { JiraModule } from '../jira/jira.module';
import { SlackMemberCacheModule } from '../slack/slack-member-cache.module';

/**
 * AI module
 * - Legacy standup digest analysis (`AiService`)
 * - RAG + hybrid embeddings + OpenAI workspace chat
 * - Background embedding reindex
 * - Persisted conversation history
 * - Send to Slack exports
 * - Evaluation framework (does not modify chat flow)
 */
@Module({
  imports: [PrismaModule, AnalyticsModule, JiraModule, SlackMemberCacheModule],
  controllers: [AiController, WorkspaceAiController, AiEvalController],
  providers: [
    AiService,
    WorkspaceAiService,
    AiChatService,
    RagPipelineService,
    LatestStandupResolverService,
    WorkspaceKnowledgeService,
    WorkspaceRetrievalService,
    WorkspaceSearchService,
    IntentDetectionService,
    ContextBuilderService,
    WorkspacePromptBuilder,
    ConversationMemoryService,
    ConversationHistoryService,
    ResponseRendererService,
    ChatResponseFormatter,
    OpenAiChatProvider,
    UnavailableAiProvider,
    OpenAiEmbeddingProvider,
    KnowledgeEmbeddingService,
    PgVectorSupportService,
    EmbeddingReindexService,
    ReportMetricsService,
    ReportGenerationService,
    VacationCatchupService,
    EvidenceCollectorService,
    TimelineBuilderService,
    PatternDetectorService,
    ProjectDetectiveAnalyzer,
    DecisionReplayAnalyzer,
    AnalysisOrchestratorService,
    AiSlackExportService,
    AiEvalDatasetService,
    AiEvalRunnerService,
    AiEvalExportService,
  ],
  exports: [
    AiService,
    WorkspaceAiService,
    AiChatService,
    RagPipelineService,
    WorkspaceKnowledgeService,
    WorkspaceRetrievalService,
    WorkspaceSearchService,
    ReportGenerationService,
    VacationCatchupService,
    AnalysisOrchestratorService,
    KnowledgeEmbeddingService,
    EmbeddingReindexService,
    PgVectorSupportService,
    ConversationHistoryService,
    AiSlackExportService,
    AiEvalDatasetService,
    AiEvalRunnerService,
    AiEvalExportService,
  ],
})
export class AiModule {}
