import { Controller, Get, Post, Query } from '@nestjs/common';
import { JiraService } from './jira.service';
import { JiraCacheService } from './jira-cache.service';
import { JiraIssuePickerService } from './jira-issue-picker.service';
import { DemoWorkspaceGeneratorService } from '../demo/demo-workspace-generator.service';

@Controller('jira')
export class JiraApiController {
  constructor(
    private readonly jiraService: JiraService,
    private readonly jiraCacheService: JiraCacheService,
    private readonly jiraIssuePickerService: JiraIssuePickerService,
    private readonly demoWorkspaceGenerator: DemoWorkspaceGeneratorService,
  ) {}

  @Get('status')
  getStatus() {
    return this.jiraService.getConnectionStatus();
  }

  @Post('sync')
  async sync() {
    const result = await this.jiraService.syncConnection();
    const userId = await this.jiraService.getConnectedUserId();
    if (userId) {
      this.jiraIssuePickerService.invalidate(userId);
      await this.jiraCacheService.refreshUserCache(userId).catch(() => 0);
    }

    // When real Jira members change, rebuild Demo mock assignments automatically.
    const demoRegen = await this.demoWorkspaceGenerator
      .refreshDemoWorkspace()
      .catch((error) => ({
        regenerated: false,
        reason:
          error instanceof Error ? error.message : 'Demo regenerate skipped',
      }));

    return {
      ...result,
      demoWorkspace: demoRegen,
    };
  }

  @Get('me')
  getCurrentUser() {
    return this.jiraService.getCurrentJiraUser();
  }

  @Get('projects')
  getProjects() {
    return this.jiraService.getProjects();
  }

  @Get('issues/picker')
  async getPickerIssues(
    @Query('q') q?: string,
    @Query('refresh') refresh?: string,
    @Query('maxResults') maxResults?: string,
  ) {
    const userId = await this.jiraService.getConnectedUserId();
    if (!userId) {
      return {
        issues: [],
        fromCache: false,
        error: 'Unable to load Jira issues.',
      };
    }

    const forceRefresh =
      refresh === '1' || refresh === 'true' || refresh === 'yes';
    const result = await this.jiraIssuePickerService.getPickerIssues(userId, {
      query: q?.trim() ?? '',
      forceRefresh,
      limit: maxResults ? Number.parseInt(maxResults, 10) : 50,
    });

    return {
      total: result.issues.length,
      issues: result.issues.map((issue) => ({
        id: issue.issueId,
        key: issue.issueKey,
        summary: issue.summary,
        status: issue.status,
        issueType: issue.issueType,
        assignee: issue.assignee,
        assigneeAccountId: issue.assigneeAccountId,
        projectKey: issue.projectKey,
        projectName: issue.projectName,
        priority: issue.priority,
        updatedAt: issue.updatedAt,
        issueUrl: issue.issueUrl,
      })),
      fromCache: result.fromCache,
      error: result.error,
    };
  }

  @Get('issues/search')
  async searchIssues(
    @Query('q') q?: string,
    @Query('maxResults') maxResults?: string,
    @Query('refresh') refresh?: string,
  ) {
    const userId = await this.jiraService.getConnectedUserId();
    if (!userId) {
      return this.jiraService.searchIssuesByQuery(
        q?.trim() ?? '',
        maxResults ? Number.parseInt(maxResults, 10) : 20,
      );
    }

    const result = await this.jiraIssuePickerService.getPickerIssues(userId, {
      query: q?.trim() ?? '',
      forceRefresh: refresh === '1' || refresh === 'true',
      limit: maxResults ? Number.parseInt(maxResults, 10) : 20,
    });

    return {
      total: result.issues.length,
      issues: result.issues.map((issue) => ({
        id: issue.issueId,
        key: issue.issueKey,
        summary: issue.summary,
        status: issue.status,
        issueType: issue.issueType,
        assignee: issue.assignee,
        assigneeAccountId: issue.assigneeAccountId,
        projectKey: issue.projectKey,
        projectName: issue.projectName,
        priority: issue.priority,
        updatedAt: issue.updatedAt,
        issueUrl: issue.issueUrl,
      })),
      error: result.error,
    };
  }

  @Get('issues')
  async getIssues(
    @Query('maxResults') maxResults?: string,
    @Query('refresh') refresh?: string,
  ) {
    const userId = await this.jiraService.getConnectedUserId();
    if (!userId) {
      return this.jiraService.getIssues(
        maxResults ? Number.parseInt(maxResults, 10) : 20,
      );
    }

    const result = await this.jiraIssuePickerService.getPickerIssues(userId, {
      forceRefresh: refresh === '1' || refresh === 'true',
      limit: maxResults ? Number.parseInt(maxResults, 10) : 50,
    });

    return {
      total: result.issues.length,
      issues: result.issues.map((issue) => ({
        id: issue.issueId,
        key: issue.issueKey,
        summary: issue.summary,
        status: issue.status,
        issueType: issue.issueType,
        assignee: issue.assignee,
        assigneeAccountId: issue.assigneeAccountId,
        projectKey: issue.projectKey,
        projectName: issue.projectName,
        priority: issue.priority,
        updatedAt: issue.updatedAt,
        issueUrl: issue.issueUrl,
      })),
      fromCache: result.fromCache,
      error: result.error,
    };
  }

  @Get('my-issues')
  getMyIssues(@Query('maxResults') maxResults?: string) {
    return this.jiraService.getMyIssues(
      maxResults ? Number.parseInt(maxResults, 10) : 20,
    );
  }
}
