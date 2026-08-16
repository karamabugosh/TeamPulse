// backend/src/jira/jira-api.service.ts

import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  JiraAccessContext,
  JiraConnectionTokenService,
} from './jira-connection-token.service';

const ATLASSIAN_API_BASE_URL =
  'https://api.atlassian.com';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 15_000;

export type JiraProjectSummary = {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string | null;
  simplified: boolean | null;
  avatarUrl: string | null;
};

export type JiraIssueUser = {
  accountId: string | null;
  displayName: string;
  avatarUrl: string | null;
};

export type JiraIssueStatus = {
  id: string;
  name: string;
  categoryKey: string | null;
  categoryName: string | null;
  categoryColorName: string | null;
};

export type JiraIssueSummary = {
  id: string;
  key: string;
  url: string;
  summary: string;
  description: unknown;
  status: JiraIssueStatus | null;
  issueType: {
    id: string;
    name: string;
    iconUrl: string | null;
    subtask: boolean;
  } | null;
  priority: {
    id: string;
    name: string;
    iconUrl: string | null;
  } | null;
  assignee: JiraIssueUser | null;
  reporter: JiraIssueUser | null;
  labels: string[];
  createdAt: string | null;
  updatedAt: string | null;
};

export type JiraIssueTransition = {
  id: string;
  name: string;
  toStatus: JiraIssueStatus | null;
  hasScreen: boolean;
  isGlobal: boolean;
  isInitial: boolean;
  isAvailable: boolean;
  isConditional: boolean;
};

export type ListJiraProjectsInput = {
  userId: string;
  jiraIntegrationId: string;
  query?: string;
  startAt?: number;
  maxResults?: number;
};

export type ListJiraProjectsResult = {
  startAt: number;
  maxResults: number;
  total: number;
  isLast: boolean;
  projects: JiraProjectSummary[];
};

export type SearchJiraIssuesInput = {
  userId: string;
  jiraIntegrationId: string;
  jql: string;
  maxResults?: number;
  nextPageToken?: string;
};

export type SearchJiraIssuesResult = {
  isLast: boolean;
  nextPageToken: string | null;
  issues: JiraIssueSummary[];
};

type JiraProjectApiRecord = {
  id?: string;
  key?: string;
  name?: string;
  projectTypeKey?: string;
  simplified?: boolean;
  avatarUrls?: Record<string, string>;
};

type JiraProjectSearchApiResponse = {
  startAt?: number;
  maxResults?: number;
  total?: number;
  isLast?: boolean;
  values?: JiraProjectApiRecord[];
};

type JiraUserApiRecord = {
  accountId?: string;
  displayName?: string;
  avatarUrls?: Record<string, string>;
};

type JiraStatusApiRecord = {
  id?: string;
  name?: string;
  statusCategory?: {
    key?: string;
    name?: string;
    colorName?: string;
  };
};

type JiraIssueApiRecord = {
  id?: string;
  key?: string;
  fields?: {
    summary?: string;
    description?: unknown;
    status?: JiraStatusApiRecord;
    issuetype?: {
      id?: string;
      name?: string;
      iconUrl?: string;
      subtask?: boolean;
    };
    priority?: {
      id?: string;
      name?: string;
      iconUrl?: string;
    } | null;
    assignee?: JiraUserApiRecord | null;
    reporter?: JiraUserApiRecord | null;
    labels?: string[];
    created?: string;
    updated?: string;
  };
};

type JiraIssueSearchApiResponse = {
  isLast?: boolean;
  nextPageToken?: string;
  issues?: JiraIssueApiRecord[];
};

type JiraTransitionApiRecord = {
  id?: string;
  name?: string;
  to?: JiraStatusApiRecord;
  hasScreen?: boolean;
  isGlobal?: boolean;
  isInitial?: boolean;
  isAvailable?: boolean;
  isConditional?: boolean;
};

type JiraTransitionsApiResponse = {
  transitions?: JiraTransitionApiRecord[];
};

@Injectable()
export class JiraApiService {
  constructor(
    private readonly jiraConnectionTokenService:
      JiraConnectionTokenService,
  ) {}

