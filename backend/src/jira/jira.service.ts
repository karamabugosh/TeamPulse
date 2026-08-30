import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JiraConnection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { resolveActiveWorkspaceId } from '../common/workspace-context';
import {
  getJiraEnvDiagnostics,
  readEnvVar,
} from '../config/env.config';
import {
  decryptSecret,
  encryptSecret,
  signOAuthState,
  verifyOAuthState,
} from './jira-token.crypto';
import { randomBytes } from 'crypto';
import {
  AtlassianAccessibleResource,
  AtlassianTokenResponse,
  AtlassianUserProfile,
  JiraActivityFeed,
  JiraActivityItem,
  JiraActivityType,
  JiraConnectionStatus,
  JiraIssueSummary,
  JiraProjectSummary,
  JiraSyncResult,
  JiraUserSummary,
  JiraWorkspaceMember,
} from './jira.types';
import {
  buildJiraDescriptionAdf,
  sanitizeJiraSummary,
  toFriendlyJiraErrorMessage,
} from './jira-issue-payload.util';
import { DEMO_CLOUD_ID, DEMO_SLACK_WORKSPACE_ID } from '../demo/demo.constants';

@Injectable()
export class JiraService {
  private readonly logger = new Logger(JiraService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private get clientId(): string {
    return this.requireConfig('JIRA_CLIENT_ID');
  }

  private get clientSecret(): string {
    return this.requireConfig('JIRA_CLIENT_SECRET');
  }

  private get redirectUri(): string {
    return this.requireConfig('JIRA_REDIRECT_URI');
  }

  private get authUrl(): string {
    return this.requireConfig('JIRA_AUTH_URL');
  }

  private get tokenUrl(): string {
    return this.requireConfig('JIRA_TOKEN_URL');
  }

  private get apiUrl(): string {
    return this.requireConfig('JIRA_API_URL');
  }

  private get scopes(): string {
    return (
      this.readConfig('JIRA_SCOPES') ||
      'read:jira-work write:jira-work read:jira-user offline_access'
    );
  }

  private get frontendUrl(): string {
    return this.readConfig('FRONTEND_URL') || 'http://localhost:5173';
  }

  private get tokenEncryptionKey(): string {
    return (
      this.readConfig('JIRA_TOKEN_ENCRYPTION_KEY') ||
      this.clientSecret
    );
  }

  private readConfig(key: string): string | undefined {
    return (
      this.configService.get<string>(key)?.trim() ||
      readEnvVar(key)
    );
  }

  private requireConfig(key: string): string {
    const value = this.readConfig(key);
    if (!value) {
      throw new InternalServerErrorException(`${key} is not configured`);
    }
    return value;
  }

  getConfigDiagnostics() {
    return getJiraEnvDiagnostics();
  }

  private async resolveWorkspace(preferredWorkspaceId?: string | null) {
    const workspaceId = await resolveActiveWorkspaceId(
      this.prisma,
      preferredWorkspaceId,
    );
    if (!workspaceId) {
      throw new NotFoundException(
        'No workspace found. Connect Slack first so Pulse has a workspace record.',
      );
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (!workspace) {
      throw new NotFoundException(
        'No workspace found. Connect Slack first so Pulse has a workspace record.',
      );
    }

    return workspace;
  }

  async resolveUserIdFromSlack(slackUserId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { slackUserId },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  /**
   * Resolves which Pulse user id should act against Jira for a Slack user.
   * Prefers the Slack user's own connection, then falls back to any connection
   * in the same workspace (dashboard OAuth on first workspace user).
   */
  async resolveJiraActingUserId(slackUserId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { slackUserId },
      select: { id: true, workspaceId: true },
    });

    if (!user) {
      return null;
    }

    if (await this.hasUserConnection(user.id)) {
      return user.id;
    }

    const workspaceConnection = await this.prisma.jiraConnection.findFirst({
      where: { workspaceId: user.workspaceId },
      orderBy: { connectedAt: 'desc' },
    });

    return workspaceConnection?.userId ?? null;
  }

  async hasJiraForSlackUser(slackUserId: string): Promise<boolean> {
    const actingUserId = await this.resolveJiraActingUserId(slackUserId);
    return actingUserId !== null;
  }

  private async resolveOAuthUserId(params: {
    workspaceId: string;
    userId?: string;
    slackUserId?: string;
  }): Promise<string> {
    if (params.userId) {
      return params.userId;
    }

    if (params.slackUserId) {
      const user = await this.prisma.user.findUnique({
        where: { slackUserId: params.slackUserId },
      });
      if (user && user.workspaceId === params.workspaceId) {
        return user.id;
      }
    }

    const fallbackUser = await this.prisma.user.findFirst({
      where: { workspaceId: params.workspaceId },
      orderBy: { createdAt: 'asc' },
    });

    if (!fallbackUser) {
      throw new NotFoundException(
        'No Pulse user found for this workspace. Use Slack first so a user record exists.',
      );
    }

    return fallbackUser.id;
  }

  async buildAuthorizationRedirectUrl(options?: {
    slackUserId?: string;
    userId?: string;
    /** Explicit workspace from UI — required when browser navigation cannot send X-Workspace-Id. */
    workspaceId?: string;
  }): Promise<string> {
    const workspace = await this.resolveWorkspace(options?.workspaceId);
    const userId = await this.resolveOAuthUserId({
      workspaceId: workspace.id,
      userId: options?.userId,
      slackUserId: options?.slackUserId,
    });
    const nonce = randomNonce();
    const payload = Buffer.from(
      JSON.stringify({
        workspaceId: workspace.id,
        userId,
        nonce,
        exp: Date.now() + 10 * 60 * 1000,
      }),
    ).toString('base64url');
    const state = signOAuthState(payload, this.clientSecret);

    this.logger.log(
      `[JiraOAuth] start workspaceId=${workspace.id} slackWorkspaceId=${workspace.slackWorkspaceId} userId=${userId} name="${workspace.slackWorkspaceName}"`,
    );

    const params = new URLSearchParams({
      audience: 'api.atlassian.com',
      client_id: this.clientId,
      scope: this.scopes,
      redirect_uri: this.redirectUri,
      state,
      response_type: 'code',
      prompt: 'consent',
    });

    return `${this.authUrl}?${params.toString()}`;
  }

  async handleOAuthCallback(code: string, state: string): Promise<string> {
    if (!code?.trim()) {
      throw new BadRequestException('Missing authorization code');
    }

    const payload = verifyOAuthState(state, this.clientSecret);
    if (!payload) {
      throw new BadRequestException('Invalid OAuth state');
    }

    let parsed: { workspaceId?: string; userId?: string; exp?: number };
    try {
      parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid OAuth state payload');
    }

    if (!parsed.workspaceId || !parsed.exp || parsed.exp < Date.now()) {
      throw new BadRequestException('OAuth state expired or invalid');
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: parsed.workspaceId },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found for OAuth callback');
    }

    const userId = await this.resolveOAuthUserId({
      workspaceId: workspace.id,
      userId: parsed.userId,
    });

    const tokenResponse = await this.exchangeAuthorizationCode(code);
    const accessToken = tokenResponse.access_token;
    const refreshToken = tokenResponse.refresh_token ?? null;
    const expiresAt = tokenResponse.expires_in
      ? new Date(Date.now() + tokenResponse.expires_in * 1000)
      : null;

    const resources = await this.fetchAccessibleResources(accessToken);
    const jiraResource = this.selectJiraResource(resources);

    if (!jiraResource) {
      throw new BadRequestException(
        'No accessible Jira site was returned for this Atlassian account',
      );
    }

    const profile = await this.fetchAtlassianUserProfile(
      accessToken,
      jiraResource.id,
    );

    const encryptedAccessToken = encryptSecret(
      accessToken,
      this.tokenEncryptionKey,
    );
    const encryptedRefreshToken = refreshToken
      ? encryptSecret(refreshToken, this.tokenEncryptionKey)
      : null;

    const now = new Date();

    await this.prisma.jiraConnection.upsert({
      where: { userId },
      create: {
        userId,
        workspaceId: workspace.id,
        cloudId: jiraResource.id,
        siteName: jiraResource.name,
        siteUrl: jiraResource.url,
        atlassianAccountId: profile.accountId,
        atlassianDisplayName: profile.displayName,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt,
        scopes: tokenResponse.scope ?? this.scopes,
        connectedAt: now,
        lastSyncAt: now,
      },
      update: {
        workspaceId: workspace.id,
        cloudId: jiraResource.id,
        siteName: jiraResource.name,
        siteUrl: jiraResource.url,
        atlassianAccountId: profile.accountId,
        atlassianDisplayName: profile.displayName,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt,
        scopes: tokenResponse.scope ?? this.scopes,
        lastSyncAt: now,
      },
    });

    this.logger.log(
      `[JiraOAuth] connected workspaceId=${workspace.id} slackWorkspaceId=${workspace.slackWorkspaceId} userId=${userId} cloudId=${jiraResource.id} site="${jiraResource.name}" account=${profile.displayName}`,
    );

    return `${this.frontendUrl}/jira?jira=connected`;
  }

