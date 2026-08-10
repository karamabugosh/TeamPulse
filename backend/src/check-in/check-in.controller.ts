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
import { CreateCheckInDto } from './dto/create-check-in.dto';
import { UpdateCheckInDto } from './dto/update-check-in.dto';

@Controller('check-ins')
export class CheckInController {
  constructor(
    private readonly checkInService: CheckInService,
    private readonly checkInRunService: CheckInRunService,
  ) {}

  @Post()
  create(@Body() dto: CreateCheckInDto) {
    return this.checkInService.create(dto);
  }

  @Get()
  findAll(@Query('teamId') teamId?: string) {
    return this.checkInService.findAll(teamId);
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
  startRun(
    @Param('id') id: string,
  ) {
    const scheduledFor = new Date();

    return this.checkInRunService.startCheckInRun(
      id,
      scheduledFor,
      'manual',
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.checkInService.remove(id);
  }
}