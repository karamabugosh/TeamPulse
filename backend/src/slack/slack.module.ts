// backend/src/slack/slack.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CollectionModule } from '../collection/collection.module';
import { ReportsModule } from '../reports/reports.module';
import { SlackGateway } from './slack.gateway';
import { SlackListener } from './slack.listener';
import { SlackService } from './slack.service';

@Module({
  imports: [
    ConfigModule,
    CollectionModule,
    ReportsModule,
  ],
  providers: [
    SlackService,
    SlackGateway,
    SlackListener,
  ],
  exports: [
    SlackGateway,
    SlackService,
  ],
})
export class SlackModule {}