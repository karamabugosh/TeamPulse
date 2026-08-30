import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CollectionModule } from '../collection/collection.module';
import { ReportsModule } from '../reports/reports.module';
import { AuthModule } from '../auth/auth.module';
import { QuestionsModule } from '../questions/questions.module';
import { JiraModule } from '../jira/jira.module';
import { AiModule } from '../ai/ai.module';

import { SlackGateway } from './slack.gateway';
import { SlackListener } from './slack.listener';
import { SlackService } from './slack.service';
import { SlackQuestionsListener } from './slack-questions.listener';
import { CheckInThreadService } from './check-in-thread.service';
import { SlackCheckInListener } from './slack-checkin.listener';
import { JiraSlackListener } from './jira-slack.listener';
import { SlackAiAssistantService } from './slack-ai-assistant.service';

@Module({
  imports: [
    ConfigModule,
    CollectionModule,
    ReportsModule,
    AuthModule,
    QuestionsModule,
    AiModule,
    forwardRef(() => JiraModule),
  ],
  providers: [
    SlackService,
    SlackGateway,
    SlackListener,
    SlackQuestionsListener,
    CheckInThreadService,
    SlackCheckInListener,
    JiraSlackListener,
    SlackAiAssistantService,
  ],
  exports: [
    SlackGateway,
    SlackService,
    CheckInThreadService,
    SlackAiAssistantService,
  ],
})
export class SlackModule {}