  async listProjects(
    input: ListJiraProjectsInput,
  ): Promise<ListJiraProjectsResult> {
    const accessContext =
      await this.getAccessContext(
        input.userId,
        input.jiraIntegrationId,
      );

    const startAt = this.normalizeStartAt(
      input.startAt,
    );

    const maxResults = this.normalizeMaxResults(
      input.maxResults,
    );

    const query = input.query?.trim();

    const searchParameters =
      new URLSearchParams({
        startAt: String(startAt),
        maxResults: String(maxResults),
        orderBy: 'name',
      });

    if (query) {
      searchParameters.set('query', query);
    }

    const response =
      await this.requestJira<JiraProjectSearchApiResponse>(
        accessContext,
        `/rest/api/3/project/search?${searchParameters.toString()}`,
        {
          method: 'GET',
        },
      );

    const projects = (response.values ?? [])
      .map((project) =>
        this.mapProject(project),
      )
      .filter(
        (
          project,
        ): project is JiraProjectSummary =>
          project !== null,
      );

    return {
      startAt: response.startAt ?? startAt,
      maxResults:
        response.maxResults ?? maxResults,
      total: response.total ?? projects.length,
      isLast:
        response.isLast ??
        projects.length < maxResults,
      projects,
    };
  }

  async searchIssues(
    input: SearchJiraIssuesInput,
  ): Promise<SearchJiraIssuesResult> {
    const accessContext =
      await this.getAccessContext(
        input.userId,
        input.jiraIntegrationId,
      );

    const jql = input.jql?.trim();

    if (!jql) {
      throw new BadRequestException(
        'jql is required to search Jira issues.',
      );
    }

    if (jql.length > 10_000) {
      throw new BadRequestException(
        'jql must not exceed 10000 characters.',
      );
    }

    const maxResults = this.normalizeMaxResults(
      input.maxResults,
    );

    const nextPageToken =
      input.nextPageToken?.trim();

    const requestBody: Record<string, unknown> = {
      jql,
      maxResults,
      fields: [
        'summary',
        'description',
        'status',
        'issuetype',
        'priority',
        'assignee',
        'reporter',
        'labels',
        'created',
        'updated',
      ],
    };

    if (nextPageToken) {
      requestBody.nextPageToken = nextPageToken;
    }

    const response =
      await this.requestJira<JiraIssueSearchApiResponse>(
        accessContext,
        '/rest/api/3/search/jql',
        {
          method: 'POST',
          body: JSON.stringify(requestBody),
        },
      );

    const issues = (response.issues ?? [])
      .map((issue) =>
        this.mapIssue(
          issue,
          accessContext.siteUrl,
        ),
      )
      .filter(
        (
          issue,
        ): issue is JiraIssueSummary =>
          issue !== null,
      );

    return {
      isLast: response.isLast ?? true,
      nextPageToken:
        response.nextPageToken ?? null,
      issues,
    };
  }

  async getIssue(
    userIdInput: string,
    jiraIntegrationIdInput: string,
    issueIdOrKeyInput: string,
  ): Promise<JiraIssueSummary> {
    const accessContext =
      await this.getAccessContext(
        userIdInput,
        jiraIntegrationIdInput,
      );

    const issueIdOrKey =
      this.normalizeIssueIdOrKey(
        issueIdOrKeyInput,
      );

    const fields = [
      'summary',
      'description',
      'status',
      'issuetype',
      'priority',
      'assignee',
      'reporter',
      'labels',
      'created',
      'updated',
    ].join(',');

    const response =
      await this.requestJira<JiraIssueApiRecord>(
        accessContext,
        `/rest/api/3/issue/${encodeURIComponent(
          issueIdOrKey,
        )}?fields=${encodeURIComponent(fields)}`,
        {
          method: 'GET',
        },
      );

    const issue = this.mapIssue(
      response,
      accessContext.siteUrl,
    );

    if (!issue) {
      throw new BadGatewayException(
        'Jira returned an invalid issue response.',
      );
    }

    return issue;
  }

  async getIssueTransitions(
    userIdInput: string,
    jiraIntegrationIdInput: string,
    issueIdOrKeyInput: string,
  ): Promise<JiraIssueTransition[]> {
    const accessContext =
      await this.getAccessContext(
        userIdInput,
        jiraIntegrationIdInput,
      );

    const issueIdOrKey =
      this.normalizeIssueIdOrKey(
        issueIdOrKeyInput,
      );

    const response =
      await this.requestJira<JiraTransitionsApiResponse>(
        accessContext,
        `/rest/api/3/issue/${encodeURIComponent(
          issueIdOrKey,
        )}/transitions`,
        {
          method: 'GET',
        },
      );

    return (response.transitions ?? [])
      .map((transition) =>
        this.mapTransition(transition),
      )
      .filter(
        (
          transition,
        ): transition is JiraIssueTransition =>
          transition !== null,
      );
  }

  private async getAccessContext(
    userIdInput: string,
    jiraIntegrationIdInput: string,
  ): Promise<JiraAccessContext> {
    const userId = userIdInput?.trim();

    const jiraIntegrationId =
      jiraIntegrationIdInput?.trim();

    if (!userId) {
      throw new BadRequestException(
        'userId is required.',
      );
    }

    if (!jiraIntegrationId) {
      throw new BadRequestException(
        'jiraIntegrationId is required.',
      );
    }

    return this.jiraConnectionTokenService
      .getAccessContext(
        userId,
        jiraIntegrationId,
      );
  }

