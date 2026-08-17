// backend/src/jira/jira-answer-issue-link.service.spec.ts

import * as assert from 'node:assert/strict';
import {
  beforeEach,
  describe,
  test,
} from 'node:test';
import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  JiraIssueLinkSource,
  QuestionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  JiraApiService,
  JiraIssueSummary,
} from './jira-api.service';
import {
  JiraAnswerIssueLinkService,
  LinkJiraIssueToAnswerInput,
} from './jira-answer-issue-link.service';

type StoredLink = {
  id: string;
  answerId: string;
  jiraIntegrationId: string;
  jiraIssueId: string;
  jiraIssueKey: string;
  projectKey: string;
  issueUrl: string;
  summarySnapshot: string;
  statusIdSnapshot: string | null;
  statusNameSnapshot: string | null;
  issueTypeSnapshot: string | null;
  source: JiraIssueLinkSource;
  confidence: number | null;
  confirmedAt: Date | null;
  selectionOrder: number;
  createdAt: Date;
  updatedAt: Date;
  jiraIntegration: {
    id: string;
    workspaceId: string;
    cloudId: string;
    siteUrl: string;
    siteName: string | null;
    enabled: boolean;
    health: string;
  };
};

type FindUniqueLinkArguments = {
  where: {
    answerId_jiraIntegrationId_jiraIssueId?: {
      answerId: string;
      jiraIntegrationId: string;
      jiraIssueId: string;
    };
    id?: string;
  };
};

type FindFirstLinkArguments = {
  where: {
    answerId?: string;
    id?: string;
  };
  orderBy?: {
    selectionOrder?: 'asc' | 'desc';
  };
};

type FindManyLinksArguments = {
  where: {
    answerId: string;
  };
};

type CreateLinkArguments = {
  data: {
    answerId: string;
    jiraIntegrationId: string;
    jiraIssueId: string;
    jiraIssueKey: string;
    projectKey: string;
    issueUrl: string;
    summarySnapshot: string;
    statusIdSnapshot: string | null;
    statusNameSnapshot: string | null;
    issueTypeSnapshot: string | null;
    source: JiraIssueLinkSource;
    confidence: number | null;
    confirmedAt: Date;
    selectionOrder: number;
  };
};

type UpdateLinkArguments = {
  where: {
    id: string;
  };
  data: Partial<StoredLink>;
};

type DeleteLinkArguments = {
  where: {
    id: string;
  };
};

