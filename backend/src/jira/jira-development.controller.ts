// backend/src/jira/jira-development.controller.ts

import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JiraConnectionStatus } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JiraApiService } from './jira-api.service';

type JiraDevelopmentProjectsQuery = {
  userId?: string;
  query?: string;
  startAt?: string;
  maxResults?: string;
};

type JiraDevelopmentIssuesQuery = {
  userId?: string;
  projectKey?: string;
  searchText?: string;
  maxResults?: string;
  nextPageToken?: string;
};

type JiraDevelopmentIssueQuery = {
  userId?: string;
};

type AvailableJiraConnection = {
  jiraIntegrationId: string;
  jiraIntegration: {
    id: string;
    siteUrl: string;
    siteName: string | null;
    isDefault: boolean;
  };
};

@Controller('jira/dev')
export class JiraDevelopmentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jiraApiService:
      JiraApiService,
    private readonly configService:
      ConfigService,
  ) {}

  @Get('projects')
  async listProjects(
    @Req() request: Request,
    @Query()
    query: JiraDevelopmentProjectsQuery,
  ) {
    this.assertDevelopmentRequestAllowed(
      request,
    );

    const userId = this.normalizeUserId(
      query.userId,
    );

    const connection =
      await this.findPreferredConnection(
        userId,
      );

    const projects =
      await this.jiraApiService.listProjects({
        userId,
        jiraIntegrationId:
          connection.jiraIntegrationId,
        query: query.query,
        startAt: this.parseOptionalInteger(
          query.startAt,
          'startAt',
        ),
        maxResults:
          this.parseOptionalInteger(
            query.maxResults,
            'maxResults',
          ),
      });

    return {
      message:
        'Jira projects were read successfully.',
      connection:
        this.toSafeConnection(connection),
      ...projects,
    };
  }

  @Get('issues')
  async searchIssues(
    @Req() request: Request,
    @Query()
    query: JiraDevelopmentIssuesQuery,
  ) {
    this.assertDevelopmentRequestAllowed(
      request,
    );

    const userId = this.normalizeUserId(
      query.userId,
    );

    const projectKey =
      this.normalizeProjectKey(
        query.projectKey,
      );

    const connection =
      await this.findPreferredConnection(
        userId,
      );

    const jql = this.buildProjectIssueJql(
      projectKey,
      query.searchText,
    );

    const issues =
      await this.jiraApiService.searchIssues({
        userId,
        jiraIntegrationId:
          connection.jiraIntegrationId,
        jql,
        maxResults:
          this.parseOptionalInteger(
            query.maxResults,
            'maxResults',
          ),
        nextPageToken:
          query.nextPageToken?.trim() ||
          undefined,
      });

    return {
      message:
        'Jira issues were read successfully.',
      connection:
        this.toSafeConnection(connection),
      projectKey,
      appliedSearchText:
        query.searchText?.trim() || null,
      ...issues,
    };
  }

  @Get(
    'issues/:issueIdOrKey/transitions',
  )
  async getIssueTransitions(
    @Req() request: Request,
    @Param('issueIdOrKey')
    issueIdOrKeyInput: string,
    @Query()
    query: JiraDevelopmentIssueQuery,
  ) {
    this.assertDevelopmentRequestAllowed(
      request,
    );

    const userId = this.normalizeUserId(
      query.userId,
    );

    const issueIdOrKey =
      this.normalizeIssueIdOrKey(
        issueIdOrKeyInput,
      );

    const connection =
      await this.findPreferredConnection(
        userId,
      );

    const [issue, transitions] =
      await Promise.all([
        this.jiraApiService.getIssue(
          userId,
          connection.jiraIntegrationId,
          issueIdOrKey,
        ),
        this.jiraApiService
          .getIssueTransitions(
            userId,
            connection.jiraIntegrationId,
            issueIdOrKey,
          ),
      ]);

    return {
      message:
        'Jira issue and transitions were read successfully.',
      connection:
        this.toSafeConnection(connection),
      issue,
      transitions,
    };
  }

  private normalizeUserId(
    userIdInput?: string,
  ): string {
    const userId = userIdInput?.trim();

    if (!userId) {
      throw new BadRequestException(
        'userId is required.',
      );
    }

    return userId;
  }

  private normalizeProjectKey(
    projectKeyInput?: string,
  ): string {
    const projectKey =
      projectKeyInput
        ?.trim()
        .toUpperCase();

    if (!projectKey) {
      throw new BadRequestException(
        'projectKey is required.',
      );
    }

    if (
      !/^[A-Z][A-Z0-9_]*$/.test(
        projectKey,
      )
    ) {
      throw new BadRequestException(
        'projectKey must be a valid Jira project key.',
      );
    }

    return projectKey;
  }

  private normalizeIssueIdOrKey(
    issueIdOrKeyInput?: string,
  ): string {
    const issueIdOrKey =
      issueIdOrKeyInput
        ?.trim()
        .toUpperCase();

    if (!issueIdOrKey) {
      throw new BadRequestException(
        'issueIdOrKey is required.',
      );
    }

    if (
      !/^(?:[A-Z][A-Z0-9_]*-\d+|\d+)$/.test(
        issueIdOrKey,
      )
    ) {
      throw new BadRequestException(
        'issueIdOrKey must be a valid Jira issue key or numeric ID.',
      );
    }

    return issueIdOrKey;
  }

  private buildProjectIssueJql(
    projectKey: string,
    searchTextInput?: string,
  ): string {
    const clauses = [
      `project = "${projectKey}"`,
    ];

    const searchText =
      searchTextInput?.trim();

    if (searchText) {
      if (searchText.length > 200) {
        throw new BadRequestException(
          'searchText must not exceed 200 characters.',
        );
      }

      const escapedSearchText =
        searchText
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"');

      clauses.push(
        `text ~ "${escapedSearchText}"`,
      );
    }

    return (
      `${clauses.join(' AND ')}` +
      ' ORDER BY updated DESC'
    );
  }

  private async findPreferredConnection(
    userId: string,
  ): Promise<AvailableJiraConnection> {
    const user =
      await this.prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          id: true,
        },
      });

    if (!user) {
      throw new NotFoundException(
        `Pulse user ${userId} was not found.`,
      );
    }

    const connections =
      await this.prisma.jiraUserConnection
        .findMany({
          where: {
            userId,
            status:
              JiraConnectionStatus.CONNECTED,
            jiraIntegration: {
              enabled: true,
            },
          },
          select: {
            jiraIntegrationId: true,
            jiraIntegration: {
              select: {
                id: true,
                siteUrl: true,
                siteName: true,
                isDefault: true,
              },
            },
          },
        });

    if (connections.length === 0) {
      throw new NotFoundException(
        'This Pulse user does not have an active Jira connection.',
      );
    }

    return (
      connections.find(
        (connection) =>
          connection.jiraIntegration
            .isDefault,
      ) ?? connections[0]
    );
  }

  private toSafeConnection(
    connection: AvailableJiraConnection,
  ) {
    return {
      integrationId:
        connection.jiraIntegrationId,
      siteUrl:
        connection.jiraIntegration.siteUrl,
      siteName:
        connection.jiraIntegration.siteName,
      isDefault:
        connection.jiraIntegration.isDefault,
    };
  }

  private parseOptionalInteger(
    valueInput: string | undefined,
    fieldName: string,
  ): number | undefined {
    const value = valueInput?.trim();

    if (!value) {
      return undefined;
    }

    if (!/^\d+$/.test(value)) {
      throw new BadRequestException(
        `${fieldName} must be a non-negative integer.`,
      );
    }

    const parsedValue = Number(value);

    if (!Number.isSafeInteger(parsedValue)) {
      throw new BadRequestException(
        `${fieldName} is too large.`,
      );
    }

    return parsedValue;
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
        'Jira development endpoints are disabled in production.',
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
        'Jira development endpoints are available from localhost only.',
      );
    }
  }
}