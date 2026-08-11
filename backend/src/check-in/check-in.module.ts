import { Module } from '@nestjs/common';
import { CheckInController } from './check-in.controller';
import { CheckInService } from './check-in.service';
import { CheckInRunService } from './check-in-run/check-in-run.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SlackModule } from '../slack/slack.module';

@Module({
  imports: [PrismaModule, SlackModule],
  controllers: [CheckInController],
  providers: [
    CheckInService,
    CheckInRunService,
  ],
  exports: [
    CheckInService,
    CheckInRunService,
  ],
})
export class CheckInModule {}