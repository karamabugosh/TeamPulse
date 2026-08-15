import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type UpsertTeamJiraConfigInput = {
  teamId: string;
  jiraIntegrationId?: string | null;
  enabled?: boolean;
  issuePickerEnabled?: boolean;
  activityPrefillEnabled?: boolean;
  commentProposalEnabled?: boolean;
  transitionProposalEnabled?: boolean;
  blockerProposalEnabled?: boolean;
  issueLinkProposalEnabled?: boolean;
  createIssueProposalEnabled?: boolean;
  defaultProjectKey?: string | null;
};

@Injectable()
export class JiraTeamConfigService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private readonly safeTeamConfigSelect = {
    id: true,
    teamId: true,
    jiraIntegrationId: true,
    enabled: true,
    issuePickerEnabled: true,
    activityPrefillEnabled: true,
    commentProposalEnabled: true,
    transitionProposalEnabled: true,
    blockerProposalEnabled: true,
    issueLinkProposalEnabled: true,
    createIssueProposalEnabled: true,
    defaultProjectKey: true,
    createdAt: true,
    updatedAt: true,
    jiraIntegration: {
      select: {
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
      },
    },
  } as const;

  async getTeamConfig(
    teamIdInput: string,
  ) {
    const teamId = teamIdInput?.trim();

    if (!teamId) {
      throw new BadRequestException(
        'teamId is required.',
      );
    }

    const team =
      await this.prisma.team.findUnique({
        where: {
          id: teamId,
        },
        select: {
          id: true,
        },
      });

    if (!team) {
      throw new NotFoundException(
        `Team ${teamId} was not found.`,
      );
    }

    return this.prisma.teamJiraConfig.findUnique({
      where: {
        teamId,
      },
      select: this.safeTeamConfigSelect,
    });
  }

  async upsertTeamConfig(
    input: UpsertTeamJiraConfigInput,
  ) {
    const teamId = input.teamId?.trim();

    if (!teamId) {
      throw new BadRequestException(
        'teamId is required.',
      );
    }

    const team =
      await this.prisma.team.findUnique({
        where: {
          id: teamId,
        },
        select: {
          id: true,
          workspaceId: true,
        },
      });

    if (!team) {
      throw new NotFoundException(
        `Team ${teamId} was not found.`,
      );
    }

    const existingConfig =
      await this.prisma.teamJiraConfig.findUnique({
        where: {
          teamId,
        },
        select: {
          jiraIntegrationId: true,
          enabled: true,
          issuePickerEnabled: true,
          activityPrefillEnabled: true,
          commentProposalEnabled: true,
          transitionProposalEnabled: true,
          blockerProposalEnabled: true,
          issueLinkProposalEnabled: true,
          createIssueProposalEnabled: true,
          defaultProjectKey: true,
        },
      });

    const integrationFieldWasProvided =
      Object.prototype.hasOwnProperty.call(
        input,
        'jiraIntegrationId',
      );

    const requestedIntegrationId =
      input.jiraIntegrationId?.trim() || null;

    const effectiveIntegrationId =
      integrationFieldWasProvided
        ? requestedIntegrationId
        : existingConfig?.jiraIntegrationId ?? null;

    const effectiveEnabled =
      input.enabled ??
      existingConfig?.enabled ??
      false;

    const effectiveIssuePickerEnabled =
      input.issuePickerEnabled ??
      existingConfig?.issuePickerEnabled ??
      true;

    const effectiveActivityPrefillEnabled =
      input.activityPrefillEnabled ??
      existingConfig?.activityPrefillEnabled ??
      false;

    const effectiveCommentProposalEnabled =
      input.commentProposalEnabled ??
      existingConfig?.commentProposalEnabled ??
      true;

    const effectiveTransitionProposalEnabled =
      input.transitionProposalEnabled ??
      existingConfig?.transitionProposalEnabled ??
      true;

    const effectiveBlockerProposalEnabled =
      input.blockerProposalEnabled ??
      existingConfig?.blockerProposalEnabled ??
      true;

    const effectiveIssueLinkProposalEnabled =
      input.issueLinkProposalEnabled ??
      existingConfig?.issueLinkProposalEnabled ??
      true;

    const effectiveCreateIssueProposalEnabled =
      input.createIssueProposalEnabled ??
      existingConfig?.createIssueProposalEnabled ??
      false;

    const defaultProjectFieldWasProvided =
      Object.prototype.hasOwnProperty.call(
        input,
        'defaultProjectKey',
      );

    const requestedDefaultProjectKey =
      this.normalizeOptionalProjectKey(
        input.defaultProjectKey,
      );

    const effectiveDefaultProjectKey =
      defaultProjectFieldWasProvided
        ? requestedDefaultProjectKey
        : existingConfig?.defaultProjectKey ?? null;

    if (
      effectiveEnabled &&
      !effectiveIntegrationId
    ) {
      throw new BadRequestException(
        'jiraIntegrationId is required when Jira is enabled for the team.',
      );
    }

    let integration:
      | {
          id: string;
          workspaceId: string;
          enabled: boolean;
          allowedProjectKeys: string[];
        }
      | null = null;

    if (effectiveIntegrationId) {
      integration =
        await this.prisma.jiraIntegration.findUnique({
          where: {
            id: effectiveIntegrationId,
          },
          select: {
            id: true,
            workspaceId: true,
            enabled: true,
            allowedProjectKeys: true,
          },
        });

      if (!integration) {
        throw new NotFoundException(
          `Jira integration ${effectiveIntegrationId} was not found.`,
        );
      }

      if (
        integration.workspaceId !==
        team.workspaceId
      ) {
        throw new BadRequestException(
          'The team and Jira integration must belong to the same workspace.',
        );
      }

      if (
        effectiveEnabled &&
        !integration.enabled
      ) {
        throw new BadRequestException(
          'The selected Jira integration is disabled.',
        );
      }

      if (
        effectiveDefaultProjectKey &&
        integration.allowedProjectKeys.length > 0 &&
        !integration.allowedProjectKeys.includes(
          effectiveDefaultProjectKey,
        )
      ) {
        throw new BadRequestException(
          'defaultProjectKey must be allowed by the selected Jira integration.',
        );
      }
    }

    return this.prisma.teamJiraConfig.upsert({
      where: {
        teamId,
      },
      update: {
        jiraIntegrationId:
          effectiveIntegrationId,
        enabled: effectiveEnabled,
        issuePickerEnabled:
          effectiveIssuePickerEnabled,
        activityPrefillEnabled:
          effectiveActivityPrefillEnabled,
        commentProposalEnabled:
          effectiveCommentProposalEnabled,
        transitionProposalEnabled:
          effectiveTransitionProposalEnabled,
        blockerProposalEnabled:
          effectiveBlockerProposalEnabled,
        issueLinkProposalEnabled:
          effectiveIssueLinkProposalEnabled,
        createIssueProposalEnabled:
          effectiveCreateIssueProposalEnabled,
        defaultProjectKey:
          effectiveDefaultProjectKey,
      },
      create: {
        teamId,
        jiraIntegrationId:
          effectiveIntegrationId,
        enabled: effectiveEnabled,
        issuePickerEnabled:
          effectiveIssuePickerEnabled,
        activityPrefillEnabled:
          effectiveActivityPrefillEnabled,
        commentProposalEnabled:
          effectiveCommentProposalEnabled,
        transitionProposalEnabled:
          effectiveTransitionProposalEnabled,
        blockerProposalEnabled:
          effectiveBlockerProposalEnabled,
        issueLinkProposalEnabled:
          effectiveIssueLinkProposalEnabled,
        createIssueProposalEnabled:
          effectiveCreateIssueProposalEnabled,
        defaultProjectKey:
          effectiveDefaultProjectKey,
      },
      select: this.safeTeamConfigSelect,
    });
  }

  private normalizeOptionalProjectKey(
    projectKeyInput?: string | null,
  ): string | null {
    const value = projectKeyInput
      ?.trim()
      .toUpperCase();

    return value || null;
  }
}