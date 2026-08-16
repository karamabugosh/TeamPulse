import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  JiraConnectionStatus,
  JiraIntegrationHealth,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JiraConfigService } from './jira-config.service';
import { JiraOAuthClientService } from './jira-oauth-client.service';
import { JiraOAuthStateService } from './jira-oauth-state.service';
import { JiraTokenCryptoService } from './jira-token-crypto.service';

export type StartJiraOAuthResult = {
  authorizationUrl: string;
  expiresAt: Date;
};

export type CompleteJiraOAuthInput = {
  code: string;
  state: string;
};

export type CompleteJiraOAuthResult = {
  connectionId: string;
  integrationId: string;
  workspaceId: string;
  userId: string;
  cloudId: string;
  siteUrl: string;
  siteName: string;
  jiraAccountId: string;
  jiraDisplayName: string;
  jiraEmail: string | null;
  status: JiraConnectionStatus;
  grantedScopes: string[];
  accessTokenExpiresAt: Date;
};

@Injectable()
export class JiraOAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jiraConfigService:
      JiraConfigService,
    private readonly jiraOAuthStateService:
      JiraOAuthStateService,
    private readonly jiraOAuthClientService:
      JiraOAuthClientService,
    private readonly jiraTokenCryptoService:
      JiraTokenCryptoService,
  ) {}

  async startConnection(
    userIdInput: string,
  ): Promise<StartJiraOAuthResult> {
    const userId = userIdInput?.trim();

    if (!userId) {
      throw new BadRequestException(
        'userId is required to connect Jira.',
      );
    }

    const issuedState =
      await this.jiraOAuthStateService.issueState(
        userId,
      );

    const authorizationUrl =
      this.jiraOAuthClientService.buildAuthorizationUrl(
        issuedState.state,
      );

    return {
      authorizationUrl,
      expiresAt: issuedState.expiresAt,
    };
  }

  async completeConnection(
    input: CompleteJiraOAuthInput,
  ): Promise<CompleteJiraOAuthResult> {
    const code = input.code?.trim();
    const state = input.state?.trim();

    if (!code) {
      throw new BadRequestException(
        'The Jira authorization code is required.',
      );
    }

    if (!state) {
      throw new BadRequestException(
        'The Jira authorization state is required.',
      );
    }

    const stateOwner =
      await this.jiraOAuthStateService.consumeState(
        state,
      );

    const tokens =
      await this.jiraOAuthClientService
        .exchangeAuthorizationCode(code);

    const resources =
      await this.jiraOAuthClientService
        .getAccessibleResources(
          tokens.accessToken,
        );

    if (resources.length === 0) {
      throw new BadGatewayException(
        'Atlassian did not return an accessible Jira site.',
      );
    }

    if (resources.length > 1) {
      throw new ConflictException(
        'More than one Jira site was authorized. Connect one Jira site at a time.',
      );
    }

    const resource = resources[0];

    const jiraUser =
      await this.jiraOAuthClientService
        .getCurrentUser(
          tokens.accessToken,
          resource.cloudId,
        );

    if (jiraUser.active === false) {
      throw new ConflictException(
        'The authorized Jira user is inactive.',
      );
    }

    const integration =
      await this.findOrCreateIntegration({
        workspaceId: stateOwner.workspaceId,
        cloudId: resource.cloudId,
        siteUrl: resource.siteUrl,
        siteName: resource.siteName,
      });

    const existingAccountConnection =
      await this.prisma.jiraUserConnection
        .findUnique({
          where: {
            jiraIntegrationId_jiraAccountId: {
              jiraIntegrationId:
                integration.id,
              jiraAccountId:
                jiraUser.accountId,
            },
          },
          select: {
            id: true,
            userId: true,
          },
        });

    if (
      existingAccountConnection &&
      existingAccountConnection.userId !==
        stateOwner.userId
    ) {
      throw new ConflictException(
        'This Jira account is already connected to another Pulse user in this workspace.',
      );
    }

    const now = new Date();

    const accessTokenExpiresAt = new Date(
      now.getTime() +
        tokens.expiresInSeconds * 1000,
    );

    const accessTokenCiphertext =
      this.jiraTokenCryptoService.encrypt(
        tokens.accessToken,
      );

    const refreshTokenCiphertext =
      this.jiraTokenCryptoService.encrypt(
        tokens.refreshToken,
      );

    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const connection =
            await transaction
              .jiraUserConnection.upsert({
                where: {
                  userId_jiraIntegrationId: {
                    userId:
                      stateOwner.userId,
                    jiraIntegrationId:
                      integration.id,
                  },
                },
                update: {
                  jiraAccountId:
                    jiraUser.accountId,
                  jiraDisplayName:
                    jiraUser.displayName,
                  jiraEmail:
                    jiraUser.emailAddress,
                  accessTokenCiphertext,
                  refreshTokenCiphertext,
                  grantedScopes:
                    tokens.scopes,
                  accessTokenExpiresAt,
                  status:
                    JiraConnectionStatus.CONNECTED,
                  lastValidatedAt: now,
                  lastUsedAt: now,
                  disconnectedAt: null,
                },
                create: {
                  userId:
                    stateOwner.userId,
                  jiraIntegrationId:
                    integration.id,
                  jiraAccountId:
                    jiraUser.accountId,
                  jiraDisplayName:
                    jiraUser.displayName,
                  jiraEmail:
                    jiraUser.emailAddress,
                  accessTokenCiphertext,
                  refreshTokenCiphertext,
                  grantedScopes:
                    tokens.scopes,
                  accessTokenExpiresAt,
                  status:
                    JiraConnectionStatus.CONNECTED,
                  lastValidatedAt: now,
                  lastUsedAt: now,
                },
                select: {
                  id: true,
                  userId: true,
                  jiraAccountId: true,
                  jiraDisplayName: true,
                  jiraEmail: true,
                  status: true,
                  grantedScopes: true,
                  accessTokenExpiresAt: true,
                },
              });

          await transaction.jiraIntegration.update({
            where: {
              id: integration.id,
            },
            data: {
              health:
                JiraIntegrationHealth.HEALTHY,
              lastHealthCheckAt: now,
              lastSuccessfulSyncAt: now,
            },
          });

          return {
            connectionId: connection.id,
            integrationId: integration.id,
            workspaceId:
              stateOwner.workspaceId,
            userId: connection.userId,
            cloudId: resource.cloudId,
            siteUrl: resource.siteUrl,
            siteName: resource.siteName,
            jiraAccountId:
              connection.jiraAccountId,
            jiraDisplayName:
              connection.jiraDisplayName ??
              jiraUser.displayName,
            jiraEmail: connection.jiraEmail,
            status: connection.status,
            grantedScopes:
              connection.grantedScopes,
            accessTokenExpiresAt:
              connection.accessTokenExpiresAt,
          };
        },
      );
    } catch (error) {
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'The Jira account connection conflicts with an existing connection.',
        );
      }

      throw error;
    }
  }

  private async findOrCreateIntegration(
    input: {
      workspaceId: string;
      cloudId: string;
      siteUrl: string;
      siteName: string;
    },
  ): Promise<{
    id: string;
  }> {
    const existingIntegration =
      await this.prisma.jiraIntegration
        .findUnique({
          where: {
            workspaceId_cloudId: {
              workspaceId:
                input.workspaceId,
              cloudId: input.cloudId,
            },
          },
          select: {
            id: true,
          },
        });

    if (existingIntegration) {
      return existingIntegration;
    }

    try {
      const createdIntegration =
        await this.jiraConfigService
          .createWorkspaceIntegration({
            workspaceId: input.workspaceId,
            cloudId: input.cloudId,
            siteUrl: input.siteUrl,
            siteName: input.siteName,
            enabled: true,
          });

      return {
        id: createdIntegration.id,
      };
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        throw error;
      }

      const concurrentlyCreatedIntegration =
        await this.prisma.jiraIntegration
          .findUnique({
            where: {
              workspaceId_cloudId: {
                workspaceId:
                  input.workspaceId,
                cloudId: input.cloudId,
              },
            },
            select: {
              id: true,
            },
          });

      if (!concurrentlyCreatedIntegration) {
        throw error;
      }

      return concurrentlyCreatedIntegration;
    }
  }
}