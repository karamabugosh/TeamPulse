import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { JiraModule } from '../jira/jira.module';
import { WorkspaceMembersModule } from '../common/workspace-members.module';
import { WorkspaceAnalyticsService } from './workspace-analytics.service';

@Module({
  imports: [PrismaModule, JiraModule, WorkspaceMembersModule],
  providers: [WorkspaceAnalyticsService],
  exports: [WorkspaceAnalyticsService],
})
export class AnalyticsModule {}
