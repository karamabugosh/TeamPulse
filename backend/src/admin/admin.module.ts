import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspaceMembersModule } from '../common/workspace-members.module';
import { SlackMemberCacheModule } from '../slack/slack-member-cache.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthModule } from '../auth/auth.module';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    PrismaModule,
    WorkspaceMembersModule,
    SlackMemberCacheModule,
    AnalyticsModule,
    AuthModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
