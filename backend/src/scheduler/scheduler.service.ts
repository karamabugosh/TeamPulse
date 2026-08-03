import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CollectionService } from '../collection/collection.service';
import { DigestService } from '../digest/digest.service';
import { SlackService } from '../slack/slack.service';
import { SlackGateway } from '../slack/slack.gateway';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private isStandupRunning = false;
  private isReminderRunning = false;
  private isDigestRunning = false;

  constructor(
    private readonly collectionService: CollectionService,
    private readonly digestService: DigestService,
    private readonly slackService: SlackService,
    private readonly slackGateway: SlackGateway,
  ) {}

  /**
   * Automatically triggers the daily standup every weekday at 9:00 AM.
   */
  // Production
  // @Cron(process.env.DAILY_STANDUP_CRON || '0 9 * * 1-5', {
  //   name: 'daily-standup-trigger',
  //   timeZone: process.env.DAILY_STANDUP_TIMEZONE || 'Asia/Hebron',
  //   waitForCompletion: true,
  // })

  // Testing
  @Cron('0 11 16 * * *', {
    name: 'daily-standup-trigger',
    timeZone: 'Asia/Hebron',
    waitForCompletion: true,
  })
  async triggerDailyStandup() {
    const startedAt = new Date();

    if (process.env.STANDUP_SCHEDULER_ENABLED === 'false') {
      this.logger.warn('Daily standup scheduler is disabled via env.');
      return { status: 'disabled', generatedAt: startedAt.toISOString() };
    }

    if (this.isStandupRunning) {
      this.logger.warn('Daily standup trigger is already running. Skipping.');
      return { status: 'skipped', reason: 'Standup trigger in progress' };
    }

    this.isStandupRunning = true;
    this.logger.log(`Starting automatic daily standup run at ${startedAt.toISOString()}`);

    try {
      const members = await this.slackService.getWorkspaceMembers();
      this.logger.log(`Initiating daily standup for ${members.length} workspace human member(s).`);

      let initiatedCount = 0;

      for (const member of members) {
        try {
          const dmChannelId = await this.slackService.openDirectMessage(member.id);
          if (!dmChannelId) {
            this.logger.error(`Could not open DM channel for user ${member.id} (${member.name}).`);
            continue;
          }

          await this.slackGateway.triggerAutomaticStandupForUser(member.id, dmChannelId);
          initiatedCount += 1;
        } catch (memberErr: unknown) {
          const msg = memberErr instanceof Error ? memberErr.message : String(memberErr);
          this.logger.error(`Failed to trigger standup for user ${member.id}: ${msg}`);
        }
      }

      this.logger.log(
        `Daily standup trigger completed. Initiated DMs for ${initiatedCount}/${members.length} member(s).`,
      );

      return {
        status: 'success',
        totalMembers: members.length,
        initiatedCount,
        startedAt: startedAt.toISOString(),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Daily standup trigger failed: ${message}`);
      return { status: 'failed', error: message };
    } finally {
      this.isStandupRunning = false;
    }
  }

  /**
   * Automatically sends a single reminder DM to users who haven't completed standup today.
   */
  @Cron(process.env.DAILY_REMINDER_CRON || '0 0 14 * * 1-5', {
    name: 'daily-standup-reminder',
    timeZone: process.env.DAILY_STANDUP_TIMEZONE || 'Asia/Riyadh',
    waitForCompletion: true,
  })
  async triggerDailyReminder() {
    const startedAt = new Date();

    if (process.env.REMINDER_SCHEDULER_ENABLED === 'false') {
      this.logger.log('Standup reminder scheduler is disabled.');
      return { status: 'disabled' };
    }

    if (this.isReminderRunning) {
      return { status: 'skipped', reason: 'Reminder run in progress' };
    }

    this.isReminderRunning = true;
    this.logger.log(`Starting standup reminder check at ${startedAt.toISOString()}`);

    try {
      const members = await this.slackService.getWorkspaceMembers();
      let reminderCount = 0;

      for (const member of members) {
        const isCompleted = await this.collectionService.isStandupCompletedToday(member.id);
        if (!isCompleted) {
          const dmChannelId = await this.slackService.openDirectMessage(member.id);
          if (dmChannelId) {
            await this.slackGateway.sendStandupReminder(member.id, dmChannelId);
            reminderCount += 1;
          }
        }
      }

      this.logger.log(`Sent standup reminder DM to ${reminderCount} pending member(s).`);
      return { status: 'success', reminderCount };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Standup reminder run failed: ${message}`);
      return { status: 'failed', error: message };
    } finally {
      this.isReminderRunning = false;
    }
  }

  /**
   * Automatically posts the daily digest to the configured Slack channel.
   */
  @Cron(process.env.DAILY_DIGEST_CRON || '0 0 17 * * 1-5', {
    name: 'daily-digest',
    timeZone: process.env.DAILY_DIGEST_TIMEZONE || 'Asia/Riyadh',
    waitForCompletion: true,
  })
  async runDailyDigest() {
    const startedAt = new Date();

    if (process.env.DIGEST_SCHEDULER_ENABLED === 'false') {
      this.logger.warn('Daily digest scheduler is disabled via env.');
      return { status: 'disabled', generatedAt: startedAt.toISOString() };
    }

    if (this.isDigestRunning) {
      this.logger.warn('Daily digest generation is already running. Duplicate run skipped.');
      return {
        status: 'skipped',
        reason: 'A digest run is already in progress.',
        generatedAt: startedAt.toISOString(),
      };
    }

    this.isDigestRunning = true;
    this.logger.log(`Starting daily digest run at ${startedAt.toISOString()}`);

    try {
      const members = await this.slackService.getWorkspaceMembers();
      const digestData = await this.collectionService.getDailyDigestData(members);

      const digest = this.digestService.generateDailyDigest(
        digestData.completedResponses,
        digestData.noUpdateUsers,
      );

      let slackDelivered = false;
      let slackError: string | null = null;
      const channelId = process.env.SLACK_DIGEST_CHANNEL_ID?.trim();

      if (!channelId) {
        slackError = 'SLACK_DIGEST_CHANNEL_ID environment variable is missing.';
        this.logger.error(slackError);
      } else {
        try {
          slackDelivered = await this.slackService.sendMessage({
            channelId,
            text: digest,
          });

          if (slackDelivered) {
            this.logger.log(`Daily digest posted to Slack channel ${channelId}.`);
          } else {
            slackError = 'SlackService could not deliver the digest message.';
            this.logger.error(slackError);
          }
        } catch (error: unknown) {
          slackError = error instanceof Error ? error.message : String(error);
          this.logger.error(`Daily digest Slack delivery failed: ${slackError}`);
        }
      }

      const completedAt = new Date();

      return {
        status: slackDelivered ? 'success' : 'partial_success',
        completedCount: digestData.completedResponses.length,
        noUpdateCount: digestData.noUpdateUsers.length,
        digest,
        slackDelivered,
        slackError,
        startedAt: startedAt.toISOString(),
        generatedAt: completedAt.toISOString(),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Daily digest generation failed: ${message}`);
      return { status: 'failed', error: message };
    } finally {
      this.isDigestRunning = false;
    }
  }
}