  /**
   * Resolve the live (non-demo) Jira OAuth row for a specific Pulse workspace.
   * Never falls back to another workspace's connection.
   */
  async findLiveConnectionForWorkspace(workspaceId: string) {
    return this.prisma.jiraConnection.findFirst({
      where: {
        workspaceId,
        cloudId: { not: DEMO_CLOUD_ID },
        NOT: {
          OR: [
            { accessToken: { contains: 'demo-access-token' } },
            { accessToken: { contains: 'placeholder' } },
            { cloudId: { contains: 'demo-cloud' } },
          ],
        },
        accessToken: { not: '' },
      },
      orderBy: { connectedAt: 'desc' },
    });
  }

  async getConnectionStatus(userId?: string): Promise<JiraConnectionStatus> {
    let connection = userId
      ? await this.prisma.jiraConnection.findUnique({
          where: { userId },
        })
      : null;

    if (!connection) {
      const workspace = await this.resolveWorkspace();
      connection = await this.prisma.jiraConnection.findFirst({
        where: { workspaceId: workspace.id },
        orderBy: { connectedAt: 'desc' },
      });
    }

    if (!connection) {
      return { connected: false };
    }

    return {
      connected: true,
      atlassianDisplayName: connection.atlassianDisplayName,
      siteName: connection.siteName,
      siteUrl: connection.siteUrl,
      lastSyncAt: connection.lastSyncAt.toISOString(),
      connectedAt: connection.connectedAt.toISOString(),
      tokenExpiresAt: connection.expiresAt?.toISOString() ?? null,
    };
  }

  async disconnect(userId?: string): Promise<{ disconnected: true }> {
    if (userId) {
      await this.prisma.jiraConnection.deleteMany({ where: { userId } });
      this.logger.log(`Jira disconnected for user ${userId}`);
      return { disconnected: true };
    }

    const workspace = await this.resolveWorkspace();
    await this.prisma.jiraConnection.deleteMany({
      where: { workspaceId: workspace.id },
    });

    this.logger.log(`Jira disconnected for workspace ${workspace.id}`);
    return { disconnected: true };
  }

  async hasUserConnection(userId: string): Promise<boolean> {
    const count = await this.prisma.jiraConnection.count({ where: { userId } });
    return count > 0;
  }

  getFrontendErrorRedirect(message: string): string {
    const params = new URLSearchParams({
      jira: 'error',
      message,
    });
    return `${this.frontendUrl}/jira?${params.toString()}`;
  }

