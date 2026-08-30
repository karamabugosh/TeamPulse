import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { RagPipelineService } from '../rag/rag-pipeline.service';
import { OpenAiChatProvider } from '../providers/openai-chat.provider';
import { ConversationMemoryService } from '../memory/conversation-memory.service';
import { ChatResponseFormatter } from '../response/chat-response.formatter';
import { ReportGenerationService } from '../report/report-generation.service';
import { VacationCatchupService } from '../report/vacation-catchup.service';
import { shouldContinueVacationPending } from '../report/vacation-pending.policy';
import { AnalysisOrchestratorService } from '../analysis/analysis-orchestrator.service';
import { WorkspaceKnowledgeService } from '../knowledge/workspace-knowledge.service';
import { IntentDetectionService } from '../intent/intent-detection.service';
import { NO_WORKSPACE_INFO_MESSAGE } from '../prompts/workspace-prompt.builder';
import {
  AiChatResponse,
  AiChatSourceItem,
  WorkspaceAiIntent,
  WorkspaceAskRequest,
  WorkspaceReportType,
} from '../types/workspace-ai.types';
import {
  buildAiPipelineTraceSafe,
  sanitizeOpenAiError,
} from '../trace/ai-pipeline-trace.builder';
import { buildMemoryRetrievalPlan } from '../../../memory/memory-retrieval-policy';

/**
 * Phase 2 — AI Chat Service
 *
 * User Question → Intent → Retrieval → Context → Prompt → OpenAI → Formatter
 * Report / Vacation / Project Detective → dedicated grounded generators
 */
