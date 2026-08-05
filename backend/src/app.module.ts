import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { SlackModule } from './slack/slack.module';
import { CollectionModule } from './collection/collection.module';
import { QuestionsModule } from './questions/questions.module';
import { AiModule } from './ai/ai.module';
import { ReportsModule } from './reports/reports.module';
import { DigestModule } from './digest/digest.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AuthModule,
    SlackModule,
    CollectionModule,
    QuestionsModule,
    AiModule,
    ReportsModule,
    DigestModule,
    SchedulerModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}