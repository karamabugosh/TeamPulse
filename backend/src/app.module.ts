import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { DigestModule } from './digest/digest.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    DigestModule,
    SchedulerModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}