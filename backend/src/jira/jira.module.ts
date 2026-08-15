import { Module } from '@nestjs/common';
import { JiraConfigService } from './jira-config.service';
import { JiraTeamConfigService } from './jira-team-config.service';
import { JiraQuestionConfigService } from './jira-question-config.service';

@Module({
  providers: [
    JiraConfigService,
    JiraTeamConfigService,
    JiraQuestionConfigService,
  ],
  exports: [
    JiraConfigService,
    JiraTeamConfigService,
    JiraQuestionConfigService,
  ],
})
export class JiraModule {}