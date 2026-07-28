import { Module } from '@nestjs/common';
import { DigestModule } from './digest/digest.module';
import { SchedulerModule } from './scheduler/scheduler.module';

@Module({
  imports: [DigestModule, SchedulerModule],
})
export class AppModule {}