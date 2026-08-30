import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolveActiveWorkspaceId } from '../../../common/workspace-context';
import { DEMO_SLACK_WORKSPACE_ID } from '../../../demo/demo.constants';
import {
  GOLD_EVAL_DATASET,
  GoldEvalCaseTemplate,
  listGoldCategories,
} from './gold-dataset';

@Injectable()
export class AiEvalDatasetService {
  private readonly logger = new Logger(AiEvalDatasetService.name);

  constructor(private readonly prisma: PrismaService) {}

  listTemplates(): GoldEvalCaseTemplate[] {
    return GOLD_EVAL_DATASET;
  }

  categories() {
    return listGoldCategories();
  }

  async listCases(params: {
    workspaceId?: string | null;
    category?: string | null;
    enabledOnly?: boolean;
  }) {
    const workspaceId = await this.requireWorkspaceId(params.workspaceId);
    const rows = await this.prisma.aiEvalCase.findMany({
      where: {
        workspaceId,
        ...(params.category ? { category: params.category } : {}),
        ...(params.enabledOnly === false ? {} : { enabled: true }),
      },
      orderBy: [{ category: 'asc' }, { caseKey: 'asc' }],
    });
    return { workspaceId, cases: rows, total: rows.length };
  }

  /**
   * Upsert gold templates into AiEvalCase for the active / demo workspace.
   */
  async seedForWorkspace(params: {
    workspaceId?: string | null;
    /** When true, resolve Demo Workspace by slack id. */
    preferDemo?: boolean;
  }) {
    const workspace = await this.resolveWorkspace(params);
    let upserted = 0;

    for (const template of GOLD_EVAL_DATASET) {
      await this.prisma.aiEvalCase.upsert({
        where: {
          workspaceId_caseKey: {
            workspaceId: workspace.id,
            caseKey: template.id,
          },
        },
        create: {
          caseKey: template.id,
          workspaceId: workspace.id,
          category: template.category,
          question: template.question,
          expectedAnswer: template.expectedAnswer,
          expectedSources: template.expectedSources as Prisma.InputJsonValue,
          expectedConfidence: template.expectedConfidence,
          tags: [
            ...template.tags,
            ...(template.mustInclude ?? []).map((item) => `must:${item}`),
          ] as Prisma.InputJsonValue,
          enabled: true,
        },
        update: {
          category: template.category,
          question: template.question,
          expectedAnswer: template.expectedAnswer,
          expectedSources: template.expectedSources as Prisma.InputJsonValue,
          expectedConfidence: template.expectedConfidence,
          tags: [
            ...template.tags,
            ...(template.mustInclude ?? []).map((item) => `must:${item}`),
          ] as Prisma.InputJsonValue,
          enabled: true,
        },
      });
      upserted += 1;
    }

    this.logger.log(
      `Seeded ${upserted} eval case(s) for workspace=${workspace.id} (${workspace.slackWorkspaceName})`,
    );

    return {
      workspaceId: workspace.id,
      workspaceName: workspace.slackWorkspaceName,
      slackWorkspaceId: workspace.slackWorkspaceId,
      upserted,
      categories: listGoldCategories(),
    };
  }

  async resolveWorkspace(params: {
    workspaceId?: string | null;
    preferDemo?: boolean;
  }) {
    if (params.preferDemo) {
      const demo = await this.prisma.workspace.findUnique({
        where: { slackWorkspaceId: DEMO_SLACK_WORKSPACE_ID },
        select: {
          id: true,
          slackWorkspaceName: true,
          slackWorkspaceId: true,
        },
      });
      if (!demo) {
        throw new NotFoundException(
          'Demo Workspace not found. Run npm run seed:demo first.',
        );
      }
      return demo;
    }

    const workspaceId = await this.requireWorkspaceId(params.workspaceId);
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        id: true,
        slackWorkspaceName: true,
        slackWorkspaceId: true,
      },
    });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    return workspace;
  }

  private async requireWorkspaceId(preferred?: string | null) {
    const workspaceId = await resolveActiveWorkspaceId(this.prisma, preferred);
    if (!workspaceId) {
      throw new NotFoundException('No active workspace');
    }
    return workspaceId;
  }
}
