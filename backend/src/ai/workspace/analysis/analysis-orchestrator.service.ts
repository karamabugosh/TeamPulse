import { Injectable, Logger } from '@nestjs/common';
import { WorkspaceKnowledgeService } from '../knowledge/workspace-knowledge.service';
import {
  GeneratedWorkspaceReport,
  WorkspaceAskRequest,
} from '../types/workspace-ai.types';
import {
  AnalysisContext,
  WorkspaceAnalyzer,
} from './analysis.types';
import {
  DecisionReplayAnalyzer,
  ProjectDetectiveAnalyzer,
  resolveDetectiveFocus,
} from './project-detective.analyzers';

/**
 * Routes detective / decision-replay questions to pluggable analyzers.
 * Add more WorkspaceAnalyzer implementations here later.
 */
@Injectable()
export class AnalysisOrchestratorService {
  private readonly logger = new Logger(AnalysisOrchestratorService.name);
  private readonly analyzers: WorkspaceAnalyzer[];

  constructor(
    private readonly knowledge: WorkspaceKnowledgeService,
    private readonly projectDetective: ProjectDetectiveAnalyzer,
    private readonly decisionReplay: DecisionReplayAnalyzer,
  ) {
    this.analyzers = [this.decisionReplay, this.projectDetective];
  }

  isAnalysisRequest(question: string): boolean {
    const q = question.trim();
    if (!q) return false;
    return this.analyzers.some((analyzer) => analyzer.matches(q));
  }

  pickAnalyzer(question: string): WorkspaceAnalyzer | null {
    for (const analyzer of this.analyzers) {
      if (analyzer.matches(question)) return analyzer;
    }
    return null;
  }

  async analyze(
    request: WorkspaceAskRequest,
  ): Promise<GeneratedWorkspaceReport> {
    const question = request.question?.trim() ?? '';
    const workspaceId = await this.knowledge.resolveWorkspaceId(
      request.workspaceId,
    );
    if (!workspaceId) {
      throw new Error('No workspace available for project analysis');
    }

    const analyzer =
      this.pickAnalyzer(question) ?? this.projectDetective;
    const focus = analyzer.resolveFocus(question);

    // Prefer issue-key / user extracted by analyzer; fill gaps from shared resolver.
    const shared = resolveDetectiveFocus(question, focus.mode);
    const mergedFocus = {
      issueKey: focus.issueKey ?? shared.issueKey,
      userQuery: focus.userQuery ?? shared.userQuery,
      sprintQuery: focus.sprintQuery ?? shared.sprintQuery,
      keyword: focus.keyword ?? shared.keyword,
      mode: focus.mode,
    };

    this.logger.log(
      `Analysis analyzer=${analyzer.id} workspace=${workspaceId} issue=${mergedFocus.issueKey ?? 'none'} user=${mergedFocus.userQuery ?? 'none'} sprint=${mergedFocus.sprintQuery ?? 'none'}`,
    );

    const ctx: AnalysisContext = {
      request,
      question,
      workspaceId,
      focus: mergedFocus,
    };

    return analyzer.analyze(ctx);
  }
}
