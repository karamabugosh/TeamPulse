import { Module } from '@nestjs/common';
import { JiraConfigService } from './jira-config.service';
import { JiraTeamConfigService } from './jira-team-config.service';

@Module({
  providers: [
    JiraConfigService,
    JiraTeamConfigService,
  ],
  exports: [
    JiraConfigService,
    JiraTeamConfigService,
  ],
})
export class JiraModule {}