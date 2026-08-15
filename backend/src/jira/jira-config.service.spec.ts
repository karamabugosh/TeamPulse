import * as assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { JiraConfigService } from './jira-config.service';
import { PrismaService } from '../prisma/prisma.service';

type CreatedIntegrationData = {
  workspaceId: string;
  cloudId: string;
  siteUrl: string;
  siteName: string | null;
  enabled: boolean;
  isDefault: boolean;
  defaultProjectKey: string | null;
  allowedProjectKeys: string[];
  cacheTtlMinutes: number;
};

describe('JiraConfigService', () => {
  let service: JiraConfigService;

  let createdIntegrationData:
    | CreatedIntegrationData
    | undefined;

  let existingIntegrationCount: number;
  let existingIntegrationId: string | null;
  let workspaceExists: boolean;

  beforeEach(() => {
    createdIntegrationData = undefined;
    existingIntegrationCount = 0;
    existingIntegrationId = null;
    workspaceExists = true;

    const transactionClient = {
      jiraIntegration: {
        count: async () =>
          existingIntegrationCount,

        updateMany: async () => ({
          count: 0,
        }),

        create: async ({
          data,
        }: {
          data: CreatedIntegrationData;
        }) => {
          createdIntegrationData = data;

          return {
            id: 'jira-integration-1',
            ...data,
            health: 'NOT_CONFIGURED',
            lastHealthCheckAt: null,
            lastSuccessfulSyncAt: null,
            createdAt: new Date(
              '2026-08-15T00:00:00.000Z',
            ),
            updatedAt: new Date(
              '2026-08-15T00:00:00.000Z',
            ),
          };
        },
      },
    };

    const prismaMock = {
      workspace: {
        findUnique: async () =>
          workspaceExists
            ? {
                id: 'workspace-1',
              }
            : null,
      },

      jiraIntegration: {
        findUnique: async () =>
          existingIntegrationId
            ? {
                id: existingIntegrationId,
              }
            : null,

        findMany: async () => [],
      },

      $transaction: async <T>(
        callback: (
          transaction: typeof transactionClient,
        ) => Promise<T>,
      ): Promise<T> =>
        callback(transactionClient),
    };

    service = new JiraConfigService(
      prismaMock as unknown as PrismaService,
    );
  });

  test('creates the first Jira site as the default integration', async () => {
    const result =
      await service.createWorkspaceIntegration({
        workspaceId: ' workspace-1 ',
        cloudId: ' cloud-123 ',
        siteUrl:
          'https://pulse-test.atlassian.net/',
        siteName: ' Pulse Test ',
        allowedProjectKeys: [
          'pulse',
          ' DEV ',
          'pulse',
        ],
        defaultProjectKey: 'pulse',
      });

    assert.equal(
      result.id,
      'jira-integration-1',
    );

    assert.deepEqual(createdIntegrationData, {
      workspaceId: 'workspace-1',
      cloudId: 'cloud-123',
      siteUrl:
        'https://pulse-test.atlassian.net',
      siteName: 'Pulse Test',
      enabled: true,
      isDefault: true,
      defaultProjectKey: 'PULSE',
      allowedProjectKeys: ['PULSE', 'DEV'],
      cacheTtlMinutes: 15,
    });
  });

  test('does not force a later Jira site to become default', async () => {
    existingIntegrationCount = 1;

    await service.createWorkspaceIntegration({
      workspaceId: 'workspace-1',
      cloudId: 'cloud-456',
      siteUrl:
        'https://second-site.atlassian.net',
    });

    assert.equal(
      createdIntegrationData?.isDefault,
      false,
    );
  });

  test('rejects a non-HTTPS Jira site URL', async () => {
    await assert.rejects(
      () =>
        service.createWorkspaceIntegration({
          workspaceId: 'workspace-1',
          cloudId: 'cloud-123',
          siteUrl:
            'http://pulse-test.atlassian.net',
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message ===
          'siteUrl must use HTTPS.',
    );
  });

  test('rejects a default project outside the allowed projects', async () => {
    await assert.rejects(
      () =>
        service.createWorkspaceIntegration({
          workspaceId: 'workspace-1',
          cloudId: 'cloud-123',
          siteUrl:
            'https://pulse-test.atlassian.net',
          defaultProjectKey: 'OPS',
          allowedProjectKeys: ['PULSE'],
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message.includes(
          'defaultProjectKey',
        ),
    );
  });

  test('rejects a Jira site already connected to the workspace', async () => {
    existingIntegrationId =
      'existing-integration';

    await assert.rejects(
      () =>
        service.createWorkspaceIntegration({
          workspaceId: 'workspace-1',
          cloudId: 'cloud-123',
          siteUrl:
            'https://pulse-test.atlassian.net',
        }),
      (error: unknown) =>
        error instanceof ConflictException,
    );
  });
});