@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);

  constructor(
    private readonly ragPipeline: RagPipelineService,
    private readonly openAi: OpenAiChatProvider,
    private readonly memory: ConversationMemoryService,
    private readonly formatter: ChatResponseFormatter,
    private readonly reports: ReportGenerationService,
    private readonly vacationCatchup: VacationCatchupService,
    private readonly analysis: AnalysisOrchestratorService,
    private readonly knowledge: WorkspaceKnowledgeService,
    private readonly intentDetection: IntentDetectionService,
  ) {}

  async chat(request: WorkspaceAskRequest): Promise<AiChatResponse> {
    const question = request.question?.trim() ?? '';
    if (!question) {
      throw new Error('question is required');
    }

    const workspaceId =
      (await this.knowledge.resolveWorkspaceId(request.workspaceId)) ??
      'unknown';
    const session = await this.memory.ensureLoaded({
      conversationId: request.conversationId,
      workspaceId,
    });

    // Intent always runs before deciding whether to continue a pending vacation flow.
    const detectedIntent = this.intentDetection.detect(question);
    this.logger.log(
      `AI chat intent=${detectedIntent.intent} confidence=${detectedIntent.confidence.toFixed(2)} rationale="${detectedIntent.rationale}" q="${question.slice(0, 120)}"`,
    );

    if (session.vacationPending) {
      const continuePending = shouldContinueVacationPending({
        question,
        awaiting: session.vacationPending.awaiting,
        intent: detectedIntent,
      });

      if (continuePending) {
        this.logger.log(
          `Clarification continue: vacationPending awaiting=${session.vacationPending.awaiting} — message is a date reply`,
        );
        this.memory.appendUserTurn(session, question);
        return this.chatVacationCatchup(request, question, session.id, true);
      }

      this.logger.log(
        `Clarification cancelled: vacationPending awaiting=${session.vacationPending.awaiting} cleared — new intent=${detectedIntent.intent} (message is not a date answer)`,
      );
      this.memory.clearVacationPending(session);
    }

    // Dedicated flows only when intent (or strong heuristics) require them —
    // never because of leftover conversation state.
    if (
      detectedIntent.intent === WorkspaceAiIntent.VACATION_CATCHUP ||
      this.vacationCatchup.isCatchupRequest(question)
    ) {
      this.memory.appendUserTurn(session, question);
      return this.chatVacationCatchup(request, question, session.id, true);
    }

    if (
      detectedIntent.intent === WorkspaceAiIntent.PROJECT_DETECTIVE ||
      detectedIntent.intent === WorkspaceAiIntent.ROOT_CAUSE_ANALYSIS ||
      detectedIntent.intent === WorkspaceAiIntent.DECISION_REPLAY ||
      detectedIntent.intent === WorkspaceAiIntent.SPRINT_REPLAY
    ) {
      this.memory.appendUserTurn(session, question);
      return this.chatDetective(request, question, session.id, true);
    }

    // Explicit detective/replay phrases that intent may have under-scored.
    if (this.analysis.isAnalysisRequest(question)) {
      this.memory.appendUserTurn(session, question);
      return this.chatDetective(request, question, session.id, true);
    }

    if (
      detectedIntent.intent === WorkspaceAiIntent.GENERATE_REPORT ||
      detectedIntent.intent === WorkspaceAiIntent.SPRINT_REPORT ||
      detectedIntent.intent === WorkspaceAiIntent.EXECUTIVE_REPORT ||
      this.reports.isReportRequest(question) ||
      /\bgenerate\b.*\breport\b|\breport\b.*\bgenerate\b|\bsprint summary\b|\bexecutive report\b/i.test(
        question,
      )
    ) {
      return this.chatReport(request, question);
    }

    // Fresh RAG for every other question.
    const rag = await this.ragPipeline.prepare(request);
    this.logger.log(
      `RAG complete intent=${rag.intent.intent} hits=${rag.retrieval.hitCount} chunks=${rag.context.chunks.length} sources=${rag.retrieval.diagnostics.sources.map((s) => `${s.sourceKey}:${s.found}`).join(',')}`,
    );

    const ragSession = await this.memory.ensureLoaded({
      conversationId: session.id,
      workspaceId: rag.workspaceId,
    });
    this.memory.appendUserTurn(ragSession, question);

    if (
      rag.intent.intent === WorkspaceAiIntent.GENERATE_REPORT ||
      rag.intent.intent === WorkspaceAiIntent.SPRINT_REPORT ||
      rag.intent.intent === WorkspaceAiIntent.EXECUTIVE_REPORT
    ) {
      return this.chatReport(request, question, {
        conversationId: ragSession.id,
        skipUserAppend: true,
      });
    }

    if (rag.intent.intent === WorkspaceAiIntent.VACATION_CATCHUP) {
      return this.chatVacationCatchup(
        request,
        question,
        ragSession.id,
        true,
      );
    }

    if (
      rag.intent.intent === WorkspaceAiIntent.PROJECT_DETECTIVE ||
      rag.intent.intent === WorkspaceAiIntent.ROOT_CAUSE_ANALYSIS ||
      rag.intent.intent === WorkspaceAiIntent.DECISION_REPLAY ||
      rag.intent.intent === WorkspaceAiIntent.SPRINT_REPLAY
    ) {
      return this.chatDetective(request, question, ragSession.id, true);
    }

    // Insufficient only when retrieval found nothing relevant across sources.
    const noEvidence =
      rag.retrieval.hitCount === 0 && rag.context.chunks.length === 0;
    if (noEvidence) {
      const diagnostics = rag.retrieval.diagnostics;
      this.logger.warn(
        `AI chat insufficient — ALL sources empty. intent=${rag.intent.intent} — ${diagnostics.summary}`,
      );

      const empty = this.formatter.format({
        rawAnswer: NO_WORKSPACE_INFO_MESSAGE,
        context: rag.context,
        intent: rag.intent,
        insufficientData: true,
        retrievalHits: rag.retrieval.hits,
        hybridMode: diagnostics.hybrid?.mode,
      });

      this.memory.appendAssistantTurn(ragSession, {
        content: empty.answer,
        intent: rag.intent.intent,
        citations: [],
        confidence: empty.confidence,
      });

      return {
        conversationId: ragSession.id,
        question,
        intent: rag.intent.intent,
        intentConfidence: rag.intent.confidence,
        answer: empty.answer,
        sources: empty.sources,
        confidence: empty.confidence,
        insufficientData: true,
        provider: 'none',
        model: null,
        retrievalDiagnostics: diagnostics,
        pipelineTrace: this.buildPipelineTrace(rag, {
          openai: { skipped: true, skipReason: 'Insufficient evidence' },
          answer: {
            confidence: empty.confidence,
            evidenceCount: 0,
            insufficientData: true,
            provider: 'none',
            model: null,
          },
        }),
        report: null,
      };
    }

    if (!this.openAi.isAvailable()) {
      throw new ServiceUnavailableException(
        'Pulse AI is not enabled. Set OPENAI_API_KEY and PULSE_AI_ENABLED=true.',
      );
    }

    const history = this.memory.toProviderHistory(ragSession, true);

    this.logger.log(
      `AI chat calling provider intent=${rag.intent.intent} chunks=${rag.context.chunks.length}`,
    );

    const openAiStarted = Date.now();
    let completion;
    let openAiTrace:
      | {
          durationMs: number;
          model: string | null;
          provider: string;
          usage?: {
            promptTokens?: number;
            completionTokens?: number;
            totalTokens?: number;
          };
          error?: { message: string; category: import('../trace/ai-pipeline-trace.types').OpenAiErrorCategory };
          skipped?: boolean;
          skipReason?: string;
        }
      | undefined;

    try {
      completion = await this.openAi.complete({
        messages: rag.prompt.messages,
        history: history.map((turn) => ({
          role: turn.role,
          content: turn.content,
        })),
        temperature: 0.15,
        maxTokens: 450,
      });
      openAiTrace = {
        durationMs: Date.now() - openAiStarted,
        model: completion.model,
        provider: completion.provider,
        usage: completion.usage,
      };
    } catch (error) {
      const sanitized = sanitizeOpenAiError(error);
      openAiTrace = {
        durationMs: Date.now() - openAiStarted,
        model: null,
        provider: 'openai',
        error: sanitized,
      };
      throw error;
    }

    const formatted = this.formatter.format({
      rawAnswer: completion.content,
      context: rag.context,
      intent: rag.intent,
      insufficientData: false,
      retrievalHits: rag.retrieval.hits,
      hybridMode: rag.retrieval.diagnostics.hybrid?.mode,
    });

    this.memory.appendAssistantTurn(ragSession, {
      content: formatted.answer,
      intent: rag.intent.intent,
      citations: formatted.sources.map((source) => ({
        id: source.id,
        sourceType: source.source,
        label: source.label,
        title: source.title,
        url: source.url,
      })),
      confidence: formatted.confidence,
    });

    return {
      conversationId: ragSession.id,
      question,
      intent: rag.intent.intent,
      intentConfidence: rag.intent.confidence,
      answer: formatted.answer,
      sources: formatted.sources,
      confidence: formatted.confidence,
      insufficientData: false,
      provider: completion.provider,
      model: completion.model,
      retrievalDiagnostics: rag.retrieval.diagnostics,
      pipelineTrace: this.buildPipelineTrace(rag, {
        openai: openAiTrace,
        answer: {
          confidence: formatted.confidence,
          evidenceCount: formatted.sources.length,
          insufficientData: false,
          provider: completion.provider,
          model: completion.model,
        },
      }),
      report: null,
    };
  }

  private buildPipelineTrace(
    rag: Awaited<ReturnType<RagPipelineService['prepare']>>,
    extras: {
      openai?: {
        durationMs?: number;
        model?: string | null;
        provider?: string;
        usage?: {
          promptTokens?: number;
          completionTokens?: number;
          totalTokens?: number;
        };
        error?: { message: string; category: import('../trace/ai-pipeline-trace.types').OpenAiErrorCategory };
        skipped?: boolean;
        skipReason?: string;
      };
      answer?: {
        confidence: AiChatResponse['confidence'];
        evidenceCount: number;
        insufficientData: boolean;
        provider: string;
        model: string | null;
      };
    },
  ) {
    if (!rag.traceMetrics) return null;
    const plan = buildMemoryRetrievalPlan({
      intent: rag.intent.intent,
      question: rag.question,
      issueKey: rag.retrieval.filters.issueKey,
      hasTrustedUserId: Boolean(rag.traceMetrics.trustedUserId),
    });
    return buildAiPipelineTraceSafe({
      metrics: rag.traceMetrics,
      intent: rag.intent,
      plan,
      diagnostics: rag.retrieval.diagnostics,
      context: rag.context,
      documents: rag.retrieval.hits,
      openai: extras.openai
        ? {
            durationMs: extras.openai.durationMs ?? 0,
            model: extras.openai.model ?? null,
            provider: extras.openai.provider ?? 'openai',
            usage: extras.openai.usage,
            error: extras.openai.error,
            skipped: extras.openai.skipped,
            skipReason: extras.openai.skipReason,
          }
        : undefined,
      answer: extras.answer,
    });
  }

  private async chatDetective(
    request: WorkspaceAskRequest,
    question: string,
    conversationId: string,
    userAlreadyAppended: boolean,
  ): Promise<AiChatResponse> {
    const workspaceId =
      (await this.knowledge.resolveWorkspaceId(request.workspaceId)) ??
      'unknown';
    const session = this.memory.getOrCreate({
      conversationId,
      workspaceId,
    });
    if (!userAlreadyAppended) {
      this.memory.appendUserTurn(session, question);
    }

    const report = await this.analysis.analyze(request);
    const intent =
      report.reportType === WorkspaceReportType.DECISION_REPLAY
        ? WorkspaceAiIntent.DECISION_REPLAY
        : WorkspaceAiIntent.PROJECT_DETECTIVE;

    const sources: AiChatSourceItem[] = report.sourcesUsed.map(
      (source, index) => ({
        id: `detective-source-${index}`,
        source: 'reports',
        label: source,
        title: source,
        date: report.generatedAt.slice(0, 10),
        url: null,
        entity: 'report',
      }),
    );

    const answer =
      report.dataPoints < 2
        ? [
            'There is not enough data to determine the root cause.',
            '',
            '---',
            `How this was generated: ${report.explanation}`,
          ].join('\n')
        : [
            report.markdown,
            '',
            '---',
            `How this was generated: ${report.explanation}`,
          ].join('\n');

    this.memory.appendAssistantTurn(session, {
      content: answer,
      intent,
      citations: sources.map((source) => ({
        id: source.id,
        sourceType: source.source,
        label: source.label,
        title: source.title,
        url: source.url,
      })),
      confidence: report.confidence,
    });

    this.logger.log(
      `Detective analysis type=${report.reportType} dataPoints=${report.dataPoints} confidence=${report.confidence}`,
    );

    return {
      conversationId: session.id,
      question,
      intent,
      intentConfidence: 0.92,
      answer,
      sources,
      confidence: report.confidence,
      insufficientData: report.dataPoints < 2,
      provider: this.openAi.isAvailable() ? 'openai' : 'metrics-only',
      model: null,
      report,
    };
  }

  private async chatVacationCatchup(
    request: WorkspaceAskRequest,
    question: string,
    conversationId: string,
    userAlreadyAppended: boolean,
  ): Promise<AiChatResponse> {
    const workspaceId =
      (await this.knowledge.resolveWorkspaceId(request.workspaceId)) ??
      'unknown';
    const session = this.memory.getOrCreate({
      conversationId,
      workspaceId,
    });
    if (!userAlreadyAppended) {
      this.memory.appendUserTurn(session, question);
    }

    const historyText = session.turns
      .slice(-8)
      .map((turn) => turn.content)
      .join('\n');

    const pending = session.vacationPending;
    const parsed = this.vacationCatchup.parseDateRange(
      question,
      historyText,
      pending?.startIso,
    );

    const focusUserName =
      request.focusUserName?.trim() ||
      pending?.focusUserName ||
      null;

    if (parsed.status === 'need_start') {
      this.memory.setVacationPending(session, {
        awaiting: 'start',
        focusUserName,
      });
      const answer =
        '🏖 Sure — I can catch you up.\n\nWhen did your vacation start?\n\n_Example: Aug 10 or 2026-08-10_';
      this.logger.log(
        `Clarification required: vacation catch-up needs a start date (missing from question="${question.slice(0, 80)}")`,
      );
      this.memory.appendAssistantTurn(session, {
        content: answer,
        intent: WorkspaceAiIntent.VACATION_CATCHUP,
        citations: [],
        confidence: 'Medium',
      });
      return {
        conversationId: session.id,
        question,
        intent: WorkspaceAiIntent.VACATION_CATCHUP,
        intentConfidence: 0.85,
        answer,
        sources: [],
        confidence: 'Medium',
        insufficientData: false,
        provider: 'none',
        model: null,
        report: null,
      };
    }

    // Legacy need_end: never ask a second question — run start..now immediately.
    let resolvedRange =
      parsed.status === 'resolved'
        ? parsed.range
        : parsed.status === 'need_end'
          ? (() => {
              const from = new Date(parsed.startIso);
              const to = new Date();
              to.setHours(23, 59, 59, 999);
              from.setHours(0, 0, 0, 0);
              const fmt = (d: Date) =>
                d.toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                });
              this.logger.log(
                `Vacation catch-up auto-closing range start=${parsed.startIso} → now (no return-date ask)`,
              );
              return {
                from: from.toISOString(),
                to: to.toISOString(),
                label: `${fmt(from)} → ${fmt(to)}`,
              };
            })()
          : null;

    if (parsed.status === 'invalid' || !resolvedRange) {
      const answer =
        parsed.status === 'invalid'
          ? parsed.message
          : 'I could not read a vacation date from that message. Send a date like Aug 10, or ask a new question.';
      this.memory.appendAssistantTurn(session, {
        content: answer,
        intent: WorkspaceAiIntent.VACATION_CATCHUP,
        citations: [],
        confidence: 'Low',
      });
      return {
        conversationId: session.id,
        question,
        intent: WorkspaceAiIntent.VACATION_CATCHUP,
        intentConfidence: 0.7,
        answer,
        sources: [],
        confidence: 'Low',
        insufficientData: true,
        provider: 'none',
        model: null,
        report: null,
      };
    }

    this.memory.clearVacationPending(session);

    const rangeSource = describeRangeSource(question, historyText, pending);

    const report = await this.vacationCatchup.generate({
      request,
      range: resolvedRange,
      focusUserName,
      rangeSource,
    });

    const sources: AiChatSourceItem[] = report.sourcesUsed.map(
      (source, index) => ({
        id: `vacation-source-${index}`,
        source: 'reports',
        label: source,
        title: source,
        date: report.generatedAt.slice(0, 10),
        url: null,
        entity: 'report',
      }),
    );

    const concise = this.vacationCatchup.buildConciseSummary(report);
    const answer =
      report.dataPoints === 0
        ? [
            `I searched standups, Jira, blockers, reports/digests, team memory, and timeline events for **${report.timeRange.label}**.`,
            '',
            'No dated workspace activity was found in that window. Try a wider start date, or switch workspace if you expected Demo / production data.',
            '',
            `Sources searched: ${report.sourcesUsed.join(', ')}`,
          ].join('\n')
        : [concise, '', report.markdown].join('\n');

    this.memory.appendAssistantTurn(session, {
      content: answer,
      intent: WorkspaceAiIntent.VACATION_CATCHUP,
      citations: sources.map((source) => ({
        id: source.id,
        sourceType: source.source,
        label: source.label,
        title: source.title,
        url: source.url,
      })),
      confidence: report.confidence,
    });

    this.logger.log(
      `Vacation catch-up generated dataPoints=${report.dataPoints} confidence=${report.confidence} sources=${report.sourcesUsed.join('|')}`,
    );

    return {
      conversationId: session.id,
      question,
      intent: WorkspaceAiIntent.VACATION_CATCHUP,
      intentConfidence: 0.92,
      answer,
      sources,
      confidence: report.confidence,
      insufficientData: report.dataPoints === 0,
      provider: this.openAi.isAvailable() ? 'openai' : 'metrics-only',
      model: null,
      report,
    };
  }

  private async chatReport(
    request: WorkspaceAskRequest,
    question: string,
    options?: { conversationId?: string; skipUserAppend?: boolean },
  ): Promise<AiChatResponse> {
    const report = await this.reports.generate(request);
    const session = this.memory.getOrCreate({
      conversationId: options?.conversationId ?? request.conversationId,
      workspaceId: report.workspaceId,
    });
    if (!options?.skipUserAppend) {
      this.memory.appendUserTurn(session, question);
    }

    const sources: AiChatSourceItem[] = report.sourcesUsed.map(
      (source, index) => ({
        id: `report-source-${index}`,
        source: 'reports',
        label: source,
        title: source,
        date: report.generatedAt.slice(0, 10),
        url: null,
        entity: 'report',
      }),
    );

    const answer = [
      report.markdown,
      '',
      '---',
      `How this was generated: ${report.explanation}`,
    ].join('\n');

    this.memory.appendAssistantTurn(session, {
      content: answer,
      intent: WorkspaceAiIntent.GENERATE_REPORT,
      citations: sources.map((source) => ({
        id: source.id,
        sourceType: source.source,
        label: source.label,
        title: source.title,
        url: source.url,
      })),
      confidence: report.confidence,
    });

    this.logger.log(
      `Generated ${report.reportType} report dataPoints=${report.dataPoints} confidence=${report.confidence}`,
    );

    return {
      conversationId: session.id,
      question,
      intent: WorkspaceAiIntent.GENERATE_REPORT,
      intentConfidence: 0.9,
      answer,
      sources,
      confidence: report.confidence,
      insufficientData: report.dataPoints === 0,
      provider: this.openAi.isAvailable() ? 'openai' : 'metrics-only',
      model: null,
      report,
    };
  }
}

function describeRangeSource(
  question: string,
  historyText: string,
  pending: { awaiting: 'start' | 'end'; startIso?: string } | null | undefined,
): string {
  const lower = question.toLowerCase();
  if (/\bsince last week\b|\blast week\b/.test(lower)) {
    return 'relative phrase ("last week" / "since last week")';
  }
  if (/\blast\s+\d+\s+days?\b/.test(lower)) {
    return 'relative phrase ("last N days")';
  }
  if (/\b(since|from|after)\b.+\d/.test(lower)) {
    return 'explicit since/from date in the question (end defaults to now)';
  }
  if (pending?.awaiting === 'start' || pending?.startIso) {
    return 'user-provided vacation start date (end defaults to now)';
  }
  if (/→|->|to|until|through/i.test(`${historyText}\n${question}`)) {
    return 'user-provided vacation date range in this conversation';
  }
  return 'dates found in the conversation context (end defaults to now)';
}
