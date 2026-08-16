// backend/src/jira/jira-api.service.spec.ts

import * as assert from 'node:assert/strict';
import {
  afterEach,
  beforeEach,
  describe,
  test,
} from 'node:test';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  JiraAccessContext,
  JiraConnectionTokenService,
} from './jira-connection-token.service';
import { JiraApiService } from './jira-api.service';

const ACCESS_CONTEXT: JiraAccessContext = {
  connectionId: 'connection-1',
  userId: 'pulse-user-1',
  integrationId: 'integration-1',
  cloudId: 'cloud-id-123',
  siteUrl:
    'https://example-company.atlassian.net',
  siteName: 'Example Company',
  accessToken: 'secret-access-token',
  accessTokenExpiresAt: new Date(
    Date.now() + 60 * 60 * 1000,
  ),
};

type CapturedRequest = {
  url: string;
  init?: RequestInit;
};

describe('JiraApiService', () => {
  let service: JiraApiService;
  let capturedRequests: CapturedRequest[];
  let originalFetch: typeof globalThis.fetch;
  let accessContextCalls: Array<{
    userId: string;
    integrationId: string;
  }>;

  beforeEach(() => {
    capturedRequests = [];
    accessContextCalls = [];
    originalFetch = globalThis.fetch;

    const tokenService = {
      async getAccessContext(
        userId: string,
        integrationId: string,
      ) {
        accessContextCalls.push({
          userId,
          integrationId,
        });

        return ACCESS_CONTEXT;
      },
    } as unknown as JiraConnectionTokenService;

    service = new JiraApiService(tokenService);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test(
    'lists accessible projects through the correct Jira cloud site',
    async () => {
      globalThis.fetch = async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        capturedRequests.push({
          url: String(input),
          init,
        });

        return jsonResponse({
          startAt: 0,
          maxResults: 25,
          total: 1,
          isLast: true,
          values: [
            {
              id: '10001',
              key: 'DEV',
              name: 'Development',
              projectTypeKey: 'software',
              simplified: true,
              avatarUrls: {
                '48x48':
                  'https://example.com/project.png',
              },
            },
          ],
        });
      };

      const result = await service.listProjects({
        userId: ' pulse-user-1 ',
        jiraIntegrationId:
          ' integration-1 ',
      });

      assert.equal(
        accessContextCalls.length,
        1,
      );

      assert.deepEqual(
        accessContextCalls[0],
        {
          userId: 'pulse-user-1',
          integrationId:
            'integration-1',
        },
      );

      assert.equal(
        capturedRequests.length,
        1,
      );

      const request =
        capturedRequests[0];

      assert.match(
        request.url,
        /^https:\/\/api\.atlassian\.com\/ex\/jira\/cloud-id-123\/rest\/api\/3\/project\/search\?/,
      );

      assert.match(
        request.url,
        /maxResults=25/,
      );

      assert.equal(
        request.init?.method,
        'GET',
      );

      assert.equal(
        getAuthorizationHeader(
          request.init,
        ),
        'Bearer secret-access-token',
      );

      assert.deepEqual(result, {
        startAt: 0,
        maxResults: 25,
        total: 1,
        isLast: true,
        projects: [
          {
            id: '10001',
            key: 'DEV',
            name: 'Development',
            projectTypeKey: 'software',
            simplified: true,
            avatarUrl:
              'https://example.com/project.png',
          },
        ],
      });
    },
  );

  test(
    'normalizes project pagination and search query',
    async () => {
      globalThis.fetch = async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        capturedRequests.push({
          url: String(input),
          init,
        });

        return jsonResponse({
          startAt: 20,
          maxResults: 10,
          total: 0,
          isLast: true,
          values: [],
        });
      };

      await service.listProjects({
        userId: 'pulse-user-1',
        jiraIntegrationId:
          'integration-1',
        query: ' Team Pulse ',
        startAt: 20,
        maxResults: 10,
      });

      const requestUrl = new URL(
        capturedRequests[0].url,
      );

      assert.equal(
        requestUrl.searchParams.get(
          'query',
        ),
        'Team Pulse',
      );

      assert.equal(
        requestUrl.searchParams.get(
          'startAt',
        ),
        '20',
      );

      assert.equal(
        requestUrl.searchParams.get(
          'maxResults',
        ),
        '10',
      );

      assert.equal(
        requestUrl.searchParams.get(
          'orderBy',
        ),
        'name',
      );
    },
  );

  test(
    'searches issues using the enhanced JQL endpoint',
    async () => {
      globalThis.fetch = async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        capturedRequests.push({
          url: String(input),
          init,
        });

        return jsonResponse({
          isLast: false,
          nextPageToken: 'next-page-2',
          issues: [
            {
              id: '20001',
              key: 'DEV-7',
              fields: {
                summary:
                  'Build Jira integration',
                description: {
                  type: 'doc',
                  version: 1,
                  content: [],
                },
                status: {
                  id: '3',
                  name: 'In Progress',
                  statusCategory: {
                    key: 'indeterminate',
                    name: 'In Progress',
                    colorName: 'yellow',
                  },
                },
                issuetype: {
                  id: '10002',
                  name: 'Task',
                  iconUrl:
                    'https://example.com/task.png',
                  subtask: false,
                },
                priority: {
                  id: '2',
                  name: 'High',
                  iconUrl:
                    'https://example.com/high.png',
                },
                assignee: {
                  accountId:
                    'jira-account-1',
                  displayName:
                    'Aroob Abughoush',
                  avatarUrls: {
                    '48x48':
                      'https://example.com/aroob.png',
                  },
                },
                reporter: null,
                labels: [
                  'jira',
                  'integration',
                ],
                created:
                  '2026-08-15T09:00:00.000Z',
                updated:
                  '2026-08-16T09:00:00.000Z',
              },
            },
          ],
        });
      };

      const result =
        await service.searchIssues({
          userId: 'pulse-user-1',
          jiraIntegrationId:
            'integration-1',
          jql:
            'project = DEV ORDER BY updated DESC',
          maxResults: 20,
          nextPageToken:
            'previous-page-token',
        });

      assert.equal(
        capturedRequests.length,
        1,
      );

      const request =
        capturedRequests[0];

      assert.equal(
        request.url,
        'https://api.atlassian.com/ex/jira/cloud-id-123/rest/api/3/search/jql',
      );

      assert.equal(
        request.init?.method,
        'POST',
      );

      const body = JSON.parse(
        String(request.init?.body),
      ) as {
        jql: string;
        maxResults: number;
        nextPageToken: string;
        fields: string[];
      };

      assert.equal(
        body.jql,
        'project = DEV ORDER BY updated DESC',
      );

      assert.equal(body.maxResults, 20);

      assert.equal(
        body.nextPageToken,
        'previous-page-token',
      );

      assert.ok(
        body.fields.includes('summary'),
      );

      assert.ok(
        body.fields.includes('status'),
      );

      assert.deepEqual(result, {
        isLast: false,
        nextPageToken: 'next-page-2',
        issues: [
          {
            id: '20001',
            key: 'DEV-7',
            url:
              'https://example-company.atlassian.net/browse/DEV-7',
            summary:
              'Build Jira integration',
            description: {
              type: 'doc',
              version: 1,
              content: [],
            },
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
              iconUrl:
                'https://example.com/task.png',
              subtask: false,
            },
            priority: {
              id: '2',
              name: 'High',
              iconUrl:
                'https://example.com/high.png',
            },
            assignee: {
              accountId:
                'jira-account-1',
              displayName:
                'Aroob Abughoush',
              avatarUrl:
                'https://example.com/aroob.png',
            },
            reporter: null,
            labels: [
              'jira',
              'integration',
            ],
            createdAt:
              '2026-08-15T09:00:00.000Z',
            updatedAt:
              '2026-08-16T09:00:00.000Z',
          },
        ],
      });
    },
  );

  test(
    'gets one issue and normalizes its key',
    async () => {
      globalThis.fetch = async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        capturedRequests.push({
          url: String(input),
          init,
        });

        return jsonResponse({
          id: '30001',
          key: 'DEV-10',
          fields: {
            summary: 'Test OAuth callback',
            status: {
              id: '1',
              name: 'To Do',
              statusCategory: {
                key: 'new',
                name: 'To Do',
                colorName: 'blue-gray',
              },
            },
            issuetype: {
              id: '10001',
              name: 'Task',
              subtask: false,
            },
            labels: [],
          },
        });
      };

      const result =
        await service.getIssue(
          'pulse-user-1',
          'integration-1',
          ' dev-10 ',
        );

      assert.match(
        capturedRequests[0].url,
        /\/rest\/api\/3\/issue\/DEV-10\?/,
      );

      assert.equal(
        result.key,
        'DEV-10',
      );

      assert.equal(
        result.summary,
        'Test OAuth callback',
      );

      assert.equal(
        result.status?.name,
        'To Do',
      );
    },
  );

  test(
    'gets only transitions Jira currently allows',
    async () => {
      globalThis.fetch = async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        capturedRequests.push({
          url: String(input),
          init,
        });

        return jsonResponse({
          transitions: [
            {
              id: '21',
              name: 'Start Progress',
              to: {
                id: '3',
                name: 'In Progress',
                statusCategory: {
                  key: 'indeterminate',
                  name: 'In Progress',
                  colorName: 'yellow',
                },
              },
              hasScreen: false,
              isGlobal: false,
              isInitial: false,
              isAvailable: true,
              isConditional: false,
            },
          ],
        });
      };

      const transitions =
        await service.getIssueTransitions(
          'pulse-user-1',
          'integration-1',
          'DEV-10',
        );

      assert.equal(
        capturedRequests[0].url,
        'https://api.atlassian.com/ex/jira/cloud-id-123/rest/api/3/issue/DEV-10/transitions',
      );

      assert.deepEqual(transitions, [
        {
          id: '21',
          name: 'Start Progress',
          toStatus: {
            id: '3',
            name: 'In Progress',
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
      ]);
    },
  );

  test(
    'rejects invalid inputs before calling Jira',
    async () => {
      let fetchCalled = false;

      globalThis.fetch = async () => {
        fetchCalled = true;

        return jsonResponse({});
      };

      await assert.rejects(
        service.searchIssues({
          userId: 'pulse-user-1',
          jiraIntegrationId:
            'integration-1',
          jql: '   ',
        }),
        BadRequestException,
      );

      await assert.rejects(
        service.getIssue(
          'pulse-user-1',
          'integration-1',
          'not a valid issue key',
        ),
        BadRequestException,
      );

      await assert.rejects(
        service.listProjects({
          userId: 'pulse-user-1',
          jiraIntegrationId:
            'integration-1',
          startAt: -1,
        }),
        BadRequestException,
      );

      await assert.rejects(
        service.listProjects({
          userId: 'pulse-user-1',
          jiraIntegrationId:
            'integration-1',
          maxResults: 101,
        }),
        BadRequestException,
      );

      assert.equal(fetchCalled, false);
    },
  );

  test(
    'maps Jira authentication and permission errors safely',
    async () => {
      globalThis.fetch = async () =>
        jsonResponse(
          {
            errorMessages: [
              'Authentication required.',
            ],
          },
          401,
        );

      await assert.rejects(
        service.listProjects({
          userId: 'pulse-user-1',
          jiraIntegrationId:
            'integration-1',
        }),
        UnauthorizedException,
      );

      globalThis.fetch = async () =>
        jsonResponse(
          {
            errorMessages: [
              'You do not have permission.',
            ],
          },
          403,
        );

      await assert.rejects(
        service.listProjects({
          userId: 'pulse-user-1',
          jiraIntegrationId:
            'integration-1',
        }),
        ForbiddenException,
      );

      globalThis.fetch = async () =>
        jsonResponse(
          {
            errorMessages: [
              'Issue does not exist.',
            ],
          },
          404,
        );

      await assert.rejects(
        service.getIssue(
          'pulse-user-1',
          'integration-1',
          'DEV-404',
        ),
        NotFoundException,
      );
    },
  );

  test(
    'maps Jira rate limiting without exposing the access token',
    async () => {
      globalThis.fetch = async () =>
        jsonResponse(
          {
            errorMessages: [
              'Too many requests.',
            ],
          },
          429,
          {
            'retry-after': '30',
          },
        );

      let thrownError: unknown;

      try {
        await service.listProjects({
          userId: 'pulse-user-1',
          jiraIntegrationId:
            'integration-1',
        });
      } catch (error) {
        thrownError = error;
      }

      assert.ok(
        thrownError instanceof HttpException,
      );

      assert.equal(
        thrownError.getStatus(),
        429,
      );

      const serializedError =
        JSON.stringify(
          thrownError.getResponse(),
        );

      assert.equal(
        serializedError.includes(
          ACCESS_CONTEXT.accessToken,
        ),
        false,
      );

      assert.match(
        serializedError,
        /Jira rate limited/,
      );
    },
  );

  test(
    'maps network failures to a safe service unavailable error',
    async () => {
      globalThis.fetch = async () => {
        throw new Error(
          'Network failed with secret-access-token',
        );
      };

      let thrownError: unknown;

      try {
        await service.listProjects({
          userId: 'pulse-user-1',
          jiraIntegrationId:
            'integration-1',
        });
      } catch (error) {
        thrownError = error;
      }

      assert.ok(
        thrownError instanceof
          ServiceUnavailableException,
      );

      const serializedError =
        JSON.stringify(
          thrownError.getResponse(),
        );

      assert.equal(
        serializedError.includes(
          ACCESS_CONTEXT.accessToken,
        ),
        false,
      );

      assert.match(
        serializedError,
        /could not reach Jira/,
      );
    },
  );
});

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        'content-type':
          'application/json',
        ...headers,
      },
    },
  );
}

function getAuthorizationHeader(
  init?: RequestInit,
): string | null {
  const headers = new Headers(
    init?.headers,
  );

  return headers.get('authorization');
}