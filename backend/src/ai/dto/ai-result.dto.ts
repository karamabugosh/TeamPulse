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

export interface ReportSections {
  keyAccomplishments: string[];
  risks: string[];
  aiInsights: string[];
  actionItems: string[];
  participantUpdates: ParticipantUpdateSummary[];
  overallProgress: string;
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
  source: 'ai' | 'rules_fallback';
  summary: string;
  blockers: ExtractedBlocker[];
  themes: ThemeSummary[];
  reportSections: ReportSections;
}

export const EMPTY_REPORT_SECTIONS: ReportSections = {
  keyAccomplishments: [],
  risks: [],
  aiInsights: [],
  actionItems: [],
  participantUpdates: [],
  overallProgress: '',
};
