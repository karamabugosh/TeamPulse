import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SlackMemberCacheService } from './slack-member-cache.service';

/**
 * Isolated module so AiModule can sync Slack members without importing SlackModule
 * (SlackModule already imports AiModule).
 */
@Module({
  imports: [PrismaModule],
  providers: [SlackMemberCacheService],
  exports: [SlackMemberCacheService],
})
export class SlackMemberCacheModule {}
