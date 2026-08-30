import {
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { JiraBlockerService } from './jira-blocker.service';
import { JiraAuditService } from './jira-audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { resolveActiveWorkspaceId } from '../common/workspace-context';
import { computeBlockerStats } from './blocker-stats.util';

@Controller('blockers')
export class BlockerController {
  constructor(
    private readonly jiraBlockerService: JiraBlockerService,
    private readonly jiraAuditService: JiraAuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(@Query('teamId') teamId?: string) {
    return this.jiraBlockerService.listDashboardBlockers(teamId);
  }

  /**
   * Same Open / Critical / Waiting>3d / Resolved-this-week cards as Blockers page.
   * Derived from the full dashboard collection (no take/limit).
   */
  @Get('stats')
  async stats(@Query('teamId') teamId?: string) {
    const workspaceId = await resolveActiveWorkspaceId(this.prisma);
    if (!workspaceId) {
      return {
        workspaceId: null,
        openBlockers: 0,
        critical: 0,
        waitingMoreThan3Days: 0,
        resolvedThisWeek: 0,
        total: 0,
        resolved: 0,
      };
    }

    if (teamId) {
      const blockers =
        await this.jiraBlockerService.listDashboardBlockersForWorkspace(
          workspaceId,
          teamId,
        );
      return {
        workspaceId,
        ...computeBlockerStats(
          blockers.map((b) => ({
            status: b.status,
            priority: b.priority,
            createdAt: b.createdAt,
            resolvedAt: b.resolvedAt,
          })),
        ),
      };
    }

    return this.jiraBlockerService.getBlockerStatsForWorkspace(workspaceId);
  }

  @Get('open')
  listOpen(@Query('teamId') teamId?: string) {
    return this.jiraBlockerService.listOpenBlockers(teamId);
  }

  @Get('audit/:userId')
  audit(@Param('userId') userId: string) {
    return this.jiraAuditService.listForUser(userId);
  }
}
