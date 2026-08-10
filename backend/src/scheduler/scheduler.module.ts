import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CheckInModule } from '../check-in/check-in.module';
import { CollectionModule } from '../collection/collection.module';
import { DigestModule } from '../digest/digest.module';
import { ReportsModule } from '../reports/reports.module';
import { SlackModule } from '../slack/slack.module';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [
    CollectionModule,
    DigestModule,
    SlackModule,
    AiModule,
    ReportsModule,
    CheckInModule,
  ],
  controllers: [SchedulerController],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}