// backend/src/jira/jira-development-transitions.controller.spec.ts

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
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JiraApiService } from './jira-api.service';
import { JiraDevelopmentController } from './jira-development.controller';

describe(
  'JiraDevelopmentController transitions',
  () => {
    let controller:
      JiraDevelopmentController;

    let nodeEnvironment: string;

    let issueCalls: Array<{
      userId: string;
      integrationId: string;
      issueIdOrKey: string;
    }>;

    let transitionCalls: Array<{
      userId: string;
      integrationId: string;
      issueIdOrKey: string;
    }>;

    beforeEach(() => {
      nodeEnvironment = 'development';
      issueCalls = [];
      transitionCalls = [];

      const prisma = {
        user: {
          async findUnique() {
            return {
              id: 'pulse-user-1',
            };
          },
        },
        jiraUserConnection: {
          async findMany() {
            return [
              {
                jiraIntegrationId:
                  'integration-1',
                jiraIntegration: {
                  id: 'integration-1',
                  siteUrl:
                    'https://example.atlassian.net',
                  siteName: 'Example',
                  isDefault: true,
                },
              },
            ];
          },
        },
      } as unknown as PrismaService;

      const jiraApiService = {
        async getIssue(
          userId: string,
          integrationId: string,
          issueIdOrKey: string,
        ) {
          issueCalls.push({
            userId,
            integrationId,
            issueIdOrKey,
          });

          return {
            id: '20001',
            key: 'DEV-2',
            url:
              'https://example.atlassian.net/browse/DEV-2',
            summary:
              'Build Jira issue picker',
            description: null,
            status: {
              id: '3',
              name: 'In Progress',
              categoryKey:
                'indeterminate',
              categoryName:
                'In Progress',
              categoryColorName:
                'yellow',
            },
            issueType: {
              id: '10002',
              name: 'Story',
              iconUrl: null,
              subtask: false,
            },
            priority: null,
            assignee: null,
            reporter: null,
            labels: [],
            createdAt: null,
            updatedAt: null,
          };
        },

        async getIssueTransitions(
          userId: string,
          integrationId: string,
          issueIdOrKey: string,
        ) {
          transitionCalls.push({
            userId,
            integrationId,
            issueIdOrKey,
          });

          return [
            {
              id: '21',
              name: 'In Review',
              toStatus: {
                id: '4',
                name: 'In Review',
                categoryKey:
                  'indeterminate',
                categoryName:
                  'In Progress',
                categoryColorName:
                  'yellow',
              },
              hasScreen: false,
              isGlobal: false,
              isInitial: false,
              isAvailable: true,
              isConditional: false,
            },
          ];
        },
      } as unknown as JiraApiService;

      const configService = {
        get<T>(
          key: string,
        ): T | undefined {
          if (key === 'NODE_ENV') {
            return nodeEnvironment as T;
          }

          return undefined;
        },
      } as unknown as ConfigService;

      controller =
        new JiraDevelopmentController(
          prisma,
          jiraApiService,
          configService,
        );
    });

    test(
      'reads the issue and its currently allowed transitions',
      async () => {
        const result =
          await controller
            .getIssueTransitions(
              localhostRequest(),
              ' dev-2 ',
              {
                userId:
                  ' pulse-user-1 ',
              },
            );

        assert.deepEqual(issueCalls, [
          {
            userId: 'pulse-user-1',
            integrationId:
              'integration-1',
            issueIdOrKey: 'DEV-2',
          },
        ]);

        assert.deepEqual(
          transitionCalls,
          [
            {
              userId:
                'pulse-user-1',
              integrationId:
                'integration-1',
              issueIdOrKey: 'DEV-2',
            },
          ],
        );

        assert.equal(
          result.issue.key,
          'DEV-2',
        );

        assert.equal(
          result.issue.status?.name,
          'In Progress',
        );

        assert.equal(
          result.transitions[0]
            .toStatus?.name,
          'In Review',
        );

        assert.equal(
          JSON.stringify(result).includes(
            'accessToken',
          ),
          false,
        );
      },
    );

    test(
      'rejects an invalid issue key before calling Jira',
      async () => {
        await assert.rejects(
          controller
            .getIssueTransitions(
              localhostRequest(),
              'DEV-2" OR key = SECRET-1',
              {
                userId:
                  'pulse-user-1',
              },
            ),
          BadRequestException,
        );

        assert.equal(
          issueCalls.length,
          0,
        );

        assert.equal(
          transitionCalls.length,
          0,
        );
      },
    );

    test(
      'rejects transition reads in production',
      async () => {
        nodeEnvironment = 'production';

        await assert.rejects(
          controller
            .getIssueTransitions(
              localhostRequest(),
              'DEV-2',
              {
                userId:
                  'pulse-user-1',
              },
            ),
          ForbiddenException,
        );

        assert.equal(
          issueCalls.length,
          0,
        );

        assert.equal(
          transitionCalls.length,
          0,
        );
      },
    );
  },
);

function localhostRequest(): Request {
  return {
    ip: '127.0.0.1',
    socket: {
      remoteAddress: '127.0.0.1',
    },
  } as unknown as Request;
}