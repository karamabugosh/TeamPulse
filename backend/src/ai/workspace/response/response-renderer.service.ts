import { Injectable } from '@nestjs/common';
import {
  BuiltContext,
  RenderedAiResponse,
  WorkspaceCitation,
  WorkspaceSourceType,
} from '../types/workspace-ai.types';

const SOURCE_LABEL: Record<WorkspaceSourceType, string> = {
  slack: 'Slack',
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
 * Future response renderer (markdown + citations).
 * Used only for insufficient-data stubs in the RAG phase.
 */
@Injectable()
export class ResponseRendererService {
  render(params: {
    rawMarkdown: string;
    context: BuiltContext;
    insufficientData: boolean;
  }): RenderedAiResponse {
    const citations = this.buildCitations(params.context);
    let markdown = (params.rawMarkdown || '').trim();

    if (!markdown) {
      markdown = "I couldn't find enough information.";
    }

    if (citations.length > 0 && !params.insufficientData) {
      markdown = `${markdown}\n\n${this.formatSourcesMarkdown(citations)}`;
    }

    const sources = [...new Set(citations.map((c) => c.sourceType))];

    return {
      markdown,
      plainText: stripMarkdown(markdown),
      citations,
      sources,
    };
  }

  buildCitations(context: BuiltContext): WorkspaceCitation[] {
    return context.chunks.map((chunk, index) => ({
      id: chunk.id,
      sourceType: chunk.sourceType,
      label: `${SOURCE_LABEL[chunk.sourceType] ?? chunk.sourceType} ${index + 1}`,
      title: chunk.title,
      url: chunk.url ?? chunk.reference.url,
      reference: chunk.reference,
    }));
  }

  private formatSourcesMarkdown(citations: WorkspaceCitation[]): string {
    const lines = citations.map((citation) => {
      const link = citation.url ? ` — ${citation.url}` : '';
      return `- **${SOURCE_LABEL[citation.sourceType] ?? citation.sourceType}**: ${citation.title}${link}`;
    });
    return `### Sources\n${lines.join('\n')}`;
  }
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
