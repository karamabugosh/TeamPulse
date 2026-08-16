import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  JiraConnectionStatus,
  JiraIntegrationHealth,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JiraConfigService } from './jira-config.service';
import { JiraOAuthClientService } from './jira-oauth-client.service';
import { JiraOAuthStateService } from './jira-oauth-state.service';
import { JiraOAuthService } from './jira-oauth.service';
import { JiraTokenCryptoService } from './jira-token-crypto.service';

type HarnessOptions = {
  accessibleResourceCount?: number;
  jiraUserActive?: boolean;
  existingIntegrationId?: string | null;
  existingAccountUserId?: string | null;
};

const createHarness = (
  options: HarnessOptions = {},
) => {
  const accessibleResourceCount =
    options.accessibleResourceCount ?? 1;

  const existingIntegrationId =
    options.existingIntegrationId ?? null;

  const calls = {
    issuedUserIds: [] as string[],
    consumedStates: [] as string[],
    exchangedCodes: [] as string[],
    accessTokensForResources: [] as string[],
    currentUserRequests: [] as Array<{
      accessToken: string;
      cloudId: string;
    }>,
    createdIntegrations: [] as unknown[],
    encryptedValues: [] as string[],
    upserts: [] as unknown[],
    integrationUpdates: [] as unknown[],
  };

  const stateService = {
    issueState: async (userId: string) => {
      calls.issuedUserIds.push(userId);

      return {
        state: 'secure-state',
        expiresAt: new Date(
          '2026-08-16T10:10:00.000Z',
        ),
      };
    },

    consumeState: async (state: string) => {
      calls.consumedStates.push(state);

      return {
        userId: 'pulse-user-1',
        workspaceId: 'workspace-1',
      };
    },
  };

  const resources = Array.from(
    {
      length: accessibleResourceCount,
    },
    (_, index) => ({
      cloudId: `cloud-${index + 1}`,
      siteUrl:
        index === 0
          ? 'https://aroobamr187.atlassian.net'
          : `https://example-${index + 1}.atlassian.net`,
      siteName:
        index === 0
          ? 'TeamPulse Lab'
          : `Example ${index + 1}`,
      scopes: [
        'read:jira-work',
        'read:jira-user',
        'write:jira-work',
      ],
      avatarUrl: null,
    }),
  );

  const oauthClientService = {
    buildAuthorizationUrl: (state: string) =>
      `https://auth.atlassian.com/authorize?state=${state}`,

    exchangeAuthorizationCode: async (
      code: string,
    ) => {
      calls.exchangedCodes.push(code);

      return {
        accessToken: 'raw-access-token',
        refreshToken: 'raw-refresh-token',
        expiresInSeconds: 3600,
        scopes: [
          'read:jira-work',
          'read:jira-user',
          'write:jira-work',
          'offline_access',
        ],
        tokenType: 'Bearer',
      };
    },

    getAccessibleResources: async (
      accessToken: string,
    ) => {
      calls.accessTokensForResources.push(
        accessToken,
      );

      return resources;
    },

    getCurrentUser: async (
      accessToken: string,
      cloudId: string,
    ) => {
      calls.currentUserRequests.push({
        accessToken,
        cloudId,
      });

      return {
        accountId: 'jira-account-1',
        displayName: 'Aroob Amr Abughoush',
        emailAddress: 'aroob@example.com',
        active:
          options.jiraUserActive ?? true,
      };
    },
  };

  const tokenCryptoService = {
    encrypt: (value: string) => {
      calls.encryptedValues.push(value);

      return `encrypted:${value}`;
    },
  };

  const jiraConfigService = {
    createWorkspaceIntegration: async (
      input: unknown,
    ) => {
      calls.createdIntegrations.push(input);

      return {
        id: 'created-integration-1',
      };
    },
  };

  const transaction = {
    jiraUserConnection: {
      upsert: async (input: {
        create: {
          userId: string;
          jiraIntegrationId: string;
          jiraAccountId: string;
          jiraDisplayName: string;
          jiraEmail: string | null;
          accessTokenCiphertext: string;
          refreshTokenCiphertext: string;
          grantedScopes: string[];
          accessTokenExpiresAt: Date;
          status: JiraConnectionStatus;
          lastValidatedAt: Date;
          lastUsedAt: Date;
        };
      }) => {
        calls.upserts.push(input);

        return {
          id: 'connection-1',
          userId: input.create.userId,
          jiraAccountId:
            input.create.jiraAccountId,
          jiraDisplayName:
            input.create.jiraDisplayName,
          jiraEmail: input.create.jiraEmail,
          status:
            JiraConnectionStatus.CONNECTED,
          grantedScopes:
            input.create.grantedScopes,
          accessTokenExpiresAt:
            input.create.accessTokenExpiresAt,
        };
      },
    },

    jiraIntegration: {
      update: async (input: unknown) => {
        calls.integrationUpdates.push(input);

        return {
          id:
            existingIntegrationId ??
            'created-integration-1',
        };
      },
    },
  };

  const prisma = {
    jiraIntegration: {
      findUnique: async () =>
        existingIntegrationId
          ? {
              id: existingIntegrationId,
            }
          : null,
    },

    jiraUserConnection: {
      findUnique: async () =>
        options.existingAccountUserId
          ? {
              id: 'existing-connection-1',
              userId:
                options.existingAccountUserId,
            }
          : null,
    },

    $transaction: async <T>(
      callback: (
        transactionClient:
          typeof transaction,
      ) => Promise<T>,
    ): Promise<T> =>
      callback(transaction),
  };

  const service = new JiraOAuthService(
    prisma as unknown as PrismaService,
    jiraConfigService as unknown as JiraConfigService,
    stateService as unknown as JiraOAuthStateService,
    oauthClientService as unknown as JiraOAuthClientService,
    tokenCryptoService as unknown as JiraTokenCryptoService,
  );

  return {
    service,
    calls,
  };
};

