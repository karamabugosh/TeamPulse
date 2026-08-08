// backend/src/ai/dto/ai-result.dto.ts

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

export interface RawResponseForAnalysis {
  userId: string;
  answers: {
    questionId: string;
    questionText: string;
    text: string;
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
}