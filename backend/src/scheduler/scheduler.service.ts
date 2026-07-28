import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DigestService } from '../digest/digest.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(private readonly digestService: DigestService) {}

  @Cron('0 * * * * *')
  runDailyDigest() {
    const sampleResponses = [
      {
        name: 'Ghassan',
        update: 'Completed the scheduling setup',
        blocker: 'Waiting for Slack integration',
      },
      {
        name: 'Intern 2',
        update: 'Finished the response model',
      },
    ];

    const digest =
      this.digestService.generateDailyDigest(sampleResponses);

    this.logger.log('Scheduled digest generated');

    return {
      status: 'success',
      digest,
      generatedAt: new Date().toISOString(),
    };
  }
}