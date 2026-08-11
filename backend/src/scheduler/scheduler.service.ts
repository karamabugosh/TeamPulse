import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import {
  AiDigestResult,
  RawResponseForAnalysis,
  EMPTY_REPORT_SECTIONS,
} from '../ai/dto/ai-result.dto';
import { AiService } from '../ai/ai.service';
import { CheckInRunService } from '../check-in/check-in-run/check-in-run.service';
import { CheckInReportService } from '../check-in/check-in-report.service';
import { CollectionService } from '../collection/collection.service';
import { DigestService } from '../digest/digest.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { CheckInThreadService } from '../slack/check-in-thread.service';
import { SlackGateway } from '../slack/slack.gateway';
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
export class SchedulerService
  implements OnModuleInit
{
  private readonly logger =
    new Logger(SchedulerService.name);

  private readonly runningTeamIds =
    new Set<string>();

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
    private readonly checkInRunService: CheckInRunService,
    private readonly checkInThreadService: CheckInThreadService,
    private readonly checkInReportService: CheckInReportService,
  ) {}

  // =========================================================
  // V2 SCHEDULER ENABLEMENT
  // =========================================================

  /**
   * CHECKIN_SCHEDULER_ENABLED is the preferred V2 flag.
   *
   * DIGEST_SCHEDULER_ENABLED remains as a compatibility
   * fallback while the V1 environment configuration exists.
   */
  private isCheckInSchedulerEnabled(): boolean {
    const configuredValue =
      process.env.CHECKIN_SCHEDULER_ENABLED ??
      process.env.DIGEST_SCHEDULER_ENABLED;

    return configuredValue === 'true';
  }

  // =========================================================
  // STARTUP
  // =========================================================

  async onModuleInit(): Promise<void> {
    if (!this.isCheckInSchedulerEnabled()) {
      this.logger.warn(
        'Database-driven CheckIn scheduling is disabled.',
      );

      return;
    }

    await this.registerCheckInJobs();

    /*
     * Reminder delivery is DB-backed rather than based on
     * in-memory setTimeout calls.
     *
     * The sweep can therefore recover reminders after an
     * application restart.
     */
    this.registerPersistentReminderSweep();
    this.registerPersistentReportSweep();
  }

  // =========================================================
  // DYNAMIC JOB REFRESH
  // =========================================================

  /**
   * Removes the currently registered V2 CheckIn collection
   * and report jobs, then recreates them from PostgreSQL.
   *
   * This is used after CheckIn configuration changes.
   */
  async refreshCheckInJobs() {
    const cronJobs =
      this.schedulerRegistry.getCronJobs();

    const removedJobs: string[] = [];

    for (const jobName of cronJobs.keys()) {
      if (
        jobName.startsWith(
          'checkin-collection-',
        ) ||
        jobName.startsWith(
          'checkin-report-',
        )
      ) {
        this.schedulerRegistry.deleteCronJob(
          jobName,
        );

        removedJobs.push(
          jobName,
        );
      }
    }

    if (!this.isCheckInSchedulerEnabled()) {
      this.logger.warn(
        'Database-driven CheckIn scheduling is disabled. Existing V2 jobs were removed but none were re-registered.',
      );

      return {
        status: 'disabled',
        removedCount:
          removedJobs.length,
        registeredCount: 0,
        generatedAt:
          new Date().toISOString(),
      };
    }

    const registeredCount =
      await this.registerCheckInJobs();

    /*
     * registerCronJob replaces a job with the same name,
     * so this is safe to call during refresh.
     */
    this.registerPersistentReminderSweep();

    this.logger.log(
      `Scheduler refreshed: removed ${removedJobs.length} V2 job(s), registered ${registeredCount} CheckIn job(s).`,
    );

    return {
      status: 'success',
      removedCount:
        removedJobs.length,
      registeredCount,
      generatedAt:
        new Date().toISOString(),
    };
  }

  // =========================================================
  // CHECK-IN CRON REGISTRATION
  // =========================================================

  /**
   * Creates collection/report jobs for every enabled CheckIn.
   *
   * Reminder timing is NOT registered here. Reminder state
   * belongs to each StandupRun and is processed by the
   * persistent reminder sweep.
   */
  private async registerCheckInJobs():
    Promise<number> {
    const checkIns =
      await this.prisma.checkIn.findMany({
        where: {
          enabled: true,
          publishStatus: 'published',
          scheduleEnabled: true,
        },

        include: {
          team: {
            select: {
              id: true,
              name: true,
            },
          },
        },

        orderBy: {
          createdAt: 'asc',
        },
      });

    if (checkIns.length === 0) {
      this.logger.warn(
        'No enabled CheckIns were found.',
      );

      return 0;
    }

    let registeredCount = 0;

    for (const checkIn of checkIns) {
      const collectionCron =
        checkIn.collectionCron.trim();

      const timezone =
        checkIn.timezone.trim();

      if (!collectionCron) {
        this.logger.warn(
          `CheckIn "${checkIn.name}" has no collection schedule.`,
        );

        continue;
      }

      this.registerCronJob({
        jobName:
          `checkin-collection-${checkIn.id}`,

        cronTime:
          collectionCron,

        timezone,

        teamName:
          `${checkIn.team.name} / ${checkIn.name}`,

        taskName:
          'check-in collection',

        onTick: async () => {
          await this.startScheduledCheckIn(
            checkIn.id,
          );
        },
      });

      registeredCount += 1;

      const reportCron =
        checkIn.reportCron?.trim();

      if (
        reportCron &&
        checkIn.reportTriggerMode !== 'all_answered'
      ) {
        this.registerCronJob({
          jobName:
            `checkin-report-${checkIn.id}`,

          cronTime:
            reportCron,

          timezone,

          teamName:
            `${checkIn.team.name} / ${checkIn.name}`,

          taskName:
            'check-in report',

          onTick: async () => {
            const runId =
              await this.checkInReportService.findScheduledRunForReport(
                checkIn.id,
              );

            if (!runId) {
              this.logger.warn(
                `[Scheduler] No eligible run found for scheduled report on CheckIn ${checkIn.id}`,
              );
              return;
            }

            await this.checkInReportService.execute(
              checkIn.id,
              runId,
              { skipTriggerValidation: true },
            );
          },
        });

        registeredCount += 1;
      }
    }

    return registeredCount;
  }

  // =========================================================
  // CHECK-IN COLLECTION
  // =========================================================

  /**
   * Starts one scheduled CheckIn occurrence.
   *
   * scheduledFor is normalized to the minute because
   * [checkInId, scheduledFor] is the database uniqueness
   * boundary for one scheduled occurrence.
   *
   * CheckInRunService owns:
   * - run creation
   * - submission creation
   * - conversation creation
   * - participant conflict handling
   * - reminderDueAt initialization
   */
  private async startScheduledCheckIn(
    checkInId: string,
  ): Promise<void> {
    this.logger.log(
      `[Scheduler] CheckIn collection triggered for ${checkInId}`,
    );

    const scheduledFor =
      new Date();

    scheduledFor.setSeconds(
      0,
      0,
    );

    const result =
      await this.checkInRunService.startCheckInRun(
        checkInId,
        scheduledFor,
        'scheduler',
      );

    this.logger.log(
      `[Scheduler] startCheckInRun status=${result.status} checkIn="${result.checkInName}" submissions=${result.run?.submissions?.length ?? 0} skipped=${result.skippedParticipantCount ?? 0}`,
    );

    if (!result.run) {
      this.logger.warn(
        `[Scheduler] No run returned for CheckIn ${checkInId} — nothing to deliver.`,
      );
      return;
    }

    const thread = await this.checkInThreadService.createRunThread(
      result.run.id,
    );

    if (thread.ok === false) {
      this.logger.error(
        `[Scheduler] Aborting DM delivery for "${result.checkInName}" — public standup message was not posted: ${thread.reason}`,
      );
      return;
    }

    if (result.run.submissions.length === 0) {
      this.logger.log(
        `[Scheduler] CheckIn "${result.checkInName}" run ${result.run.id} has no eligible submissions.`,
      );
      return;
    }

    const delivery = await this.slackGateway.deliverCheckInRun(result);

    this.logger.log(
      `[Scheduler] DM delivery for "${result.checkInName}": ${delivery.delivered} sent, ${delivery.failed} failed, ${delivery.skipped} skipped`,
    );

    if (delivery.failed > 0) {
      this.logger.error(
        `[Scheduler] ${delivery.failed} participant(s) did not receive a DM for CheckIn "${result.checkInName}". Check Slack token, scopes (chat:write, im:write), and bot installation.`,
      );
    }
  }

  // =========================================================
  // PERSISTENT REMINDERS
  // =========================================================

  /**
   * Runs every minute and checks PostgreSQL for reminders
   * whose due time has arrived.
   *
   * Unlike setTimeout(), this survives process restarts.
   */
  private registerPersistentReminderSweep():
    void {
    this.registerCronJob({
      jobName:
        'checkin-reminder-sweep',

      cronTime:
        '* * * * *',

      timezone:
        'UTC',

      teamName:
        'Pulse',

      taskName:
        'persistent reminder sweep',

      onTick: async () => {
        await this.processDueCheckInReminders();
      },
    });
  }

  private registerPersistentReportSweep(): void {
    this.registerCronJob({
      jobName: 'checkin-report-sweep',
      cronTime: '* * * * *',
      timezone: 'UTC',
      teamName: 'Pulse',
      taskName: 'persistent report sweep',
      onTick: async () => {
        await this.checkInReportService.processDueReports();
      },
    });
  }

  /**
   * Finds due reminder rows and delivers them.
   *
   * reminderSentAt is only written after reminder processing
   * succeeds. If processing throws, the row remains eligible
   * for a later sweep.
   *
   * Delivery semantics are intentionally at-least-once:
   * if the process crashes after Slack accepts a message but
   * before reminderSentAt is saved, a later retry may resend.
   */
  private async processDueCheckInReminders():
    Promise<void> {
    const now =
      new Date();

    const dueRuns =
      await this.prisma.standupRun.findMany({
        where: {
          reminderDueAt: {
            lte: now,
          },

          reminderSentAt:
            null,

          status: {
            not:
              'completed',
          },

          checkInId: {
            not: null,
          },

          checkIn: {
            is: {
              enabled:
                true,

              reminderEnabled:
                true,
            },
          },
        },

        orderBy: {
          reminderDueAt:
            'asc',
        },

        take: 100,

        select: {
          id: true,
          reminderDueAt: true,
          reminderSentAt: true,
          status: true,
        },
      });

    if (
      dueRuns.length ===
      0
    ) {
      return;
    }

    this.logger.log(
      `Persistent reminder sweep found ${dueRuns.length} due CheckIn run(s).`,
    );

    for (const dueRun of dueRuns) {
      try {
        /*
         * Re-read before delivery because the run may have
         * completed after the initial query.
         */
        const currentRun =
          await this.prisma.standupRun.findUnique({
            where: {
              id:
                dueRun.id,
            },

            select: {
              id: true,
              status: true,
              reminderDueAt:
                true,
              reminderSentAt:
                true,
            },
          });

        if (
          !currentRun ||
          currentRun.status ===
            'completed' ||
          currentRun.reminderSentAt ||
          !currentRun.reminderDueAt ||
          currentRun.reminderDueAt >
            new Date()
        ) {
          continue;
        }

        await this.sendCheckInRunReminder(
          currentRun.id,
        );

        /*
         * updateMany gives us a final idempotency guard.
         *
         * We only transition a reminder that is still unsent.
         */
        await this.prisma.standupRun.updateMany({
          where: {
            id:
              currentRun.id,

            reminderSentAt:
              null,
          },

          data: {
            reminderSentAt:
              new Date(),
          },
        });

        this.logger.log(
          `Reminder state completed for CheckIn run ${currentRun.id}.`,
        );
      } catch (
        error: unknown
      ) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        /*
         * Do not set reminderSentAt here.
         *
         * Leaving it null lets the next sweep retry.
         */
        this.logger.error(
          `Persistent reminder processing failed for run ${dueRun.id}: ${message}`,
          error instanceof Error
            ? error.stack
            : undefined,
        );
      }
    }
  }

  /**
   * Sends the reminder for one exact run.
   *
   * Only participants whose submission remains incomplete
   * receive a message.
   */
  private async sendCheckInRunReminder(
    runId: string,
  ): Promise<void> {
    const run =
      await this.prisma.standupRun.findUnique({
        where: {
          id:
            runId,
        },

        include: {
          checkIn: {
            select: {
              id: true,
              name: true,
              enabled: true,
              reminderEnabled:
                true,
            },
          },

          team: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

    if (
      !run ||
      !run.checkIn
    ) {
      this.logger.warn(
        `Cannot send reminder: V2 run ${runId} was not found.`,
      );

      return;
    }

    if (
      run.status ===
      'completed'
    ) {
      this.logger.log(
        `Reminder skipped because run ${runId} is complete.`,
      );

      return;
    }

    if (
      !run.checkIn.enabled ||
      !run.checkIn
        .reminderEnabled
    ) {
      this.logger.log(
        `Reminder skipped because reminders are disabled for CheckIn "${run.checkIn.name}".`,
      );

      return;
    }

    const pendingMembers =
      await this.collectionService.getPendingRunMembers(
        run.id,
      );

    if (
      pendingMembers.length ===
      0
    ) {
      this.logger.log(
        `Reminder skipped for run ${runId}: no pending participants remain.`,
      );

      return;
    }

    let deliveredCount = 0;
    let failedCount = 0;

    for (
      const member
      of pendingMembers
    ) {
      const dmChannelId =
        member.dmChannelId ||
        (await this.slackService.openDirectMessage(member.userId));

      if (!dmChannelId) {
        failedCount += 1;
        continue;
      }

      const questionText =
        member.currentQuestion?.text ||
        'Please complete your check-in.';

      await this.slackGateway.sendStandupReminder(
        member.userId,
        dmChannelId,
        run.checkIn.name,
        questionText,
      );

      deliveredCount += 1;
    }

    this.logger.log(
      `Reminder for run ${runId}: delivered ${deliveredCount}/${pendingMembers.length}.`,
    );

    if (
      failedCount > 0 &&
      deliveredCount > 0
    ) {
      this.logger.warn(
        `Reminder for run ${runId} partially delivered: ${failedCount} participant(s) failed.`,
      );
    }

    /*
     * If every delivery attempt failed, throw so the
     * persistent sweep leaves reminderSentAt null.
     *
     * A later sweep can then retry.
     */
    if (
      pendingMembers.length >
        0 &&
      deliveredCount === 0
    ) {
      throw new Error(
        `Reminder delivery failed for all ${pendingMembers.length} pending participant(s) in run ${runId}.`,
      );
    }
  }

  // =========================================================
  // V2 CHECK-IN REPORTING
  // =========================================================

  async runCheckInDigest(
    checkInId: string,
    runId?: string,
  ): Promise<TeamDigestResult> {
    const checkIn =
      await this.prisma.checkIn.findUnique({
        where: { id: checkInId },
        include: { team: true },
      });

    if (!checkIn) {
      return {
        teamId: null,
        teamName: checkInId,
        status: 'failed',
        responseCount: 0,
        slackDelivered: false,
        slackError: `CheckIn ${checkInId} was not found.`,
        generatedAt: new Date().toISOString(),
      };
    }

    const resolvedRunId =
      runId ??
      (await this.checkInReportService.findScheduledRunForReport(
        checkInId,
      ));

    if (!resolvedRunId) {
      return {
        teamId: checkIn.team.id,
        teamName: checkIn.team.name,
        status: 'skipped',
        responseCount: 0,
        slackDelivered: false,
        slackError: 'No CheckIn run exists yet.',
        generatedAt: new Date().toISOString(),
      };
    }

    const result = await this.checkInReportService.execute(
      checkInId,
      resolvedRunId,
      { skipTriggerValidation: !!runId, allowRetry: true },
    );

    return {
      teamId: checkIn.team.id,
      teamName: checkIn.team.name,
      status: result.status,
      responseCount: result.responseCount,
      slackDelivered: result.slackDelivered,
      slackError: result.slackError ?? result.message ?? null,
      generatedAt: new Date().toISOString(),
    };
  }

  // =========================================================
  // GENERIC CRON REGISTRATION
  // =========================================================

  private registerCronJob(
    input: {
      jobName: string;
      cronTime: string;
      timezone: string;
      teamName: string;
      taskName: string;
      onTick: () => Promise<void>;
    },
  ): void {
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

      const job =
        CronJob.from({
          cronTime:
            input.cronTime,

          timeZone:
            input.timezone,

          waitForCompletion:
            true,

          onTick:
            input.onTick,

          errorHandler:
            (
              error: unknown,
            ) => {
              const message =
                error instanceof Error
                  ? error.message
                  : String(error);

              this.logger.error(
                `${input.taskName} failed for "${input.teamName}": ${message}`,
              );
            },
        });

      this.schedulerRegistry.addCronJob(
        input.jobName,
        job,
      );

      job.start();

      this.logger.log(
        `Registered ${input.taskName} for "${input.teamName}" using "${input.cronTime}" in ${input.timezone}.`,
      );
    } catch (
      error: unknown
    ) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.error(
        `Could not register ${input.taskName} for "${input.teamName}": ${message}`,
      );
    }
  }

  // =========================================================
  // LEGACY COMPATIBILITY
  // =========================================================

  /**
   * Legacy daily standup trigger.
   *
   * Retained temporarily so existing controllers/integrations
   * continue compiling while V2 CheckIns become the primary
   * scheduling path.
   */
  async triggerDailyStandup() {
    const startedAt =
      new Date();

    if (
      process.env.STANDUP_SCHEDULER_ENABLED ===
      'false'
    ) {
      return {
        status:
          'disabled',

        generatedAt:
          startedAt.toISOString(),
      };
    }

    if (
      this.isStandupRunning
    ) {
      return {
        status:
          'skipped',

        reason:
          'Standup trigger in progress',
      };
    }

    this.isStandupRunning =
      true;

    try {
      const members =
        await this.slackService.getWorkspaceMembers();

      let initiatedCount =
        0;

      for (
        const member
        of members
      ) {
        try {
          const dmChannelId =
            await this.slackService.openDirectMessage(
              member.id,
            );

          if (!dmChannelId) {
            continue;
          }

          await this.slackGateway.triggerAutomaticStandupForUser(
            member.id,
            dmChannelId,
          );

          initiatedCount +=
            1;
        } catch (
          error: unknown
        ) {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          this.logger.error(
            `Failed to trigger standup for ${member.id}: ${message}`,
          );
        }
      }

      return {
        status:
          'success',

        totalMembers:
          members.length,

        initiatedCount,

        startedAt:
          startedAt.toISOString(),
      };
    } finally {
      this.isStandupRunning =
        false;
    }
  }

  /**
   * Legacy workspace-wide reminder.
   */
  async triggerDailyReminder() {
    if (
      process.env.REMINDER_SCHEDULER_ENABLED ===
      'false'
    ) {
      return {
        status:
          'disabled',
      };
    }

    if (
      this.isReminderRunning
    ) {
      return {
        status:
          'skipped',

        reason:
          'Reminder run in progress',
      };
    }

    this.isReminderRunning =
      true;

    try {
      const members =
        await this.slackService.getWorkspaceMembers();

      let reminderCount =
        0;

      for (
        const member
        of members
      ) {
        const completed =
          await this.collectionService.isStandupCompletedToday(
            member.id,
          );

        if (completed) {
          continue;
        }

        const dmChannelId =
          await this.slackService.openDirectMessage(
            member.id,
          );

        if (!dmChannelId) {
          continue;
        }

        await this.slackGateway.sendStandupReminder(
          member.id,
          dmChannelId,
          'Daily Standup',
          'Please complete your check-in when you have a moment.',
        );

        reminderCount +=
          1;
      }

      return {
        status:
          'success',

        reminderCount,
      };
    } finally {
      this.isReminderRunning =
        false;
    }
  }

  /**
   * Legacy team-level collection.
   */
  async startTeamStandupCollection(
    teamId: string,
  ) {
    const team =
      await this.prisma.team.findUnique({
        where: {
          id:
            teamId,
        },
      });

    if (!team) {
      return {
        status:
          'failed',

        teamId,

        teamName:
          teamId,

        memberCount:
          0,

        deliveredCount:
          0,

        failedUserIds: [],

        error:
          `Team ${teamId} was not found.`,

        generatedAt:
          new Date().toISOString(),
      };
    }

    try {
      const prompts =
        await this.collectionService.startTeamStandup(
          team.id,
        );

      if (
        prompts.length ===
        0
      ) {
        return {
          status:
            'skipped',

          teamId:
            team.id,

          teamName:
            team.name,

          memberCount:
            0,

          deliveredCount:
            0,

          failedUserIds: [],

          error:
            'No active team members were found.',

          generatedAt:
            new Date().toISOString(),
        };
      }

      let deliveredCount =
        0;

      const failedUserIds:
        string[] = [];

      for (
        const prompt
        of prompts
      ) {
        const dmChannelId =
          await this.slackService.openDirectMessage(
            prompt.userId,
          );

        if (!dmChannelId) {
          failedUserIds.push(
            prompt.userId,
          );

          continue;
        }

        const delivered =
          await this.slackService.sendMessage({
            channelId:
              dmChannelId,

            text:
              `*Daily standup — ${team.name}*\n` +
              `${prompt.question.text}\n\n` +
              '_Reply directly to continue._',
          });

        if (delivered) {
          deliveredCount +=
            1;
        } else {
          failedUserIds.push(
            prompt.userId,
          );
        }
      }

      return {
        status:
          deliveredCount ===
          prompts.length
            ? 'success'
            : deliveredCount >
                0
              ? 'partial_success'
              : 'failed',

        teamId:
          team.id,

        teamName:
          team.name,

        memberCount:
          prompts.length,

        deliveredCount,

        failedUserIds,

        error:
          failedUserIds.length >
          0
            ? 'One or more Slack messages could not be delivered.'
            : null,

        generatedAt:
          new Date().toISOString(),
      };
    } catch (
      error: unknown
    ) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.error(
        `Could not start standup collection for team "${team.name}": ${message}`,
      );

      return {
        status:
          'failed',

        teamId:
          team.id,

        teamName:
          team.name,

        memberCount:
          0,

        deliveredCount:
          0,

        failedUserIds: [],

        error:
          message,

        generatedAt:
          new Date().toISOString(),
      };
    }
  }

  /**
   * Legacy team-level reminder.
   */
  async sendTeamStandupReminder(
    teamId: string,
  ) {
    const team =
      await this.prisma.team.findUnique({
        where: {
          id:
            teamId,
        },
      });

    if (!team) {
      return {
        status:
          'failed',

        teamId,

        teamName:
          teamId,

        pendingCount:
          0,

        deliveredCount:
          0,

        failedUserIds: [],

        error:
          `Team ${teamId} was not found.`,

        generatedAt:
          new Date().toISOString(),
      };
    }

    const pendingMembers =
      await this.collectionService.getPendingTeamStandupMembers(
        team.id,
      );

    if (
      pendingMembers.length ===
      0
    ) {
      return {
        status:
          'skipped',

        teamId:
          team.id,

        teamName:
          team.name,

        pendingCount:
          0,

        deliveredCount:
          0,

        failedUserIds: [],

        error:
          'No pending standup responses were found.',

        generatedAt:
          new Date().toISOString(),
      };
    }

    let deliveredCount =
      0;

    const failedUserIds:
      string[] = [];

    for (
      const member
      of pendingMembers
    ) {
      const dmChannelId =
        await this.slackService.openDirectMessage(
          member.userId,
        );

      if (!dmChannelId) {
        failedUserIds.push(
          member.userId,
        );

        continue;
      }

      const delivered =
        await this.slackService.sendMessage({
          channelId:
            dmChannelId,

          text:
            `*Standup reminder — ${team.name}*\n` +
            `${
              member.currentQuestion
                ?.text ||
              'Please complete your standup.'
            }\n\n` +
            '_Reply directly to continue._',
        });

      if (delivered) {
        deliveredCount +=
          1;
      } else {
        failedUserIds.push(
          member.userId,
        );
      }
    }

    return {
      status:
        deliveredCount ===
        pendingMembers.length
          ? 'success'
          : deliveredCount >
              0
            ? 'partial_success'
            : 'failed',

      teamId:
        team.id,

      teamName:
        team.name,

      pendingCount:
        pendingMembers.length,

      deliveredCount,

      failedUserIds,

      error:
        failedUserIds.length >
        0
          ? 'One or more reminders could not be delivered.'
          : null,

      generatedAt:
        new Date().toISOString(),
    };
  }

  // =========================================================
  // DAILY DIGEST COMPATIBILITY
  // =========================================================

  async runDailyDigest() {
    const startedAt =
      new Date();

    if (
      process.env.DIGEST_SCHEDULER_ENABLED ===
      'false'
    ) {
      return {
        status:
          'disabled',

        generatedAt:
          startedAt.toISOString(),
      };
    }

    const checkIns =
      await this.prisma.checkIn.findMany({
        where: {
          enabled:
            true,
        },

        orderBy: {
          createdAt:
            'asc',
        },
      });

    if (
      checkIns.length ===
      0
    ) {
      const fallback =
        await this.runEnvironmentFallbackDigest();

      return {
        status:
          fallback.status,

        mode:
          'environment-fallback',

        results: [
          fallback,
        ],

        startedAt:
          startedAt.toISOString(),

        generatedAt:
          new Date().toISOString(),
      };
    }

    const results:
      TeamDigestResult[] =
      [];

    for (
      const checkIn
      of checkIns
    ) {
      results.push(
        await this.runCheckInDigest(
          checkIn.id,
        ),
      );
    }

    const failed =
      results.some(
        (result) =>
          result.status ===
          'failed',
      );

    const partial =
      results.some(
        (result) =>
          result.status ===
          'partial_success',
      );

    return {
      status:
        failed || partial
          ? 'partial_success'
          : 'success',

      mode:
        'check-ins',

      checkInCount:
        checkIns.length,

      results,

      startedAt:
        startedAt.toISOString(),

      generatedAt:
        new Date().toISOString(),
    };
  }

  async runTeamDigest(
    teamId: string,
  ): Promise<TeamDigestResult> {
    if (
      this.runningTeamIds.has(
        teamId,
      )
    ) {
      return {
        teamId,
        teamName:
          teamId,
        status:
          'skipped',
        responseCount:
          0,
        slackDelivered:
          false,
        slackError:
          'A digest is already running for this team.',
        generatedAt:
          new Date().toISOString(),
      };
    }

    this.runningTeamIds.add(
      teamId,
    );

    try {
      const team =
        await this.prisma.team.findUnique({
          where: {
            id:
              teamId,
          },
        });

      if (!team) {
        return {
          teamId,

          teamName:
            teamId,

          status:
            'failed',

          responseCount:
            0,

          slackDelivered:
            false,

          slackError:
            `Team ${teamId} was not found.`,

          generatedAt:
            new Date().toISOString(),
        };
      }

      /*
       * Prefer V2 CheckIn reporting whenever this team owns
       * an enabled CheckIn.
       */
      const checkIn =
        await this.prisma.checkIn.findFirst({
          where: {
            teamId:
              team.id,

            enabled:
              true,
          },

          orderBy: {
            createdAt:
              'desc',
          },
        });

      if (checkIn) {
        return this.runCheckInDigest(
          checkIn.id,
        );
      }

      /*
       * V1 fallback.
       */
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

      const channelId =
        team.slackChannelId?.trim();

      if (!channelId) {
        return {
          teamId:
            team.id,

          teamName:
            team.name,

          status:
            'partial_success',

          responseCount:
            responses.length,

          digest,

          slackDelivered:
            false,

          slackError:
            'The team does not have a Slack channel configured.',

          generatedAt:
            new Date().toISOString(),
        };
      }

      if (
        process.env.SLACK_DIGEST_ENABLED !==
        'true'
      ) {
        return {
          teamId:
            team.id,

          teamName:
            team.name,

          status:
            'partial_success',

          responseCount:
            responses.length,

          digest,

          slackDelivered:
            false,

          slackError:
            'SLACK_DIGEST_ENABLED is not true.',

          generatedAt:
            new Date().toISOString(),
        };
      }

      const delivered =
        await this.slackService.sendMessage({
          channelId,
          text:
            digest,
        });

      return {
        teamId:
          team.id,

        teamName:
          team.name,

        status:
          delivered
            ? 'success'
            : 'partial_success',

        responseCount:
          responses.length,

        digest,

        slackDelivered:
          delivered,

        slackError:
          delivered
            ? null
            : 'SlackService could not deliver the digest.',

        generatedAt:
          new Date().toISOString(),
      };
    } finally {
      this.runningTeamIds.delete(
        teamId,
      );
    }
  }

  // =========================================================
  // AI REPORT HELPERS
  // =========================================================

  private async getOrGenerateAiDigest(
    teamId: string,
    runId: string,
    responses:
      RawResponseForAnalysis[],
  ): Promise<AiDigestResult> {
    const existingDigest =
      await this.prisma.aiDigest.findFirst({
        where: {
          teamId,
          runId,
        },

        orderBy: {
          generatedAt:
            'desc',
        },
      });

    if (existingDigest) {
      this.logger.log(
        `Using existing AI digest for standup run ${runId}.`,
      );

      return {
        teamId:
          existingDigest.teamId,

        runId:
          existingDigest.runId,

        generatedAt:
          existingDigest.generatedAt.toISOString(),

        source:
          existingDigest.source ===
          'rules_fallback'
            ? 'rules_fallback'
            : 'ai',

        summary:
          existingDigest.summary,

        blockers:
          existingDigest.blockers as unknown as AiDigestResult['blockers'],

        themes:
          existingDigest.themes as unknown as AiDigestResult['themes'],

        reportSections: this.parseStoredReportSections(
          existingDigest.reportSections,
        ),
      };
    }

    return this.aiService.analyzeRun(
      teamId,
      runId,
      responses,
    );
  }

  private parseStoredReportSections(
    value: unknown,
  ): AiDigestResult['reportSections'] {
    if (!value || typeof value !== 'object') {
      return { ...EMPTY_REPORT_SECTIONS };
    }

    const record = value as Record<string, unknown>;
    const toStringArray = (input: unknown) =>
      Array.isArray(input)
        ? input.filter((item): item is string => typeof item === 'string')
        : [];

    return {
      keyAccomplishments: toStringArray(record.keyAccomplishments),
      risks: toStringArray(record.risks),
      aiInsights: toStringArray(record.aiInsights),
      actionItems: toStringArray(record.actionItems),
      participantUpdates: Array.isArray(record.participantUpdates)
        ? (record.participantUpdates as AiDigestResult['reportSections']['participantUpdates'])
        : [],
      overallProgress:
        typeof record.overallProgress === 'string'
          ? record.overallProgress
          : '',
    };
  }

  // =========================================================
  // ENVIRONMENT FALLBACK
  // =========================================================

  private async runEnvironmentFallbackDigest():
    Promise<TeamDigestResult> {
    const responses =
      await this.collectionService.getCompletedStandupResponses();

    const digest =
      this.digestService.generateDailyDigest(
        responses,
      );

    const channelId =
      process.env.SLACK_DIGEST_CHANNEL_ID?.trim();

    if (!channelId) {
      return {
        teamId:
          null,

        teamName:
          'Environment fallback',

        status:
          'partial_success',

        responseCount:
          responses.length,

        digest,

        slackDelivered:
          false,

        slackError:
          'SLACK_DIGEST_CHANNEL_ID is missing.',

        generatedAt:
          new Date().toISOString(),
      };
    }

    if (
      process.env.SLACK_DIGEST_ENABLED !==
      'true'
    ) {
      return {
        teamId:
          null,

        teamName:
          'Environment fallback',

        status:
          'partial_success',

        responseCount:
          responses.length,

        digest,

        slackDelivered:
          false,

        slackError:
          'SLACK_DIGEST_ENABLED is not true.',

        generatedAt:
          new Date().toISOString(),
      };
    }

    const slackDelivered =
      await this.slackService.sendMessage({
        channelId,
        text:
          digest,
      });

    return {
      teamId:
        null,

      teamName:
        'Environment fallback',

      status:
        slackDelivered
          ? 'success'
          : 'partial_success',

      responseCount:
        responses.length,

      digest,

      slackDelivered,

      slackError:
        slackDelivered
          ? null
          : 'SlackService could not deliver the digest.',

      generatedAt:
        new Date().toISOString(),
    };
  }
}