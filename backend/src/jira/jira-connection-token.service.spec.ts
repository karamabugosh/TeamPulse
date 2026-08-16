import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { JiraConnectionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JiraConnectionTokenService } from './jira-connection-token.service';
import { JiraOAuthClientService } from './jira-oauth-client.service';
import { JiraTokenCryptoService } from './jira-token-crypto.service';

type HarnessOptions = {
  connectionExists?: boolean;
  status?: JiraConnectionStatus;
  integrationEnabled?: boolean;
  expiresInMilliseconds?: number;
  updateManyCount?: number;
};

const createHarness = (
  options: HarnessOptions = {},
) => {
  const calls = {
    findUniqueCount: 0,
    decryptedValues: [] as string[],
    encryptedValues: [] as string[],
    refreshTokens: [] as string[],
    lastUsedUpdates: [] as unknown[],
    tokenUpdates: [] as unknown[],
  };

  const baseConnection = {
    id: 'connection-1',
    userId: 'pulse-user-1',
    jiraIntegrationId: 'integration-1',
    status:
      options.status ??
      JiraConnectionStatus.CONNECTED,
    accessTokenCiphertext:
      'encrypted:old-access-token',
    refreshTokenCiphertext:
      'encrypted:old-refresh-token',
    accessTokenExpiresAt: new Date(
      Date.now() +
        (options.expiresInMilliseconds ??
          10 * 60 * 1000),
    ),
    jiraIntegration: {
      id: 'integration-1',
      cloudId: 'cloud-1',
      siteUrl:
        'https://aroobamr187.atlassian.net',
      siteName: 'aroobamr187',
      enabled:
        options.integrationEnabled ?? true,
    },
  };

  const refreshedConnection = {
    ...baseConnection,
    accessTokenCiphertext:
      'encrypted:new-access-token',
    refreshTokenCiphertext:
      'encrypted:new-refresh-token',
    accessTokenExpiresAt: new Date(
      Date.now() + 60 * 60 * 1000,
    ),
  };

  let refreshResolver:
    | (() => void)
    | null = null;

  let holdRefresh = false;

  const refreshGate = new Promise<void>(
    (resolve) => {
      refreshResolver = resolve;
    },
  );

  const prisma = {
    jiraUserConnection: {
      findUnique: async () => {
        calls.findUniqueCount += 1;

        if (
          options.connectionExists === false
        ) {
          return null;
        }

        if (
          calls.findUniqueCount > 1 &&
          options.updateManyCount === 0
        ) {
          return refreshedConnection;
        }

        return baseConnection;
      },

      update: async (input: unknown) => {
        calls.lastUsedUpdates.push(input);

        return {
          id: baseConnection.id,
        };
      },

      updateMany: async (input: unknown) => {
        calls.tokenUpdates.push(input);

        return {
          count:
            options.updateManyCount ?? 1,
        };
      },
    },
  };

  const oauthClientService = {
    refreshAccessToken: async (
      refreshToken: string,
    ) => {
      calls.refreshTokens.push(refreshToken);

      if (holdRefresh) {
        await refreshGate;
      }

      return {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
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
  };

  const cryptoService = {
    decrypt: (encryptedValue: string) => {
      calls.decryptedValues.push(
        encryptedValue,
      );

      return encryptedValue.replace(
        'encrypted:',
        '',
      );
    },

    encrypt: (value: string) => {
      calls.encryptedValues.push(value);

      return `encrypted:${value}`;
    },
  };

  const service =
    new JiraConnectionTokenService(
      prisma as unknown as PrismaService,
      oauthClientService as unknown as JiraOAuthClientService,
      cryptoService as unknown as JiraTokenCryptoService,
    );

  return {
    service,
    calls,
    baseConnection,
    enableRefreshHold: () => {
      holdRefresh = true;
    },
    releaseRefresh: () => {
      refreshResolver?.();
    },
  };
};

describe('JiraConnectionTokenService', () => {
  test('returns a valid decrypted access token without refreshing', async () => {
    const { service, calls } =
      createHarness({
        expiresInMilliseconds:
          10 * 60 * 1000,
      });

    const result =
      await service.getAccessContext(
        ' pulse-user-1 ',
        ' integration-1 ',
      );

    assert.equal(
      result.accessToken,
      'old-access-token',
    );

    assert.equal(result.cloudId, 'cloud-1');

    assert.deepEqual(
      calls.decryptedValues,
      ['encrypted:old-access-token'],
    );

    assert.equal(
      calls.refreshTokens.length,
      0,
    );

    assert.equal(
      calls.lastUsedUpdates.length,
      1,
    );
  });

  test('refreshes a token that is near expiry', async () => {
    const { service, calls } =
      createHarness({
        expiresInMilliseconds: 30 * 1000,
      });

    const beforeRefresh = Date.now();

    const result =
      await service.getAccessContext(
        'pulse-user-1',
        'integration-1',
      );

    const afterRefresh = Date.now();

    assert.deepEqual(calls.refreshTokens, [
      'old-refresh-token',
    ]);

    assert.deepEqual(calls.encryptedValues, [
      'new-access-token',
      'new-refresh-token',
    ]);

    assert.equal(
      calls.tokenUpdates.length,
      1,
    );

    assert.equal(
      result.accessToken,
      'new-access-token',
    );

    assert.ok(
      result.accessTokenExpiresAt.getTime() >=
        beforeRefresh + 3600 * 1000,
    );

    assert.ok(
      result.accessTokenExpiresAt.getTime() <=
        afterRefresh + 3600 * 1000,
    );
  });

  test('uses a single refresh for concurrent requests in one process', async () => {
    const {
      service,
      calls,
      enableRefreshHold,
      releaseRefresh,
    } = createHarness({
      expiresInMilliseconds: 30 * 1000,
    });

    enableRefreshHold();

    const firstRequest =
      service.getAccessContext(
        'pulse-user-1',
        'integration-1',
      );

    const secondRequest =
      service.getAccessContext(
        'pulse-user-1',
        'integration-1',
      );

    await new Promise((resolve) =>
      setImmediate(resolve),
    );

    assert.equal(
      calls.refreshTokens.length,
      1,
    );

    releaseRefresh();

    const [firstResult, secondResult] =
      await Promise.all([
        firstRequest,
        secondRequest,
      ]);

    assert.equal(
      firstResult.accessToken,
      'new-access-token',
    );

    assert.equal(
      secondResult.accessToken,
      'new-access-token',
    );

    assert.equal(
      calls.tokenUpdates.length,
      1,
    );
  });

  test('uses the latest stored token when another refresh won the update race', async () => {
    const { service, calls } =
      createHarness({
        expiresInMilliseconds: 30 * 1000,
        updateManyCount: 0,
      });

    const result =
      await service.getAccessContext(
        'pulse-user-1',
        'integration-1',
      );

    assert.equal(
      result.accessToken,
      'new-access-token',
    );

    assert.ok(
      calls.decryptedValues.includes(
        'encrypted:new-access-token',
      ),
    );

    assert.equal(
      calls.findUniqueCount,
      2,
    );
  });

  test('rejects a missing Jira connection', async () => {
    const { service } = createHarness({
      connectionExists: false,
    });

    await assert.rejects(
      () =>
        service.getAccessContext(
          'pulse-user-1',
          'integration-1',
        ),
      (error: unknown) =>
        error instanceof NotFoundException,
    );
  });

  test('rejects a disconnected Jira connection', async () => {
    const { service } = createHarness({
      status:
        JiraConnectionStatus.REVOKED,
    });

    await assert.rejects(
      () =>
        service.getAccessContext(
          'pulse-user-1',
          'integration-1',
        ),
      (error: unknown) =>
        error instanceof ConflictException,
    );
  });

  test('rejects a disabled Jira integration', async () => {
    const { service } = createHarness({
      integrationEnabled: false,
    });

    await assert.rejects(
      () =>
        service.getAccessContext(
          'pulse-user-1',
          'integration-1',
        ),
      (error: unknown) =>
        error instanceof ConflictException,
    );
  });

  test('rejects missing user or integration IDs', async () => {
    const { service } = createHarness();

    await assert.rejects(
      () =>
        service.getAccessContext(
          '',
          'integration-1',
        ),
      (error: unknown) =>
        error instanceof ConflictException,
    );

    await assert.rejects(
      () =>
        service.getAccessContext(
          'pulse-user-1',
          '',
        ),
      (error: unknown) =>
        error instanceof ConflictException,
    );
  });
});