describe('JiraOAuthService', () => {
  test('starts Jira authorization using a one-time state', async () => {
    const { service, calls } = createHarness();

    const result =
      await service.startConnection(
        ' pulse-user-1 ',
      );

    assert.deepEqual(calls.issuedUserIds, [
      'pulse-user-1',
    ]);

    assert.deepEqual(result, {
      authorizationUrl:
        'https://auth.atlassian.com/authorize?state=secure-state',
      expiresAt: new Date(
        '2026-08-16T10:10:00.000Z',
      ),
    });
  });

  test('rejects starting authorization without a user ID', async () => {
    const { service } = createHarness();

    await assert.rejects(
      () => service.startConnection('   '),
      (error: unknown) =>
        error instanceof BadRequestException,
    );
  });

  test('completes OAuth and stores only encrypted tokens', async () => {
    const { service, calls } = createHarness();

    const beforeCompletion = Date.now();

    const result =
      await service.completeConnection({
        code: ' authorization-code ',
        state: ' secure-state ',
      });

    const afterCompletion = Date.now();

    assert.deepEqual(calls.consumedStates, [
      'secure-state',
    ]);

    assert.deepEqual(calls.exchangedCodes, [
      'authorization-code',
    ]);

    assert.deepEqual(
      calls.accessTokensForResources,
      ['raw-access-token'],
    );

    assert.deepEqual(
      calls.currentUserRequests,
      [
        {
          accessToken: 'raw-access-token',
          cloudId: 'cloud-1',
        },
      ],
    );

    assert.deepEqual(calls.encryptedValues, [
      'raw-access-token',
      'raw-refresh-token',
    ]);

    assert.equal(
      calls.createdIntegrations.length,
      1,
    );

    assert.equal(calls.upserts.length, 1);
    assert.equal(
      calls.integrationUpdates.length,
      1,
    );

    const upsert = calls.upserts[0] as {
      create: {
        accessTokenCiphertext: string;
        refreshTokenCiphertext: string;
        accessTokenExpiresAt: Date;
        status: JiraConnectionStatus;
      };
    };

    assert.equal(
      upsert.create.accessTokenCiphertext,
      'encrypted:raw-access-token',
    );

    assert.equal(
      upsert.create.refreshTokenCiphertext,
      'encrypted:raw-refresh-token',
    );

    assert.equal(
      upsert.create.status,
      JiraConnectionStatus.CONNECTED,
    );

    const expiry =
      upsert.create.accessTokenExpiresAt.getTime();

    assert.ok(
      expiry >= beforeCompletion + 3600 * 1000,
    );

    assert.ok(
      expiry <= afterCompletion + 3600 * 1000,
    );

    assert.deepEqual(result, {
      connectionId: 'connection-1',
      integrationId:
        'created-integration-1',
      workspaceId: 'workspace-1',
      userId: 'pulse-user-1',
      cloudId: 'cloud-1',
      siteUrl:
        'https://aroobamr187.atlassian.net',
      siteName: 'TeamPulse Lab',
      jiraAccountId: 'jira-account-1',
      jiraDisplayName:
        'Aroob Amr Abughoush',
      jiraEmail: 'aroob@example.com',
      status: JiraConnectionStatus.CONNECTED,
      grantedScopes: [
        'read:jira-work',
        'read:jira-user',
        'write:jira-work',
        'offline_access',
      ],
      accessTokenExpiresAt:
        upsert.create.accessTokenExpiresAt,
    });

    const serializedResult =
      JSON.stringify(result);

    assert.equal(
      serializedResult.includes(
        'raw-access-token',
      ),
      false,
    );

    assert.equal(
      serializedResult.includes(
        'raw-refresh-token',
      ),
      false,
    );
  });

  test('reuses an existing workspace integration', async () => {
    const { service, calls } = createHarness({
      existingIntegrationId:
        'existing-integration-1',
    });

    const result =
      await service.completeConnection({
        code: 'authorization-code',
        state: 'secure-state',
      });

    assert.equal(
      calls.createdIntegrations.length,
      0,
    );

    assert.equal(
      result.integrationId,
      'existing-integration-1',
    );
  });

  test('rejects a callback without code or state', async () => {
    const { service } = createHarness();

    await assert.rejects(
      () =>
        service.completeConnection({
          code: '',
          state: 'secure-state',
        }),
      (error: unknown) =>
        error instanceof BadRequestException,
    );

    await assert.rejects(
      () =>
        service.completeConnection({
          code: 'authorization-code',
          state: '',
        }),
      (error: unknown) =>
        error instanceof BadRequestException,
    );
  });

  test('rejects authorization with no accessible Jira site', async () => {
    const { service } = createHarness({
      accessibleResourceCount: 0,
    });

    await assert.rejects(
      () =>
        service.completeConnection({
          code: 'authorization-code',
          state: 'secure-state',
        }),
      (error: unknown) =>
        error instanceof BadGatewayException,
    );
  });

  test('rejects authorization containing multiple Jira sites', async () => {
    const { service } = createHarness({
      accessibleResourceCount: 2,
    });

    await assert.rejects(
      () =>
        service.completeConnection({
          code: 'authorization-code',
          state: 'secure-state',
        }),
      (error: unknown) =>
        error instanceof ConflictException,
    );
  });

  test('rejects an inactive Jira user', async () => {
    const { service } = createHarness({
      jiraUserActive: false,
    });

    await assert.rejects(
      () =>
        service.completeConnection({
          code: 'authorization-code',
          state: 'secure-state',
        }),
      (error: unknown) =>
        error instanceof ConflictException,
    );
  });

  test('rejects a Jira account connected to another Pulse user', async () => {
    const { service, calls } = createHarness({
      existingAccountUserId:
        'different-pulse-user',
    });

    await assert.rejects(
      () =>
        service.completeConnection({
          code: 'authorization-code',
          state: 'secure-state',
        }),
      (error: unknown) =>
        error instanceof ConflictException,
    );

    assert.equal(calls.encryptedValues.length, 0);
    assert.equal(calls.upserts.length, 0);
  });

  test('marks the Jira integration as healthy', async () => {
    const { service, calls } = createHarness();

    await service.completeConnection({
      code: 'authorization-code',
      state: 'secure-state',
    });

    const update =
      calls.integrationUpdates[0] as {
        data: {
          health: JiraIntegrationHealth;
          lastHealthCheckAt: Date;
          lastSuccessfulSyncAt: Date;
        };
      };

    assert.equal(
      update.data.health,
      JiraIntegrationHealth.HEALTHY,
    );

    assert.ok(
      update.data.lastHealthCheckAt instanceof Date,
    );

    assert.ok(
      update.data.lastSuccessfulSyncAt instanceof Date,
    );
  });
});