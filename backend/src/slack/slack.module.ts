// backend/src/slack/slack.module.ts

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CollectionModule } from '../collection/collection.module';
import { ReportsModule } from '../reports/reports.module';
import { AuthModule } from '../auth/auth.module';
import { QuestionsModule } from '../questions/questions.module';

import { SlackGateway } from './slack.gateway';
import { SlackListener } from './slack.listener';
import { SlackService } from './slack.service';
import { SlackQuestionsListener } from './slack-questions.listener';

@Module({
  imports: [
    ConfigModule,
    CollectionModule,
    ReportsModule,
    AuthModule,
    QuestionsModule,
  ],
  providers: [
    SlackService,
    SlackGateway,
    SlackListener,
    SlackQuestionsListener,
  ],
  exports: [
    SlackGateway,
    SlackService,
  ],
})
export class SlackModule {}