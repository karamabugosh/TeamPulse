import { Module } from '@nestjs/common';
import { CheckInController } from './check-in.controller';
import { CheckInService } from './check-in.service';
import { CheckInRunService } from './check-in-run/check-in-run.service';
import { CheckInReportService } from './check-in-report.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SlackModule } from '../slack/slack.module';
import { AiModule } from '../ai/ai.module';
import { ReportsModule } from '../reports/reports.module';
import { CollectionModule } from '../collection/collection.module';
import { DigestModule } from '../digest/digest.module';

@Module({
  imports: [
    PrismaModule,
    SlackModule,
    AiModule,
    ReportsModule,
    CollectionModule,
    DigestModule,
  ],
  controllers: [CheckInController],
  providers: [
    CheckInService,
    CheckInRunService,
    CheckInReportService,
  ],
  exports: [
    CheckInService,
    CheckInRunService,
    CheckInReportService,
  ],
})
export class CheckInModule {}