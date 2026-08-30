/**
 * Modular workspace analysis types for Project Detective / Decision Replay.
 * Additional analyzers can plug into AnalysisOrchestrator later.
 */

import {
  AiChatConfidence,
  GeneratedWorkspaceReport,
  WorkspaceAskRequest,
} from '../types/workspace-ai.types';

export type AnalysisMode =
  | 'root_cause'
  | 'timeline'
  | 'decision_replay'
  | 'pattern';

export type DetectiveFocus = {
  issueKey: string | null;
  userQuery: string | null;
  sprintQuery: string | null;
  keyword: string | null;
  mode: AnalysisMode;
};

export type EvidenceSourceKind =
  | 'slack_standup'
  | 'jira_issue'
  | 'jira_changelog'
  | 'blocker'
  | 'blocker_update'
  | 'report'
  | 'team_memory'
  | 'standup_thread';

export type EvidenceEvent = {
  id: string;
  occurredAt: string;
  source: EvidenceSourceKind;
  label: string;
  summary: string;
  details: string;
  issueKey: string | null;
  actor: string | null;
  weight: number;
};

export type DetectivePattern = {
  id: string;
  label: string;
  evidenceIds: string[];
  strength: 'strong' | 'moderate' | 'weak';
};

export type RootCauseCandidate = {
  id: string;
  label: string;
  rationale: string;
  evidenceIds: string[];
  contribution: 'high' | 'medium' | 'low';
};

export type DetectiveBundle = {
  workspaceId: string;
  workspaceName: string;
  focus: DetectiveFocus;
  question: string;
  events: EvidenceEvent[];
  patterns: DetectivePattern[];
  rootCauses: RootCauseCandidate[];
  decisionImpacts: Array<{
    label: string;
    rationale: string;
    evidenceIds: string[];
  }>;
  sourcesUsed: string[];
  dataPoints: number;
  confidence: AiChatConfidence;
  insufficient: boolean;
  insufficientReason: string | null;
};

export type AnalysisContext = {
  request: WorkspaceAskRequest;
  question: string;
  workspaceId: string;
  focus: DetectiveFocus;
};

/** Pluggable analysis module contract. */
export interface WorkspaceAnalyzer {
  readonly id: string;
  readonly reportType: string;
  matches(question: string): boolean;
  resolveFocus(question: string): DetectiveFocus;
  analyze(ctx: AnalysisContext): Promise<GeneratedWorkspaceReport>;
}
