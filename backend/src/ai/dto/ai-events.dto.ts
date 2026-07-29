// backend/src/ai/dto/ai-events.dto.ts

import { AiDigestResult, RawResponseForAnalysis } from './ai-result.dto';

export const AI_EVENTS = {
  RUN_COMPLETED: 'run.completed',
  ANALYSIS_COMPLETED: 'ai.analysis.completed',
} as const;

export interface RunCompletedEvent {
  teamId: string;
  runId: string;
  responses: RawResponseForAnalysis[];
}

export interface AiAnalysisCompletedEvent {
  teamId: string;
  runId: string;
  result: AiDigestResult;
}