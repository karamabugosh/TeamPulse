import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
  BadGatewayException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  JiraOAuthClientService,
  JiraOAuthTokens,
} from './jira-oauth-client.service';

type CapturedRequest = {
  url: string;
  init: RequestInit;
};

const CLIENT_ID = 'test-client-id';
const CLIENT_SECRET = 'test-client-secret';
const CALLBACK_URL =
  'http://localhost:3000/api/jira/oauth/callback';

class TestableJiraOAuthClientService extends
  JiraOAuthClientService {
  readonly requests: CapturedRequest[] = [];
  private readonly responses: unknown[] = [];

  queueResponse(response: unknown): void {
    this.responses.push(response);
  }

  protected async requestJson<T>(
    url: string,
    init: RequestInit,
  ): Promise<T> {
    this.requests.push({
      url,
      init,
    });

    if (this.responses.length === 0) {
      throw new Error(
        'No mocked Atlassian response was queued.',
      );
    }

    return this.responses.shift() as T;
  }
}

const createService = (
  overrides: Record<string, string> = {},
): TestableJiraOAuthClientService => {
  const configService = new ConfigService({
    JIRA_OAUTH_CLIENT_ID: CLIENT_ID,
    JIRA_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
    JIRA_OAUTH_CALLBACK_URL: CALLBACK_URL,
    ...overrides,
  });

  return new TestableJiraOAuthClientService(
    configService,
  );
};

const queueValidTokenResponse = (
  service: TestableJiraOAuthClientService,
): void => {
  service.queueResponse({
    access_token: 'access-token-value',
    refresh_token: 'refresh-token-value',
    expires_in: 3600,
    scope:
      'read:jira-work read:jira-user write:jira-work offline_access',
    token_type: 'Bearer',
  });
};

const assertValidTokens = (
  tokens: JiraOAuthTokens,
): void => {
  assert.deepEqual(tokens, {
    accessToken: 'access-token-value',
    refreshToken: 'refresh-token-value',
    expiresInSeconds: 3600,
    scopes: [
      'read:jira-work',
      'read:jira-user',
      'write:jira-work',
      'offline_access',
    ],
    tokenType: 'Bearer',
  });
};

