import { Module } from '@nestjs/common';
import { JiraConfigService } from './jira-config.service';
import { JiraTeamConfigService } from './jira-team-config.service';
import { JiraQuestionConfigService } from './jira-question-config.service';
import { JiraTokenCryptoService } from './jira-token-crypto.service';

@Module({
  providers: [
    JiraConfigService,
    JiraTeamConfigService,
    JiraQuestionConfigService,
    JiraTokenCryptoService,
  ],
  exports: [
    JiraConfigService,
    JiraTeamConfigService,
    JiraQuestionConfigService,
    JiraTokenCryptoService,
  ],
})
export class JiraModule {}