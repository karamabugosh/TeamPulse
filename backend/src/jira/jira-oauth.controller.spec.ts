import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { JiraOAuthController } from './jira-oauth.controller';
import { JiraOAuthService } from './jira-oauth.service';

type ControllerHarnessOptions = {
  nodeEnvironment?: string;
};

const createRequest = (
  remoteAddress: string,
): Request =>
  ({
    ip: remoteAddress,
    socket: {
      remoteAddress,
    },
  }) as unknown as Request;

const createHarness = (
  options: ControllerHarnessOptions = {},
) => {
  const calls = {
    startedUserIds: [] as string[],
    completedConnections: [] as Array<{
      code: string;
      state: string;
    }>,
  };

  const oauthService = {
    startConnection: async (
      userId: string,
    ) => {
      calls.startedUserIds.push(userId);

      return {
        authorizationUrl:
          'https://auth.atlassian.com/authorize?state=secure-state',
        expiresAt: new Date(
          '2026-08-16T10:10:00.000Z',
        ),
      };
    },

    completeConnection: async (input: {
      code: string;
      state: string;
    }) => {
      calls.completedConnections.push(input);

      return {
        connectionId: 'connection-1',
        integrationId: 'integration-1',
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
        status: 'CONNECTED',
        grantedScopes: [
          'read:jira-work',
          'read:jira-user',
          'write:jira-work',
          'offline_access',
        ],
        accessTokenExpiresAt: new Date(
          '2026-08-16T11:00:00.000Z',
        ),
      };
    },
  };

  const configService = {
    get: (key: string) =>
      key === 'NODE_ENV'
        ? options.nodeEnvironment
        : undefined,
  };

  const controller =
    new JiraOAuthController(
      oauthService as unknown as JiraOAuthService,
      configService as unknown as ConfigService,
    );

  return {
    controller,
    calls,
  };
};

describe('JiraOAuthController', () => {
  test('starts Jira OAuth from IPv4 localhost during development', async () => {
    const { controller, calls } =
      createHarness({
        nodeEnvironment: 'development',
      });

    const result =
      await controller
        .startDevelopmentConnection(
          createRequest('127.0.0.1'),
          {
            userId: 'pulse-user-1',
          },
        );

    assert.deepEqual(calls.startedUserIds, [
      'pulse-user-1',
    ]);

    assert.equal(
      result.authorizationUrl,
      'https://auth.atlassian.com/authorize?state=secure-state',
    );
  });

  test('starts Jira OAuth from IPv6 localhost', async () => {
    const { controller } = createHarness({
      nodeEnvironment: 'development',
    });

    const result =
      await controller
        .startDevelopmentConnection(
          createRequest('::1'),
          {
            userId: 'pulse-user-1',
          },
        );

    assert.ok(result.authorizationUrl);
  });

  test('rejects the development endpoint in production', async () => {
    const { controller, calls } =
      createHarness({
        nodeEnvironment: 'production',
      });

    await assert.rejects(
      () =>
        controller
          .startDevelopmentConnection(
            createRequest('127.0.0.1'),
            {
              userId: 'pulse-user-1',
            },
          ),
      (error: unknown) =>
        error instanceof ForbiddenException,
    );

    assert.equal(
      calls.startedUserIds.length,
      0,
    );
  });

  test('rejects the development endpoint from a remote address', async () => {
    const { controller, calls } =
      createHarness({
        nodeEnvironment: 'development',
      });

    await assert.rejects(
      () =>
        controller
          .startDevelopmentConnection(
            createRequest('192.168.1.50'),
            {
              userId: 'pulse-user-1',
            },
          ),
      (error: unknown) =>
        error instanceof ForbiddenException,
    );

    assert.equal(
      calls.startedUserIds.length,
      0,
    );
  });

  test('completes the Jira OAuth callback', async () => {
    const { controller, calls } =
      createHarness();

    const result =
      await controller.completeConnection({
        code: 'authorization-code',
        state: 'secure-state',
      });

    assert.deepEqual(
      calls.completedConnections,
      [
        {
          code: 'authorization-code',
          state: 'secure-state',
        },
      ],
    );

    assert.equal(
      result.message,
      'Jira was connected successfully.',
    );

    assert.equal(
      result.connection.connectionId,
      'connection-1',
    );

    const serializedResult =
      JSON.stringify(result);

    assert.equal(
      serializedResult.includes(
        'access-token',
      ),
      false,
    );

    assert.equal(
      serializedResult.includes(
        'refresh-token',
      ),
      false,
    );
  });

  test('rejects a cancelled or denied Atlassian callback', async () => {
    const { controller, calls } =
      createHarness();

    await assert.rejects(
      () =>
        controller.completeConnection({
          error: 'access_denied',
          error_description:
            'Sensitive provider message',
          state: 'secure-state',
        }),
      (error: unknown) =>
        error instanceof BadRequestException &&
        !error.message.includes(
          'Sensitive provider message',
        ),
    );

    assert.equal(
      calls.completedConnections.length,
      0,
    );
  });

  test('passes missing callback values as empty strings for service validation', async () => {
    const { controller, calls } =
      createHarness();

    await controller.completeConnection({});

    assert.deepEqual(
      calls.completedConnections,
      [
        {
          code: '',
          state: '',
        },
      ],
    );
  });
});