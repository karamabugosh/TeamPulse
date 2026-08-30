import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { resolveBackendEnvPath } from './config/env.config';
import { AuthModule } from './auth/auth.module';
import { QuestionsModule } from './questions/questions.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { TeamModule } from './team/team.module';
import { CheckInModule } from './check-in/check-in.module';
import { AdminModule } from './admin/admin.module';
import { JiraModule } from './jira/jira.module';
import { DemoModule } from './demo/demo.module';
import { WorkspaceMembersModule } from './common/workspace-members.module';
import { MemoryModule } from './memory/memory.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: resolveBackendEnvPath(),
    }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    WorkspaceMembersModule,
    MemoryModule,
    AuthModule,
    QuestionsModule,
    SchedulerModule,
    TeamModule,
    CheckInModule,
    AdminModule,
    JiraModule,
    DemoModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
