// backend/src/ai/dto/ai-result.dto.ts

import { QuestionType } from '@prisma/client';
import type { SemanticSentiment } from '../../common/question-semantics';

export enum BlockerSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export interface ExtractedBlocker {
  userId: string;
  questionId: string;
  description: string;
  severity: BlockerSeverity;
  dependency: string | null;
  confidence: number;
}

export interface ThemeSummary {
  theme: string;
  mentionCount: number;
  summary: string;
}

export interface ParticipantUpdateSummary {
  slackUserId: string;
  displayName: string;
  answers: Array<{
    question: string;
    answer: string;
    formattedAnswer?: string;
    sentiment?: SemanticSentiment;
    semanticInterpretation?: string | null;
  }>;
}

export interface NamedPersonSection {
  displayName: string;
  items: string[];
}

export interface ParticipantProfile {
  slackUserId: string;
  displayName: string;
  yesterdaysWork: string;
  todaysPlan: string;
  blocked: boolean;
  blockedDetail: string;
  confidence: number | null;
  helpRequested: boolean;
  helpDetail: string;
  taskStatus: string;
}

export interface ReportStatistics {
  completedTasksCount: number;
  blockedMembersCount: number;
  helpRequestedCount: number;
  atRiskCount: number;
  averageConfidence: number | null;
  completionRate: number;
  teamProgressBullets: string[];
  respondedCount: number;
  totalParticipants: number;
}

export interface ReportSections {
  keyAccomplishments: string[];
  risks: string[];
  aiInsights: string[];
  actionItems: string[];
  participantUpdates: ParticipantUpdateSummary[];
  overallProgress: string;
  participationSummary?: string;
  generationError?: string;
  runStats?: {
    completedCount: number;
    totalCount: number;
    completionRate: number;
  };
  namedBlockers?: NamedPersonSection[];
  helpRequests?: NamedPersonSection[];
  namedRisks?: NamedPersonSection[];
  namedAccomplishments?: NamedPersonSection[];
  teamProgress?: string[];
  participantProfiles?: ParticipantProfile[];
  statistics?: ReportStatistics;
}

export interface RawResponseForAnalysis {
  userId: string;
  answers: {
    questionId: string;
    questionText: string;
    questionType?: QuestionType;
    text: string;
    formattedAnswer?: string;
    semanticInterpretation?: string | null;
    sentiment?: SemanticSentiment;
  }[];
}

export interface AiDigestInput {
  teamId: string;
  runId: string;
  generatedFor: string;
  responses: RawResponseForAnalysis[];
}

export interface AiDigestResult {
  teamId: string;
  runId: string;
  generatedAt: string;
  source: 'ai' | 'rules_fallback' | 'failed';
  summary: string;
  blockers: ExtractedBlocker[];
  themes: ThemeSummary[];
  reportSections: ReportSections;
  generationError?: string | null;
}

export const EMPTY_REPORT_SECTIONS: ReportSections = {
  keyAccomplishments: [],
  risks: [],
  aiInsights: [],
  actionItems: [],
  participantUpdates: [],
  overallProgress: '',
};