  private async exchangeAuthorizationCode(
    code: string,
  ): Promise<AtlassianTokenResponse> {
    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: this.redirectUri,
      }),
    });

    const body = (await response.json().catch(() => null)) as
      | AtlassianTokenResponse
      | { error?: string; error_description?: string }
      | null;

    if (!response.ok || !body || !('access_token' in body)) {
      const errorMessage =
        (body && 'error_description' in body && body.error_description) ||
        (body && 'error' in body && body.error) ||
        `Token exchange failed (${response.status})`;
      this.logger.error(`Jira token exchange failed: ${errorMessage}`);
      throw new BadRequestException(String(errorMessage));
    }

    return body;
  }

  private async fetchAccessibleResources(
    accessToken: string,
  ): Promise<AtlassianAccessibleResource[]> {
    const response = await fetch(
      `${this.apiUrl}/oauth/token/accessible-resources`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) {
      throw new BadRequestException(
        `Failed to load accessible Jira resources (${response.status})`,
      );
    }

    return (await response.json()) as AtlassianAccessibleResource[];
  }

  private selectJiraResource(
    resources: AtlassianAccessibleResource[],
  ): AtlassianAccessibleResource | null {
    const jiraResources = resources.filter((resource) =>
      resource.scopes.some((scope) => scope.includes('jira')),
    );

    return jiraResources[0] ?? resources[0] ?? null;
  }

  private async fetchAtlassianUserProfile(
    accessToken: string,
    cloudId: string,
  ): Promise<AtlassianUserProfile> {
    const response = await fetch(
      `${this.apiUrl}/ex/jira/${cloudId}/rest/api/3/myself`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      },
    );

    if (!response.ok) {
      throw new BadRequestException(
        `Failed to load Atlassian user profile (${response.status})`,
      );
    }

    return (await response.json()) as AtlassianUserProfile;
  }

  async getDecryptedAccessToken(userId: string): Promise<string | null> {
    const connection = await this.prisma.jiraConnection.findUnique({
      where: { userId },
    });

    if (!connection) {
      return null;
    }

    return decryptSecret(connection.accessToken, this.tokenEncryptionKey);
  }

  async getCurrentJiraUser(): Promise<JiraUserSummary> {
    const profile = await this.callJiraApi<AtlassianUserProfile>(
      '/rest/api/3/myself',
    );

    return {
      accountId: profile.accountId,
      displayName: profile.displayName,
      emailAddress: profile.emailAddress ?? null,
      active: true,
    };
  }

  async getProjects(): Promise<{ total: number; projects: JiraProjectSummary[] }> {
    const response = await this.callJiraApi<{
      total?: number;
      values?: Array<{
        id: string;
        key: string;
        name: string;
        projectTypeKey?: string;
        simplified?: boolean;
        style?: string;
      }>;
    }>('/rest/api/3/project/search?maxResults=50');

    const projects = (response.values ?? []).map((project) => ({
      id: project.id,
      key: project.key,
      name: project.name,
      projectTypeKey: project.projectTypeKey ?? null,
      simplified: project.simplified,
      style: project.style ?? null,
    }));

    return {
      total: response.total ?? projects.length,
      projects,
    };
  }

  async getIssues(maxResults = 20): Promise<{
    total: number;
    issues: JiraIssueSummary[];
  }> {
    const projects = await this.getProjects();
    const projectKeys = projects.projects.map((project) => project.key);

    if (projectKeys.length === 0) {
      return { total: 0, issues: [] };
    }

    const jql = `project in (${projectKeys.map((key) => `"${key}"`).join(', ')}) AND statusCategory != Done ORDER BY updated DESC`;

    return this.searchIssues(jql, maxResults);
  }

  async getMyIssues(maxResults = 20): Promise<{
    total: number;
    issues: JiraIssueSummary[];
  }> {
    return this.searchIssues(
      'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC',
      maxResults,
    );
  }

  async searchIssuesByQuery(
    query: string,
    maxResults = 20,
  ): Promise<{ total: number; issues: JiraIssueSummary[] }> {
    const trimmed = query.trim();
    const projects = await this.getProjects();
    const projectKeys = projects.projects.map((project) => project.key);
    const projectClause =
      projectKeys.length > 0
        ? `project in (${projectKeys.map((key) => `"${key}"`).join(', ')}) AND `
        : '';

    if (!trimmed) {
      return this.getIssues(maxResults);
    }

    if (/^[A-Z][A-Z0-9]+-\d+$/i.test(trimmed)) {
      return this.searchIssues(
        `${projectClause}key = "${trimmed.toUpperCase()}"`,
        maxResults,
      );
    }

    const escaped = trimmed.replace(/"/g, '\\"');
    return this.searchIssues(
      `${projectClause}statusCategory != Done AND (summary ~ "${escaped}" OR text ~ "${escaped}") ORDER BY updated DESC`,
      maxResults,
    );
  }

  /**
   * Recent Jira activity from live issue changelogs (newest first).
   * Never fabricates events — empty when changelog is unavailable.
   */
  async getRecentActivity(params?: {
    days?: number;
    maxIssues?: number;
    limit?: number;
  }): Promise<JiraActivityFeed> {
    const days = Math.min(Math.max(params?.days ?? 30, 1), 90);
    const maxIssues = Math.min(Math.max(params?.maxIssues ?? 25, 1), 40);
    const limit = Math.min(Math.max(params?.limit ?? 80, 1), 200);

    const connection = await this.requireConnectionRecord().catch(() => null);
    if (!connection) {
      return {
        available: false,
        message: 'No recent Jira activity available.',
        activities: [],
        total: 0,
        fetchedIssueCount: 0,
      };
    }

    try {
      const projects = await this.getProjectsForConnection(connection);
      const projectKeys = projects.projects.map((project) => project.key);
      if (projectKeys.length === 0) {
        return {
          available: false,
          message: 'No recent Jira activity available.',
          activities: [],
          total: 0,
          fetchedIssueCount: 0,
        };
      }

      const jql = `project in (${projectKeys
        .map((key) => `"${key}"`)
        .join(', ')}) AND updated >= -${days}d ORDER BY updated DESC`;

      const searched = await this.searchIssuesRaw(jql, maxIssues, connection);
      const activities: JiraActivityItem[] = [];

      const batchSize = 5;
      for (let i = 0; i < searched.issues.length; i += batchSize) {
        const batch = searched.issues.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map((issue) =>
            this.fetchIssueChangelogActivities(issue, connection),
          ),
        );
        for (const items of results) {
          activities.push(...items);
        }
      }

      activities.sort(
        (a, b) =>
          new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
      );

      const sliced = activities.slice(0, limit);

      if (sliced.length === 0) {
        return {
          available: false,
          message: 'No recent Jira activity available.',
          activities: [],
          total: 0,
          fetchedIssueCount: searched.issues.length,
        };
      }

      return {
        available: true,
        message: null,
        activities: sliced,
        total: activities.length,
        fetchedIssueCount: searched.issues.length,
      };
    } catch (error: unknown) {
      this.logger.warn(
        `Jira recent activity unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        available: false,
        message: 'No recent Jira activity available.',
        activities: [],
        total: 0,
        fetchedIssueCount: 0,
      };
    }
  }

  /**
   * Live changelog timeline for one issue (oldest → newest).
   * Returns empty when Jira is disconnected or the issue/changelog is unavailable.
   */
  async getIssueActivityTimeline(issueKey: string): Promise<{
    available: boolean;
    message: string | null;
    activities: JiraActivityItem[];
  }> {
    const key = issueKey.trim().toUpperCase();
    if (!key) {
      return {
        available: false,
        message: 'Issue key is required.',
        activities: [],
      };
    }

    const connection = await this.requireConnectionRecord().catch(() => null);
    if (!connection) {
      return {
        available: false,
        message: 'Jira is not connected for this workspace.',
        activities: [],
      };
    }

    try {
      const searched = await this.searchIssuesRaw(
        `key = ${key}`,
        1,
        connection,
      );
      const issue = searched.issues[0];
      if (!issue) {
        return {
          available: false,
          message: `No Jira issue found for ${key}.`,
          activities: [],
        };
      }

      const activities = await this.fetchIssueChangelogActivities(
        issue,
        connection,
      );
      activities.sort(
        (a, b) =>
          new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
      );

      if (activities.length === 0) {
        return {
          available: false,
          message: `No changelog activity available for ${key}.`,
          activities: [],
        };
      }

      return {
        available: true,
        message: null,
        activities,
      };
    } catch (error: unknown) {
      this.logger.warn(
        `Jira issue timeline unavailable for ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        available: false,
        message: `Jira changelog unavailable for ${key}.`,
        activities: [],
      };
    }
  }

  private async searchIssuesRaw(
    jql: string,
    maxResults: number,
    connection: JiraConnection,
  ): Promise<{
    issues: Array<{
      id: string;
      key: string;
      fields?: {
        summary?: string;
        created?: string;
        updated?: string;
        status?: { name?: string };
        creator?: { displayName?: string };
        project?: { key?: string; name?: string };
      };
    }>;
  }> {
    const safeMaxResults = Math.min(Math.max(maxResults, 1), 50);
    const response = await this.callJiraApi<{
      issues?: Array<{
        id: string;
        key: string;
        fields?: {
          summary?: string;
          created?: string;
          updated?: string;
          status?: { name?: string };
          creator?: { displayName?: string };
          project?: { key?: string; name?: string };
        };
      }>;
    }>(
      '/rest/api/3/search/jql',
      {
        method: 'POST',
        body: JSON.stringify({
          jql,
          maxResults: safeMaxResults,
          fields: ['summary', 'created', 'updated', 'status', 'creator', 'project'],
        }),
      },
      connection,
    );

    return { issues: response.issues ?? [] };
  }

  private async fetchIssueChangelogActivities(
    issue: {
      id: string;
      key: string;
      fields?: {
        summary?: string;
        created?: string;
        creator?: { displayName?: string };
        project?: { key?: string; name?: string };
      };
    },
    connection: JiraConnection,
  ): Promise<JiraActivityItem[]> {
    const summary = issue.fields?.summary ?? 'Untitled issue';
    const projectKey = issue.fields?.project?.key ?? null;
    const projectName = issue.fields?.project?.name ?? null;
    const issueUrl = connection.siteUrl
      ? `${connection.siteUrl.replace(/\/$/, '')}/browse/${issue.key}`
      : null;

    const detail = await this.callJiraApi<{
      fields?: {
        created?: string;
        creator?: { displayName?: string };
      };
      changelog?: {
        histories?: Array<{
          id: string;
          created: string;
          author?: { displayName?: string };
          items?: Array<{
            field?: string;
            fieldId?: string;
            fromString?: string | null;
            toString?: string | null;
          }>;
        }>;
      };
    }>(
      `/rest/api/3/issue/${encodeURIComponent(issue.key)}?expand=changelog`,
      { method: 'GET' },
      connection,
    );

    const activities: JiraActivityItem[] = [];
    const histories = detail.changelog?.histories ?? [];

    for (const history of histories) {
      const author = history.author?.displayName ?? null;
      const occurredAt = history.created;
      for (const [index, item] of (history.items ?? []).entries()) {
        const mapped = mapChangelogItemToActivity(item);
        if (!mapped) continue;

        activities.push({
          id: `${issue.key}-${history.id}-${index}-${mapped.activityType}`,
          issueKey: issue.key,
          summary,
          activityType: mapped.activityType,
          previousValue: mapped.previousValue,
          newValue: mapped.newValue,
          author,
          occurredAt,
          projectKey,
          projectName,
          issueUrl,
        });
      }
    }

    const createdAt = detail.fields?.created ?? issue.fields?.created;
    if (createdAt) {
      const hasCreated = activities.some((a) => a.activityType === 'Created');
      if (!hasCreated) {
        activities.push({
          id: `${issue.key}-created`,
          issueKey: issue.key,
          summary,
          activityType: 'Created',
          previousValue: null,
          newValue: summary,
          author:
            detail.fields?.creator?.displayName ??
            issue.fields?.creator?.displayName ??
            null,
          occurredAt: createdAt,
          projectKey,
          projectName,
          issueUrl,
        });
      }
    }

    return activities;
  }

  async getConnectedUserId(): Promise<string | null> {
    const connection = await this.requireConnectionRecord().catch(() => null);
    return connection?.userId ?? null;
  }

  async syncConnection(): Promise<JiraSyncResult> {
    const user = await this.getCurrentJiraUser();
    const projects = await this.getProjects();
    const myIssues = await this.getMyIssues(10);
    const updatedConnection = await this.requireConnectionRecord();

    this.logger.log(
      `Jira sync completed for workspace ${updatedConnection.workspaceId}: ${projects.projects.length} project(s), ${myIssues.issues.length} assigned issue(s)`,
    );

    return {
      synced: true,
      lastSyncAt: updatedConnection.lastSyncAt.toISOString(),
      checked: {
        user: Boolean(user.accountId),
        projects: projects.projects.length,
        myIssues: myIssues.issues.length,
      },
    };
  }

  /**
   * Find a real (non-Demo) Jira OAuth connection to use as the member template source.
   * Never returns Demo Workspace fake connections.
   */
  async findRealJiraConnection(): Promise<JiraConnection | null> {
    return this.prisma.jiraConnection.findFirst({
      where: {
        cloudId: { not: DEMO_CLOUD_ID },
        NOT: {
          OR: [
            { accessToken: { contains: 'demo-access-token' } },
            { workspace: { slackWorkspaceId: DEMO_SLACK_WORKSPACE_ID } },
          ],
        },
      },
      orderBy: { connectedAt: 'desc' },
    });
  }

  /**
   * Read-only: list human users visible in the connected Jira site.
   * Uses /users/search with assignee fallback. Never writes to Jira.
   */
  async listWorkspaceMembers(options?: {
    connection?: JiraConnection;
    maxResults?: number;
  }): Promise<JiraWorkspaceMember[]> {
    const connection =
      options?.connection ??
      (await this.findRealJiraConnection()) ??
      (await this.requireConnectionRecord().catch(() => null));

    if (!connection) {
      throw new NotFoundException(
        'No real Jira connection found. Connect Jira on a non-Demo workspace first.',
      );
    }

    if (
      connection.cloudId === DEMO_CLOUD_ID ||
      connection.accessToken.includes('demo-access-token')
    ) {
      throw new BadRequestException(
        'Refusing to list members from Demo Workspace fake Jira credentials.',
      );
    }

    const maxResults = Math.min(Math.max(options?.maxResults ?? 100, 1), 200);
    const byAccountId = new Map<string, JiraWorkspaceMember>();

    const merge = (member: JiraWorkspaceMember) => {
      if (!member.accountId || !member.displayName?.trim()) return;
      const accountType = (member.accountType ?? '').toLowerCase();
      if (accountType === 'app' || accountType === 'customer') return;
      const name = member.displayName.trim();
      if (/^addon[_/]/i.test(name) || /^jira\b/i.test(name)) return;
      const existing = byAccountId.get(member.accountId);
      if (!existing || (member.emailAddress && !existing.emailAddress)) {
        byAccountId.set(member.accountId, {
          ...existing,
          ...member,
          displayName: name,
          active: member.active !== false,
        });
      }
    };

    // Primary: paginated users/search (read:jira-user)
    try {
      let startAt = 0;
      while (startAt < maxResults) {
        const pageSize = Math.min(50, maxResults - startAt);
        const page = await this.callJiraApi<
          Array<{
            accountId?: string;
            displayName?: string;
            emailAddress?: string;
            active?: boolean;
            accountType?: string;
            avatarUrls?: { '48x48'?: string };
          }>
        >(
          `/rest/api/3/users/search?startAt=${startAt}&maxResults=${pageSize}`,
          {},
          connection,
        );

        if (!Array.isArray(page) || page.length === 0) break;
        for (const row of page) {
          merge({
            accountId: row.accountId ?? '',
            displayName: row.displayName ?? '',
            emailAddress: row.emailAddress ?? null,
            avatarUrl: row.avatarUrls?.['48x48'] ?? null,
            active: row.active !== false,
            accountType: row.accountType ?? null,
          });
        }
        if (page.length < pageSize) break;
        startAt += page.length;
      }
    } catch (error) {
      this.logger.warn(
        `Jira users/search unavailable; falling back to assignees + myself. ${
          error instanceof Error ? error.message : error
        }`,
      );
    }

    // Fallback / enrichment: unique assignees on recent visible issues
    if (byAccountId.size < 2) {
      try {
        const { projects } = await this.getProjectsForConnection(connection);
        const jql =
          projects.length > 0
            ? `project in (${projects
                .slice(0, 10)
                .map((project) => `"${project.key.replace(/"/g, '\\"')}"`)
                .join(', ')}) ORDER BY updated DESC`
            : 'ORDER BY updated DESC';
        const searched = await this.searchIssues(jql, 50, connection);
        for (const issue of searched.issues) {
          if (issue.assigneeAccountId && issue.assignee) {
            merge({
              accountId: issue.assigneeAccountId,
              displayName: issue.assignee,
              emailAddress: null,
              avatarUrl: null,
              active: true,
              accountType: 'atlassian',
            });
          }
        }
      } catch (error) {
        this.logger.warn(
          `Jira assignee fallback failed: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
    }

    // Always include the connected Atlassian user
    if (connection.atlassianAccountId && connection.atlassianDisplayName) {
      merge({
        accountId: connection.atlassianAccountId,
        displayName: connection.atlassianDisplayName,
        emailAddress: null,
        avatarUrl: null,
        active: true,
        accountType: 'atlassian',
      });
    }

    const members = Array.from(byAccountId.values())
      .filter((m) => m.active)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    if (members.length === 0) {
      throw new NotFoundException(
        'No human Jira users found on the connected site.',
      );
    }

    this.logger.log(
      `Listed ${members.length} Jira workspace member(s) from cloudId=${connection.cloudId}`,
    );
    return members;
  }

  private async searchIssues(
    jql: string,
    maxResults: number,
    connection?: JiraConnection,
  ): Promise<{ total: number; issues: JiraIssueSummary[] }> {
    const activeConnection =
      connection ?? (await this.requireConnectionRecord());
    const safeMaxResults = Number.isFinite(maxResults)
      ? Math.min(Math.max(maxResults, 1), 50)
      : 20;
    const searchPath = '/rest/api/3/search/jql';
    const requestUrl = `${this.apiUrl}/ex/jira/${activeConnection.cloudId}${searchPath}`;

    this.logger.log(
      `[JiraSearch] userId=${activeConnection.userId} workspaceId=${activeConnection.workspaceId} cloudId=${activeConnection.cloudId} accessToken=yes jql="${jql}" url=${requestUrl} maxResults=${safeMaxResults}`,
    );

    const response = await this.callJiraApi<{
      isLast?: boolean;
      nextPageToken?: string;
      totalIssueCount?: number;
      issues?: Array<{
        id: string;
        key: string;
        fields?: {
          summary?: string;
          updated?: string;
          status?: { name?: string };
          issuetype?: { name?: string };
          assignee?: { displayName?: string; accountId?: string };
          project?: { key?: string; name?: string };
          priority?: { name?: string };
        };
      }>;
    }>(searchPath, {
      method: 'POST',
      body: JSON.stringify({
        jql,
        maxResults: safeMaxResults,
        fields: [
          'summary',
          'status',
          'issuetype',
          'assignee',
          'project',
          'priority',
          'updated',
        ],
      }),
    }, activeConnection);

    const issues = (response.issues ?? []).map((issue) =>
      this.mapIssueSummary(issue, activeConnection.siteUrl),
    );

    this.logger.log(
      `[JiraSearch] response issues=${issues.length} total=${response.totalIssueCount ?? issues.length}`,
    );

    return {
      total: response.totalIssueCount ?? issues.length,
      issues,
    };
  }

  /**
   * Read-only: paginated issue list for Demo Workspace generation.
   * Returns real keys, summaries, statuses, assignees — never invents issues.
   */
  async listIssuesForDemoGeneration(options?: {
    connection?: JiraConnection;
    maxIssues?: number;
  }): Promise<{
    siteUrl: string;
    projects: Array<{ key: string; name: string }>;
    issues: JiraIssueSummary[];
  }> {
    const connection =
      options?.connection ??
      (await this.findRealJiraConnection()) ??
      (await this.requireConnectionRecord().catch(() => null));

    if (!connection) {
      throw new NotFoundException(
        'No real Jira connection found for Demo issue generation.',
      );
    }
    if (
      connection.cloudId === DEMO_CLOUD_ID ||
      connection.accessToken.includes('demo-access-token')
    ) {
      throw new BadRequestException(
        'Refusing to list issues from Demo Workspace fake Jira credentials.',
      );
    }

    const maxIssues = Math.min(Math.max(options?.maxIssues ?? 100, 1), 200);
    const { projects } = await this.getProjectsForConnection(connection);
    const projectKeys = projects.slice(0, 15).map((p) => p.key);
    const jql =
      projectKeys.length > 0
        ? `project in (${projectKeys
            .map((k) => `"${k.replace(/"/g, '\\"')}"`)
            .join(', ')}) ORDER BY updated DESC`
        : 'ORDER BY updated DESC';

    const collected: JiraIssueSummary[] = [];
    let nextPageToken: string | undefined;
    let pages = 0;
    const maxPages = Math.ceil(maxIssues / 50);

    while (collected.length < maxIssues && pages < maxPages) {
      pages += 1;
      const pageSize = Math.min(50, maxIssues - collected.length);
      const body: Record<string, unknown> = {
        jql,
        maxResults: pageSize,
        fields: [
          'summary',
          'status',
          'issuetype',
          'assignee',
          'project',
          'priority',
          'updated',
          'reporter',
          'labels',
          'components',
        ],
      };
      if (nextPageToken) body.nextPageToken = nextPageToken;

      const response = await this.callJiraApi<{
        isLast?: boolean;
        nextPageToken?: string;
        issues?: Array<{
          id: string;
          key: string;
          fields?: {
            summary?: string;
            updated?: string;
            status?: { name?: string };
            issuetype?: { name?: string };
            assignee?: { displayName?: string; accountId?: string };
            project?: { key?: string; name?: string };
            priority?: { name?: string };
          };
        }>;
      }>(
        '/rest/api/3/search/jql',
        { method: 'POST', body: JSON.stringify(body) },
        connection,
      );

      const page = (response.issues ?? []).map((issue) =>
        this.mapIssueSummary(issue, connection.siteUrl),
      );
      collected.push(...page);

      if (response.isLast === true || !response.nextPageToken || page.length === 0) {
        break;
      }
      nextPageToken = response.nextPageToken;
    }

    // Deterministic order for stable fingerprints / seeds
    collected.sort((a, b) => a.key.localeCompare(b.key));

    this.logger.log(
      `Demo generation listed ${collected.length} Live Jira issue(s) from ${projectKeys.length} project(s)`,
    );

    return {
      siteUrl: connection.siteUrl,
      projects: projects.map((p) => ({ key: p.key, name: p.name })),
      issues: collected,
    };
  }

  private mapIssueSummary(
    issue: {
      id: string;
      key: string;
      fields?: {
        summary?: string;
        updated?: string;
        status?: { name?: string };
        issuetype?: { name?: string };
        assignee?: { displayName?: string; accountId?: string };
        reporter?: { displayName?: string; accountId?: string };
        project?: { key?: string; name?: string };
        priority?: { name?: string };
        labels?: string[];
        components?: Array<{ name?: string }>;
        duedate?: string | null;
        resolution?: { name?: string } | null;
        fixVersions?: Array<{ name?: string }>;
      };
    },
    siteUrl: string,
  ): JiraIssueSummary {
    const fields = issue.fields ?? {};
    const fixVersion = fields.fixVersions?.[0]?.name ?? null;

    return {
      id: issue.id,
      key: issue.key,
      summary: fields.summary ?? 'Untitled issue',
      status: fields.status?.name ?? null,
      issueType: fields.issuetype?.name ?? null,
      assignee: fields.assignee?.displayName ?? null,
      assigneeAccountId: fields.assignee?.accountId ?? null,
      reporter: fields.reporter?.displayName ?? null,
      projectKey: fields.project?.key ?? null,
      projectName: fields.project?.name ?? null,
      priority: fields.priority?.name ?? null,
      updatedAt: fields.updated ?? null,
      issueUrl: siteUrl
        ? `${siteUrl.replace(/\/$/, '')}/browse/${issue.key}`
        : null,
      labels: fields.labels ?? [],
      components: (fields.components ?? [])
        .map((c) => c.name)
        .filter(Boolean) as string[],
      dueDate: fields.duedate ?? null,
      resolution: fields.resolution?.name ?? null,
      sprint: fixVersion,
    };
  }

  private async requireConnectionRecord(userId?: string): Promise<JiraConnection> {
    if (userId) {
      const connection = await this.prisma.jiraConnection.findUnique({
        where: { userId },
      });
      if (!connection) {
        throw new NotFoundException(
          'Jira is not connected for this user. Connect Jira first.',
        );
      }
      return connection;
    }

    const workspace = await this.resolveWorkspace();
    const connection = await this.prisma.jiraConnection.findFirst({
      where: { workspaceId: workspace.id },
      orderBy: { connectedAt: 'desc' },
    });

    if (!connection) {
      throw new NotFoundException(
        'Jira is not connected for this workspace. Connect Jira first.',
      );
    }

    return connection;
  }

  async getMyIssuesForUser(userId: string, maxResults = 20) {
    return this.withUserConnection(userId, (connection) =>
      this.searchIssues(
        'assignee = currentUser() ORDER BY updated DESC',
        maxResults,
        connection,
      ),
    );
  }

  async getProjectsForUser(userId: string) {
    return this.withUserConnection(userId, (connection) =>
      this.getProjectsForConnection(connection),
    );
  }

  async getVisibleIssuesForUser(userId: string, maxResults = 50) {
    return this.withUserConnection(userId, async (connection) => {
      const { projects } = await this.getProjectsForConnection(connection);
      const jql =
        projects.length > 0
          ? `project in (${projects
              .map((project) => `"${project.key.replace(/"/g, '\\"')}"`)
              .join(', ')}) ORDER BY updated DESC`
          : 'ORDER BY updated DESC';

      this.logger.log(
        `[JiraVisibleIssues] userId=${userId} workspaceId=${connection.workspaceId} cloudId=${connection.cloudId} jql="${jql}"`,
      );

      const result = await this.searchIssues(jql, maxResults, connection);

      for (const issue of result.issues) {
        this.logger.log(
          `[JiraVisibleIssues] ${issue.key} | ${issue.summary} | ${issue.status ?? '—'} | ${issue.projectKey ?? '—'}`,
        );
      }

      return result;
    });
  }

  async getActiveVisibleIssuesForUser(userId: string, maxResults = 50) {
    return this.withUserConnection(userId, async (connection) => {
      const { projects } = await this.getProjectsForConnection(connection);
      const jql =
        projects.length > 0
          ? `project in (${projects
              .map((project) => `"${project.key.replace(/"/g, '\\"')}"`)
              .join(', ')}) AND statusCategory != Done ORDER BY updated DESC`
          : 'statusCategory != Done ORDER BY updated DESC';

      this.logger.log(
        `[JiraActiveIssues] userId=${userId} workspaceId=${connection.workspaceId} cloudId=${connection.cloudId} jql="${jql}"`,
      );

      return this.searchIssues(jql, maxResults, connection);
    });
  }

  async getCurrentJiraUserForUser(userId: string): Promise<JiraUserSummary> {
    return this.withUserConnection(userId, async (connection) => {
      const profile = await this.callJiraApi<AtlassianUserProfile>(
        '/rest/api/3/myself',
        {},
        connection,
      );
      return {
        accountId: profile.accountId,
        displayName: profile.displayName,
        emailAddress: profile.emailAddress ?? null,
        active: true,
      };
    });
  }

  async logOAuthDiagnostics(userId: string): Promise<void> {
    const connection = await this.prisma.jiraConnection.findUnique({
      where: { userId },
    });

    if (!connection) {
      this.logger.warn(`[JiraOAuth] userId=${userId} — no JiraConnection record`);
      return;
    }

    this.logger.log(
      `[JiraOAuth] userId=${userId} workspaceId=${connection.workspaceId} cloudId=${connection.cloudId ?? 'MISSING'} accountId=${connection.atlassianAccountId ?? 'MISSING'} accessToken=${connection.accessToken ? 'yes' : 'MISSING'} refreshToken=${connection.refreshToken ? 'yes' : 'MISSING'}`,
    );
  }

  async searchIssuesForUser(
    userId: string,
    jql: string,
    maxResults = 20,
  ) {
    return this.withUserConnection(userId, (connection) =>
      this.searchIssues(jql, maxResults, connection),
    );
  }

  /**
   * Search issues assigned to one or more people (by Jira accountId or display name).
   */
  async searchIssuesByAssignee(params: {
    userId: string;
    displayNames: string[];
    accountIds: string[];
    maxResults?: number;
  }) {
    const clauses: string[] = [];
    for (const id of params.accountIds) {
      const trimmed = id?.trim();
      if (trimmed) clauses.push(`assignee = "${trimmed.replace(/"/g, '\\"')}"`);
    }
    for (const name of params.displayNames) {
      const trimmed = name?.trim();
      if (trimmed) {
        clauses.push(`assignee = "${trimmed.replace(/"/g, '\\"')}"`);
      }
    }
    if (clauses.length === 0) {
      return { total: 0, issues: [] as Awaited<ReturnType<JiraService['getIssues']>>['issues'] };
    }
    const jql = `(${clauses.join(' OR ')}) ORDER BY updated DESC`;
    return this.searchIssuesForUser(
      params.userId,
      jql,
      params.maxResults ?? 50,
    );
  }

  async lookupIssueForUser(userId: string, issueKey: string) {
    return this.withUserConnection(userId, async (connection) => {
      const fields = [
        'summary',
        'status',
        'issuetype',
        'project',
        'priority',
        'updated',
        'assignee',
        'reporter',
        'labels',
        'components',
        'duedate',
        'resolution',
        'fixVersions',
      ].join(',');
      const response = await this.callJiraApi<{
        id?: string;
        key?: string;
        fields?: {
          summary?: string;
          status?: { name?: string };
          issuetype?: { name?: string };
          project?: { key?: string; name?: string };
          priority?: { name?: string };
          updated?: string;
          assignee?: { displayName?: string; accountId?: string };
          reporter?: { displayName?: string; accountId?: string };
          labels?: string[];
          components?: Array<{ name?: string }>;
          duedate?: string | null;
          resolution?: { name?: string } | null;
          fixVersions?: Array<{ name?: string }>;
        };
      }>(
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${fields}`,
        {},
        connection,
      );

      if (!response.key || !response.id) {
        return null;
      }

      const summary = this.mapIssueSummary(
        {
          id: response.id,
          key: response.key,
          fields: response.fields,
        },
        connection.siteUrl,
      );

      this.logger.log(
        `[JiraLookup] ${summary.key} status=${summary.status ?? '(none)'} summary=${summary.summary} assignee=${summary.assignee ?? '(none)'} priority=${summary.priority ?? '(none)'} reporter=${summary.reporter ?? '(none)'} resolution=${summary.resolution ?? '(none)'}`,
      );

      return {
        ...this.summaryToSnapshot(summary),
        assigneeName: summary.assignee,
        assigneeAccountId: summary.assigneeAccountId,
        reporterName: summary.reporter ?? null,
        labels: summary.labels,
        components: summary.components,
        dueDate: summary.dueDate,
        resolution: summary.resolution,
        sprint: summary.sprint,
      };
    });
  }

  async addCommentForUser(
    userId: string,
    issueKey: string,
    commentBody: string,
  ): Promise<Record<string, unknown>> {
    return this.withUserConnection(userId, async (connection) => {
      const result = await this.callJiraApi<{ id?: string }>(
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`,
        {
          method: 'POST',
          body: JSON.stringify({
            body: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: commentBody }],
                },
              ],
            },
          }),
        },
        connection,
      );
      return {
        issueKey,
        commentId: result.id ?? null,
        issueUrl: `${connection.siteUrl.replace(/\/$/, '')}/browse/${issueKey}`,
      };
    });
  }

  async createIssueForUser(
    userId: string,
    params: {
      summary: string;
      description: string;
      projectKey?: string;
    },
  ): Promise<Record<string, unknown>> {
    return this.withUserConnection(userId, async (connection) => {
      const projectKey =
        params.projectKey ??
        (await this.getProjectsForConnection(connection)).projects[0]?.key;

      if (!projectKey) {
        throw new BadRequestException('No valid Jira project was available.');
      }

      // Jira rejects summaries that contain newline characters.
      const summary = sanitizeJiraSummary(params.summary);
      const descriptionDoc = buildJiraDescriptionAdf(params.description ?? '');

      const created = await this.callJiraApi<{ id?: string; key?: string }>(
        '/rest/api/3/issue',
        {
          method: 'POST',
          body: JSON.stringify({
            fields: {
              project: { key: projectKey },
              summary,
              description: descriptionDoc,
              issuetype: { name: 'Task' },
            },
          }),
        },
        connection,
      );

      const issueKey = created.key ?? null;
      return {
        issueId: created.id ?? null,
        issueKey,
        issueUrl: issueKey
          ? `${connection.siteUrl.replace(/\/$/, '')}/browse/${issueKey}`
          : null,
        projectKey,
      };
    });
  }

  private async withUserConnection<T>(
    userId: string,
    handler: (connection: JiraConnection) => Promise<T>,
  ): Promise<T> {
    const connection = await this.requireConnectionRecord(userId);
    return handler(connection);
  }

  private async getProjectsForConnection(connection: JiraConnection) {
    const response = await this.callJiraApi<{
      total?: number;
      values?: Array<{ id: string; key: string; name: string }>;
    }>('/rest/api/3/project/search?maxResults=50', {}, connection);

    return {
      total: response.total ?? response.values?.length ?? 0,
      projects: (response.values ?? []).map((project) => ({
        id: project.id,
        key: project.key,
        name: project.name,
        projectTypeKey: null,
        simplified: undefined,
        style: null,
      })),
    };
  }

  private async callJiraApi<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST';
      body?: string;
      retryOnUnauthorized?: boolean;
    } = {},
    connection?: JiraConnection,
  ): Promise<T> {
    const activeConnection =
      connection ?? (await this.requireConnectionRecord());
    const accessToken = await this.ensureValidAccessToken(activeConnection);
    const url = `${this.apiUrl}/ex/jira/${activeConnection.cloudId}${path.startsWith('/') ? path : `/${path}`}`;

    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body,
    });

    if (response.status === 401 && options.retryOnUnauthorized !== false) {
      const refreshed = await this.refreshAccessToken(activeConnection);
      if (refreshed) {
        return this.callJiraApi<T>(
          path,
          {
            ...options,
            retryOnUnauthorized: false,
          },
          activeConnection,
        );
      }

      throw new UnauthorizedException(
        'Jira access token expired and could not be refreshed. Reconnect Jira.',
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      this.logger.error(
        `Jira API request failed (${response.status}) for ${path}: ${errorBody}`,
      );
      const friendly = toFriendlyJiraErrorMessage(errorBody);
      throw new BadRequestException(friendly);
    }

    await this.markSynced(activeConnection.id);

    if (response.status === 204) {
      return {} as T;
    }

    return (await response.json()) as T;
  }

  private async ensureValidAccessToken(
    connection: JiraConnection,
  ): Promise<string> {
    const expiresSoon =
      connection.expiresAt &&
      connection.expiresAt.getTime() <= Date.now() + 60_000;

    if (!expiresSoon) {
      return decryptSecret(connection.accessToken, this.tokenEncryptionKey);
    }

    if (!connection.refreshToken) {
      return decryptSecret(connection.accessToken, this.tokenEncryptionKey);
    }

    const refreshed = await this.refreshAccessToken(connection);
    if (!refreshed) {
      throw new UnauthorizedException(
        'Jira access token expired and refresh token is unavailable. Reconnect Jira.',
      );
    }

    return refreshed;
  }

  private async refreshAccessToken(
    connection: JiraConnection,
  ): Promise<string | null> {
    if (!connection.refreshToken) {
      this.logger.warn(
        `Jira refresh token missing for workspace ${connection.workspaceId}`,
      );
      return null;
    }

    const refreshToken = decryptSecret(
      connection.refreshToken,
      this.tokenEncryptionKey,
    );

    const response = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
      }),
    });

    const body = (await response.json().catch(() => null)) as
      | AtlassianTokenResponse
      | { error?: string; error_description?: string }
      | null;

    if (!response.ok || !body || !('access_token' in body)) {
      const errorMessage =
        (body && 'error_description' in body && body.error_description) ||
        (body && 'error' in body && body.error) ||
        `Refresh failed (${response.status})`;
      this.logger.error(`Jira token refresh failed: ${errorMessage}`);
      return null;
    }

    const encryptedAccessToken = encryptSecret(
      body.access_token,
      this.tokenEncryptionKey,
    );
    const encryptedRefreshToken = body.refresh_token
      ? encryptSecret(body.refresh_token, this.tokenEncryptionKey)
      : connection.refreshToken;
    const expiresAt = body.expires_in
      ? new Date(Date.now() + body.expires_in * 1000)
      : null;

    await this.prisma.jiraConnection.update({
      where: { id: connection.id },
      data: {
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt,
        scopes: body.scope ?? connection.scopes,
      },
    });

    this.logger.log(
      `Refreshed Jira access token for workspace ${connection.workspaceId}`,
    );

    return body.access_token;
  }

  private summaryToSnapshot(summary: JiraIssueSummary) {
    return {
      type: 'issue_ref' as const,
      issueKey: summary.key,
      issueId: summary.id,
      summary: summary.summary,
      status: summary.status,
      projectKey: summary.projectKey,
      projectName: summary.projectName,
      issueType: summary.issueType,
      priority: summary.priority,
      issueUrl: summary.issueUrl,
      capturedAt: summary.updatedAt ?? new Date().toISOString(),
    };
  }

  private async markSynced(connectionId: string): Promise<void> {
    await this.prisma.jiraConnection.update({
      where: { id: connectionId },
      data: { lastSyncAt: new Date() },
    });
  }
}

