// backend/src/ai/ai-event.listener.ts

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiService } from './ai.service';
import {
  AI_EVENTS,
  AiAnalysisCompletedEvent,
  RunCompletedEvent,
} from './dto/ai-events.dto';

@Injectable()
export class AiEventListener {
  private readonly logger = new Logger(AiEventListener.name);

  constructor(
    private readonly aiService: AiService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(AI_EVENTS.RUN_COMPLETED)
  async handleRunCompleted(event: RunCompletedEvent): Promise<void> {
    this.logger.log(`Received ${AI_EVENTS.RUN_COMPLETED} for run ${event.runId}`);

    const result = await this.aiService.analyzeRun(
      event.teamId,
      event.runId,
      event.responses,
    );

    const payload: AiAnalysisCompletedEvent = {
      teamId: event.teamId,
      runId: event.runId,
      result,
    };

    this.eventEmitter.emit(AI_EVENTS.ANALYSIS_COMPLETED, payload);
    this.logger.log(`Emitted ${AI_EVENTS.ANALYSIS_COMPLETED} for run ${event.runId}`);
  }
}