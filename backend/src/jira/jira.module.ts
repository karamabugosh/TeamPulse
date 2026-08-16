// backend/src/jira/jira.module.ts

import { Module } from '@nestjs/common';
import { JiraConfigService } from './jira-config.service';
import { JiraTeamConfigService } from './jira-team-config.service';
import { JiraQuestionConfigService } from './jira-question-config.service';
import { JiraTokenCryptoService } from './jira-token-crypto.service';
import { JiraOAuthStateService } from './jira-oauth-state.service';
import { JiraOAuthClientService } from './jira-oauth-client.service';
import { JiraOAuthService } from './jira-oauth.service';
import { JiraOAuthController } from './jira-oauth.controller';
import { JiraConnectionTokenService } from './jira-connection-token.service';
import { JiraApiService } from './jira-api.service';
import { JiraDevelopmentController } from './jira-development.controller';

@Module({
  controllers: [
    JiraOAuthController,
    JiraDevelopmentController,
  ],
  providers: [
    JiraConfigService,
    JiraTeamConfigService,
    JiraQuestionConfigService,
    JiraTokenCryptoService,
    JiraOAuthStateService,
    JiraOAuthClientService,
    JiraOAuthService,
    JiraConnectionTokenService,
    JiraApiService,
  ],
  exports: [
    JiraConfigService,
    JiraTeamConfigService,
    JiraQuestionConfigService,
    JiraTokenCryptoService,
    JiraOAuthStateService,
    JiraOAuthClientService,
    JiraOAuthService,
    JiraConnectionTokenService,
    JiraApiService,
  ],
})
export class JiraModule {}