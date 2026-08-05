import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { CronJob } from 'cron';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionService } from '../collection/collection.service';
import { DigestService } from '../digest/digest.service';
import { SlackService } from '../slack/slack.service';

type TeamDigestResult = {
  teamId: string | null;
  teamName: string;
  status:
    | 'success'
    | 'partial_success'
    | 'failed'
    | 'skipped';
  responseCount: number;
  digest?: string;
  slackDelivered: boolean;
  slackError: string | null;
  generatedAt: string;
};

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  private readonly runningTeamIds = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly collectionService: CollectionService,
    private readonly digestService: DigestService,
    private readonly slackService: SlackService,
  ) {}

  /**
   * Registers automatic digest jobs for enabled teams
   * when the backend starts.
   */
  async onModuleInit(): Promise<void> {
    if (process.env.DIGEST_SCHEDULER_ENABLED !== 'true') {
      this.logger.warn(
        'Database-driven digest scheduling is disabled.',
      );

      return;
    }

    await this.registerTeamDigestJobs();
  }

  /**
   * Creates one cron job for each enabled team.
   */
  private async registerTeamDigestJobs(): Promise<void> {
    const teams = await this.prisma.team.findMany({
      where: {
        schedulerEnabled: true,
        scheduleCron: {
          not: null,
        },
        slackChannelId: {
          not: null,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (teams.length === 0) {
      this.logger.warn(
        'No enabled teams with a schedule and Slack channel were found.',
      );

      return;
    }

    for (const team of teams) {
      const scheduleCron = team.scheduleCron?.trim();

      const timezone =
        team.timezone?.trim() ||
        process.env.DAILY_DIGEST_TIMEZONE ||
        'Asia/Riyadh';

      if (!scheduleCron) {
        this.logger.warn(
          `Team "${team.name}" does not have a valid cron schedule.`,
        );

        continue;
      }

      const jobName = `daily-digest-${team.id}`;

      try {
        if (
          this.schedulerRegistry.doesExist(
            'cron',
            jobName,
          )
        ) {
          this.schedulerRegistry.deleteCronJob(jobName);
        }

        const job = CronJob.from({
          cronTime: scheduleCron,
          timeZone: timezone,
          waitForCompletion: true,

          onTick: async () => {
            await this.runTeamDigest(team.id);
          },

          errorHandler: (error: unknown) => {
            const message =
              error instanceof Error
                ? error.message
                : String(error);

            this.logger.error(
              `Scheduled digest job failed for team "${team.name}": ${message}`,
            );
          },
        });

        this.schedulerRegistry.addCronJob(jobName, job);
        job.start();

        this.logger.log(
          `Registered digest schedule for team "${team.name}" using "${scheduleCron}" in ${timezone}.`,
        );
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        this.logger.error(
          `Could not register digest schedule for team "${team.name}": ${message}`,
        );
      }
    }
  }

  /**
   * Manual endpoint entry point.
   *
   * Runs a digest for every enabled team.
   * If no Team rows exist, it uses the environment fallback.
   */
  async runDailyDigest() {
    const startedAt = new Date();

    if (process.env.DIGEST_SCHEDULER_ENABLED !== 'true') {
      this.logger.warn('Daily digest scheduler is disabled.');

      return {
        status: 'disabled',
        generatedAt: startedAt.toISOString(),
      };
    }

    const teams = await this.prisma.team.findMany({
      where: {
        schedulerEnabled: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (teams.length === 0) {
      const fallbackResult =
        await this.runEnvironmentFallbackDigest();

      return {
        status: fallbackResult.status,
        mode: 'environment-fallback',
        results: [fallbackResult],
        startedAt: startedAt.toISOString(),
        generatedAt: new Date().toISOString(),
      };
    }

    const results: TeamDigestResult[] = [];

    for (const team of teams) {
      const result = await this.runTeamDigest(team.id);
      results.push(result);
    }

    const failedCount = results.filter(
      (result) => result.status === 'failed',
    ).length;

    const partialCount = results.filter(
      (result) =>
        result.status === 'partial_success',
    ).length;

    return {
      status:
        failedCount > 0 || partialCount > 0
          ? 'partial_success'
          : 'success',
      mode: 'database-teams',
      teamCount: teams.length,
      results,
      startedAt: startedAt.toISOString(),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Generates and posts a digest for one team.
   */
  async runTeamDigest(
    teamId: string,
  ): Promise<TeamDigestResult> {
    const startedAt = new Date();

    if (this.runningTeamIds.has(teamId)) {
      this.logger.warn(
        `Digest generation is already running for team ${teamId}. Duplicate run skipped.`,
      );

      return {
        teamId,
        teamName: teamId,
        status: 'skipped',
        responseCount: 0,
        slackDelivered: false,
        slackError:
          'A digest run is already in progress for this team.',
        generatedAt: startedAt.toISOString(),
      };
    }

    this.runningTeamIds.add(teamId);

    try {
      const team = await this.prisma.team.findUnique({
        where: {
          id: teamId,
        },
      });

      if (!team) {
        throw new Error(`Team ${teamId} was not found.`);
      }

      if (!team.schedulerEnabled) {
        return {
          teamId: team.id,
          teamName: team.name,
          status: 'skipped',
          responseCount: 0,
          slackDelivered: false,
          slackError: 'Team scheduling is disabled.',
          generatedAt: new Date().toISOString(),
        };
      }

      const responses =
        await this.collectionService.getCompletedStandupResponses(
          team.id,
        );

      const nonResponders =
        await this.collectionService.getTeamNonResponders(
          team.id,
          responses,
        );

      const digest =
        this.digestService.generateDailyDigest(
          responses,
          nonResponders,
        );

      const channelId = team.slackChannelId?.trim();

      if (!channelId) {
        return {
          teamId: team.id,
          teamName: team.name,
          status: 'partial_success',
          responseCount: responses.length,
          digest,
          slackDelivered: false,
          slackError:
            'The team does not have a Slack channel configured.',
          generatedAt: new Date().toISOString(),
        };
      }

      if (
        responses.length === 0 &&
        process.env.SEND_EMPTY_DIGEST !== 'true'
      ) {
        this.logger.warn(
          `No completed responses were found for team "${team.name}". Empty digest not posted.`,
        );

        return {
          teamId: team.id,
          teamName: team.name,
          status: 'skipped',
          responseCount: 0,
          digest,
          slackDelivered: false,
          slackError:
            'No completed responses were found.',
          generatedAt: new Date().toISOString(),
        };
      }

      if (
        process.env.SLACK_DIGEST_ENABLED !== 'true'
      ) {
        return {
          teamId: team.id,
          teamName: team.name,
          status: 'partial_success',
          responseCount: responses.length,
          digest,
          slackDelivered: false,
          slackError:
            'SLACK_DIGEST_ENABLED is not true.',
          generatedAt: new Date().toISOString(),
        };
      }

      const slackDelivered =
        await this.slackService.sendMessage({
          channelId,
          text: digest,
        });

      const completedAt = new Date();

      if (!slackDelivered) {
        return {
          teamId: team.id,
          teamName: team.name,
          status: 'partial_success',
          responseCount: responses.length,
          digest,
          slackDelivered: false,
          slackError:
            'SlackService could not deliver the digest.',
          generatedAt: completedAt.toISOString(),
        };
      }

      this.logger.log(
        `Digest for team "${team.name}" posted to Slack with ${responses.length} response(s) and ${nonResponders.length} non-responder(s) in ${
          completedAt.getTime() - startedAt.getTime()
        }ms.`,
      );

      return {
        teamId: team.id,
        teamName: team.name,
        status: 'success',
        responseCount: responses.length,
        digest,
        slackDelivered: true,
        slackError: null,
        generatedAt: completedAt.toISOString(),
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.error(
        `Team digest generation failed for team ${teamId}: ${message}`,
        error instanceof Error
          ? error.stack
          : undefined,
      );

      return {
        teamId,
        teamName: teamId,
        status: 'failed',
        responseCount: 0,
        slackDelivered: false,
        slackError: message,
        generatedAt: new Date().toISOString(),
      };
    } finally {
      this.runningTeamIds.delete(teamId);
    }
  }

  /**
   * Keeps the original environment-based behavior
   * when no Team records exist.
   */
  private async runEnvironmentFallbackDigest(): Promise<TeamDigestResult> {
    const responses =
      await this.collectionService.getCompletedStandupResponses();

    const digest =
      this.digestService.generateDailyDigest(responses);

    const channelId =
      process.env.SLACK_DIGEST_CHANNEL_ID?.trim();

    if (!channelId) {
      return {
        teamId: null,
        teamName: 'Environment fallback',
        status: 'partial_success',
        responseCount: responses.length,
        digest,
        slackDelivered: false,
        slackError:
          'SLACK_DIGEST_CHANNEL_ID is missing.',
        generatedAt: new Date().toISOString(),
      };
    }

    if (
      responses.length === 0 &&
      process.env.SEND_EMPTY_DIGEST !== 'true'
    ) {
      return {
        teamId: null,
        teamName: 'Environment fallback',
        status: 'skipped',
        responseCount: 0,
        digest,
        slackDelivered: false,
        slackError:
          'No completed responses were found.',
        generatedAt: new Date().toISOString(),
      };
    }

    if (
      process.env.SLACK_DIGEST_ENABLED !== 'true'
    ) {
      return {
        teamId: null,
        teamName: 'Environment fallback',
        status: 'partial_success',
        responseCount: responses.length,
        digest,
        slackDelivered: false,
        slackError:
          'SLACK_DIGEST_ENABLED is not true.',
        generatedAt: new Date().toISOString(),
      };
    }

    const slackDelivered =
      await this.slackService.sendMessage({
        channelId,
        text: digest,
      });

    return {
      teamId: null,
      teamName: 'Environment fallback',
      status: slackDelivered
        ? 'success'
        : 'partial_success',
      responseCount: responses.length,
      digest,
      slackDelivered,
      slackError: slackDelivered
        ? null
        : 'SlackService could not deliver the digest.',
      generatedAt: new Date().toISOString(),
    };
  }
}