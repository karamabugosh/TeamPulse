import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JiraAuditService } from './jira-audit.service';
import {
  JiraIssueSnapshot,
  formatIssueRefDisplay,
  parseIssueRefPayload,
} from './jira-issue-ref.types';
import { JiraCacheService } from './jira-cache.service';
import { JiraService } from './jira.service';

@Injectable()
export class JiraIssueRefService {
  private readonly logger = new Logger(JiraIssueRefService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jiraService: JiraService,
    private readonly jiraCacheService: JiraCacheService,
    private readonly jiraAuditService: JiraAuditService,
  ) {}

  buildSnapshotFromPickerValue(rawValue: string): JiraIssueSnapshot | null {
    return parseIssueRefPayload(rawValue);
  }

  async buildSnapshotFromIssueKey(
    userId: string,
    issueKey: string,
  ): Promise<JiraIssueSnapshot | null> {
    const resolved = await this.jiraCacheService.resolveIssueKeysForUser(
      userId,
      [issueKey.toUpperCase()],
    );
    return resolved[0] ?? null;
  }

  formatAnswerText(snapshot: JiraIssueSnapshot): string {
    return formatIssueRefDisplay(snapshot);
  }

  async enrichFreeTextAnswer(params: {
    userId: string;
    text: string;
  }): Promise<{
    text: string;
    structuredValue: JiraIssueSnapshot | null;
  }> {
    const keys = [...new Set(
      (params.text.match(/\b([A-Z][A-Z0-9]+-\d+)\b/g) ?? []).map((k) =>
        k.toUpperCase(),
      ),
    )];

    if (keys.length !== 1) {
      return { text: params.text, structuredValue: null };
    }

    const snapshot = await this.buildSnapshotFromIssueKey(
      params.userId,
      keys[0],
    );

    if (!snapshot) {
      return { text: params.text, structuredValue: null };
    }

    return {
      text: params.text,
      structuredValue: snapshot,
    };
  }

  async getEnrichedDisplayForAnswer(answer: {
    text: string;
    structuredValue: unknown;
  }): Promise<string> {
    const snapshot =
      this.readSnapshotFromStructuredValue(answer.structuredValue) ??
      parseIssueRefPayload(answer.text);

    if (snapshot) {
      return formatIssueRefDisplay(snapshot);
    }

    return answer.text;
  }

  readSnapshotFromStructuredValue(
    structuredValue: unknown,
  ): JiraIssueSnapshot | null {
    if (!structuredValue || typeof structuredValue !== 'object') {
      return null;
    }

    const value = structuredValue as Partial<JiraIssueSnapshot>;
    if (value.type === 'issue_ref' && value.issueKey && value.summary) {
      return {
        type: 'issue_ref',
        issueKey: value.issueKey,
        issueId: value.issueId ?? value.issueKey,
        summary: value.summary,
        status: value.status ?? null,
        projectKey: value.projectKey ?? null,
        projectName: value.projectName ?? null,
        issueType: value.issueType ?? null,
        priority: value.priority ?? null,
        issueUrl: value.issueUrl ?? null,
        capturedAt: value.capturedAt ?? new Date().toISOString(),
      };
    }

    return null;
  }
}
