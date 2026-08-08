import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { CronJob } from 'cron';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  AiDigestResult,
  RawResponseForAnalysis,
} from '../ai/dto/ai-result.dto';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionService } from '../collection/collection.service';
import { DigestService } from '../digest/digest.service';
import { ReportsService } from '../reports/reports.service';
import { SlackService } from '../slack/slack.service';
import { SlackGateway } from '../slack/slack.gateway';

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
  private isStandupRunning = false;
  private isReminderRunning = false;


  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly collectionService: CollectionService,
    private readonly digestService: DigestService,
    private readonly slackService: SlackService,

    private readonly slackGateway: SlackGateway,
    private readonly aiService: AiService,
    private readonly reportsService: ReportsService,
  ) {}

  /**
   * Registers automatic collection, reminder, and digest jobs
   * for enabled teams when the backend starts.
   */
  async onModuleInit(): Promise<void> {
    if (process.env.DIGEST_SCHEDULER_ENABLED !== 'true') {
      this.logger.warn(
        'Database-driven scheduling is disabled.',
      );

      return;
    }

    await this.registerTeamJobs();
  }

  /**
   * Creates collection, reminder, and digest cron jobs
   * for every enabled team.
   */
  private async registerTeamJobs(): Promise<void> {
    const teams = await this.prisma.team.findMany({
      where: {
        schedulerEnabled: true,
        scheduleCron: {
          not: null,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    if (teams.length === 0) {
      this.logger.warn(
        'No enabled teams with a schedule were found.',
      );

      return;
    }

    for (const team of teams) {
      const digestCron = team.scheduleCron?.trim();

      const collectionCron =
        process.env.DAILY_COLLECTION_CRON?.trim() ||
        '0 0 8 * * 0-4';

      const reminderCron =
        process.env.DAILY_REMINDER_CRON?.trim() ||
        '0 45 8 * * 0-4';

      const timezone =
        team.timezone?.trim() ||
        process.env.DAILY_DIGEST_TIMEZONE ||
        'Asia/Riyadh';

      if (!digestCron) {
        this.logger.warn(
          `Team "${team.name}" does not have a valid digest cron schedule.`,
        );

        continue;
      }

      this.registerCronJob({
        jobName: `standup-collection-${team.id}`,
        cronTime: collectionCron,
        timezone,
        teamName: team.name,
        taskName: 'standup collection',
        onTick: async () => {
          await this.startTeamStandupCollection(team.id);
        },
      });

      this.registerCronJob({
        jobName: `standup-reminder-${team.id}`,
        cronTime: reminderCron,
        timezone,
        teamName: team.name,
        taskName: 'standup reminder',
        onTick: async () => {
          await this.sendTeamStandupReminder(team.id);
        },
      });

      this.registerCronJob({
        jobName: `daily-digest-${team.id}`,
        cronTime: digestCron,
        timezone,
        teamName: team.name,
        taskName: 'daily digest',
        onTick: async () => {
          await this.runTeamDigest(team.id);
        },
      });
    }
  }

  private registerCronJob(input: {
    jobName: string;
    cronTime: string;
    timezone: string;
    teamName: string;
    taskName: string;
    onTick: () => Promise<void>;
  }): void {
    try {
      if (
        this.schedulerRegistry.doesExist(
          'cron',
          input.jobName,
        )
      ) {
        this.schedulerRegistry.deleteCronJob(
          input.jobName,
        );
      }

      const job = CronJob.from({
        cronTime: input.cronTime,
        timeZone: input.timezone,
        waitForCompletion: true,

        onTick: input.onTick,

        errorHandler: (error: unknown) => {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          this.logger.error(
            `${input.taskName} failed for team "${input.teamName}": ${message}`,
          );
        },
      });

      this.schedulerRegistry.addCronJob(
        input.jobName,
        job,
      );

      job.start();

      this.logger.log(
        `Registered ${input.taskName} for team "${input.teamName}" using "${input.cronTime}" in ${input.timezone}.`,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.error(
        `Could not register ${input.taskName} for team "${input.teamName}": ${message}`,
      );

    }
  }

  /**

   * Starts one shared team standup and sends the first question
   * directly to every active team member in Slack.
   */
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

    try {
      const members = await this.slackService.getWorkspaceMembers();
      let initiatedCount = 0;

      for (const member of members) {
        try {
          const dmChannelId = await this.slackService.openDirectMessage(member.id);

          if (!dmChannelId) {
            continue;
          }

          await this.slackGateway.triggerAutomaticStandupForUser(
            member.id,
            dmChannelId,
          );

          initiatedCount += 1;
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);

          this.logger.error(
            `Failed to trigger standup for user ${member.id}: ${message}`,
          );
        }
      }

      return {
        status: 'success',
        totalMembers: members.length,
        initiatedCount,
        startedAt: startedAt.toISOString(),
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Daily standup trigger failed: ${message}`);

      return { status: 'failed', error: message };
    } finally {
      this.isStandupRunning = false;
    }
  }

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

    try {
      const members = await this.slackService.getWorkspaceMembers();
      let reminderCount = 0;

      for (const member of members) {
        const isCompleted =
          await this.collectionService.isStandupCompletedToday(member.id);

        if (isCompleted) {
          continue;
        }

        const dmChannelId =
          await this.slackService.openDirectMessage(member.id);

        if (!dmChannelId) {
          continue;
        }

        await this.slackGateway.sendStandupReminder(
          member.id,
          dmChannelId,
        );

        reminderCount += 1;
      }

      return { status: 'success', reminderCount };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`Standup reminder run failed: ${message}`);

      return { status: 'failed', error: message };
    } finally {
      this.isReminderRunning = false;
    }
  }

  async startTeamStandupCollection(teamId: string) {
    const team = await this.prisma.team.findUnique({
      where: {
        id: teamId,
      },
    });

    if (!team) {
      return {
        status: 'failed',
        teamId,
        teamName: teamId,
        memberCount: 0,
        deliveredCount: 0,
        failedUserIds: [],
        error: `Team ${teamId} was not found.`,
        generatedAt: new Date().toISOString(),
      };
    }

    if (!team.schedulerEnabled) {
      return {
        status: 'skipped',
        teamId: team.id,
        teamName: team.name,
        memberCount: 0,
        deliveredCount: 0,
        failedUserIds: [],
        error: 'Team scheduling is disabled.',
        generatedAt: new Date().toISOString(),
      };
    }

    try {
      const prompts =
        await this.collectionService.startTeamStandup(
          team.id,
        );

      if (prompts.length === 0) {
        return {
          status: 'skipped',
          teamId: team.id,
          teamName: team.name,
          memberCount: 0,
          deliveredCount: 0,
          failedUserIds: [],
          error: 'No active team members were found.',
          generatedAt: new Date().toISOString(),
        };
      }

      let deliveredCount = 0;
      const failedUserIds: string[] = [];

      for (const prompt of prompts) {
        const delivered =
          await this.slackService.sendMessage({
            channelId: prompt.userId,
            text:
              `*Daily standup — ${team.name}*\n` +
              `${prompt.question.text}\n\n` +
              '_Reply directly to this message to continue._',
          });

        if (delivered) {
          deliveredCount += 1;
        } else {
          failedUserIds.push(prompt.userId);
        }
      }

      return {
        status:
          deliveredCount === prompts.length
            ? 'success'
            : deliveredCount > 0
              ? 'partial_success'
              : 'failed',
        teamId: team.id,
        teamName: team.name,
        memberCount: prompts.length,
        deliveredCount,
        failedUserIds,
        error:
          failedUserIds.length > 0
            ? 'One or more Slack messages could not be delivered.'
            : null,
        generatedAt: new Date().toISOString(),
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.error(
        `Could not start standup collection for team "${team.name}": ${message}`,
      );

      return {
        status: 'failed',
        teamId: team.id,
        teamName: team.name,
        memberCount: 0,
        deliveredCount: 0,
        failedUserIds: [],
        error: message,
        generatedAt: new Date().toISOString(),
      };

    }
  }

  /**

   * Sends one reminder to members who have not completed
   * the latest collecting standup run.
   */
  async sendTeamStandupReminder(teamId: string) {
    const team = await this.prisma.team.findUnique({
      where: {
        id: teamId,
      },
    });

    if (!team) {
      return {
        status: 'failed',
        teamId,
        teamName: teamId,
        pendingCount: 0,
        deliveredCount: 0,
        failedUserIds: [],
        error: `Team ${teamId} was not found.`,
        generatedAt: new Date().toISOString(),
      };
    }

    try {
      const pendingMembers =
        await this.collectionService.getPendingTeamStandupMembers(
          team.id,
        );

      if (pendingMembers.length === 0) {
        return {
          status: 'skipped',
          teamId: team.id,
          teamName: team.name,
          pendingCount: 0,
          deliveredCount: 0,
          failedUserIds: [],
          error: 'No pending standup responses were found.',
          generatedAt: new Date().toISOString(),
        };
      }

      let deliveredCount = 0;
      const failedUserIds: string[] = [];

      for (const member of pendingMembers) {
        const questionText =
          member.currentQuestion?.text ||
          'Please complete your daily standup.';

        const delivered =
          await this.slackService.sendMessage({
            channelId: member.userId,
            text:
              `*Standup reminder — ${team.name}*\n` +
              `${questionText}\n\n` +
              '_Reply directly to continue your standup._',
          });

        if (delivered) {
          deliveredCount += 1;
        } else {
          failedUserIds.push(member.userId);
        }
      }

      return {
        status:
          deliveredCount === pendingMembers.length
            ? 'success'
            : deliveredCount > 0
              ? 'partial_success'
              : 'failed',
        teamId: team.id,
        teamName: team.name,
        pendingCount: pendingMembers.length,
        deliveredCount,
        failedUserIds,
        error:
          failedUserIds.length > 0
            ? 'One or more reminders could not be delivered.'
            : null,
        generatedAt: new Date().toISOString(),
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.error(
        `Could not send standup reminders for team "${team.name}": ${message}`,
      );

      return {
        status: 'failed',
        teamId: team.id,
        teamName: team.name,
        pendingCount: 0,
        deliveredCount: 0,
        failedUserIds: [],
        error: message,
        generatedAt: new Date().toISOString(),
      };
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

    if (process.env.DIGEST_SCHEDULER_ENABLED === 'false') {
      this.logger.warn('Daily digest scheduler is disabled via env.');
      return { status: 'disabled', generatedAt: startedAt.toISOString() };
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

      /*
       * Keep the existing formatted digest as a reliable fallback.
       * If AI analysis is unavailable or fails, this digest is still posted.
       */
      let digest =
        this.digestService.generateDailyDigest(
          responses,
          nonResponders,
        );

      let aiDigestForBlocks: AiDigestResult | null = null;

      if (responses.length > 0) {
        try {
          const latestCompletedRun =
            await this.prisma.standupRun.findFirst({
              where: {
                teamId: team.id,
                status: 'completed',
              },
              orderBy: [
                {
                  completedAt: 'desc',
                },
                {
                  createdAt: 'desc',
                },
              ],
              include: {
                submissions: {
                  where: {
                    status: 'completed',
                  },
                  include: {
                    user: true,
                    answers: {
                      include: {
                        question: true,
                      },
                      orderBy: {
                        createdAt: 'asc',
                      },
                    },
                  },
                },
              },
            });

          if (!latestCompletedRun) {
            this.logger.warn(
              `No completed StandupRun was found for team "${team.name}". Using the rules-based digest.`,
            );
          } else {
            const aiResponses: RawResponseForAnalysis[] =
              latestCompletedRun.submissions
                .filter(
                  (submission) =>
                    submission.answers.length > 0,
                )
                .map((submission) => ({
                  userId: submission.user.slackUserId,
                  answers: submission.answers.map(
                    (answer) => ({
                      questionId: answer.questionId,
                      questionText:
                        answer.question.question,
                      text: answer.text,
                    }),
                  ),
                }));

            if (aiResponses.length === 0) {
              this.logger.warn(
                `Completed run ${latestCompletedRun.id} has no answers for AI analysis. Using the rules-based digest.`,
              );
            } else {
              const aiResult =
                await this.getOrGenerateAiDigest(
                  team.id,
                  latestCompletedRun.id,
                  aiResponses,
                );

              aiDigestForBlocks = aiResult;

              digest =
                this.reportsService.formatDigestForSlack(
                  aiResult,
                );

              const nonResponderSection =
                nonResponders.length > 0
                  ? [
                      '*⏳ No Response*',
                      ...nonResponders.map(
                        (member) =>
                          `• ${member.name}`,
                      ),
                    ].join('\n')
                  : '*⏳ No Response*\n• Everyone submitted.';

              digest =
                `${digest}\n\n${nonResponderSection}`;

              this.logger.log(
                `AI digest prepared for team "${team.name}" using standup run ${latestCompletedRun.id}.`,
              );
            }
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          this.logger.error(
            `AI digest generation failed for team "${team.name}". Using the rules-based digest instead: ${message}`,
            error instanceof Error
              ? error.stack
              : undefined,
          );

        }
      }

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

      const digestBlocks =
        aiDigestForBlocks
          ? this.reportsService.buildDigestBlocks(
              aiDigestForBlocks,
              nonResponders.map(
                (member) => member.name,
              ),
            )
          : undefined;

      const slackDelivered =
        await this.slackService.sendMessage({
          channelId,
          text: digest,
          ...(digestBlocks
            ? { blocks: digestBlocks }
            : {}),
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
   * Reuses an existing digest for the run when available.
   * Otherwise, calls AiService, which generates and saves it.
   */
  private async getOrGenerateAiDigest(
    teamId: string,
    runId: string,
    responses: RawResponseForAnalysis[],
  ): Promise<AiDigestResult> {
    const existingDigest =
      await this.prisma.aiDigest.findFirst({
        where: {
          teamId,
          runId,
        },
        orderBy: {
          generatedAt: 'desc',
        },
      });

    if (existingDigest) {
      this.logger.log(
        `Using existing AI digest for standup run ${runId}.`,
      );

      return {
        teamId: existingDigest.teamId,
        runId: existingDigest.runId,
        generatedAt:
          existingDigest.generatedAt.toISOString(),
        source:
          existingDigest.source === 'rules_fallback'
            ? 'rules_fallback'
            : 'ai',
        summary: existingDigest.summary,
       blockers:
  existingDigest.blockers as unknown as AiDigestResult['blockers'],
themes:
  existingDigest.themes as unknown as AiDigestResult['themes'],
      };
    }

    return this.aiService.analyzeRun(
      teamId,
      runId,
      responses,
    );
  }

  /**
   * Keeps the original environment-based behavior
   * when no Team records exist.
   *
   * AI analysis is not used here because there is no database
   * Team/StandupRun pair to safely link to AiDigest.
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
