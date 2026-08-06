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

  @Post('run-daily')
  runDailyDigest() {
    return this.schedulerService.runDailyDigest();
  }

  @Post('teams/:teamId/start-standup')
  startTeamStandup(
    @Param('teamId') teamId: string,
  ) {
    return this.schedulerService.startTeamStandupCollection(
      teamId,
    );
  }

  @Post('teams/:teamId/send-reminder')
  sendTeamReminder(
    @Param('teamId') teamId: string,
  ) {
    return this.schedulerService.sendTeamStandupReminder(
      teamId,
    );
  }

  @Post('teams/:teamId/run-digest')
  runTeamDigest(
    @Param('teamId') teamId: string,
  ) {
    return this.schedulerService.runTeamDigest(teamId);
  }
}