describe('JiraOAuthClientService', () => {
  test('builds a secure Atlassian authorization URL', () => {
    const service = createService();

    const authorizationUrl =
      service.buildAuthorizationUrl(
        'secure-state-value',
      );

    const parsedUrl = new URL(authorizationUrl);

    assert.equal(
      parsedUrl.origin,
      'https://auth.atlassian.com',
    );

    assert.equal(
      parsedUrl.pathname,
      '/authorize',
    );

    assert.equal(
      parsedUrl.searchParams.get('audience'),
      'api.atlassian.com',
    );

    assert.equal(
      parsedUrl.searchParams.get('client_id'),
      CLIENT_ID,
    );

    assert.equal(
      parsedUrl.searchParams.get('redirect_uri'),
      CALLBACK_URL,
    );

    assert.equal(
      parsedUrl.searchParams.get('state'),
      'secure-state-value',
    );

    assert.equal(
      parsedUrl.searchParams.get('response_type'),
      'code',
    );

    assert.equal(
      parsedUrl.searchParams.get('prompt'),
      'consent',
    );

    assert.deepEqual(
      parsedUrl.searchParams
        .get('scope')
        ?.split(' '),
      [
        'read:jira-work',
        'read:jira-user',
        'write:jira-work',
        'offline_access',
      ],
    );

    assert.equal(
      authorizationUrl.includes(CLIENT_SECRET),
      false,
    );
  });

  test('rejects building an authorization URL without state', () => {
    const service = createService();

    assert.throws(
      () => service.buildAuthorizationUrl('   '),
      (error: unknown) =>
        error instanceof BadRequestException,
    );
  });

  test('exchanges an authorization code for tokens', async () => {
    const service = createService();

    queueValidTokenResponse(service);

    const tokens =
      await service.exchangeAuthorizationCode(
        'authorization-code',
      );

    assertValidTokens(tokens);
    assert.equal(service.requests.length, 1);

    const request = service.requests[0];

    assert.equal(
      request.url,
      'https://auth.atlassian.com/oauth/token',
    );

    assert.equal(request.init.method, 'POST');

    const body = JSON.parse(
      String(request.init.body),
    );

    assert.deepEqual(body, {
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code: 'authorization-code',
      redirect_uri: CALLBACK_URL,
    });
  });

  test('refreshes an access token using the refresh token', async () => {
    const service = createService();

    queueValidTokenResponse(service);

    const tokens =
      await service.refreshAccessToken(
        'old-refresh-token',
      );

    assertValidTokens(tokens);

    const body = JSON.parse(
      String(service.requests[0].init.body),
    );

    assert.deepEqual(body, {
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: 'old-refresh-token',
    });
  });

  test('parses accessible Jira sites', async () => {
    const service = createService();

    service.queueResponse([
      {
        id: 'cloud-id-1',
        url: 'https://example.atlassian.net',
        name: 'Example Jira',
        scopes: [
          'read:jira-work',
          'write:jira-work',
        ],
        avatarUrl:
          'https://example.com/avatar.png',
      },
    ]);

    const resources =
      await service.getAccessibleResources(
        'access-token',
      );

    assert.deepEqual(resources, [
      {
        cloudId: 'cloud-id-1',
        siteUrl:
          'https://example.atlassian.net',
        siteName: 'Example Jira',
        scopes: [
          'read:jira-work',
          'write:jira-work',
        ],
        avatarUrl:
          'https://example.com/avatar.png',
      },
    ]);

    assert.equal(
      service.requests[0].init.headers &&
        (
          service.requests[0].init
            .headers as Record<string, string>
        ).Authorization,
      'Bearer access-token',
    );
  });

  test('parses the current Jira user', async () => {
    const service = createService();

    service.queueResponse({
      accountId: 'jira-account-1',
      displayName: 'Aroob Test',
      emailAddress: 'aroob@example.com',
      active: true,
    });

    const user = await service.getCurrentUser(
      'access-token',
      'cloud-id-1',
    );

    assert.deepEqual(user, {
      accountId: 'jira-account-1',
      displayName: 'Aroob Test',
      emailAddress: 'aroob@example.com',
      active: true,
    });

    assert.equal(
      service.requests[0].url,
      'https://api.atlassian.com/ex/jira/cloud-id-1/rest/api/3/myself',
    );
  });

  test('rejects a token response without a refresh token', async () => {
    const service = createService();

    service.queueResponse({
      access_token: 'access-token-value',
      expires_in: 3600,
      scope: 'read:jira-work',
      token_type: 'Bearer',
    });

    await assert.rejects(
      () =>
        service.exchangeAuthorizationCode(
          'authorization-code',
        ),
      (error: unknown) =>
        error instanceof BadGatewayException &&
        !error.message.includes(CLIENT_SECRET),
    );
  });

  test('rejects an invalid accessible resource', async () => {
    const service = createService();

    service.queueResponse([
      {
        id: '',
        url: 'https://example.atlassian.net',
        name: 'Example Jira',
      },
    ]);

    await assert.rejects(
      () =>
        service.getAccessibleResources(
          'access-token',
        ),
      (error: unknown) =>
        error instanceof BadGatewayException,
    );
  });

  test('rejects an invalid Jira user profile', async () => {
    const service = createService();

    service.queueResponse({
      accountId: '',
      displayName: '',
    });

    await assert.rejects(
      () =>
        service.getCurrentUser(
          'access-token',
          'cloud-id-1',
        ),
      (error: unknown) =>
        error instanceof BadGatewayException,
    );
  });

  test('rejects missing OAuth configuration', () => {
    const configService = new ConfigService({
      JIRA_OAUTH_CLIENT_ID: '',
      JIRA_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
      JIRA_OAUTH_CALLBACK_URL: CALLBACK_URL,
    });

    assert.throws(
      () =>
        new JiraOAuthClientService(
          configService,
        ),
      /JIRA_OAUTH_CLIENT_ID is required/,
    );
  });

  test('rejects an unsafe non-local HTTP callback URL', () => {
    assert.throws(
      () =>
        createService({
          JIRA_OAUTH_CALLBACK_URL:
            'http://example.com/jira/callback',
        }),
      /must use HTTPS/,
    );
  });
});