  private async requestJira<T>(
    accessContext: JiraAccessContext,
    path: string,
    requestInit: RequestInit,
  ): Promise<T> {
    const cloudId = encodeURIComponent(
      accessContext.cloudId,
    );

    const requestUrl =
      `${ATLASSIAN_API_BASE_URL}` +
      `/ex/jira/${cloudId}${path}`;

    let response: Response;

    try {
      response = await fetch(requestUrl, {
        ...requestInit,
        headers: {
          Accept: 'application/json',
          Authorization:
            `Bearer ${accessContext.accessToken}`,
          ...(requestInit.body
            ? {
                'Content-Type':
                  'application/json',
              }
            : {}),
          ...requestInit.headers,
        },
        signal: AbortSignal.timeout(
          REQUEST_TIMEOUT_MS,
        ),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'AbortError' ||
          error.name === 'TimeoutError')
      ) {
        throw new ServiceUnavailableException(
          'Jira did not respond before the request timed out.',
        );
      }

      throw new ServiceUnavailableException(
        'Pulse could not reach Jira.',
      );
    }

    if (!response.ok) {
      await this.throwJiraError(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new BadGatewayException(
        'Jira returned an invalid response.',
      );
    }
  }

  private async throwJiraError(
    response: Response,
  ): Promise<never> {
    const jiraMessage =
      await this.readSafeErrorMessage(response);

    if (response.status === 400) {
      throw new BadRequestException(
        jiraMessage ||
          'Jira rejected the request.',
      );
    }

    if (response.status === 401) {
      throw new UnauthorizedException(
        'The Jira connection is no longer authorized. Reconnect Jira and try again.',
      );
    }

    if (response.status === 403) {
      throw new ForbiddenException(
        jiraMessage ||
          'The Jira user does not have permission to perform this operation.',
      );
    }

    if (response.status === 404) {
      throw new NotFoundException(
        jiraMessage ||
          'The requested Jira resource was not found.',
      );
    }

    if (response.status === 429) {
      const retryAfter =
        response.headers.get('retry-after');

      throw new HttpException(
        {
          statusCode:
            HttpStatus.TOO_MANY_REQUESTS,
          message:
            'Jira rate limited this request. Please try again shortly.',
          retryAfterSeconds:
            retryAfter ?? null,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (response.status >= 500) {
      throw new ServiceUnavailableException(
        'Jira is temporarily unavailable.',
      );
    }

    throw new BadGatewayException(
      jiraMessage ||
        `Jira request failed with status ${response.status}.`,
    );
  }

  private async readSafeErrorMessage(
    response: Response,
  ): Promise<string | null> {
    try {
      const payload =
        (await response.json()) as {
          errorMessages?: unknown;
          errors?: unknown;
          message?: unknown;
        };

      const messages: string[] = [];

      if (
        Array.isArray(payload.errorMessages)
      ) {
        messages.push(
          ...payload.errorMessages.filter(
            (
              message,
            ): message is string =>
              typeof message === 'string',
          ),
        );
      }

      if (
        payload.errors &&
        typeof payload.errors === 'object' &&
        !Array.isArray(payload.errors)
      ) {
        messages.push(
          ...Object.values(payload.errors)
            .filter(
              (
                message,
              ): message is string =>
                typeof message === 'string',
            ),
        );
      }

      if (
        typeof payload.message === 'string'
      ) {
        messages.push(payload.message);
      }

      const safeMessage = messages
        .map((message) => message.trim())
        .filter(Boolean)
        .join(' ');

      return safeMessage || null;
    } catch {
      return null;
    }
  }

  private normalizeStartAt(
    startAtInput?: number,
  ): number {
    const startAt = startAtInput ?? 0;

    if (
      !Number.isInteger(startAt) ||
      startAt < 0
    ) {
      throw new BadRequestException(
        'startAt must be a non-negative integer.',
      );
    }

    return startAt;
  }

  private normalizeMaxResults(
    maxResultsInput?: number,
  ): number {
    const maxResults =
      maxResultsInput ?? DEFAULT_PAGE_SIZE;

    if (
      !Number.isInteger(maxResults) ||
      maxResults < 1 ||
      maxResults > MAX_PAGE_SIZE
    ) {
      throw new BadRequestException(
        `maxResults must be an integer between 1 and ${MAX_PAGE_SIZE}.`,
      );
    }

    return maxResults;
  }

  private normalizeIssueIdOrKey(
    issueIdOrKeyInput: string,
  ): string {
    const issueIdOrKey =
      issueIdOrKeyInput
        ?.trim()
        .toUpperCase();

    if (!issueIdOrKey) {
      throw new BadRequestException(
        'issueIdOrKey is required.',
      );
    }

    if (
      !/^(?:[A-Z][A-Z0-9_]*-\d+|\d+)$/.test(
        issueIdOrKey,
      )
    ) {
      throw new BadRequestException(
        'issueIdOrKey must be a valid Jira issue key or numeric ID.',
      );
    }

    return issueIdOrKey;
  }

  private mapProject(
    project: JiraProjectApiRecord,
  ): JiraProjectSummary | null {
    const id = project.id?.trim();
    const key = project.key?.trim();
    const name = project.name?.trim();

    if (!id || !key || !name) {
      return null;
    }

    return {
      id,
      key,
      name,
      projectTypeKey:
        project.projectTypeKey?.trim() ||
        null,
      simplified:
        typeof project.simplified ===
        'boolean'
          ? project.simplified
          : null,
      avatarUrl:
        this.selectAvatarUrl(
          project.avatarUrls,
        ),
    };
  }

  private mapIssue(
    issue: JiraIssueApiRecord,
    siteUrl: string,
  ): JiraIssueSummary | null {
    const id = issue.id?.trim();
    const key = issue.key?.trim();
    const summary =
      issue.fields?.summary?.trim();

    if (!id || !key || !summary) {
      return null;
    }

    const fields = issue.fields;

    return {
      id,
      key,
      url:
        `${siteUrl.replace(/\/+$/, '')}` +
        `/browse/${encodeURIComponent(key)}`,
      summary,
      description:
        fields?.description ?? null,
      status: this.mapStatus(
        fields?.status,
      ),
      issueType:
        fields?.issuetype?.id &&
        fields.issuetype.name
          ? {
              id: fields.issuetype.id,
              name:
                fields.issuetype.name,
              iconUrl:
                fields.issuetype
                  .iconUrl ?? null,
              subtask:
                fields.issuetype
                  .subtask ?? false,
            }
          : null,
      priority:
        fields?.priority?.id &&
        fields.priority.name
          ? {
              id: fields.priority.id,
              name:
                fields.priority.name,
              iconUrl:
                fields.priority.iconUrl ??
                null,
            }
          : null,
      assignee: this.mapUser(
        fields?.assignee,
      ),
      reporter: this.mapUser(
        fields?.reporter,
      ),
      labels: Array.isArray(fields?.labels)
        ? fields.labels.filter(
            (
              label,
            ): label is string =>
              typeof label === 'string',
          )
        : [],
      createdAt:
        fields?.created ?? null,
      updatedAt:
        fields?.updated ?? null,
    };
  }

  private mapTransition(
    transition: JiraTransitionApiRecord,
  ): JiraIssueTransition | null {
    const id = transition.id?.trim();
    const name = transition.name?.trim();

    if (!id || !name) {
      return null;
    }

    return {
      id,
      name,
      toStatus: this.mapStatus(
        transition.to,
      ),
      hasScreen:
        transition.hasScreen ?? false,
      isGlobal:
        transition.isGlobal ?? false,
      isInitial:
        transition.isInitial ?? false,
      isAvailable:
        transition.isAvailable ?? true,
      isConditional:
        transition.isConditional ?? false,
    };
  }

  private mapStatus(
    status?: JiraStatusApiRecord | null,
  ): JiraIssueStatus | null {
    const id = status?.id?.trim();
    const name = status?.name?.trim();

    if (!id || !name) {
      return null;
    }

    return {
      id,
      name,
      categoryKey:
        status.statusCategory?.key?.trim() ||
        null,
      categoryName:
        status.statusCategory?.name?.trim() ||
        null,
      categoryColorName:
        status.statusCategory?.colorName
          ?.trim() || null,
    };
  }

  private mapUser(
    user?: JiraUserApiRecord | null,
  ): JiraIssueUser | null {
    const displayName =
      user?.displayName?.trim();

    if (!displayName) {
      return null;
    }

    return {
      accountId:
        user?.accountId?.trim() || null,
      displayName,
      avatarUrl:
        this.selectAvatarUrl(
          user?.avatarUrls,
        ),
    };
  }

  private selectAvatarUrl(
    avatarUrls?: Record<string, string>,
  ): string | null {
    if (!avatarUrls) {
      return null;
    }

    return (
      avatarUrls['48x48'] ??
      avatarUrls['32x32'] ??
      avatarUrls['24x24'] ??
      avatarUrls['16x16'] ??
      null
    );
  }
}