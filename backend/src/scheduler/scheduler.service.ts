import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StandupResponse } from '../common/types/standup-response.type';
import { DigestService } from '../digest/digest.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(private readonly digestService: DigestService) {}

  @Cron('0 * * * * *')
  runDailyDigest() {
    const sampleResponses: StandupResponse[] = [
      {
        userId: 'user-1',
        name: 'Ghassan',
        update: 'Completed the scheduling setup',
        blocker: 'Waiting for Slack integration',
        submittedAt: new Date().toISOString(),
      },
      {
        userId: 'user-2',
        name: 'Intern 2',
        update: 'Finished the response model',
        submittedAt: new Date().toISOString(),
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