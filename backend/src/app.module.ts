import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { SlackModule } from './slack/slack.module';
import { CollectionModule } from './collection/collection.module';
import { QuestionsModule } from './questions/questions.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    SlackModule,
    CollectionModule,
    QuestionsModule,
    AiModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}