import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SlackModule } from './slack/slack.module';
import { CollectionModule } from './collection/collection.module';
import { QuestionsModule } from './questions/questions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SlackModule,
    CollectionModule,
    QuestionsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}