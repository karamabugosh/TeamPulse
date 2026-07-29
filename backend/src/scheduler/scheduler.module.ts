import { Module } from '@nestjs/common';
import { DigestModule } from '../digest/digest.module';
import { SlackModule } from '../slack/slack.module';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [DigestModule, SlackModule],
  controllers: [SchedulerController],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}