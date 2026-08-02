import { Controller, Post } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';

@Controller('scheduler')
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Post('run-daily')
  runDailyDigest() {
    return this.schedulerService.runDailyDigest();
  }
}