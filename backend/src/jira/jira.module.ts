import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspaceMembersModule } from '../common/workspace-members.module';
import { DemoModule } from '../demo/demo.module';
import { JiraApiController } from './jira-api.controller';
import { JiraController } from './jira.controller';
import { BlockerController } from './blocker.controller';
import { JiraService } from './jira.service';
import { JiraCacheService } from './jira-cache.service';
import { JiraIssueRefService } from './jira-issue-ref.service';
import { JiraBlockerService } from './jira-blocker.service';
import { JiraActionService } from './jira-action.service';
import { JiraAuditService } from './jira-audit.service';
import { JiraStandupHookService } from './jira-standup-hook.service';
import { AnswerJiraLinkService } from './answer-jira-link.service';
import { JiraHubService } from './jira-hub.service';
import { JiraHubController } from './jira-hub.controller';
import { TeamMemoryService } from './team-memory.service';
import { JiraIssuePickerService } from './jira-issue-picker.service';
import { BlockerFollowUpService } from './blocker-follow-up.service';
import { JiraMemberCacheService } from './jira-member-cache.service';

@Module({
  imports: [PrismaModule, WorkspaceMembersModule, forwardRef(() => DemoModule)],
  controllers: [JiraController, JiraApiController, BlockerController, JiraHubController],
  providers: [
    JiraService,
    JiraCacheService,
    JiraIssuePickerService,
    JiraIssueRefService,
    JiraBlockerService,
    BlockerFollowUpService,
    JiraActionService,
    JiraAuditService,
    JiraStandupHookService,
    AnswerJiraLinkService,
    JiraHubService,
    TeamMemoryService,
    JiraMemberCacheService,
  ],
  exports: [
    JiraService,
    JiraCacheService,
    JiraIssuePickerService,
    JiraIssueRefService,
    JiraBlockerService,
    BlockerFollowUpService,
    JiraActionService,
    JiraAuditService,
    JiraStandupHookService,
    AnswerJiraLinkService,
    JiraHubService,
    TeamMemoryService,
    JiraMemberCacheService,
  ],
})
export class JiraModule {}
