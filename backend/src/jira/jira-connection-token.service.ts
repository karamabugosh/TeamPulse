import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  JiraConnectionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JiraOAuthClientService } from './jira-oauth-client.service';
import { JiraTokenCryptoService } from './jira-token-crypto.service';

const REFRESH_EARLY_SECONDS = 120;

type StoredJiraConnection = {
  id: string;
  userId: string;
  jiraIntegrationId: string;
  status: JiraConnectionStatus;
  accessTokenCiphertext: string;
  refreshTokenCiphertext: string;
  accessTokenExpiresAt: Date;
  jiraIntegration: {
    id: string;
    cloudId: string;
    siteUrl: string;
    siteName: string | null;
    enabled: boolean;
  };
};

export type JiraAccessContext = {
  connectionId: string;
  userId: string;
  integrationId: string;
  cloudId: string;
  siteUrl: string;
  siteName: string | null;
  accessToken: string;
  accessTokenExpiresAt: Date;
};

@Injectable()
export class JiraConnectionTokenService {
  private readonly refreshPromises =
    new Map<
      string,
      Promise<JiraAccessContext>
    >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jiraOAuthClientService:
      JiraOAuthClientService,
    private readonly jiraTokenCryptoService:
      JiraTokenCryptoService,
  ) {}

  async getAccessContext(
    userIdInput: string,
    jiraIntegrationIdInput: string,
  ): Promise<JiraAccessContext> {
    const userId = userIdInput?.trim();

    const jiraIntegrationId =
      jiraIntegrationIdInput?.trim();

    if (!userId) {
      throw new ConflictException(
        'A Pulse user is required to access Jira.',
      );
    }

    if (!jiraIntegrationId) {
      throw new ConflictException(
        'A Jira integration is required.',
      );
    }

    const connection =
      await this.loadConnection(
        userId,
        jiraIntegrationId,
      );

    this.assertConnectionUsable(connection);

    if (
      !this.shouldRefresh(
        connection.accessTokenExpiresAt,
      )
    ) {
      const accessToken =
        this.jiraTokenCryptoService.decrypt(
          connection.accessTokenCiphertext,
        );

      await this.prisma.jiraUserConnection.update({
        where: {
          id: connection.id,
        },
        data: {
          lastUsedAt: new Date(),
        },
      });

      return this.toAccessContext(
        connection,
        accessToken,
        connection.accessTokenExpiresAt,
      );
    }

    return this.refreshOnce(connection);
  }

  private async loadConnection(
    userId: string,
    jiraIntegrationId: string,
  ): Promise<StoredJiraConnection> {
    const connection =
      await this.prisma.jiraUserConnection
        .findUnique({
          where: {
            userId_jiraIntegrationId: {
              userId,
              jiraIntegrationId,
            },
          },
          select: {
            id: true,
            userId: true,
            jiraIntegrationId: true,
            status: true,
            accessTokenCiphertext: true,
            refreshTokenCiphertext: true,
            accessTokenExpiresAt: true,
            jiraIntegration: {
              select: {
                id: true,
                cloudId: true,
                siteUrl: true,
                siteName: true,
                enabled: true,
              },
            },
          },
        });

    if (!connection) {
      throw new NotFoundException(
        'No Jira connection exists for this Pulse user and integration.',
      );
    }

    return connection;
  }

  private assertConnectionUsable(
    connection: StoredJiraConnection,
  ): void {
    if (
      connection.status !==
      JiraConnectionStatus.CONNECTED
    ) {
      throw new ConflictException(
        `The Jira connection is not usable because its status is ${connection.status}.`,
      );
    }

    if (!connection.jiraIntegration.enabled) {
      throw new ConflictException(
        'The Jira integration is disabled.',
      );
    }
  }

  private shouldRefresh(
    accessTokenExpiresAt: Date,
  ): boolean {
    const refreshThreshold =
      Date.now() +
      REFRESH_EARLY_SECONDS * 1000;

    return (
      accessTokenExpiresAt.getTime() <=
      refreshThreshold
    );
  }

  private refreshOnce(
    connection: StoredJiraConnection,
  ): Promise<JiraAccessContext> {
    const existingRefresh =
      this.refreshPromises.get(connection.id);

    if (existingRefresh) {
      return existingRefresh;
    }

    const refreshPromise =
      this.refreshConnection(connection)
        .finally(() => {
          this.refreshPromises.delete(
            connection.id,
          );
        });

    this.refreshPromises.set(
      connection.id,
      refreshPromise,
    );

    return refreshPromise;
  }

  private async refreshConnection(
    connection: StoredJiraConnection,
  ): Promise<JiraAccessContext> {
    const refreshToken =
      this.jiraTokenCryptoService.decrypt(
        connection.refreshTokenCiphertext,
      );

    const refreshedTokens =
      await this.jiraOAuthClientService
        .refreshAccessToken(refreshToken);

    const accessTokenCiphertext =
      this.jiraTokenCryptoService.encrypt(
        refreshedTokens.accessToken,
      );

    const refreshTokenCiphertext =
      this.jiraTokenCryptoService.encrypt(
        refreshedTokens.refreshToken,
      );

    const refreshedAt = new Date();

    const accessTokenExpiresAt = new Date(
      refreshedAt.getTime() +
        refreshedTokens.expiresInSeconds *
          1000,
    );

    const updateResult =
      await this.prisma.jiraUserConnection
        .updateMany({
          where: {
            id: connection.id,
            refreshTokenCiphertext:
              connection.refreshTokenCiphertext,
            status:
              JiraConnectionStatus.CONNECTED,
          },
          data: {
            accessTokenCiphertext,
            refreshTokenCiphertext,
            grantedScopes:
              refreshedTokens.scopes,
            accessTokenExpiresAt,
            lastValidatedAt: refreshedAt,
            lastUsedAt: refreshedAt,
          },
        });

    if (updateResult.count !== 1) {
      const latestConnection =
        await this.loadConnection(
          connection.userId,
          connection.jiraIntegrationId,
        );

      this.assertConnectionUsable(
        latestConnection,
      );

      const latestAccessToken =
        this.jiraTokenCryptoService.decrypt(
          latestConnection
            .accessTokenCiphertext,
        );

      return this.toAccessContext(
        latestConnection,
        latestAccessToken,
        latestConnection
          .accessTokenExpiresAt,
      );
    }

    return this.toAccessContext(
      connection,
      refreshedTokens.accessToken,
      accessTokenExpiresAt,
    );
  }

  private toAccessContext(
    connection: StoredJiraConnection,
    accessToken: string,
    accessTokenExpiresAt: Date,
  ): JiraAccessContext {
    return {
      connectionId: connection.id,
      userId: connection.userId,
      integrationId:
        connection.jiraIntegrationId,
      cloudId:
        connection.jiraIntegration.cloudId,
      siteUrl:
        connection.jiraIntegration.siteUrl,
      siteName:
        connection.jiraIntegration.siteName,
      accessToken,
      accessTokenExpiresAt,
    };
  }
}