function mapChangelogItemToActivity(item: {
  field?: string;
  fieldId?: string;
  fromString?: string | null;
  toString?: string | null;
}): {
  activityType: JiraActivityType;
  previousValue: string | null;
  newValue: string | null;
} | null {
  const field = (item.field ?? '').trim().toLowerCase();
  const fieldId = (item.fieldId ?? '').trim().toLowerCase();
  const previousValue = normalizeActivityValue(item.fromString);
  const newValue = normalizeActivityValue(item.toString);

  if (field === 'status') {
    const to = (newValue ?? '').toLowerCase();
    const from = (previousValue ?? '').toLowerCase();
    if (
      to.includes('done') ||
      to.includes('resolved') ||
      to.includes('closed') ||
      to.includes('complete')
    ) {
      return { activityType: 'Resolved', previousValue, newValue };
    }
    if (
      from.includes('done') ||
      from.includes('resolved') ||
      from.includes('closed') ||
      from.includes('complete')
    ) {
      return { activityType: 'Reopened', previousValue, newValue };
    }
    return { activityType: 'Status Changed', previousValue, newValue };
  }

  if (field === 'assignee') {
    return { activityType: 'Assigned', previousValue, newValue };
  }

  if (field === 'priority') {
    return { activityType: 'Priority Changed', previousValue, newValue };
  }

  if (field === 'comment' || field === 'commentbody') {
    return { activityType: 'Comment Added', previousValue, newValue };
  }

  if (field === 'labels' || field === 'label') {
    return { activityType: 'Label Added', previousValue, newValue };
  }

  if (
    field === 'sprint' ||
    fieldId.includes('sprint') ||
    field.includes('sprint')
  ) {
    return { activityType: 'Sprint Changed', previousValue, newValue };
  }

  return null;
}

function normalizeActivityValue(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function randomNonce(): string {
  return randomBytes(16).toString('hex');
}
