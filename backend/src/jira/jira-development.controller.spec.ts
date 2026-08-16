// backend/src/jira/jira-development.controller.spec.ts

import * as assert from 'node:assert/strict';
import {
  beforeEach,
  describe,
  test,
} from 'node:test';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JiraApiService } from './jira-api.service';
import { JiraDevelopmentController } from './jira-development.controller';

type MockConnection = {
  jiraIntegrationId: string;
  jiraIntegration: {
    id: string;
    siteUrl: string;
    siteName: string | null;
    isDefault: boolean;
  };
};

type ProjectCall = {
  userId: string;
  jiraIntegrationId: string;
  query?: string;
  startAt?: number;
  maxResults?: number;
};

type IssueCall = {
  userId: string;
  jiraIntegrationId: string;
  jql: string;
  maxResults?: number;
  nextPageToken?: string;
};

describe('JiraDevelopmentController', () => {
  let controller: JiraDevelopmentController;

  let nodeEnvironment:
    | string
    | undefined;

  let userExists: boolean;

  let connections: MockConnection[];

  let projectCalls: ProjectCall[];

  let issueCalls: IssueCall[];

  beforeEach(() => {
    nodeEnvironment = 'development';
    userExists = true;
    connections = [];
    projectCalls = [];
    issueCalls = [];

    const prisma = {
      user: {
        async findUnique() {
          return userExists
            ? {
                id: 'pulse-user-1',
              }
            : null;
        },
      },
      jiraUserConnection: {
        async findMany() {
          return connections;
        },
      },
    } as unknown as PrismaService;

    const jiraApiService = {
      async listProjects(
        input: ProjectCall,
      ) {
        projectCalls.push(input);

        return {
          startAt:
            input.startAt ?? 0,
          maxResults:
            input.maxResults ?? 25,
          total: 1,
          isLast: true,
          projects: [
            {
              id: '10001',
              key: 'DEV',
              name: 'Development',
              projectTypeKey:
                'software',
              simplified: true,
              avatarUrl: null,
            },
          ],
        };
      },

      async searchIssues(
        input: IssueCall,
      ) {
        issueCalls.push(input);

        return {
          isLast: true,
          nextPageToken: null,
          issues: [
            {
              id: '20001',
              key: 'DEV-1',
              url:
                'https://default.atlassian.net/browse/DEV-1',
              summary:
                'Build Jira integration',
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
                name: 'Task',
                iconUrl: null,
                subtask: false,
              },
              priority: null,
              assignee: null,
              reporter: null,
              labels: [],
              createdAt: null,
              updatedAt: null,
            },
          ],
        };
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
    'reads projects locally using the default Jira integration',
    async () => {
      connections = [
        mockConnection(
          'integration-secondary',
          false,
          'https://secondary.atlassian.net',
          'Secondary',
        ),
        mockConnection(
          'integration-default',
          true,
          'https://default.atlassian.net',
          'Default',
        ),
      ];

      const result =
        await controller.listProjects(
          localhostRequest(),
          {
            userId: ' pulse-user-1 ',
            query: ' Pulse ',
            startAt: '10',
            maxResults: '20',
          },
        );

      assert.deepEqual(projectCalls, [
        {
          userId: 'pulse-user-1',
          jiraIntegrationId:
            'integration-default',
          query: ' Pulse ',
          startAt: 10,
          maxResults: 20,
        },
      ]);

      assert.equal(
        result.connection.integrationId,
        'integration-default',
      );

      assert.equal(
        result.projects[0].key,
        'DEV',
      );

      const serializedResult =
        JSON.stringify(result);

      assert.equal(
        serializedResult.includes(
          'accessToken',
        ),
        false,
      );

      assert.equal(
        serializedResult.includes(
          'refreshToken',
        ),
        false,
      );
    },
  );

  test(
    'uses the first active connection when none is default',
    async () => {
      connections = [
        mockConnection(
          'integration-first',
          false,
          'https://first.atlassian.net',
          'First',
        ),
        mockConnection(
          'integration-second',
          false,
          'https://second.atlassian.net',
          'Second',
        ),
      ];

      await controller.listProjects(
        localhostRequest(),
        {
          userId: 'pulse-user-1',
        },
      );

      assert.equal(
        projectCalls[0]
          .jiraIntegrationId,
        'integration-first',
      );
    },
  );

  test(
    'reads issues from the requested Jira project',
    async () => {
      connections = [
        mockConnection(
          'integration-default',
          true,
          'https://default.atlassian.net',
          'Default',
        ),
      ];

      const result =
        await controller.searchIssues(
          localhostRequest(),
          {
            userId: ' pulse-user-1 ',
            projectKey: ' dev ',
            maxResults: '15',
            nextPageToken:
              'next-page-token',
          },
        );

      assert.deepEqual(issueCalls, [
        {
          userId: 'pulse-user-1',
          jiraIntegrationId:
            'integration-default',
          jql:
            'project = "DEV" ORDER BY updated DESC',
          maxResults: 15,
          nextPageToken:
            'next-page-token',
        },
      ]);

      assert.equal(
        result.message,
        'Jira issues were read successfully.',
      );

      assert.equal(
        result.projectKey,
        'DEV',
      );

      assert.equal(
        result.appliedSearchText,
        null,
      );

      assert.equal(
        result.issues[0].key,
        'DEV-1',
      );

      assert.equal(
        result.issues[0].status?.name,
        'In Progress',
      );
    },
  );

  test(
    'escapes search text before placing it in JQL',
    async () => {
      connections = [
        mockConnection(
          'integration-default',
          true,
          'https://default.atlassian.net',
          'Default',
        ),
      ];

      const result =
        await controller.searchIssues(
          localhostRequest(),
          {
            userId: 'pulse-user-1',
            projectKey: 'DEV',
            searchText:
              'OAuth "3LO"',
          },
        );

      assert.equal(
        result.appliedSearchText,
        'OAuth "3LO"',
      );

      assert.equal(
        issueCalls[0].jql,
        'project = "DEV" AND text ~ "OAuth \\"3LO\\"" ORDER BY updated DESC',
      );
    },
  );

  test(
    'rejects an invalid Jira project key',
    async () => {
      await assert.rejects(
        controller.searchIssues(
          localhostRequest(),
          {
            userId: 'pulse-user-1',
            projectKey:
              'DEV" OR project = SECRET',
          },
        ),
        BadRequestException,
      );

      assert.equal(
        issueCalls.length,
        0,
      );
    },
  );

  test(
    'rejects search text longer than 200 characters',
    async () => {
      connections = [
        mockConnection(
          'integration-default',
          true,
          'https://default.atlassian.net',
          'Default',
        ),
      ];

      await assert.rejects(
        controller.searchIssues(
          localhostRequest(),
          {
            userId: 'pulse-user-1',
            projectKey: 'DEV',
            searchText: 'a'.repeat(201),
          },
        ),
        BadRequestException,
      );

      assert.equal(
        issueCalls.length,
        0,
      );
    },
  );

  test(
    'rejects development endpoints in production',
    async () => {
      nodeEnvironment = 'production';

      await assert.rejects(
        controller.listProjects(
          localhostRequest(),
          {
            userId: 'pulse-user-1',
          },
        ),
        ForbiddenException,
      );

      await assert.rejects(
        controller.searchIssues(
          localhostRequest(),
          {
            userId: 'pulse-user-1',
            projectKey: 'DEV',
          },
        ),
        ForbiddenException,
      );

      assert.equal(
        projectCalls.length,
        0,
      );

      assert.equal(
        issueCalls.length,
        0,
      );
    },
  );

  test(
    'rejects development endpoints from a remote address',
    async () => {
      await assert.rejects(
        controller.listProjects(
          requestWithIp(
            '192.168.1.25',
          ),
          {
            userId: 'pulse-user-1',
          },
        ),
        ForbiddenException,
      );

      await assert.rejects(
        controller.searchIssues(
          requestWithIp(
            '192.168.1.25',
          ),
          {
            userId: 'pulse-user-1',
            projectKey: 'DEV',
          },
        ),
        ForbiddenException,
      );
    },
  );

  test(
    'rejects an unknown Pulse user',
    async () => {
      userExists = false;

      await assert.rejects(
        controller.listProjects(
          localhostRequest(),
          {
            userId:
              'unknown-pulse-user',
          },
        ),
        NotFoundException,
      );

      assert.equal(
        projectCalls.length,
        0,
      );
    },
  );

  test(
    'rejects a user without an active Jira connection',
    async () => {
      connections = [];

      await assert.rejects(
        controller.listProjects(
          localhostRequest(),
          {
            userId: 'pulse-user-1',
          },
        ),
        NotFoundException,
      );

      assert.equal(
        projectCalls.length,
        0,
      );
    },
  );

  test(
    'rejects a missing user ID',
    async () => {
      await assert.rejects(
        controller.listProjects(
          localhostRequest(),
          {},
        ),
        BadRequestException,
      );

      await assert.rejects(
        controller.searchIssues(
          localhostRequest(),
          {
            projectKey: 'DEV',
          },
        ),
        BadRequestException,
      );
    },
  );

  test(
    'rejects invalid pagination values before reading Jira',
    async () => {
      connections = [
        mockConnection(
          'integration-default',
          true,
          'https://default.atlassian.net',
          'Default',
        ),
      ];

      await assert.rejects(
        controller.listProjects(
          localhostRequest(),
          {
            userId: 'pulse-user-1',
            startAt: '-1',
          },
        ),
        BadRequestException,
      );

      await assert.rejects(
        controller.searchIssues(
          localhostRequest(),
          {
            userId: 'pulse-user-1',
            projectKey: 'DEV',
            maxResults: 'abc',
          },
        ),
        BadRequestException,
      );

      assert.equal(
        projectCalls.length,
        0,
      );

      assert.equal(
        issueCalls.length,
        0,
      );
    },
  );
});

function mockConnection(
  integrationId: string,
  isDefault: boolean,
  siteUrl: string,
  siteName: string,
): MockConnection {
  return {
    jiraIntegrationId:
      integrationId,
    jiraIntegration: {
      id: integrationId,
      siteUrl,
      siteName,
      isDefault,
    },
  };
}

function localhostRequest(): Request {
  return requestWithIp(
    '127.0.0.1',
  );
}

function requestWithIp(
  ip: string,
): Request {
  return {
    ip,
    socket: {
      remoteAddress: ip,
    },
  } as unknown as Request;
}