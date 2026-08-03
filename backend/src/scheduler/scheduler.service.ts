import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CollectionService } from '../collection/collection.service';
import { DigestService } from '../digest/digest.service';
import { SlackService } from '../slack/slack.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private isDigestRunning = false;

  constructor(
    private readonly collectionService: CollectionService,
    private readonly digestService: DigestService,
    private readonly slackService: SlackService,
  ) {}

  @Cron(process.env.DAILY_DIGEST_CRON || '0 0 9 * * 0-4', {
    name: 'daily-digest',
    timeZone:
      process.env.DAILY_DIGEST_TIMEZONE || 'Asia/Riyadh',
    waitForCompletion: true,
  })
  async runDailyDigest() {
    const startedAt = new Date();

    if (process.env.DIGEST_SCHEDULER_ENABLED !== 'true') {
      this.logger.warn('Daily digest scheduler is disabled.');

      return {
        status: 'disabled',
        generatedAt: startedAt.toISOString(),
      };
    }

    if (this.isDigestRunning) {
      this.logger.warn(
        'Daily digest generation is already running. Duplicate run skipped.',
      );

      return {
        status: 'skipped',
        reason: 'A digest run is already in progress.',
        generatedAt: startedAt.toISOString(),
      };
    }

    this.isDigestRunning = true;

    this.logger.log(
      `Starting daily digest run at ${startedAt.toISOString()}`,
    );

    try {
      const responses =
        await this.collectionService.getCompletedStandupResponses();

      const digest =
        this.digestService.generateDailyDigest(responses);

      let slackDelivered = false;
      let slackError: string | null = null;

      const slackDeliveryEnabled =
        process.env.SLACK_DIGEST_ENABLED === 'true';

      if (!slackDeliveryEnabled) {
        this.logger.log(
          'Daily digest generated without Slack delivery because SLACK_DIGEST_ENABLED is not true.',
        );
      } else {
        const channelId =
          process.env.SLACK_DIGEST_CHANNEL_ID?.trim();

        if (!channelId) {
          slackError =
            'SLACK_DIGEST_CHANNEL_ID is missing.';

          this.logger.error(slackError);
        } else if (
          responses.length === 0 &&
          process.env.SEND_EMPTY_DIGEST !== 'true'
        ) {
          slackError =
            'No completed responses were found, so the empty digest was not posted.';

          this.logger.warn(slackError);
        } else {
          try {
            slackDelivered =
              await this.slackService.sendMessage({
                channelId,
                text: digest,
              });

            if (slackDelivered) {
              this.logger.log(
                `Daily digest posted to Slack channel ${channelId}.`,
              );
            } else {
              slackError =
                'SlackService could not deliver the digest.';

              this.logger.error(slackError);
            }
          } catch (error: unknown) {
            slackError =
              error instanceof Error
                ? error.message
                : String(error);

            this.logger.error(
              `Daily digest Slack delivery failed: ${slackError}`,
            );
          }
        }
      }

      const completedAt = new Date();

      this.logger.log(
        `Daily digest run completed with ${responses.length} response(s).`,
      );

      return {
        status: slackError ? 'partial_success' : 'success',
        responseCount: responses.length,
        digest,
        slackDelivered,
        slackError,
        startedAt: startedAt.toISOString(),
        generatedAt: completedAt.toISOString(),
        durationMs:
          completedAt.getTime() - startedAt.getTime(),
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.error(
        `Daily digest generation failed: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      return {
        status: 'failed',
        error: message,
        generatedAt: new Date().toISOString(),
      };
    } finally {
      this.isDigestRunning = false;
    }
  }
}