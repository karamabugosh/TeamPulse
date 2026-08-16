import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { JiraOAuthService } from './jira-oauth.service';

type StartJiraOAuthBody = {
  userId?: string;
};

type JiraOAuthCallbackQuery = {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
};

@Controller('jira/oauth')
export class JiraOAuthController {
  constructor(
    private readonly jiraOAuthService:
      JiraOAuthService,
    private readonly configService:
      ConfigService,
  ) {}

  @Post('dev/connect')
  async startDevelopmentConnection(
    @Req() request: Request,
    @Body() body: StartJiraOAuthBody,
  ) {
    this.assertDevelopmentRequestAllowed(
      request,
    );

    return this.jiraOAuthService
      .startConnection(body.userId ?? '');
  }

  @Get('callback')
  async completeConnection(
    @Query() query: JiraOAuthCallbackQuery,
  ) {
    if (query.error) {
      throw new BadRequestException(
        'Jira authorization was cancelled or denied.',
      );
    }

    const connection =
      await this.jiraOAuthService
        .completeConnection({
          code: query.code ?? '',
          state: query.state ?? '',
        });

    return {
      message:
        'Jira was connected successfully.',
      connection,
    };
  }

  private assertDevelopmentRequestAllowed(
    request: Request,
  ): void {
    const nodeEnvironment =
      this.configService
        .get<string>('NODE_ENV')
        ?.trim()
        .toLowerCase();

    if (nodeEnvironment === 'production') {
      throw new ForbiddenException(
        'The Jira development connect endpoint is disabled in production.',
      );
    }

    const remoteAddress =
      request.ip ||
      request.socket.remoteAddress ||
      '';

    const allowedLoopbackAddresses =
      new Set([
        '127.0.0.1',
        '::1',
        '::ffff:127.0.0.1',
        '0:0:0:0:0:0:0:1',
      ]);

    if (
      !allowedLoopbackAddresses.has(
        remoteAddress,
      )
    ) {
      throw new ForbiddenException(
        'The Jira development connect endpoint is available from localhost only.',
      );
    }
  }
}