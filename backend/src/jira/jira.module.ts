import { Module } from '@nestjs/common';
import { JiraConfigService } from './jira-config.service';
import { JiraTeamConfigService } from './jira-team-config.service';
import { JiraQuestionConfigService } from './jira-question-config.service';
import { JiraTokenCryptoService } from './jira-token-crypto.service';
import { JiraOAuthStateService } from './jira-oauth-state.service';

@Module({
  providers: [
    JiraConfigService,
    JiraTeamConfigService,
    JiraQuestionConfigService,
    JiraTokenCryptoService,
    JiraOAuthStateService,
  ],
  exports: [
    JiraConfigService,
    JiraTeamConfigService,
    JiraQuestionConfigService,
    JiraTokenCryptoService,
    JiraOAuthStateService,
  ],
})
export class JiraModule {}