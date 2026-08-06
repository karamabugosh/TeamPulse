import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { SlackModule } from './slack/slack.module';
import { CollectionModule } from './collection/collection.module';
import { QuestionsModule } from './questions/questions.module';
import { DigestModule } from './digest/digest.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { TeamModule } from './team/team.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AuthModule,
    SlackModule,
    CollectionModule,
    QuestionsModule,
    DigestModule,
    SchedulerModule,
    TeamModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}