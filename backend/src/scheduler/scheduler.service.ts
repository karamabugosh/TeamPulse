import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CollectionService } from '../collection/collection.service';
import { DigestService } from '../digest/digest.service';
import { SlackService } from '../slack/slack.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly collectionService: CollectionService,
    private readonly digestService: DigestService,
    private readonly slackService: SlackService,
  ) {}

  @Cron(process.env.DAILY_DIGEST_CRON || '0 0 9 * * 0-4', {
    name: 'daily-digest',
    timeZone: process.env.DAILY_DIGEST_TIMEZONE || 'Asia/Riyadh',
    waitForCompletion: true,
  })
  async runDailyDigest() {
    if (process.env.DIGEST_SCHEDULER_ENABLED !== 'true') {
      this.logger.warn('Daily digest scheduler is disabled');

      return {
        status: 'disabled',
        generatedAt: new Date().toISOString(),
      };
    }

    const responses =
      await this.collectionService.getCompletedStandupResponses();

    const digest =
      this.digestService.generateDailyDigest(responses);

    let slackDelivered = false;

    if (process.env.SLACK_DIGEST_ENABLED === 'true') {
      const channelId = process.env.SLACK_DIGEST_CHANNEL_ID;

      if (!channelId) {
        throw new Error('SLACK_DIGEST_CHANNEL_ID is missing');
      }

      await this.slackService.sendMessage({
        channelId,
        text: digest,
      });

      slackDelivered = true;
      this.logger.log('Scheduled digest posted to Slack');
    } else {
      this.logger.log(
        'Scheduled digest generated without Slack delivery',
      );
    }

    return {
      status: 'success',
      responseCount: responses.length,
      digest,
      slackDelivered,
      generatedAt: new Date().toISOString(),
    };
  }
}