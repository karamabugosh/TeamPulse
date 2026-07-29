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

/**
 * Input to the AI layer, matching the actual Prisma schema (Answer model):
 * just userId, questionId, questionText, and the free-text answer. There is
 * no answerType/severity/dependency stored at collection time — the AI is
 * the only place blockers get identified and structured, extracted purely
 * from free text.
 */
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