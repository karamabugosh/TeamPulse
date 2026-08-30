import { Injectable, Logger } from '@nestjs/common';
import { JiraService } from './jira.service';
import {
  JiraIssuePickerOption,
  JiraIssueSnapshot,
  parseIssueRefPayload,
} from './jira-issue-ref.types';
import { JiraIssueSummary } from './jira.types';

export type LiveJiraPickerIssue = JiraIssuePickerOption & {
  assignee: string | null;
  assigneeAccountId: string | null;
  updatedAt: string | null;
  issueType: string | null;
  projectName: string | null;
  priority: string | null;
};

export type LiveJiraPickerResult = {
  issues: LiveJiraPickerIssue[];
  fromCache: boolean;
  error: string | null;
};

type CacheEntry = {
  fetchedAt: number;
  issues: LiveJiraPickerIssue[];
  accountId: string | null;
};

const DONE_STATUS_PATTERN =
  /\b(done|closed|resolved|complete|cancelled|canceled)\b/i;

@Injectable()
export class JiraIssuePickerService {
  private readonly logger = new Logger(JiraIssuePickerService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private static readonly TTL_MS = 60_000;

  constructor(private readonly jiraService: JiraService) {}

  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  async getPickerIssues(
    userId: string,
    options: {
      query?: string;
      forceRefresh?: boolean;
      limit?: number;
    } = {},
  ): Promise<LiveJiraPickerResult> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 50);
    const query = options.query?.trim() ?? '';

    try {
      const bundle = await this.loadActiveIssues(userId, options.forceRefresh === true);
      const filtered = this.filterIssues(bundle.issues, query);
      const sorted = this.sortIssues(filtered, bundle.accountId);

      return {
        issues: sorted.slice(0, limit),
        fromCache: bundle.fromCache,
        error: null,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[JiraPicker] live fetch failed userId=${userId}: ${message}`);
      return {
        issues: [],
        fromCache: false,
        error: 'Unable to load Jira issues.',
      };
    }
  }

  async resolveSelectedIssue(
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

    const cached = this.cache.get(userId);
    const fromMemory = cached?.issues.find(
      (issue) => issue.issueKey.toUpperCase() === issueKey,
    );
    if (fromMemory) {
      return this.toSnapshot(fromMemory);
    }

    const live = await this.jiraService.lookupIssueForUser(userId, issueKey);
    return live;
  }

  toSnapshot(issue: LiveJiraPickerIssue): JiraIssueSnapshot {
    return {
      type: 'issue_ref',
      issueKey: issue.issueKey,
      issueId: issue.issueId,
      summary: issue.summary,
      status: issue.status,
      projectKey: issue.projectKey,
      projectName: issue.projectName,
      issueType: issue.issueType,
      priority: issue.priority,
      issueUrl: issue.issueUrl,
      capturedAt: issue.updatedAt ?? new Date().toISOString(),
    };
  }

  formatSlackOptionText(issue: LiveJiraPickerIssue): string {
    return issue.issueKey.slice(0, 75);
  }

  formatSlackOptionDescription(issue: LiveJiraPickerIssue): string {
    const summary = issue.summary.trim() || 'Untitled issue';
    const status = issue.status?.trim() || 'Unknown';
    return `${summary} · ${status}`.slice(0, 75);
  }

  private async loadActiveIssues(
    userId: string,
    forceRefresh: boolean,
  ): Promise<{
    issues: LiveJiraPickerIssue[];
    accountId: string | null;
    fromCache: boolean;
  }> {
    const now = Date.now();
    const existing = this.cache.get(userId);
    if (
      !forceRefresh &&
      existing &&
      now - existing.fetchedAt < JiraIssuePickerService.TTL_MS
    ) {
      return {
        issues: existing.issues,
        accountId: existing.accountId,
        fromCache: true,
      };
    }

    this.logger.log(
      `[JiraPicker] fetching live issues from Jira userId=${userId} forceRefresh=${forceRefresh}`,
    );

    const accountId =
      (await this.jiraService.getCurrentJiraUserForUser(userId).catch(() => null))
        ?.accountId ?? null;

    const live = await this.jiraService.getActiveVisibleIssuesForUser(userId, 50);
    const issues = live.issues
      .map((issue) => this.mapSummary(issue))
      .filter((issue) => this.isActiveIssue(issue));

    this.cache.set(userId, {
      fetchedAt: now,
      issues,
      accountId,
    });

    this.logger.log(
      `[JiraPicker] live fetch complete userId=${userId} activeIssues=${issues.length}`,
    );

    return { issues, accountId, fromCache: false };
  }

  private mapSummary(issue: JiraIssueSummary): LiveJiraPickerIssue {
    return {
      issueKey: issue.key,
      issueId: issue.id,
      summary: issue.summary,
      status: issue.status,
      projectKey: issue.projectKey,
      projectName: issue.projectName,
      issueUrl: issue.issueUrl,
      assignee: issue.assignee,
      assigneeAccountId: issue.assigneeAccountId ?? null,
      updatedAt: issue.updatedAt,
      issueType: issue.issueType,
      priority: issue.priority,
    };
  }

  private isActiveIssue(issue: LiveJiraPickerIssue): boolean {
    if (!issue.status) {
      return true;
    }
    return !DONE_STATUS_PATTERN.test(issue.status);
  }

  private filterIssues(
    issues: LiveJiraPickerIssue[],
    query: string,
  ): LiveJiraPickerIssue[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return issues;
    }

    const tokens = normalized.split(/\s+/).filter(Boolean);
    return issues.filter((issue) => {
      const haystack = `${issue.issueKey} ${issue.summary}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }

  private sortIssues(
    issues: LiveJiraPickerIssue[],
    currentAccountId: string | null,
  ): LiveJiraPickerIssue[] {
    return [...issues].sort((a, b) => {
      const aMine =
        !!currentAccountId && a.assigneeAccountId === currentAccountId ? 0 : 1;
      const bMine =
        !!currentAccountId && b.assigneeAccountId === currentAccountId ? 0 : 1;
      if (aMine !== bMine) {
        return aMine - bMine;
      }

      const aUpdated = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const bUpdated = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      if (aUpdated !== bUpdated) {
        return bUpdated - aUpdated;
      }

      return a.issueKey.localeCompare(b.issueKey);
    });
  }
}
