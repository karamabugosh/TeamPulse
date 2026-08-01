// backend/src/ai/ai.controller.ts
//
// Not part of the main workflow (Ghassan calls AiService directly via
// dependency injection). Kept as a manual entry point for testing via
// Postman and as a ready-made API surface if we need one later.

import { Body, Controller, Post } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiDigestResult, RawResponseForAnalysis } from './dto/ai-result.dto';

@Controller('internal/ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('analyze')
  analyze(
    @Body('teamId') teamId: string,
    @Body('runId') runId: string,
    @Body('responses') responses: RawResponseForAnalysis[],
  ): Promise<AiDigestResult> {
    return this.aiService.analyzeRun(teamId, runId, responses);
  }
}