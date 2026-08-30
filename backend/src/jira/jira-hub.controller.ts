import { Controller, Get, Query } from '@nestjs/common';
import { JiraHubService } from './jira-hub.service';
import { TeamMemoryService } from './team-memory.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveActiveWorkspaceId } from '../common/workspace-context';
import { WorkspaceTimelineService } from '../common/workspace-timeline.service';

@Controller('jira/hub')
export class JiraHubController {
  constructor(
    private readonly jiraHubService: JiraHubService,
    private readonly teamMemoryService: TeamMemoryService,
    private readonly timelineService: WorkspaceTimelineService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('overview')
  getOverview() {
    return this.jiraHubService.getOverview();
  }

  @Get('projects')
  getProjects(@Query('maxIssues') maxIssues?: string) {
    const parsed = maxIssues ? Number.parseInt(maxIssues, 10) : 5;
    return this.jiraHubService.getProjectsWithIssues(
      Number.isFinite(parsed) ? parsed : 5,
    );
  }

  @Get('activity')
  getActivity(
    @Query('days') days?: string,
    @Query('limit') limit?: string,
    @Query('maxIssues') maxIssues?: string,
  ) {
    const parsedDays = days ? Number.parseInt(days, 10) : 30;
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 80;
    const parsedMaxIssues = maxIssues ? Number.parseInt(maxIssues, 10) : 25;
    return this.jiraHubService.getRecentActivity({
      days: Number.isFinite(parsedDays) ? parsedDays : 30,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 80,
      maxIssues: Number.isFinite(parsedMaxIssues) ? parsedMaxIssues : 25,
    });
  }

  @Get('timeline')
  getWorkspaceTimeline(
    @Query('workspaceId') workspaceId?: string,
    @Query('userId') userId?: string,
    @Query('eventType') eventType?: string,
    @Query('issueKey') issueKey?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 120;
    return this.timelineService.getTimeline({
      workspaceId,
      userId,
      eventType,
      issueKey,
      from,
      to,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 120,
    });
  }

  @Get('linked-issues')
  getLinkedIssues(@Query('limit') limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : 50;
    return this.jiraHubService.getRecentLinkedIssues(
      Number.isFinite(parsed) ? parsed : 50,
    );
  }

  @Get('blockers')
  getBlockers(@Query('teamId') teamId?: string) {
    return this.jiraHubService.getBlockers(teamId);
  }

  @Get('analytics')
  getAnalytics() {
    return this.jiraHubService.getAnalytics();
  }

  @Get('linked-standups')
  getLinkedStandups(@Query('issueKey') issueKey?: string) {
    return this.jiraHubService.getLinkedStandups(issueKey);
  }

  @Get('standup-history')
  getStandupHistory(
    @Query('search') search?: string,
    @Query('userId') userId?: string,
    @Query('checkInId') checkInId?: string,
    @Query('issueKey') issueKey?: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 100;
    return this.jiraHubService.getStandupHistory({
      search,
      userId,
      checkInId,
      issueKey,
      preset,
      from,
      to,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 100,
    });
  }

  @Get('insights')
  getInsights() {
    return this.jiraHubService.getAiInsights();
  }

  @Get('memory/search')
  async searchMemory(@Query('q') q?: string, @Query('limit') limit?: string) {
    const workspaceId = await resolveActiveWorkspaceId(this.prisma);

    if (!workspaceId) {
      return { results: [] };
    }

    const parsed = limit ? Number.parseInt(limit, 10) : 20;
    return this.teamMemoryService.search(
      workspaceId,
      q?.trim() ?? '',
      Number.isFinite(parsed) ? parsed : 20,
    );
  }
}
