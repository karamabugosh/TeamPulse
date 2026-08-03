import { Controller, Post } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';

@Controller('scheduler')
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Post('trigger-standup')
  triggerDailyStandup() {
    return this.schedulerService.triggerDailyStandup();
  }

  @Post('send-reminders')
  triggerDailyReminder() {
    return this.schedulerService.triggerDailyReminder();
  }

  @Post('run-daily')
  runDailyDigest() {
    return this.schedulerService.runDailyDigest();
  }
}