import {
  Controller,
  Delete,
  Get,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { JiraService } from './jira.service';

@Controller('auth/jira')
export class JiraController {
  constructor(private readonly jiraService: JiraService) {}

  @Get()
  async startOAuth(
    @Query('slackUserId') slackUserId: string,
    @Query('workspaceId') workspaceId: string,
    @Res() res: Response,
  ): Promise<void> {
    // Browser navigation cannot send X-Workspace-Id; require workspaceId query.
    const redirectUrl = await this.jiraService.buildAuthorizationRedirectUrl({
      slackUserId: slackUserId?.trim() || undefined,
      workspaceId: workspaceId?.trim() || undefined,
    });
    res.redirect(redirectUrl);
  }

  @Get('callback')
  async oauthCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Query('error_description') errorDescription: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      if (error) {
        const message = errorDescription || error;
        res.redirect(this.jiraService.getFrontendErrorRedirect(message));
        return;
      }

      const redirectUrl = await this.jiraService.handleOAuthCallback(
        code,
        state,
      );
      res.redirect(redirectUrl);
    } catch (callbackError: unknown) {
      const message =
        callbackError instanceof Error
          ? callbackError.message
          : 'Jira OAuth callback failed';
      res.redirect(this.jiraService.getFrontendErrorRedirect(message));
    }
  }

  @Get('status')
  getStatus() {
    return this.jiraService.getConnectionStatus();
  }

  @Get('config-check')
  getConfigCheck() {
    return this.jiraService.getConfigDiagnostics();
  }

  @Delete()
  disconnect() {
    return this.jiraService.disconnect();
  }
}
