import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StandupResponse } from '../common/types/standup-response.type';
import { DigestService } from '../digest/digest.service';
import { SlackService } from '../slack/slack.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly digestService: DigestService,
    private readonly slackService: SlackService,
  ) {}

  @Cron(process.env.DAILY_DIGEST_CRON || '0 0 9 * * 0-4', {
    name: 'daily-digest',
    timeZone: process.env.DAILY_DIGEST_TIMEZONE || 'Asia/Riyadh',
    waitForCompletion: true,
  })
  runDailyDigest() {
    if (process.env.DIGEST_SCHEDULER_ENABLED !== 'true') {
      this.logger.warn('Daily digest scheduler is disabled');

      return {
        status: 'disabled',
        generatedAt: new Date().toISOString(),
      };
    }

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