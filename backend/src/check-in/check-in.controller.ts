import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CheckInService } from './check-in.service';
import { CheckInRunService } from './check-in-run/check-in-run.service';
import { CheckInThreadService } from '../slack/check-in-thread.service';
import { SlackGateway } from '../slack/slack.gateway';
import { CreateCheckInDto } from './dto/create-check-in.dto';
import { UpdateCheckInDto } from './dto/update-check-in.dto';

@Controller('check-ins')
export class CheckInController {
  constructor(
    private readonly checkInService: CheckInService,
    private readonly checkInRunService: CheckInRunService,
    private readonly slackGateway: SlackGateway,
    private readonly checkInThreadService: CheckInThreadService,
  ) {}

  @Post()
  create(@Body() dto: CreateCheckInDto) {
    return this.checkInService.create(dto);
  }

  @Get()
  findAll(@Query('teamId') teamId?: string) {
    return this.checkInService.findAll(teamId);
  }

  @Get('runs/active')
  getActiveRuns() {
    return this.checkInService.getActiveRuns();
  }

  @Get('runs/history')
  getRunHistory(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('checkInId') checkInId?: string,
  ) {
    return this.checkInService.getRunHistory({
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      checkInId: checkInId?.trim() || undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.checkInService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCheckInDto,
  ) {
    return this.checkInService.update(id, dto);
  }

  @Patch(':id/enabled')
  setEnabled(
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.checkInService.setEnabled(id, body.enabled);
  }

  @Post(':id/runs')
  async startRun(
    @Param('id') id: string,
  ) {
    const scheduledFor = new Date();
    scheduledFor.setSeconds(0, 0);

    const result = await this.checkInRunService.startCheckInRun(
      id,
      scheduledFor,
      'manual',
    );

    if (result.run) {
      const thread = await this.checkInThreadService.createRunThread(result.run.id);

      if (thread.ok === false) {
        return {
          ...result,
          thread,
          delivery: {
            delivered: 0,
            failed: 0,
            skipped: 0,
            aborted: true,
            reason: thread.reason,
          },
        };
      }

      if (result.run.submissions.length) {
        const delivery = await this.slackGateway.deliverCheckInRun(result);
        return { ...result, thread, delivery };
      }

      return { ...result, thread };
    }

    return result;
  }

  @Post('runs/:runId/deliver')
  async deliverRun(
    @Param('runId') runId: string,
  ) {
    const thread = await this.checkInThreadService.createRunThread(runId);

    if (thread.ok === false) {
      return {
        runId,
        thread,
        delivery: {
          delivered: 0,
          failed: 0,
          skipped: 0,
          aborted: true,
          reason: thread.reason,
        },
      };
    }

    const run = await this.checkInRunService.getRunForDelivery(runId);
    const delivery = await this.slackGateway.deliverCheckInRun(run);
    return { runId, thread, delivery };
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string) {
    return this.checkInService.duplicate(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.checkInService.remove(id);
  }
}