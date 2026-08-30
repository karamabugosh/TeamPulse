import { Injectable, Logger } from '@nestjs/common';
import {
  AiChatConfidence,
  AiChatSourceItem,
  BuiltContext,
  DetectedIntent,
  KnowledgeDocument,
  WorkspaceSourceType,
} from '../types/workspace-ai.types';
import { NO_WORKSPACE_INFO_MESSAGE } from '../prompts/workspace-prompt.builder';

const SOURCE_LABEL: Record<WorkspaceSourceType, string> = {
  slack: 'Slack Standup',
  jira: 'Jira',
  blockers: 'Blockers',
  reports: 'Reports',
  users: 'Users',
  check_ins: 'Check-ins',
  standup_runs: 'Standup Runs',
  team_memory: 'Team Memory',
  ai_history: 'AI History',
};

/**
 * Formats model output + retrieval evidence into the UI contract:
 * Answer, Sources, Confidence.
 *
 * Confidence uses intent score, source count, semantic similarity,
 * source consistency, retrieval quality, and missing-info signals.
 */
@Injectable()
export class ChatResponseFormatter {
  private readonly logger = new Logger(ChatResponseFormatter.name);

  format(params: {
    rawAnswer: string;
    context: BuiltContext;
    intent: DetectedIntent;
    insufficientData: boolean;
    retrievalHits?: KnowledgeDocument[];
    hybridMode?: 'keyword_only' | 'hybrid';
  }): {
    answer: string;
    sources: AiChatSourceItem[];
    confidence: AiChatConfidence;
  } {
    const sources = this.buildSources(params.context);
    const answer = (params.rawAnswer || '').trim();

    if (
      params.insufficientData ||
      !answer ||
      this.isInsufficientReply(answer)
    ) {
      return {
        answer: NO_WORKSPACE_INFO_MESSAGE,
        sources: [],
        confidence: 'Low',
      };
    }

    return {
      answer,
      sources,
      confidence: this.computeConfidence({
        intent: params.intent,
        chunkCount: params.context.chunks.length,
        sources,
        hits: params.retrievalHits ?? [],
        hybridMode: params.hybridMode ?? 'keyword_only',
        answer,
      }),
    };
  }

  buildSources(context: BuiltContext): AiChatSourceItem[] {
    return context.chunks.map((chunk) => ({
      id: chunk.id,
      source: chunk.sourceType,
      label: SOURCE_LABEL[chunk.sourceType] ?? chunk.sourceType,
      title: chunk.title,
      date: formatSourceDate(chunk.reference.timestamp ?? null),
      url: chunk.url ?? chunk.reference.url ?? null,
      entity: chunk.entity,
    }));
  }

  private computeConfidence(params: {
    intent: DetectedIntent;
    chunkCount: number;
    sources: AiChatSourceItem[];
    hits: KnowledgeDocument[];
    hybridMode: 'keyword_only' | 'hybrid';
    answer: string;
  }): AiChatConfidence {
    if (params.chunkCount === 0 || params.sources.length === 0) return 'Low';

    let score = params.intent.confidence * 0.35;

    // Retrieved source count
    if (params.chunkCount >= 8) score += 0.18;
    else if (params.chunkCount >= 5) score += 0.14;
    else if (params.chunkCount >= 2) score += 0.08;
    else score += 0.02;

    // Semantic similarity (avg of top hits)
    const semanticScores = params.hits
      .map((h) => h.semanticScore ?? 0)
      .filter((s) => s > 0)
      .sort((a, b) => b - a)
      .slice(0, 5);
    if (semanticScores.length > 0) {
      const avg =
        semanticScores.reduce((a, b) => a + b, 0) / semanticScores.length;
      score += Math.min(0.2, avg * 0.25);
    } else if (params.hybridMode === 'keyword_only') {
      score += 0.04; // keyword-only still usable but weaker signal
    }

    // Source consistency — multiple distinct source types agreeing
    const distinctSources = new Set(params.sources.map((s) => s.source)).size;
    if (distinctSources >= 3) score += 0.12;
    else if (distinctSources >= 2) score += 0.07;
    else score += 0.02;

    // Retrieval quality — keyword + semantic both present on top hits
    const hybridAgree = params.hits.filter(
      (h) => (h.keywordScore ?? 0) > 0.2 && (h.semanticScore ?? 0) > 0.25,
    ).length;
    if (hybridAgree >= 2) score += 0.1;
    else if (hybridAgree >= 1) score += 0.05;

    // Missing information / hedging in the answer
    const lower = params.answer.toLowerCase();
    if (
      /\b(not enough|insufficient|unclear|could not find|couldn't find|no evidence|missing)\b/.test(
        lower,
      )
    ) {
      score -= 0.18;
    }

    const band: AiChatConfidence =
      score >= 0.72 ? 'High' : score >= 0.42 ? 'Medium' : 'Low';
    this.logger.log(
      `confidenceCalc chunks=${params.chunkCount} distinctSources=${distinctSources} hybrid=${params.hybridMode} semanticAvg=${semanticScores[0]?.toFixed?.(3) ?? 'n/a'} rawScore=${score.toFixed(3)} → ${band}`,
    );
    return band;
  }

  private isInsufficientReply(answer: string): boolean {
    const normalized = answer.trim().toLowerCase();
    return (
      normalized === NO_WORKSPACE_INFO_MESSAGE.toLowerCase() ||
      normalized.includes("couldn't find enough information") ||
      normalized.includes('could not find enough information') ||
      normalized.includes("couldn't find information about that")
    );
  }
}

function formatSourceDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}
