import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { JiraService } from '../jira/jira.service';
import type { JiraWorkspaceMember } from '../jira/jira.types';
import { WORKSPACE_KNOWLEDGE_CHANGED } from '../ai/workspace/retrieval/knowledge-events';
import { DEMO_SLACK_WORKSPACE_ID } from './demo.constants';
import {
  buildDemoWorkspaceFromJiraMembers,
  deleteDemoWorkspaceOnly,
  fingerprintDemoSource,
  readDemoMemberFingerprint,
} from './demo-workspace-builder';
import type { DemoLiveBoard } from './demo-live-board';

export type DemoGenerateResult = {
  regenerated: boolean;
  reason: string;
  workspaceId?: string;
  fingerprint: string;
  previousFingerprint: string | null;
  members: Array<{ name: string; accountId: string }>;
  counts?: Record<string, number>;
};

/**
 * Demo Workspace is a normal PostgreSQL tenant (same tables / AI pipeline as Real).
 * This service only seeds / clears that tenant — it never forks runtime logic
 * and never calls the live Slack API (placeholder bot token is non-usable).
 */
@Injectable()
export class DemoWorkspaceGeneratorService {
  private readonly logger = new Logger(DemoWorkspaceGeneratorService.name);
  private regenerating = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jiraService: JiraService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Read-only: members from the connected (real) Jira workspace.
   */
  async listSourceJiraMembers(): Promise<JiraWorkspaceMember[]> {
    const connection = await this.jiraService.findRealJiraConnection();
    if (!connection) {
      throw new NotFoundException(
        'Connect Jira on a non-Demo workspace first. Demo data is seeded from that member list only.',
      );
    }
    return this.jiraService.listWorkspaceMembers({ connection });
  }

  /**
   * Read-only: Live Jira projects + issues (real keys/summaries/assignees).
   */
  async listSourceJiraBoard(): Promise<DemoLiveBoard> {
    const connection = await this.jiraService.findRealJiraConnection();
    if (!connection) {
      throw new NotFoundException(
        'Connect Jira on a non-Demo workspace first.',
      );
    }
    return this.jiraService.listIssuesForDemoGeneration({
      connection,
      maxIssues: 100,
    });
  }

  async getStatus() {
    const members = await this.listSourceJiraMembers().catch(
      () => [] as JiraWorkspaceMember[],
    );
    const board = await this.listSourceJiraBoard().catch(
      (): DemoLiveBoard => ({
        siteUrl: '',
        projects: [],
        issues: [],
      }),
    );
    const fingerprint = members.length
      ? fingerprintDemoSource(members, board.issues.length ? board : null)
      : null;
    const stored = await readDemoMemberFingerprint(this.prisma);
    const demo = await this.prisma.workspace.findUnique({
      where: { slackWorkspaceId: DEMO_SLACK_WORKSPACE_ID },
      select: { id: true, slackWorkspaceName: true },
    });
    const demoUserCount = demo
      ? await this.prisma.user.count({ where: { workspaceId: demo.id } })
      : 0;

    return {
      demoWorkspaceId: demo?.id ?? null,
      demoWorkspaceName: demo?.slackWorkspaceName ?? null,
      demoUserCount,
      sourceMemberCount: members.length,
      sourceIssueCount: board.issues.length,
      sourceProjectCount: board.projects.length,
      sourceMembers: members.map((m) => ({
        accountId: m.accountId,
        displayName: m.displayName,
        emailAddress: m.emailAddress ?? null,
      })),
      currentFingerprint: fingerprint,
      storedFingerprint: stored,
      stale: Boolean(fingerprint && stored && fingerprint !== stored),
      missing: !demo,
    };
  }

  /** Alias: wipe Demo tenant only (never touches Real Workspace). */
  async clearDemoWorkspace(): Promise<{ removed: boolean }> {
    return this.removeDemoOnly();
  }

  /**
   * Alias: force full Demo rebuild into shared PostgreSQL tables.
   * Same as seedDemoWorkspace().
   */
  async generateDemoWorkspace(): Promise<DemoGenerateResult> {
    return this.ensureGenerated({ force: true });
  }

  /**
   * Alias: force seed/rebuild Demo from current real Jira members.
   * Deletes Demo data only, then inserts into the same tables Real uses.
   */
  async seedDemoWorkspace(): Promise<DemoGenerateResult> {
    return this.ensureGenerated({ force: true });
  }

  /**
   * Alias: regenerate only when the Jira member fingerprint changed (or Demo missing).
   */
  async refreshDemoWorkspace(): Promise<DemoGenerateResult> {
    return this.ensureGenerated({ force: false });
  }

  /**
   * Regenerate Demo Workspace when the Jira member fingerprint changes (or force).
   * Never writes to Atlassian / real Jira — only Postgres Demo tenant.
   */
  async ensureGenerated(options?: {
    force?: boolean;
  }): Promise<DemoGenerateResult> {
    if (this.regenerating) {
      return {
        regenerated: false,
        reason: 'Regeneration already in progress',
        fingerprint: '',
        previousFingerprint: null,
        members: [],
      };
    }

    this.regenerating = true;
    try {
      const members = await this.listSourceJiraMembers();
      if (members.length === 0) {
        throw new BadRequestException(
          'Connected Jira returned no human members to seed Demo from.',
        );
      }

      const board = await this.listSourceJiraBoard().catch((error) => {
        this.logger.warn(
          `Live Jira issue list failed for Demo seed: ${
            error instanceof Error ? error.message : String(error)
          } — falling back to member-only templates`,
        );
        return null;
      });

      const fingerprint = fingerprintDemoSource(members, board);
      const previousFingerprint = await readDemoMemberFingerprint(this.prisma);

      if (!options?.force && previousFingerprint === fingerprint) {
        const demo = await this.prisma.workspace.findUnique({
          where: { slackWorkspaceId: DEMO_SLACK_WORKSPACE_ID },
          select: { id: true },
        });
        this.logger.log(
          `Demo Workspace unchanged (fingerprint=${fingerprint.slice(0, 12)}…) — skip regenerate`,
        );
        return {
          regenerated: false,
          reason: 'Jira members + issues unchanged',
          workspaceId: demo?.id,
          fingerprint,
          previousFingerprint,
          members: members.map((m) => ({
            name: m.displayName,
            accountId: m.accountId,
          })),
        };
      }

      this.logger.log(
        `Seeding Demo Workspace from ${members.length} Jira member(s) + ${
          board?.issues.length ?? 0
        } Live issue(s)${options?.force ? ' (forced)' : ''}`,
      );

      const result = await buildDemoWorkspaceFromJiraMembers(
        this.prisma,
        members,
        board,
      );

      this.events.emit(WORKSPACE_KNOWLEDGE_CHANGED, {
        workspaceId: result.workspaceId,
        reason: 'demo_workspace_seeded',
      });

      return {
        regenerated: true,
        reason: options?.force
          ? 'Forced regeneration'
          : previousFingerprint
            ? 'Jira member list changed'
            : 'Demo Workspace missing or first generation',
        workspaceId: result.workspaceId,
        fingerprint: result.fingerprint,
        previousFingerprint,
        members: result.members,
        counts: result.counts,
      };
    } finally {
      this.regenerating = false;
    }
  }

  async removeDemoOnly(): Promise<{ removed: boolean }> {
    const existing = await this.prisma.workspace.findUnique({
      where: { slackWorkspaceId: DEMO_SLACK_WORKSPACE_ID },
      select: { id: true },
    });
    if (!existing) return { removed: false };
    await deleteDemoWorkspaceOnly(this.prisma);
    return { removed: true };
  }
}
