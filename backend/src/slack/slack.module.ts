import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SlackService } from './slack.service';
import { SlackListener } from './slack.listener';
import { SlackGateway } from './slack.gateway';

import { CollectionModule } from '../collection/collection.module';
import { AuthModule } from '../auth/auth.module';
import { QuestionsModule } from '../questions/questions.module';
import { SlackQuestionsListener } from './slack-questions.listener';

// We do not export slack.controller.ts since Slack Bolt handles its own events over WebSockets (Socket Mode)
// If HTTP events are needed, you can add it back here.

@Module({
  imports: [ConfigModule, CollectionModule, AuthModule, QuestionsModule],
  providers: [SlackService, SlackGateway, SlackListener, SlackQuestionsListener],
  exports: [SlackGateway],
})
export class SlackModule {}
