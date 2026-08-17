// backend/src/jira/jira-answer-issue-link.service.ts

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  JiraIssueLinkSource,
  Prisma,
  QuestionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  JiraApiService,
  JiraIssueSummary,
} from './jira-api.service';

export type LinkJiraIssueToAnswerInput = {
  answerId: string;
  userId: string;
  jiraIntegrationId: string;
  issueIdOrKey: string;
  source?: JiraIssueLinkSource;
  confidence?: number;
};

export type RemoveJiraIssueFromAnswerInput = {
  answerId: string;
  userId: string;
  linkId: string;
};

@Injectable()
export class JiraAnswerIssueLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jiraApiService: JiraApiService,
  ) {}

  private readonly safeLinkSelect = {
    id: true,
    answerId: true,
    jiraIntegrationId: true,
    jiraIssueId: true,
    jiraIssueKey: true,
    projectKey: true,
    issueUrl: true,
    summarySnapshot: true,
    statusIdSnapshot: true,
    statusNameSnapshot: true,
    issueTypeSnapshot: true,
    source: true,
    confidence: true,
    confirmedAt: true,
    selectionOrder: true,
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
        health: true,
      },
    },
  } as const;

  async listAnswerIssueLinks(
    answerIdInput: string,
    userIdInput: string,
  ) {
    const answerId =
      this.normalizeRequiredId(
        answerIdInput,
        'answerId',
      );

    const userId =
      this.normalizeRequiredId(
        userIdInput,
        'userId',
      );

    await this.loadOwnedAnswerContext(
      answerId,
      userId,
    );

    return this.prisma.jiraAnswerIssueLink.findMany({
      where: {
        answerId,
      },
      select: this.safeLinkSelect,
      orderBy: [
        {
          selectionOrder: 'asc',
        },
        {
          createdAt: 'asc',
        },
      ],
    });
  }

  async linkIssueToAnswer(
    input: LinkJiraIssueToAnswerInput,
  ) {
    const answerId =
      this.normalizeRequiredId(
        input.answerId,
        'answerId',
      );

    const userId =
      this.normalizeRequiredId(
        input.userId,
        'userId',
      );

    const jiraIntegrationId =
      this.normalizeRequiredId(
        input.jiraIntegrationId,
        'jiraIntegrationId',
      );

    const issueIdOrKey =
      this.normalizeRequiredId(
        input.issueIdOrKey,
        'issueIdOrKey',
      );

    const source =
      this.normalizeSource(input.source);

    const confidence =
      this.normalizeConfidence(
        input.confidence,
        source,
      );

    const answer =
      await this.loadOwnedAnswerContext(
        answerId,
        userId,
      );

    const configuration =
      this.assertJiraConfiguration(
        answer,
        jiraIntegrationId,
      );

    const issue =
      await this.jiraApiService.getIssue(
        userId,
        jiraIntegrationId,
        issueIdOrKey,
      );

    const projectKey =
      this.extractProjectKey(issue.key);

    this.assertProjectAllowed(
      projectKey,
      configuration
        .integrationAllowedProjectKeys,
      'The Jira project is not allowed by the workspace integration.',
    );

    this.assertProjectAllowed(
      projectKey,
      configuration
        .questionAllowedProjectKeys,
      'The Jira project is not allowed for this Check-In question.',
    );

    const now = new Date();

    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const existingLink =
            await transaction
              .jiraAnswerIssueLink
              .findUnique({
                where: {
                  answerId_jiraIntegrationId_jiraIssueId:
                    {
                      answerId,
                      jiraIntegrationId,
                      jiraIssueId: issue.id,
                    },
                },
                select: {
                  id: true,
                  selectionOrder: true,
                },
              });

          if (existingLink) {
            return transaction
              .jiraAnswerIssueLink
              .update({
                where: {
                  id: existingLink.id,
                },
                data: this.buildLinkSnapshotData(
                  issue,
                  projectKey,
                  source,
                  confidence,
                  now,
                ),
                select: this.safeLinkSelect,
              });
          }

          const currentLinkCount =
            await transaction
              .jiraAnswerIssueLink
              .count({
                where: {
                  answerId,
                },
              });

          if (
            currentLinkCount >=
            configuration.maxSelections
          ) {
            throw new BadRequestException(
              configuration.maxSelections === 1
                ? 'This answer allows only one Jira issue.'
                : `This answer allows at most ${configuration.maxSelections} Jira issues.`,
            );
          }

          const lastSelection =
            await transaction
              .jiraAnswerIssueLink
              .findFirst({
                where: {
                  answerId,
                },
                select: {
                  selectionOrder: true,
                },
                orderBy: {
                  selectionOrder: 'desc',
                },
              });

          const selectionOrder =
            (lastSelection?.selectionOrder ??
              -1) + 1;

          return transaction
            .jiraAnswerIssueLink
            .create({
              data: {
                answerId,
                jiraIntegrationId,
                jiraIssueId: issue.id,
                jiraIssueKey:
                  issue.key.toUpperCase(),
                projectKey,
                issueUrl: issue.url,
                summarySnapshot:
                  issue.summary,
                statusIdSnapshot:
                  issue.status?.id ?? null,
                statusNameSnapshot:
                  issue.status?.name ?? null,
                issueTypeSnapshot:
                  issue.issueType?.name ?? null,
                source,
                confidence,
                confirmedAt: now,
                selectionOrder,
              },
              select: this.safeLinkSelect,
            });
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel
              .Serializable,
        },
      );
    } catch (error) {
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError
      ) {
        if (error.code === 'P2002') {
          throw new ConflictException(
            'This Jira issue is already linked to the answer.',
          );
        }

        if (error.code === 'P2034') {
          throw new ConflictException(
            'The Jira issue selection changed concurrently. Please try again.',
          );
        }
      }

      throw error;
    }
  }

  async removeIssueFromAnswer(
    input: RemoveJiraIssueFromAnswerInput,
  ) {
    const answerId =
      this.normalizeRequiredId(
        input.answerId,
        'answerId',
      );

    const userId =
      this.normalizeRequiredId(
        input.userId,
        'userId',
      );

    const linkId =
      this.normalizeRequiredId(
        input.linkId,
        'linkId',
      );

    await this.loadOwnedAnswerContext(
      answerId,
      userId,
    );

    const link =
      await this.prisma.jiraAnswerIssueLink.findFirst({
        where: {
          id: linkId,
          answerId,
        },
        select: {
          id: true,
        },
      });

    if (!link) {
      throw new NotFoundException(
        `Jira answer issue link ${linkId} was not found.`,
      );
    }

    await this.prisma.$transaction(
      async (transaction) => {
        await transaction
          .jiraAnswerIssueLink
          .delete({
            where: {
              id: link.id,
            },
          });

        const remainingLinks =
          await transaction
            .jiraAnswerIssueLink
            .findMany({
              where: {
                answerId,
              },
              select: {
                id: true,
              },
              orderBy: [
                {
                  selectionOrder: 'asc',
                },
                {
                  createdAt: 'asc',
                },
              ],
            });

        for (
          let index = 0;
          index < remainingLinks.length;
          index += 1
        ) {
          await transaction
            .jiraAnswerIssueLink
            .update({
              where: {
                id: remainingLinks[index].id,
              },
              data: {
                selectionOrder: index,
              },
            });
        }
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel
            .Serializable,
      },
    );

    return {
      removed: true,
      answerId,
      linkId,
    };
  }

  private async loadOwnedAnswerContext(
    answerId: string,
    userId: string,
  ) {
    const answer =
      await this.prisma.answer.findUnique({
        where: {
          id: answerId,
        },
        select: {
          id: true,
          userId: true,
          user: {
            select: {
              id: true,
              workspaceId: true,
            },
          },
          question: {
            select: {
              id: true,
              type: true,
              isActive: true,
              jiraConfig: {
                select: {
                  id: true,
                  allowMultiple: true,
                  maxSelections: true,
                  allowedProjectKeys: true,
                  plaintextFallbackEnabled: true,
                  actionProposalEnabled: true,
                },
              },
              checkIn: {
                select: {
                  id: true,
                  enabled: true,
                  team: {
                    select: {
                      id: true,
                      workspaceId: true,
                      jiraConfig: {
                        select: {
                          id: true,
                          enabled: true,
                          issuePickerEnabled: true,
                          jiraIntegrationId: true,
                          jiraIntegration: {
                            select: {
                              id: true,
                              workspaceId: true,
                              enabled: true,
                              allowedProjectKeys: true,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

    if (!answer) {
      throw new NotFoundException(
        `Answer ${answerId} was not found.`,
      );
    }

    if (answer.userId !== userId) {
      throw new ForbiddenException(
        'You cannot manage Jira issues for another user’s answer.',
      );
    }

    return answer;
  }

  private assertJiraConfiguration(
    answer: Awaited<
      ReturnType<
        JiraAnswerIssueLinkService[
          'loadOwnedAnswerContext'
        ]
      >
    >,
    jiraIntegrationId: string,
  ) {
    if (
      answer.question.type !==
      QuestionType.ISSUE_REF
    ) {
      throw new BadRequestException(
        'Jira issues can only be linked to an ISSUE_REF answer.',
      );
    }

    if (!answer.question.isActive) {
      throw new BadRequestException(
        'Jira issues cannot be linked because the question is inactive.',
      );
    }

    const checkIn =
      answer.question.checkIn;

    if (!checkIn) {
      throw new BadRequestException(
        'The answer question is not attached to a Check-In.',
      );
    }

    if (!checkIn.enabled) {
      throw new BadRequestException(
        'Jira issues cannot be linked because the Check-In is disabled.',
      );
    }

    const questionConfig =
      answer.question.jiraConfig;

    if (!questionConfig) {
      throw new BadRequestException(
        'The ISSUE_REF question does not have Jira configuration.',
      );
    }

    const team = checkIn.team;
    const teamJiraConfig =
      team.jiraConfig;

    if (
      answer.user.workspaceId !==
      team.workspaceId
    ) {
      throw new ForbiddenException(
        'The answer user and Check-In team belong to different workspaces.',
      );
    }

    if (
      !teamJiraConfig?.enabled ||
      !teamJiraConfig.issuePickerEnabled
    ) {
      throw new BadRequestException(
        'The Jira issue picker is disabled for this team.',
      );
    }

    if (
      !teamJiraConfig.jiraIntegrationId ||
      teamJiraConfig.jiraIntegrationId !==
        jiraIntegrationId
    ) {
      throw new BadRequestException(
        'The selected Jira integration is not configured for this team.',
      );
    }

    const integration =
      teamJiraConfig.jiraIntegration;

    if (
      !integration ||
      !integration.enabled
    ) {
      throw new BadRequestException(
        'The Jira integration is disabled or unavailable.',
      );
    }

    if (
      integration.workspaceId !==
        team.workspaceId ||
      integration.workspaceId !==
        answer.user.workspaceId
    ) {
      throw new ForbiddenException(
        'The Jira integration belongs to a different workspace.',
      );
    }

    const expectedMaxSelections =
      questionConfig.allowMultiple
        ? questionConfig.maxSelections
        : 1;

    if (
      !Number.isInteger(
        expectedMaxSelections,
      ) ||
      expectedMaxSelections < 1 ||
      expectedMaxSelections > 50
    ) {
      throw new BadRequestException(
        'The Jira question selection limit is invalid.',
      );
    }

    return {
      maxSelections:
        expectedMaxSelections,
      integrationAllowedProjectKeys:
        this.normalizeProjectKeys(
          integration.allowedProjectKeys,
        ),
      questionAllowedProjectKeys:
        this.normalizeProjectKeys(
          questionConfig
            .allowedProjectKeys,
        ),
    };
  }

  private buildLinkSnapshotData(
    issue: JiraIssueSummary,
    projectKey: string,
    source: JiraIssueLinkSource,
    confidence: number | null,
    confirmedAt: Date,
  ) {
    return {
      jiraIssueKey:
        issue.key.toUpperCase(),
      projectKey,
      issueUrl: issue.url,
      summarySnapshot:
        issue.summary,
      statusIdSnapshot:
        issue.status?.id ?? null,
      statusNameSnapshot:
        issue.status?.name ?? null,
      issueTypeSnapshot:
        issue.issueType?.name ?? null,
      source,
      confidence,
      confirmedAt,
    };
  }

  private normalizeRequiredId(
    valueInput: string,
    fieldName: string,
  ): string {
    const value = valueInput?.trim();

    if (!value) {
      throw new BadRequestException(
        `${fieldName} is required.`,
      );
    }

    return value;
  }

  private normalizeSource(
    sourceInput?: JiraIssueLinkSource,
  ): JiraIssueLinkSource {
    const source =
      sourceInput ??
      JiraIssueLinkSource.USER_SELECTED;

    if (
      !Object.values(
        JiraIssueLinkSource,
      ).includes(source)
    ) {
      throw new BadRequestException(
        'source must be a valid Jira issue link source.',
      );
    }

    return source;
  }

  private normalizeConfidence(
    confidenceInput: number | undefined,
    source: JiraIssueLinkSource,
  ): number | null {
    if (confidenceInput === undefined) {
      if (
        source ===
        JiraIssueLinkSource.AI_SUGGESTED
      ) {
        throw new BadRequestException(
          'confidence is required for an AI-suggested Jira issue.',
        );
      }

      return null;
    }

    if (
      typeof confidenceInput !== 'number' ||
      !Number.isFinite(confidenceInput) ||
      confidenceInput < 0 ||
      confidenceInput > 1
    ) {
      throw new BadRequestException(
        'confidence must be a number between 0 and 1.',
      );
    }

    return confidenceInput;
  }

  private normalizeProjectKeys(
    projectKeys: string[],
  ): string[] {
    return Array.from(
      new Set(
        projectKeys
          .map((projectKey) =>
            projectKey
              ?.trim()
              .toUpperCase(),
          )
          .filter(
            (
              projectKey,
            ): projectKey is string =>
              Boolean(projectKey),
          ),
      ),
    );
  }

  private assertProjectAllowed(
    projectKey: string,
    allowedProjectKeys: string[],
    errorMessage: string,
  ): void {
    if (
      allowedProjectKeys.length > 0 &&
      !allowedProjectKeys.includes(
        projectKey,
      )
    ) {
      throw new ForbiddenException(
        errorMessage,
      );
    }
  }

  private extractProjectKey(
    issueKeyInput: string,
  ): string {
    const issueKey =
      issueKeyInput
        ?.trim()
        .toUpperCase();

    const match =
      /^([A-Z][A-Z0-9_]*)-\d+$/.exec(
        issueKey,
      );

    if (!match) {
      throw new BadRequestException(
        'Jira returned an invalid issue key.',
      );
    }

    return match[1];
  }
}