// backend/src/ai/ai.controller.ts

import {
  Body,
  Controller,
  Post,
} from '@nestjs/common';
import { AiService } from './ai.service';
import {
  AiDigestResult,
  RawResponseForAnalysis,
} from './dto/ai-result.dto';

interface AnalyzeAiRequestDto {
  teamId: string;
  runId: string;
  responses: RawResponseForAnalysis[];
}

@Controller('internal/ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
  ) {}

  @Post('analyze')
  async analyze(
    @Body() body: AnalyzeAiRequestDto,
  ): Promise<AiDigestResult> {
    if (
      !body?.teamId?.trim() ||
      !body?.runId?.trim() ||
      !Array.isArray(body.responses)
    ) {
      throw new Error(
        'teamId, runId, and responses are required',
      );
    }

    return this.aiService.analyzeRun(
      body.teamId.trim(),
      body.runId.trim(),
      body.responses,
    );
  }
}