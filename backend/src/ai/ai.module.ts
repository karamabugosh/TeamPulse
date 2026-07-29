// backend/src/ai/ai.module.ts

import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiEventListener } from './ai-event.listener';
import { AiController } from './ai.controller';

@Module({
  controllers: [AiController],
  providers: [AiService, AiEventListener],
  exports: [AiService],
})
export class AiModule {}