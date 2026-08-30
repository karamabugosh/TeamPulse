/**
 * AI Workspace UI types + suggested prompts.
 */
import type { AiPipelineTrace } from './ai-pipeline-trace.types';

export const AI_SUGGESTED_PROMPTS = [
  "Generate today's report",
  'Generate weekly report',
  'Why was SCRUM-8 delayed?',
  'Explain the timeline of SCRUM-8',
  'Replay Sprint 14',
  'What caused this blocker?',
  'Catch me up on my vacation',
  'What changed since last week?',
  'Who is blocked today?',
  "Summarize today's standup.",
] as const;

export type AiChatRole = 'user' | 'assistant' | 'system';

export type AiChatConfidence = 'High' | 'Medium' | 'Low';

export type WorkspaceReportType =
  | 'daily'
  | 'weekly'
  | 'sprint'
  | 'blocker'
  | 'jira'
  | 'personal'
  | 'executive'
  | 'vacation_catchup'
  | 'project_detective'
  | 'decision_replay';

export type GeneratedWorkspaceReport = {
  id: string;
  reportType: WorkspaceReportType;
  title: string;
  generatedAt: string;
  workspaceId: string;
  workspaceName: string;
  timeRange: {
    from: string;
    to: string;
    label: string;
  };
  sections: Array<{ id: string; title: string; markdown: string }>;
  markdown: string;
  sourcesUsed: string[];
  confidence: AiChatConfidence;
  dataPoints: number;
  explanation: string;
  metrics: Record<string, unknown>;
};

export type AiChatCitation = {
  id: string;
  label: string;
  title?: string;
  date?: string | null;
  sourceType?: string;
  url?: string | null;
};

export type AiChatMessage = {
  id: string;
  role: AiChatRole;
  content: string;
  createdAt: string;
  isStreaming?: boolean;
  confidence?: AiChatConfidence | null;
  citations?: AiChatCitation[];
  report?: GeneratedWorkspaceReport | null;
  pipelineTrace?: AiPipelineTrace | null;
};

export type AiChatApiResponse = {
  conversationId: string;
  question: string;
  intent: string;
  answer: string;
  sources: Array<{
    id: string;
    source: string;
    label: string;
    title: string;
    date: string | null;
    url: string | null;
    entity: string;
  }>;
  confidence: AiChatConfidence;
  insufficientData: boolean;
  provider: string;
  model: string | null;
  report?: GeneratedWorkspaceReport | null;
  pipelineTrace?: AiPipelineTrace | null;
};
