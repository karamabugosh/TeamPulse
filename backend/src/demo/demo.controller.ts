import { Controller, Delete, Get, Post, Query } from '@nestjs/common';
import { DemoWorkspaceGeneratorService } from './demo-workspace-generator.service';

/**
 * Admin APIs for the Demo Workspace tenant.
 * Demo is a normal workspace row in PostgreSQL — these endpoints only seed/clear it.
 */
@Controller('demo')
export class DemoController {
  constructor(private readonly demoGenerator: DemoWorkspaceGeneratorService) {}

  /** Source Jira members + Demo fingerprint status */
  @Get('status')
  getStatus() {
    return this.demoGenerator.getStatus();
  }

  /** Members read from the connected real Jira workspace (read-only seed input). */
  @Get('jira-members')
  async listJiraMembers() {
    const members = await this.demoGenerator.listSourceJiraMembers();
    return {
      total: members.length,
      members: members.map((m) => ({
        accountId: m.accountId,
        displayName: m.displayName,
        emailAddress: m.emailAddress ?? null,
        avatarUrl: m.avatarUrl ?? null,
      })),
    };
  }

  /**
   * Regenerate Demo Workspace from current Jira members.
   * Query: ?force=1 to rebuild even when the member fingerprint is unchanged.
   */
  @Post('regenerate')
  regenerate(@Query('force') force?: string) {
    const forced = force === '1' || force === 'true' || force === 'yes';
    return this.demoGenerator.ensureGenerated({ force: forced });
  }

  /** Force full Demo seed into shared tables. */
  @Post('seed')
  seed() {
    return this.demoGenerator.seedDemoWorkspace();
  }

  /** Force generate (alias of seed). */
  @Post('generate')
  generate() {
    return this.demoGenerator.generateDemoWorkspace();
  }

  /** Refresh when Jira member fingerprint changed (idempotent skip otherwise). */
  @Post('refresh')
  refresh() {
    return this.demoGenerator.refreshDemoWorkspace();
  }

  /** Delete Demo Workspace data only — never touches Real. */
  @Delete()
  clear() {
    return this.demoGenerator.clearDemoWorkspace();
  }
}
