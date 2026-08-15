import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ATLASSIAN_AUTHORIZE_URL =
  'https://auth.atlassian.com/authorize';

const ATLASSIAN_TOKEN_URL =
  'https://auth.atlassian.com/oauth/token';

const ATLASSIAN_ACCESSIBLE_RESOURCES_URL =
  'https://api.atlassian.com/oauth/token/accessible-resources';

const JIRA_API_BASE_URL =
  'https://api.atlassian.com/ex/jira';

const REQUIRED_SCOPES = [
  'read:jira-work',
  'read:jira-user',
  'write:jira-work',
  'offline_access',
] as const;

type RawAtlassianTokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  token_type?: unknown;
};

type RawAtlassianResource = {
  id?: unknown;
  url?: unknown;
  name?: unknown;
  scopes?: unknown;
  avatarUrl?: unknown;
};

type RawAtlassianUser = {
  accountId?: unknown;
  displayName?: unknown;
  emailAddress?: unknown;
  active?: unknown;
};

export type JiraOAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scopes: string[];
  tokenType: string;
};

export type JiraAccessibleResource = {
  cloudId: string;
  siteUrl: string;
  siteName: string;
  scopes: string[];
  avatarUrl: string | null;
};

export type JiraOAuthUser = {
  accountId: string;
  displayName: string;
  emailAddress: string | null;
  active: boolean | null;
};