describe(
  'JiraAnswerIssueLinkService',
  () => {
    let service:
      JiraAnswerIssueLinkService;

    let answerExists: boolean;
    let answerOwnerId: string;
    let answerWorkspaceId: string;

    let questionType: QuestionType;
    let questionActive: boolean;
    let questionHasCheckIn: boolean;
    let checkInEnabled: boolean;

    let teamWorkspaceId: string;

    let questionConfig: {
      id: string;
      allowMultiple: boolean;
      maxSelections: number;
      allowedProjectKeys: string[];
      plaintextFallbackEnabled: boolean;
      actionProposalEnabled: boolean;
    } | null;

    let teamJiraConfig: {
      id: string;
      enabled: boolean;
      issuePickerEnabled: boolean;
      jiraIntegrationId: string | null;
      jiraIntegration: {
        id: string;
        workspaceId: string;
        enabled: boolean;
        allowedProjectKeys: string[];
      } | null;
    } | null;

    let jiraIssue: JiraIssueSummary;
    let storedLinks: StoredLink[];

    let capturedJiraRequest:
      | {
          userId: string;
          jiraIntegrationId: string;
          issueIdOrKey: string;
        }
      | undefined;

    const fixedDate =
      new Date(
        '2026-08-17T08:00:00.000Z',
      );

    const createStoredLink = (
      overrides: Partial<StoredLink> = {},
    ): StoredLink => ({
      id:
        overrides.id ??
        `link-${storedLinks.length + 1}`,
      answerId:
        overrides.answerId ??
        'answer-1',
      jiraIntegrationId:
        overrides.jiraIntegrationId ??
        'jira-integration-1',
      jiraIssueId:
        overrides.jiraIssueId ??
        `1000${storedLinks.length + 1}`,
      jiraIssueKey:
        overrides.jiraIssueKey ??
        `KAN-${storedLinks.length + 1}`,
      projectKey:
        overrides.projectKey ?? 'KAN',
      issueUrl:
        overrides.issueUrl ??
        `https://example.atlassian.net/browse/${
          overrides.jiraIssueKey ??
          `KAN-${storedLinks.length + 1}`
        }`,
      summarySnapshot:
        overrides.summarySnapshot ??
        'Stored Jira issue',
      statusIdSnapshot:
        overrides.statusIdSnapshot ??
        '10005',
      statusNameSnapshot:
        overrides.statusNameSnapshot ??
        'In Progress',
      issueTypeSnapshot:
        overrides.issueTypeSnapshot ??
        'Story',
      source:
        overrides.source ??
        JiraIssueLinkSource
          .USER_SELECTED,
      confidence:
        overrides.confidence ?? null,
      confirmedAt:
        overrides.confirmedAt ??
        fixedDate,
      selectionOrder:
        overrides.selectionOrder ??
        storedLinks.length,
      createdAt:
        overrides.createdAt ??
        fixedDate,
      updatedAt:
        overrides.updatedAt ??
        fixedDate,
      jiraIntegration:
        overrides.jiraIntegration ?? {
          id: 'jira-integration-1',
          workspaceId: 'workspace-1',
          cloudId: 'cloud-1',
          siteUrl:
            'https://example.atlassian.net',
          siteName: 'Example Jira',
          enabled: true,
          health: 'HEALTHY',
        },
    });

    beforeEach(() => {
      answerExists = true;
      answerOwnerId = 'user-1';
      answerWorkspaceId = 'workspace-1';

      questionType =
        QuestionType.ISSUE_REF;

      questionActive = true;
      questionHasCheckIn = true;
      checkInEnabled = true;

      teamWorkspaceId = 'workspace-1';

      questionConfig = {
        id: 'jira-question-config-1',
        allowMultiple: true,
        maxSelections: 3,
        allowedProjectKeys: ['KAN'],
        plaintextFallbackEnabled: true,
        actionProposalEnabled: true,
      };

      teamJiraConfig = {
        id: 'team-jira-config-1',
        enabled: true,
        issuePickerEnabled: true,
        jiraIntegrationId:
          'jira-integration-1',
        jiraIntegration: {
          id: 'jira-integration-1',
          workspaceId: 'workspace-1',
          enabled: true,
          allowedProjectKeys: [
            'KAN',
            'OPS',
          ],
        },
      };

      jiraIssue = {
        id: '10011',
        key: 'KAN-2',
        url:
          'https://example.atlassian.net/browse/KAN-2',
        summary:
          'Build Jira issue picker for Slack Check-Ins',
        description: null,
        status: {
          id: '10005',
          name: 'In Progress',
          categoryKey: 'indeterminate',
          categoryName: 'In Progress',
          categoryColorName: 'yellow',
        },
        issueType: {
          id: '10009',
          name: 'Story',
          iconUrl: null,
          subtask: false,
        },
        priority: {
          id: '3',
          name: 'Medium',
          iconUrl: null,
        },
        assignee: null,
        reporter: null,
        labels: [],
        createdAt:
          '2026-08-15T08:00:00.000Z',
        updatedAt:
          '2026-08-17T08:00:00.000Z',
      };

      storedLinks = [];
      capturedJiraRequest = undefined;

      const jiraAnswerIssueLinkMock = {
        findUnique: async (
          argumentsInput:
            FindUniqueLinkArguments,
        ) => {
          const compoundKey =
            argumentsInput.where
              .answerId_jiraIntegrationId_jiraIssueId;

          if (compoundKey) {
            return (
              storedLinks.find(
                (link) =>
                  link.answerId ===
                    compoundKey.answerId &&
                  link.jiraIntegrationId ===
                    compoundKey
                      .jiraIntegrationId &&
                  link.jiraIssueId ===
                    compoundKey.jiraIssueId,
              ) ?? null
            );
          }

          if (argumentsInput.where.id) {
            return (
              storedLinks.find(
                (link) =>
                  link.id ===
                  argumentsInput.where.id,
              ) ?? null
            );
          }

          return null;
        },

        findFirst: async (
          argumentsInput:
            FindFirstLinkArguments,
        ) => {
          let matches =
            storedLinks.filter(
              (link) =>
                (!argumentsInput.where
                  .answerId ||
                  link.answerId ===
                    argumentsInput.where
                      .answerId) &&
                (!argumentsInput.where.id ||
                  link.id ===
                    argumentsInput.where.id),
            );

          if (
            argumentsInput.orderBy
              ?.selectionOrder === 'desc'
          ) {
            matches = matches.sort(
              (first, second) =>
                second.selectionOrder -
                first.selectionOrder,
            );
          }

          if (
            argumentsInput.orderBy
              ?.selectionOrder === 'asc'
          ) {
            matches = matches.sort(
              (first, second) =>
                first.selectionOrder -
                second.selectionOrder,
            );
          }

          return matches[0] ?? null;
        },

        findMany: async (
          argumentsInput:
            FindManyLinksArguments,
        ) =>
          storedLinks
            .filter(
              (link) =>
                link.answerId ===
                argumentsInput.where
                  .answerId,
            )
            .sort(
              (first, second) =>
                first.selectionOrder -
                  second.selectionOrder ||
                first.createdAt.getTime() -
                  second.createdAt.getTime(),
            ),

        count: async (
          argumentsInput: {
            where: {
              answerId: string;
            };
          },
        ) =>
          storedLinks.filter(
            (link) =>
              link.answerId ===
              argumentsInput.where.answerId,
          ).length,

        create: async (
          argumentsInput:
            CreateLinkArguments,
        ) => {
          const createdLink =
            createStoredLink({
              ...argumentsInput.data,
              id:
                `link-${storedLinks.length + 1}`,
              createdAt: fixedDate,
              updatedAt: fixedDate,
            });

          storedLinks.push(createdLink);

          return createdLink;
        },

        update: async (
          argumentsInput:
            UpdateLinkArguments,
        ) => {
          const linkIndex =
            storedLinks.findIndex(
              (link) =>
                link.id ===
                argumentsInput.where.id,
            );

          if (linkIndex < 0) {
            throw new Error(
              'Test link was not found.',
            );
          }

          storedLinks[linkIndex] = {
            ...storedLinks[linkIndex],
            ...argumentsInput.data,
            updatedAt: fixedDate,
          };

          return storedLinks[linkIndex];
        },

        delete: async (
          argumentsInput:
            DeleteLinkArguments,
        ) => {
          const linkIndex =
            storedLinks.findIndex(
              (link) =>
                link.id ===
                argumentsInput.where.id,
            );

          if (linkIndex < 0) {
            throw new Error(
              'Test link was not found.',
            );
          }

          const [deletedLink] =
            storedLinks.splice(
              linkIndex,
              1,
            );

          return deletedLink;
        },
      };

      const prismaMock = {
        answer: {
          findUnique: async () =>
            answerExists
              ? {
                  id: 'answer-1',
                  userId:
                    answerOwnerId,
                  user: {
                    id: answerOwnerId,
                    workspaceId:
                      answerWorkspaceId,
                  },
                  question: {
                    id: 'question-1',
                    type: questionType,
                    isActive:
                      questionActive,
                    jiraConfig:
                      questionConfig,
                    checkIn:
                      questionHasCheckIn
                        ? {
                            id: 'check-in-1',
                            enabled:
                              checkInEnabled,
                            team: {
                              id: 'team-1',
                              workspaceId:
                                teamWorkspaceId,
                              jiraConfig:
                                teamJiraConfig,
                            },
                          }
                        : null,
                  },
                }
              : null,
        },

        jiraAnswerIssueLink:
          jiraAnswerIssueLinkMock,

        $transaction: async <T>(
          transactionCallback: (
            transaction: {
              jiraAnswerIssueLink:
                typeof jiraAnswerIssueLinkMock;
            },
          ) => Promise<T>,
        ): Promise<T> =>
          transactionCallback({
            jiraAnswerIssueLink:
              jiraAnswerIssueLinkMock,
          }),
      };

      const jiraApiMock = {
        getIssue: async (
          userId: string,
          jiraIntegrationId: string,
          issueIdOrKey: string,
        ) => {
          capturedJiraRequest = {
            userId,
            jiraIntegrationId,
            issueIdOrKey,
          };

          return jiraIssue;
        },
      };

      service =
        new JiraAnswerIssueLinkService(
          prismaMock as unknown as
            PrismaService,
          jiraApiMock as unknown as
            JiraApiService,
        );
    });

    test(
      'links a live Jira issue to an owned ISSUE_REF answer',
      async () => {
        const input:
          LinkJiraIssueToAnswerInput = {
          answerId: ' answer-1 ',
          userId: ' user-1 ',
          jiraIntegrationId:
            ' jira-integration-1 ',
          issueIdOrKey: ' kan-2 ',
          source:
            JiraIssueLinkSource
              .USER_SELECTED,
        };

        const result =
          await service.linkIssueToAnswer(
            input,
          );

        assert.deepEqual(
          capturedJiraRequest,
          {
            userId: 'user-1',
            jiraIntegrationId:
              'jira-integration-1',
            issueIdOrKey: 'kan-2',
          },
        );

        assert.equal(
          result.jiraIssueId,
          '10011',
        );

        assert.equal(
          result.jiraIssueKey,
          'KAN-2',
        );

        assert.equal(
          result.projectKey,
          'KAN',
        );

        assert.equal(
          result.summarySnapshot,
          jiraIssue.summary,
        );

        assert.equal(
          result.statusNameSnapshot,
          'In Progress',
        );

        assert.equal(
          result.issueTypeSnapshot,
          'Story',
        );

        assert.equal(
          result.selectionOrder,
          0,
        );

        assert.equal(
          result.source,
          JiraIssueLinkSource
            .USER_SELECTED,
        );

        assert.equal(
          storedLinks.length,
          1,
        );
      },
    );

    test(
      'updates the snapshot instead of duplicating an existing issue link',
      async () => {
        storedLinks.push(
          createStoredLink({
            id: 'existing-link',
            jiraIssueId: '10011',
            jiraIssueKey: 'KAN-2',
            summarySnapshot:
              'Old summary',
            statusNameSnapshot:
              'To Do',
          }),
        );

        jiraIssue = {
          ...jiraIssue,
          summary:
            'Updated Jira issue summary',
          status: {
            ...jiraIssue.status!,
            id: '10006',
            name: 'In Review',
          },
        };

        const result =
          await service.linkIssueToAnswer({
            answerId: 'answer-1',
            userId: 'user-1',
            jiraIntegrationId:
              'jira-integration-1',
            issueIdOrKey: 'KAN-2',
          });

        assert.equal(
          storedLinks.length,
          1,
        );

        assert.equal(
          result.id,
          'existing-link',
        );

        assert.equal(
          result.summarySnapshot,
          'Updated Jira issue summary',
        );

        assert.equal(
          result.statusNameSnapshot,
          'In Review',
        );
      },
    );

    test(
      'rejects managing Jira links for another user’s answer',
      async () => {
        await assert.rejects(
          () =>
            service.linkIssueToAnswer({
              answerId: 'answer-1',
              userId: 'user-2',
              jiraIntegrationId:
                'jira-integration-1',
              issueIdOrKey: 'KAN-2',
            }),
          (error: unknown) =>
            error instanceof
              ForbiddenException &&
            error.message.includes(
              'another user',
            ),
        );

        assert.equal(
          capturedJiraRequest,
          undefined,
        );
      },
    );

    test(
      'rejects Jira links for a non-ISSUE_REF answer',
      async () => {
        questionType =
          QuestionType.FREE_TEXT;

        await assert.rejects(
          () =>
            service.linkIssueToAnswer({
              answerId: 'answer-1',
              userId: 'user-1',
              jiraIntegrationId:
                'jira-integration-1',
              issueIdOrKey: 'KAN-2',
            }),
          (error: unknown) =>
            error instanceof
              BadRequestException &&
            error.message.includes(
              'ISSUE_REF',
            ),
        );
      },
    );

    test(
      'rejects a Jira integration that is not configured for the team',
      async () => {
        await assert.rejects(
          () =>
            service.linkIssueToAnswer({
              answerId: 'answer-1',
              userId: 'user-1',
              jiraIntegrationId:
                'jira-integration-2',
              issueIdOrKey: 'KAN-2',
            }),
          (error: unknown) =>
            error instanceof
              BadRequestException &&
            error.message.includes(
              'not configured for this team',
            ),
        );
      },
    );

    test(
      'rejects an answer and team from different workspaces',
      async () => {
        answerWorkspaceId =
          'workspace-2';

        await assert.rejects(
          () =>
            service.linkIssueToAnswer({
              answerId: 'answer-1',
              userId: 'user-1',
              jiraIntegrationId:
                'jira-integration-1',
              issueIdOrKey: 'KAN-2',
            }),
          (error: unknown) =>
            error instanceof
              ForbiddenException &&
            error.message.includes(
              'different workspaces',
            ),
        );
      },
    );

    test(
      'rejects an issue outside the integration project scope',
      async () => {
        jiraIssue = {
          ...jiraIssue,
          key: 'SECRET-7',
          url:
            'https://example.atlassian.net/browse/SECRET-7',
        };

        await assert.rejects(
          () =>
            service.linkIssueToAnswer({
              answerId: 'answer-1',
              userId: 'user-1',
              jiraIntegrationId:
                'jira-integration-1',
              issueIdOrKey: 'SECRET-7',
            }),
          (error: unknown) =>
            error instanceof
              ForbiddenException &&
            error.message.includes(
              'workspace integration',
            ),
        );
      },
    );

    test(
      'rejects an issue outside the question project scope',
      async () => {
        teamJiraConfig!
          .jiraIntegration!
          .allowedProjectKeys = [
          'KAN',
          'OPS',
        ];

        questionConfig!
          .allowedProjectKeys = ['KAN'];

        jiraIssue = {
          ...jiraIssue,
          key: 'OPS-8',
          url:
            'https://example.atlassian.net/browse/OPS-8',
        };

        await assert.rejects(
          () =>
            service.linkIssueToAnswer({
              answerId: 'answer-1',
              userId: 'user-1',
              jiraIntegrationId:
                'jira-integration-1',
              issueIdOrKey: 'OPS-8',
            }),
          (error: unknown) =>
            error instanceof
              ForbiddenException &&
            error.message.includes(
              'Check-In question',
            ),
        );
      },
    );

    test(
      'enforces the question maximum issue selection count',
      async () => {
        questionConfig = {
          ...questionConfig!,
          allowMultiple: false,
          maxSelections: 1,
        };

        storedLinks.push(
          createStoredLink({
            id: 'link-1',
            jiraIssueId: '10010',
            jiraIssueKey: 'KAN-1',
            selectionOrder: 0,
          }),
        );

        await assert.rejects(
          () =>
            service.linkIssueToAnswer({
              answerId: 'answer-1',
              userId: 'user-1',
              jiraIntegrationId:
                'jira-integration-1',
              issueIdOrKey: 'KAN-2',
            }),
          (error: unknown) =>
            error instanceof
              BadRequestException &&
            error.message.includes(
              'only one Jira issue',
            ),
        );

        assert.equal(
          storedLinks.length,
          1,
        );
      },
    );

    test(
      'requires confidence for an AI-suggested issue',
      async () => {
        await assert.rejects(
          () =>
            service.linkIssueToAnswer({
              answerId: 'answer-1',
              userId: 'user-1',
              jiraIntegrationId:
                'jira-integration-1',
              issueIdOrKey: 'KAN-2',
              source:
                JiraIssueLinkSource
                  .AI_SUGGESTED,
            }),
          (error: unknown) =>
            error instanceof
              BadRequestException &&
            error.message.includes(
              'confidence is required',
            ),
        );

        assert.equal(
          capturedJiraRequest,
          undefined,
        );
      },
    );

    test(
      'stores confidence for a confirmed AI suggestion',
      async () => {
        const result =
          await service.linkIssueToAnswer({
            answerId: 'answer-1',
            userId: 'user-1',
            jiraIntegrationId:
              'jira-integration-1',
            issueIdOrKey: 'KAN-2',
            source:
              JiraIssueLinkSource
                .AI_SUGGESTED,
            confidence: 0.92,
          });

        assert.equal(
          result.source,
          JiraIssueLinkSource
            .AI_SUGGESTED,
        );

        assert.equal(
          result.confidence,
          0.92,
        );

        assert.ok(
          result.confirmedAt instanceof Date,
        );
      },
    );

    test(
      'lists linked issues in selection order',
      async () => {
        storedLinks.push(
          createStoredLink({
            id: 'link-second',
            jiraIssueId: '10012',
            jiraIssueKey: 'KAN-3',
            selectionOrder: 1,
          }),
        );

        storedLinks.push(
          createStoredLink({
            id: 'link-first',
            jiraIssueId: '10011',
            jiraIssueKey: 'KAN-2',
            selectionOrder: 0,
          }),
        );

        const links =
          await service
            .listAnswerIssueLinks(
              'answer-1',
              'user-1',
            );

        assert.deepEqual(
          links.map(
            (link) =>
              link.jiraIssueKey,
          ),
          ['KAN-2', 'KAN-3'],
        );
      },
    );

    test(
      'removes a link and compacts the remaining selection order',
      async () => {
        storedLinks.push(
          createStoredLink({
            id: 'link-first',
            jiraIssueId: '10011',
            jiraIssueKey: 'KAN-2',
            selectionOrder: 0,
          }),
        );

        storedLinks.push(
          createStoredLink({
            id: 'link-second',
            jiraIssueId: '10012',
            jiraIssueKey: 'KAN-3',
            selectionOrder: 3,
          }),
        );

        const result =
          await service
            .removeIssueFromAnswer({
              answerId: 'answer-1',
              userId: 'user-1',
              linkId: 'link-first',
            });

        assert.deepEqual(
          result,
          {
            removed: true,
            answerId: 'answer-1',
            linkId: 'link-first',
          },
        );

        assert.equal(
          storedLinks.length,
          1,
        );

        assert.equal(
          storedLinks[0].id,
          'link-second',
        );

        assert.equal(
          storedLinks[0].selectionOrder,
          0,
        );
      },
    );
  },
);