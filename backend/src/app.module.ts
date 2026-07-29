import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    AiModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}