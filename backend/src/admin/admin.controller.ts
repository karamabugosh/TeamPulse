import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('workspaces')
  listWorkspaces() {
    return this.adminService.listWorkspaces();
  }

  @Get('overview')
  getOverview() {
    return this.adminService.getOverviewStats();
  }

  @Get('analytics/snapshot')
  getAnalyticsSnapshot() {
    return this.adminService.getAnalyticsSnapshot();
  }

  @Get('analytics')
  getAnalytics() {
    return this.adminService.getAnalyticsData();
  }

  @Get('reports')
  getReports(
    @Query('search') search?: string,
    @Query('timeframe') timeframe?: string,
  ) {
    return this.adminService.getReportsList(search, timeframe);
  }

  @Get('reports/grouped')
  getReportsGrouped(
    @Query('search') search?: string,
    @Query('timeframe') timeframe?: string,
  ) {
    return this.adminService.getReportsGrouped(search, timeframe);
  }

  @Get('reports/by-checkin/:checkInId')
  getReportsForCheckIn(@Param('checkInId') checkInId: string) {
    return this.adminService.getReportsForCheckIn(checkInId);
  }

  @Get('reports/by-run/:runId')
  getReportByRun(@Param('runId') runId: string) {
    return this.adminService.getReportByRunId(runId);
  }

  @Get('reports/:id/export/csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="report-export.csv"')
  exportCsv(@Param('id') id: string) {
    return this.adminService.exportReportCsv(id);
  }

  @Get('reports/:id/export/pdf')
  @Header('Content-Type', 'text/plain')
  @Header('Content-Disposition', 'attachment; filename="report-export.txt"')
  exportPdf(@Param('id') id: string) {
    return this.adminService.exportReportPdf(id);
  }

  @Get('reports/:id')
  getReport(@Param('id') id: string) {
    return this.adminService.getReportDetail(id);
  }

  @Get('settings')
  getSettings() {
    return this.adminService.getSettings();
  }

  @Put('settings')
  updateSettings(@Body() body: any) {
    return this.adminService.updateSettings(body);
  }

  @Get('teams')
  getTeams() {
    return this.adminService.getTeams();
  }

  @Post('teams')
  @HttpCode(201)
  createTeam(@Body() body: { name: string; slackChannelId?: string; timezone?: string; scheduleCron?: string }) {
    return this.adminService.createTeam(body);
  }

  @Delete('teams/:id')
  deleteTeam(@Param('id') id: string) {
    return this.adminService.deleteTeam(id);
  }

  @Get('users')
  getUsers(@Query('search') search?: string) {
    return this.adminService.getUsers(search);
  }

  @Get('workspace-members')
  listWorkspaceMembers(
    @Query('search') search?: string,
    @Query('teamId') teamId?: string,
    @Query('sync') sync?: string,
  ) {
    return this.adminService.listWorkspaceMembers({
      search,
      teamId,
      sync: sync === 'false' ? false : true,
    });
  }

  @Post('workspace-members/sync')
  syncWorkspaceMembers() {
    return this.adminService.syncWorkspaceMembers();
  }

  @Get('teams/:teamId/members')
  searchTeamMembers(
    @Param('teamId') teamId: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.searchTeamMembers(teamId, search);
  }

  @Post('teams/:teamId/members')
  addTeamMember(
    @Param('teamId') teamId: string,
    @Body() body: { userId?: string; slackUserId?: string; role?: string },
  ) {
    return this.adminService.addTeamMember(teamId, body);
  }

  @Patch('teams/:teamId/members/:memberId')
  updateTeamMemberRole(
    @Param('teamId') teamId: string,
    @Param('memberId') memberId: string,
    @Body() body: { role: string },
  ) {
    return this.adminService.updateTeamMemberRole(teamId, memberId, body.role);
  }

  @Delete('teams/:teamId/members/:memberId')
  removeTeamMember(
    @Param('teamId') teamId: string,
    @Param('memberId') memberId: string,
  ) {
    return this.adminService.removeTeamMember(teamId, memberId);
  }
}
