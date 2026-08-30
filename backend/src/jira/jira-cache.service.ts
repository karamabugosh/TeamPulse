import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { PrismaService } from '../prisma/prisma.service';

import { JiraService } from './jira.service';

import {

  JiraIssuePickerOption,

  JiraIssueSnapshot,

  parseIssueRefPayload,

} from './jira-issue-ref.types';
import { WORKSPACE_KNOWLEDGE_CHANGED } from '../ai/workspace/retrieval/knowledge-events';



@Injectable()

export class JiraCacheService {

  private readonly logger = new Logger(JiraCacheService.name);



  constructor(

    private readonly prisma: PrismaService,

    private readonly jiraService: JiraService,

    private readonly events: EventEmitter2,

  ) {}



  async upsertFromSnapshot(
    userId: string,
    snapshot: JiraIssueSnapshot,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { workspaceId: true },
    });
    if (!user?.workspaceId) {
      this.logger.warn(
        `Jira cache upsert skipped — user ${userId} has no workspace`,
      );
      return;
    }

    const issueKey = snapshot.issueKey.trim().toUpperCase();

    await this.prisma.jiraIssueCacheEntry.upsert({
      where: {
        workspaceId_issueKey: {
          workspaceId: user.workspaceId,
          issueKey,
        },
      },
      create: {
        workspaceId: user.workspaceId,
        userId,
        issueKey,
        issueId: snapshot.issueId,
        summary: snapshot.summary,
        status: snapshot.status,
        projectKey: snapshot.projectKey,
        projectName: snapshot.projectName,
        issueType: snapshot.issueType,
        priority: snapshot.priority,
        issueUrl: snapshot.issueUrl,
        jiraUpdatedAt: snapshot.capturedAt
          ? new Date(snapshot.capturedAt)
          : null,
        ...(snapshot.assigneeName !== undefined
          ? { assigneeName: snapshot.assigneeName }
          : {}),
        ...(snapshot.assigneeAccountId !== undefined
          ? { assigneeAccountId: snapshot.assigneeAccountId }
          : {}),
      },
      update: {
        // Keep a single workspace row; record who last refreshed it.
        userId,
        issueId: snapshot.issueId,
        summary: snapshot.summary,
        status: snapshot.status,
        projectKey: snapshot.projectKey,
        projectName: snapshot.projectName,
        issueType: snapshot.issueType,
        priority: snapshot.priority,
        issueUrl: snapshot.issueUrl,
        jiraUpdatedAt: snapshot.capturedAt
          ? new Date(snapshot.capturedAt)
          : null,
        refreshedAt: new Date(),
        ...(snapshot.assigneeName !== undefined
          ? { assigneeName: snapshot.assigneeName }
          : {}),
        ...(snapshot.assigneeAccountId !== undefined
          ? { assigneeAccountId: snapshot.assigneeAccountId }
          : {}),
      },
    });

    this.events.emit(WORKSPACE_KNOWLEDGE_CHANGED, {
      workspaceId: user.workspaceId,
      reason: `jira_cache:${issueKey}`,
    });
  }



  async searchCachedIssues(
    userId: string,
    query: string,
    limit = 20,
  ): Promise<JiraIssuePickerOption[]> {
    const normalized = query.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { workspaceId: true },
    });
    if (!user?.workspaceId) return [];

    const entries = await this.prisma.jiraIssueCacheEntry.findMany({
      where: {
        workspaceId: user.workspaceId,
        ...(normalized
          ? {
              OR: [
                { issueKey: { contains: normalized, mode: 'insensitive' } },
                { summary: { contains: normalized, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ refreshedAt: 'desc' }],
      take: limit,
    });

    return entries.map((entry) => ({
      issueKey: entry.issueKey,
      issueId: entry.issueId,
      summary: entry.summary,
      status: entry.status,
      projectKey: entry.projectKey,
      issueUrl: entry.issueUrl,
    }));
  }



  async refreshUserCache(userId: string): Promise<number> {

    try {

      const visibleIssues = await this.jiraService.getVisibleIssuesForUser(

        userId,

        50,

      );



      for (const issue of visibleIssues.issues) {

        await this.upsertFromSnapshot(userId, {

          type: 'issue_ref',

          issueKey: issue.key,

          issueId: issue.id,

          summary: issue.summary,

          status: issue.status,

          projectKey: issue.projectKey,

          projectName: issue.projectName,

          issueType: issue.issueType,

          priority: issue.priority,

          issueUrl: issue.issueUrl,

          capturedAt: issue.updatedAt ?? new Date().toISOString(),

        });

      }



      this.logger.log(

        `[JiraPicker] cache refreshed userId=${userId} issues=${visibleIssues.issues.length}`,

      );



      return visibleIssues.issues.length;

    } catch (error: unknown) {

      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`Jira cache refresh failed for user ${userId}: ${message}`);

      return 0;

    }

  }



  async resolveIssueKeysForUser(
    userId: string,
    keys: string[],
  ): Promise<JiraIssueSnapshot[]> {
    const snapshots: JiraIssueSnapshot[] = [];
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { workspaceId: true },
    });
    if (!user?.workspaceId) return snapshots;

    for (const rawKey of keys) {
      const issueKey = rawKey.trim().toUpperCase();

      const cached = await this.prisma.jiraIssueCacheEntry.findUnique({
        where: {
          workspaceId_issueKey: {
            workspaceId: user.workspaceId,
            issueKey,
          },
        },
      });

      if (cached) {
        snapshots.push({
          type: 'issue_ref',
          issueKey: cached.issueKey,
          issueId: cached.issueId,
          summary: cached.summary,
          status: cached.status,
          projectKey: cached.projectKey,
          projectName: cached.projectName,
          issueType: cached.issueType,
          priority: cached.priority,
          issueUrl: cached.issueUrl,
          capturedAt: cached.refreshedAt.toISOString(),
          assigneeName: cached.assigneeName,
          assigneeAccountId: cached.assigneeAccountId,
        });
        continue;
      }

      try {
        const live = await this.jiraService.lookupIssueForUser(userId, issueKey);

        if (live) {
          await this.upsertFromSnapshot(userId, live);
          snapshots.push(live);
        }
      } catch {
        // Graceful degradation — skip unresolved keys
      }
    }

    return snapshots;
  }

  async resolvePickerValue(

    userId: string,

    rawValue: string,

  ): Promise<JiraIssueSnapshot | null> {

    const fromJson = parseIssueRefPayload(rawValue);

    if (fromJson) {

      return fromJson;

    }



    const issueKey = rawValue.trim().toUpperCase();

    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(issueKey)) {

      return null;

    }



    const resolved = await this.resolveIssueKeysForUser(userId, [issueKey]);

    return resolved[0] ?? null;

  }



  private async buildVisibleIssuesJql(userId: string): Promise<string> {

    const { projects } = await this.jiraService.getProjectsForUser(userId);



    if (projects.length === 0) {

      return 'ORDER BY updated DESC';

    }



    const projectKeys = projects

      .map((project) => `"${project.key.replace(/"/g, '\\"')}"`)

      .join(', ');



    return `project in (${projectKeys}) ORDER BY updated DESC`;

  }



  async searchPickerOptions(

    userId: string,

    query: string,

  ): Promise<JiraIssuePickerOption[]> {

    const normalizedQuery = query.trim();



    this.logger.log(

      `[JiraPicker] searchPickerOptions userId=${userId} query="${normalizedQuery}"`,

    );



    const cached = await this.searchCachedIssues(userId, normalizedQuery, 20);

    if (cached.length > 0) {

      this.logger.log(`[JiraPicker] cache hit count=${cached.length}`);

      return cached;

    }



    this.logger.log('[JiraPicker] cache miss — fetching live issues from Jira');



    try {

      const jql = normalizedQuery

        ? `text ~ "${normalizedQuery.replace(/"/g, '\\"')}" ORDER BY updated DESC`

        : await this.buildVisibleIssuesJql(userId);



      this.logger.log(`[JiraPicker] live JQL="${jql}"`);



      const live = await this.jiraService.searchIssuesForUser(

        userId,

        jql,

        20,

      );



      for (const issue of live.issues) {

        await this.upsertFromSnapshot(userId, {

          type: 'issue_ref',

          issueKey: issue.key,

          issueId: issue.id,

          summary: issue.summary,

          status: issue.status,

          projectKey: issue.projectKey,

          projectName: issue.projectName,

          issueType: issue.issueType,

          priority: issue.priority,

          issueUrl: issue.issueUrl,

          capturedAt: issue.updatedAt ?? new Date().toISOString(),

        });



        this.logger.log(

          `[JiraPicker] ${issue.key} | ${issue.summary} | ${issue.status ?? '—'} | ${issue.projectKey ?? '—'}`,

        );

      }



      return live.issues.map((issue) => ({

        issueKey: issue.key,

        issueId: issue.id,

        summary: issue.summary,

        status: issue.status,

        projectKey: issue.projectKey,

        issueUrl: issue.issueUrl,

      }));

    } catch (error: unknown) {

      const message = error instanceof Error ? error.message : String(error);

      this.logger.warn(`[JiraPicker] live fetch failed: ${message}`);

      return cached;

    }

  }

}

