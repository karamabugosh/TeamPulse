import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { QuestionsModule } from './questions/questions.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { TeamModule } from './team/team.module';
import { CheckInModule } from './check-in/check-in.module';
import { AdminModule } from './admin/admin.module';
import { JiraModule } from './jira/jira.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    QuestionsModule,
    SchedulerModule,
    TeamModule,
    CheckInModule,
    AdminModule,
    JiraModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}