@Injectable()
export class JiraOAuthClientService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly callbackUrl: string;

  constructor(
    private readonly configService: ConfigService,
  ) {
    this.clientId = this.requireConfiguration(
      'JIRA_OAUTH_CLIENT_ID',
    );

    this.clientSecret = this.requireConfiguration(
      'JIRA_OAUTH_CLIENT_SECRET',
    );

    this.callbackUrl = this.requireConfiguration(
      'JIRA_OAUTH_CALLBACK_URL',
    );

    this.validateCallbackUrl(this.callbackUrl);
  }

  buildAuthorizationUrl(stateInput: string): string {
    const state = stateInput?.trim();

    if (!state) {
      throw new BadRequestException(
        'A Jira OAuth state is required.',
      );
    }

    const url = new URL(ATLASSIAN_AUTHORIZE_URL);

    url.searchParams.set(
      'audience',
      'api.atlassian.com',
    );

    url.searchParams.set(
      'client_id',
      this.clientId,
    );

    url.searchParams.set(
      'scope',
      REQUIRED_SCOPES.join(' '),
    );

    url.searchParams.set(
      'redirect_uri',
      this.callbackUrl,
    );

    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('prompt', 'consent');

    return url.toString();
  }

  async exchangeAuthorizationCode(
    codeInput: string,
  ): Promise<JiraOAuthTokens> {
    const code = codeInput?.trim();

    if (!code) {
      throw new BadRequestException(
        'The Jira authorization code is required.',
      );
    }

    const response =
      await this.requestJson<RawAtlassianTokenResponse>(
        ATLASSIAN_TOKEN_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            grant_type: 'authorization_code',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            code,
            redirect_uri: this.callbackUrl,
          }),
        },
      );

    return this.parseTokenResponse(response);
  }

  async refreshAccessToken(
    refreshTokenInput: string,
  ): Promise<JiraOAuthTokens> {
    const refreshToken = refreshTokenInput?.trim();

    if (!refreshToken) {
      throw new BadRequestException(
        'The Jira refresh token is required.',
      );
    }

    const response =
      await this.requestJson<RawAtlassianTokenResponse>(
        ATLASSIAN_TOKEN_URL,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            grant_type: 'refresh_token',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: refreshToken,
          }),
        },
      );

    return this.parseTokenResponse(response);
  }

  async getAccessibleResources(
    accessTokenInput: string,
  ): Promise<JiraAccessibleResource[]> {
    const accessToken = this.requireAccessToken(
      accessTokenInput,
    );

    const response =
      await this.requestJson<unknown>(
        ATLASSIAN_ACCESSIBLE_RESOURCES_URL,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
      );

    if (!Array.isArray(response)) {
      throw new BadGatewayException(
        'Atlassian returned an invalid accessible resources response.',
      );
    }

    return response.map((resource) =>
      this.parseAccessibleResource(
        resource as RawAtlassianResource,
      ),
    );
  }

  async getCurrentUser(
    accessTokenInput: string,
    cloudIdInput: string,
  ): Promise<JiraOAuthUser> {
    const accessToken = this.requireAccessToken(
      accessTokenInput,
    );

    const cloudId = cloudIdInput?.trim();

    if (!cloudId) {
      throw new BadRequestException(
        'A Jira cloud ID is required.',
      );
    }

    const encodedCloudId =
      encodeURIComponent(cloudId);

    const response =
      await this.requestJson<RawAtlassianUser>(
        `${JIRA_API_BASE_URL}/${encodedCloudId}/rest/api/3/myself`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
      );

    return this.parseCurrentUser(response);
  }

  protected async requestJson<T>(
    url: string,
    init: RequestInit,
  ): Promise<T> {
    let response: Response;

    try {
      response = await fetch(url, init);
    } catch {
      throw new BadGatewayException(
        'Unable to reach Atlassian.',
      );
    }

    if (!response.ok) {
      throw new BadGatewayException(
        `Atlassian request failed with status ${response.status}.`,
      );
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new BadGatewayException(
        'Atlassian returned an invalid JSON response.',
      );
    }
  }

  private parseTokenResponse(
    response: RawAtlassianTokenResponse,
  ): JiraOAuthTokens {
    if (
      typeof response.access_token !== 'string' ||
      response.access_token.length === 0
    ) {
      throw new BadGatewayException(
        'Atlassian did not return an access token.',
      );
    }

    if (
      typeof response.refresh_token !== 'string' ||
      response.refresh_token.length === 0
    ) {
      throw new BadGatewayException(
        'Atlassian did not return a refresh token.',
      );
    }

    if (
      typeof response.expires_in !== 'number' ||
      !Number.isFinite(response.expires_in) ||
      response.expires_in <= 0
    ) {
      throw new BadGatewayException(
        'Atlassian returned an invalid token expiry.',
      );
    }

    const scopes =
      typeof response.scope === 'string'
        ? response.scope
            .split(' ')
            .map((scope) => scope.trim())
            .filter(Boolean)
        : [];

    const tokenType =
      typeof response.token_type === 'string' &&
      response.token_type.trim().length > 0
        ? response.token_type.trim()
        : 'Bearer';

    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresInSeconds: response.expires_in,
      scopes,
      tokenType,
    };
  }

  private parseAccessibleResource(
    resource: RawAtlassianResource,
  ): JiraAccessibleResource {
    if (
      typeof resource.id !== 'string' ||
      resource.id.trim().length === 0 ||
      typeof resource.url !== 'string' ||
      resource.url.trim().length === 0 ||
      typeof resource.name !== 'string' ||
      resource.name.trim().length === 0
    ) {
      throw new BadGatewayException(
        'Atlassian returned an invalid Jira site.',
      );
    }

    const scopes = Array.isArray(resource.scopes)
      ? resource.scopes.filter(
          (scope): scope is string =>
            typeof scope === 'string',
        )
      : [];

    return {
      cloudId: resource.id.trim(),
      siteUrl: resource.url.trim(),
      siteName: resource.name.trim(),
      scopes,
      avatarUrl:
        typeof resource.avatarUrl === 'string'
          ? resource.avatarUrl
          : null,
    };
  }

  private parseCurrentUser(
    user: RawAtlassianUser,
  ): JiraOAuthUser {
    if (
      typeof user.accountId !== 'string' ||
      user.accountId.trim().length === 0 ||
      typeof user.displayName !== 'string' ||
      user.displayName.trim().length === 0
    ) {
      throw new BadGatewayException(
        'Atlassian returned an invalid user profile.',
      );
    }

    return {
      accountId: user.accountId.trim(),
      displayName: user.displayName.trim(),
      emailAddress:
        typeof user.emailAddress === 'string' &&
        user.emailAddress.trim().length > 0
          ? user.emailAddress.trim()
          : null,
      active:
        typeof user.active === 'boolean'
          ? user.active
          : null,
    };
  }

  private requireAccessToken(
    accessTokenInput: string,
  ): string {
    const accessToken = accessTokenInput?.trim();

    if (!accessToken) {
      throw new BadRequestException(
        'A Jira access token is required.',
      );
    }

    return accessToken;
  }

  private requireConfiguration(
    key: string,
  ): string {
    const value = this.configService
      .get<string>(key)
      ?.trim();

    if (!value) {
      throw new Error(`${key} is required.`);
    }

    return value;
  }

  private validateCallbackUrl(
    callbackUrl: string,
  ): void {
    let parsedUrl: URL;

    try {
      parsedUrl = new URL(callbackUrl);
    } catch {
      throw new Error(
        'JIRA_OAUTH_CALLBACK_URL must be a valid URL.',
      );
    }

    const isLocalDevelopment =
      parsedUrl.protocol === 'http:' &&
      parsedUrl.hostname === 'localhost';

    if (
      parsedUrl.protocol !== 'https:' &&
      !isLocalDevelopment
    ) {
      throw new Error(
        'JIRA_OAUTH_CALLBACK_URL must use HTTPS, except for localhost development.',
      );
    }
  }
}