import {
  Controller,
  Param,
  Post,
} from '@nestjs/common';
import { SchedulerService } from './scheduler.service';

@Controller('scheduler')
export class SchedulerController {
  constructor(
    private readonly schedulerService: SchedulerService,
  ) {}

  /**
   * V2: Reload all CheckIn cron jobs from PostgreSQL.
   *
   * This lets configuration changes take effect without
   * restarting the NestJS backend.
   */
  @Post('refresh')
  refreshCheckInJobs() {
    return this.schedulerService.refreshCheckInJobs();
  }

  /**
   * Legacy/manual V1 standup trigger.
   */
  @Post('trigger-standup')
  triggerDailyStandup() {
    return this.schedulerService.triggerDailyStandup();
  }

  /**
   * Legacy/manual V1 reminder trigger.
   */
  @Post('send-reminders')
  triggerDailyReminder() {
    return this.schedulerService.triggerDailyReminder();
  }

  /**
   * Legacy/manual V1 digest trigger.
   */
  @Post('run-daily')
  runDailyDigest() {
    return this.schedulerService.runDailyDigest();
  }

  /**
   * Legacy/manual team-level collection trigger.
   */
  @Post('teams/:teamId/start-standup')
  startTeamStandup(
    @Param('teamId') teamId: string,
  ) {
    return this.schedulerService.startTeamStandupCollection(
      teamId,
    );
  }

  /**
   * Legacy/manual team-level reminder trigger.
   */
  @Post('teams/:teamId/send-reminder')
  sendTeamReminder(
    @Param('teamId') teamId: string,
  ) {
    return this.schedulerService.sendTeamStandupReminder(
      teamId,
    );
  }

  /**
   * Legacy/manual team-level digest trigger.
   */
  @Post('teams/:teamId/run-digest')
  runTeamDigest(
    @Param('teamId') teamId: string,
  ) {
    return this.schedulerService.runTeamDigest(
      teamId,
    );
  }

  /**
   * V2: manually start one configured CheckIn.
   *
   * Uses the exact same lifecycle as the scheduled collection
   * path:
   * - StandupRun creation
   * - submission creation
   * - ConversationState creation
   * - reminder state
   * - Slack delivery
   */
  @Post('check-ins/:checkInId/start')
  startCheckIn(
    @Param('checkInId') checkInId: string,
  ) {
    return this.schedulerService.startScheduledCheckIn(
      checkInId,
    );
  }

  /**
   * V2: manually generate the latest report for
   * one configured CheckIn.
   */
  @Post('check-ins/:checkInId/run-report')
  runCheckInReport(
    @Param('checkInId') checkInId: string,
  ) {
    return this.schedulerService.runCheckInDigest(
      checkInId,
    );
  }
}