import * as assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  JiraTeamConfigService,
  UpsertTeamJiraConfigInput,
} from './jira-team-config.service';
import { PrismaService } from '../prisma/prisma.service';

type ExistingTeamConfig = {
  jiraIntegrationId: string | null;
  enabled: boolean;
  issuePickerEnabled: boolean;
  activityPrefillEnabled: boolean;
  commentProposalEnabled: boolean;
  transitionProposalEnabled: boolean;
  blockerProposalEnabled: boolean;
  issueLinkProposalEnabled: boolean;
  createIssueProposalEnabled: boolean;
  defaultProjectKey: string | null;
};

type JiraIntegrationRecord = {
  id: string;
  workspaceId: string;
  enabled: boolean;
  allowedProjectKeys: string[];
};

type UpsertArguments = {
  where: {
    teamId: string;
  };
  update: Record<string, unknown>;
  create: Record<string, unknown>;
  select: unknown;
};

describe('JiraTeamConfigService', () => {
  let service: JiraTeamConfigService;

  let teamExists: boolean;
  let teamWorkspaceId: string;

  let existingConfig:
    | ExistingTeamConfig
    | null;

  let integration:
    | JiraIntegrationRecord
    | null;

  let capturedUpsert:
    | UpsertArguments
    | undefined;

  beforeEach(() => {
    teamExists = true;
    teamWorkspaceId = 'workspace-1';

    existingConfig = null;

    integration = {
      id: 'jira-integration-1',
      workspaceId: 'workspace-1',
      enabled: true,
      allowedProjectKeys: [
        'PULSE',
        'DEV',
      ],
    };

    capturedUpsert = undefined;

    const prismaMock = {
      team: {
        findUnique: async () =>
          teamExists
            ? {
                id: 'team-1',
                workspaceId:
                  teamWorkspaceId,
              }
            : null,
      },

      teamJiraConfig: {
        findUnique: async () =>
          existingConfig,

        upsert: async (
          argumentsInput: UpsertArguments,
        ) => {
          capturedUpsert =
            argumentsInput;

          return {
            id: 'team-jira-config-1',
            ...argumentsInput.create,
            createdAt: new Date(
              '2026-08-15T00:00:00.000Z',
            ),
            updatedAt: new Date(
              '2026-08-15T00:00:00.000Z',
            ),
            jiraIntegration:
              integration,
          };
        },
      },

      jiraIntegration: {
        findUnique: async () =>
          integration,
      },
    };

    service = new JiraTeamConfigService(
      prismaMock as unknown as PrismaService,
    );
  });

  test('creates an enabled team configuration for an integration in the same workspace', async () => {
    const input: UpsertTeamJiraConfigInput = {
      teamId: ' team-1 ',
      jiraIntegrationId:
        ' jira-integration-1 ',
      enabled: true,
      issuePickerEnabled: true,
      activityPrefillEnabled: true,
      transitionProposalEnabled: true,
      defaultProjectKey: 'pulse',
    };

    const result =
      await service.upsertTeamConfig(input);

    assert.equal(
      result.id,
      'team-jira-config-1',
    );

    assert.equal(
      capturedUpsert?.where.teamId,
      'team-1',
    );

    assert.deepEqual(
      capturedUpsert?.create,
      {
        teamId: 'team-1',
        jiraIntegrationId:
          'jira-integration-1',
        enabled: true,
        issuePickerEnabled: true,
        activityPrefillEnabled: true,
        commentProposalEnabled: true,
        transitionProposalEnabled: true,
        blockerProposalEnabled: true,
        issueLinkProposalEnabled: true,
        createIssueProposalEnabled: false,
        defaultProjectKey: 'PULSE',
      },
    );
  });

  test('rejects enabling Jira without selecting an integration', async () => {
    await assert.rejects(
      () =>
        service.upsertTeamConfig({
          teamId: 'team-1',
          enabled: true,
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes(
          'jiraIntegrationId is required',
        ),
    );
  });

  test('rejects an integration from another workspace', async () => {
    integration = {
      id: 'jira-integration-2',
      workspaceId: 'workspace-2',
      enabled: true,
      allowedProjectKeys: [],
    };

    await assert.rejects(
      () =>
        service.upsertTeamConfig({
          teamId: 'team-1',
          jiraIntegrationId:
            'jira-integration-2',
          enabled: true,
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes(
          'same workspace',
        ),
    );
  });

  test('rejects enabling a disabled integration', async () => {
    integration = {
      id: 'jira-integration-1',
      workspaceId: 'workspace-1',
      enabled: false,
      allowedProjectKeys: [],
    };

    await assert.rejects(
      () =>
        service.upsertTeamConfig({
          teamId: 'team-1',
          jiraIntegrationId:
            'jira-integration-1',
          enabled: true,
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message ===
          'The selected Jira integration is disabled.',
    );
  });

  test('rejects a team default project that is not allowed by the integration', async () => {
    await assert.rejects(
      () =>
        service.upsertTeamConfig({
          teamId: 'team-1',
          jiraIntegrationId:
            'jira-integration-1',
          enabled: true,
          defaultProjectKey: 'OPS',
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes(
          'must be allowed',
        ),
    );
  });

  test('rejects an unknown team', async () => {
    teamExists = false;

    await assert.rejects(
      () =>
        service.upsertTeamConfig({
          teamId: 'missing-team',
          enabled: false,
        }),
      (error: unknown) =>
        error instanceof NotFoundException &&
        error.message.includes(
          'missing-team',
        ),
    );
  });

  test('preserves existing settings when optional values are omitted', async () => {
    existingConfig = {
      jiraIntegrationId:
        'jira-integration-1',
      enabled: true,
      issuePickerEnabled: true,
      activityPrefillEnabled: true,
      commentProposalEnabled: false,
      transitionProposalEnabled: true,
      blockerProposalEnabled: false,
      issueLinkProposalEnabled: true,
      createIssueProposalEnabled: true,
      defaultProjectKey: 'DEV',
    };

    await service.upsertTeamConfig({
      teamId: 'team-1',
    });

    assert.deepEqual(
      capturedUpsert?.update,
      {
        jiraIntegrationId:
          'jira-integration-1',
        enabled: true,
        issuePickerEnabled: true,
        activityPrefillEnabled: true,
        commentProposalEnabled: false,
        transitionProposalEnabled: true,
        blockerProposalEnabled: false,
        issueLinkProposalEnabled: true,
        createIssueProposalEnabled: true,
        defaultProjectKey: 'DEV',
      },
    );
  });
});