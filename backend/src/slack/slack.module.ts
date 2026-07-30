import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CollectionModule } from '../collection/collection.module';
import { SlackGateway } from './slack.gateway';
import { SlackListener } from './slack.listener';
import { SlackService } from './slack.service';

@Module({
  imports: [ConfigModule, CollectionModule],
  providers: [SlackService, SlackGateway, SlackListener],
  exports: [SlackService, SlackGateway],
})
export class SlackModule {}