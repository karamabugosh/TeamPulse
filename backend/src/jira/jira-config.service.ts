import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type CreateJiraIntegrationInput = {
  workspaceId: string;
  cloudId: string;
  siteUrl: string;
  siteName?: string;
  enabled?: boolean;
  isDefault?: boolean;
  defaultProjectKey?: string;
  allowedProjectKeys?: string[];
  cacheTtlMinutes?: number;
};

@Injectable()
export class JiraConfigService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private readonly safeIntegrationSelect = {
    id: true,
    workspaceId: true,
    cloudId: true,
    siteUrl: true,
    siteName: true,
    enabled: true,
    isDefault: true,
    defaultProjectKey: true,
    allowedProjectKeys: true,
    cacheTtlMinutes: true,
    health: true,
    lastHealthCheckAt: true,
    lastSuccessfulSyncAt: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  async listWorkspaceIntegrations(
    workspaceIdInput: string,
  ) {
    const workspaceId = workspaceIdInput?.trim();

    if (!workspaceId) {
      throw new BadRequestException(
        'workspaceId is required.',
      );
    }

    const workspace =
      await this.prisma.workspace.findUnique({
        where: {
          id: workspaceId,
        },
        select: {
          id: true,
        },
      });

    if (!workspace) {
      throw new NotFoundException(
        `Workspace ${workspaceId} was not found.`,
      );
    }

    return this.prisma.jiraIntegration.findMany({
      where: {
        workspaceId,
      },
      select: this.safeIntegrationSelect,
      orderBy: [
        {
          isDefault: 'desc',
        },
        {
          siteName: 'asc',
        },
        {
          createdAt: 'asc',
        },
      ],
    });
  }

  async createWorkspaceIntegration(
    input: CreateJiraIntegrationInput,
  ) {
    const workspaceId = input.workspaceId?.trim();
    const cloudId = input.cloudId?.trim();
    const siteUrl = this.normalizeSiteUrl(
      input.siteUrl,
    );
    const siteName = input.siteName?.trim() || null;

    if (!workspaceId) {
      throw new BadRequestException(
        'workspaceId is required.',
      );
    }

    if (!cloudId) {
      throw new BadRequestException(
        'cloudId is required.',
      );
    }

    const cacheTtlMinutes =
      input.cacheTtlMinutes ?? 15;

    if (
      !Number.isInteger(cacheTtlMinutes) ||
      cacheTtlMinutes < 1 ||
      cacheTtlMinutes > 1440
    ) {
      throw new BadRequestException(
        'cacheTtlMinutes must be an integer between 1 and 1440.',
      );
    }

    const defaultProjectKey =
      this.normalizeOptionalProjectKey(
        input.defaultProjectKey,
      );

    const allowedProjectKeys =
      this.normalizeProjectKeys(
        input.allowedProjectKeys ?? [],
      );

    if (
      defaultProjectKey &&
      allowedProjectKeys.length > 0 &&
      !allowedProjectKeys.includes(defaultProjectKey)
    ) {
      throw new BadRequestException(
        'defaultProjectKey must be included in allowedProjectKeys when the allowed list is not empty.',
      );
    }

    const workspace =
      await this.prisma.workspace.findUnique({
        where: {
          id: workspaceId,
        },
        select: {
          id: true,
        },
      });

    if (!workspace) {
      throw new NotFoundException(
        `Workspace ${workspaceId} was not found.`,
      );
    }

    const existingIntegration =
      await this.prisma.jiraIntegration.findUnique({
        where: {
          workspaceId_cloudId: {
            workspaceId,
            cloudId,
          },
        },
        select: {
          id: true,
        },
      });

    if (existingIntegration) {
      throw new ConflictException(
        'This Jira site is already connected to the workspace.',
      );
    }

    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const integrationCount =
            await transaction.jiraIntegration.count({
              where: {
                workspaceId,
              },
            });

          const shouldBeDefault =
            input.isDefault ?? integrationCount === 0;

          if (shouldBeDefault) {
            await transaction.jiraIntegration.updateMany({
              where: {
                workspaceId,
                isDefault: true,
              },
              data: {
                isDefault: false,
              },
            });
          }

          return transaction.jiraIntegration.create({
            data: {
              workspaceId,
              cloudId,
              siteUrl,
              siteName,
              enabled: input.enabled ?? true,
              isDefault: shouldBeDefault,
              defaultProjectKey,
              allowedProjectKeys,
              cacheTtlMinutes,
            },
            select: this.safeIntegrationSelect,
          });
        },
      );
    } catch (error) {
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'This Jira site is already connected to the workspace.',
        );
      }

      throw error;
    }
  }

  private normalizeSiteUrl(
    siteUrlInput: string,
  ): string {
    const value = siteUrlInput?.trim();

    if (!value) {
      throw new BadRequestException(
        'siteUrl is required.',
      );
    }

    let parsedUrl: URL;

    try {
      parsedUrl = new URL(value);
    } catch {
      throw new BadRequestException(
        'siteUrl must be a valid URL.',
      );
    }

    if (parsedUrl.protocol !== 'https:') {
      throw new BadRequestException(
        'siteUrl must use HTTPS.',
      );
    }

    if (
      parsedUrl.pathname !== '/' ||
      parsedUrl.search ||
      parsedUrl.hash
    ) {
      throw new BadRequestException(
        'siteUrl must contain only the Jira site origin, without a path, query, or fragment.',
      );
    }

    return parsedUrl.origin;
  }

  private normalizeOptionalProjectKey(
    projectKeyInput?: string,
  ): string | null {
    const value = projectKeyInput
      ?.trim()
      .toUpperCase();

    return value || null;
  }

  private normalizeProjectKeys(
    projectKeys: string[],
  ): string[] {
    if (!Array.isArray(projectKeys)) {
      throw new BadRequestException(
        'allowedProjectKeys must be an array.',
      );
    }

    return Array.from(
      new Set(
        projectKeys
          .map((projectKey) =>
            projectKey?.trim().toUpperCase(),
          )
          .filter(
            (projectKey): projectKey is string =>
              Boolean(projectKey),
          ),
      ),
    );
  }
}