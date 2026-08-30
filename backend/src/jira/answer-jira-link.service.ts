import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JiraIssueSnapshot, parseIssueRefPayload } from './jira-issue-ref.types';
import { TeamMemoryService } from './team-memory.service';

export type LinkedJiraIssueDto = {
  id: string;
  issueId: string;
  issueKey: string;
  summary: string;
  status: string | null;
  assigneeName: string | null;
  projectKey: string | null;
  issueUrl: string | null;
  runId: string | null;
  cloudId: string | null;
  capturedAt: string;
};

@Injectable()
export class AnswerJiraLinkService {
  private readonly logger = new Logger(AnswerJiraLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly teamMemoryService: TeamMemoryService,
  ) {}

  parsePickerValues(rawValues: string[]): JiraIssueSnapshot[] {
    const snapshots: JiraIssueSnapshot[] = [];

    for (const raw of rawValues) {
      const snapshot = parseIssueRefPayload(raw);
      if (snapshot) {
        snapshots.push(snapshot);
      }
    }

    return snapshots;
  }

  async linkIssueToQuestion(params: {
    userId: string;
    submissionId: string;
    questionId: string;
    answerId?: string | null;
    runId?: string | null;
    cloudId?: string | null;
    issue: JiraIssueSnapshot;
  }): Promise<LinkedJiraIssueDto> {
    const submission = await this.prisma.standupSubmission.findUnique({
      where: { id: params.submissionId },
      select: { runId: true },
    });

    const connection = await this.prisma.jiraConnection.findUnique({
      where: { userId: params.userId },
      select: { cloudId: true },
    });

    const runId = params.runId ?? submission?.runId ?? null;
    const cloudId = params.cloudId ?? connection?.cloudId ?? null;

    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { workspaceId: true },
    });
    if (!user?.workspaceId) {
      throw new Error(
        `Cannot link Jira issue — user ${params.userId} has no workspace`,
      );
    }

    const cached = await this.prisma.jiraIssueCacheEntry.findUnique({
      where: {
        workspaceId_issueKey: {
          workspaceId: user.workspaceId,
          issueKey: params.issue.issueKey.trim().toUpperCase(),
        },
      },
      select: { assigneeName: true },
    });

    const link = await this.prisma.answerJiraIssueLink.upsert({
      where: {
        submissionId_questionId_issueKey: {
          submissionId: params.submissionId,
          questionId: params.questionId,
          issueKey: params.issue.issueKey,
        },
      },
      create: {
        workspaceId: user.workspaceId,
        userId: params.userId,
        submissionId: params.submissionId,
        runId,
        questionId: params.questionId,
        answerId: params.answerId ?? null,
        issueId: params.issue.issueId,
        issueKey: params.issue.issueKey,
        summary: params.issue.summary,
        status: params.issue.status,
        assigneeName: cached?.assigneeName ?? null,
        projectKey: params.issue.projectKey,
        issueUrl: params.issue.issueUrl,
        cloudId,
        capturedAt: params.issue.capturedAt
          ? new Date(params.issue.capturedAt)
          : new Date(),
      },
      update: {
        answerId: params.answerId ?? undefined,
        runId,
        cloudId,
        issueId: params.issue.issueId,
        summary: params.issue.summary,
        status: params.issue.status,
        assigneeName: cached?.assigneeName ?? null,
        projectKey: params.issue.projectKey,
        issueUrl: params.issue.issueUrl,
        capturedAt: params.issue.capturedAt
          ? new Date(params.issue.capturedAt)
          : new Date(),
      },
    });

    await this.teamMemoryService.indexJiraLink(link.id).catch((error: unknown) => {
      this.logger.warn(
        `Failed to index Jira link ${link.id} for team memory: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });

    return this.toDto(link);
  }

  async replaceLinksForQuestion(params: {
    userId: string;
    submissionId: string;
    questionId: string;
    answerId?: string | null;
    issues: JiraIssueSnapshot[];
  }): Promise<LinkedJiraIssueDto[]> {
    const { userId, submissionId, questionId, answerId, issues } = params;

    await this.prisma.answerJiraIssueLink.deleteMany({
      where: {
        submissionId,
        questionId,
        issueKey: {
          notIn: issues.map((issue) => issue.issueKey),
        },
      },
    });

    const saved: LinkedJiraIssueDto[] = [];

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { workspaceId: true },
    });
    if (!user?.workspaceId) {
      throw new Error(`Cannot link Jira issues — user ${userId} has no workspace`);
    }

    for (const issue of issues) {
      const cached = await this.prisma.jiraIssueCacheEntry.findUnique({
        where: {
          workspaceId_issueKey: {
            workspaceId: user.workspaceId,
            issueKey: issue.issueKey.trim().toUpperCase(),
          },
        },
        select: { assigneeName: true },
      });

      const link = await this.prisma.answerJiraIssueLink.upsert({
        where: {
          submissionId_questionId_issueKey: {
            submissionId,
            questionId,
            issueKey: issue.issueKey,
          },
        },
        create: {
          workspaceId: user.workspaceId,
          userId,
          submissionId,
          questionId,
          answerId: answerId ?? null,
          issueId: issue.issueId,
          issueKey: issue.issueKey,
          summary: issue.summary,
          status: issue.status,
          assigneeName: cached?.assigneeName ?? null,
          projectKey: issue.projectKey,
          issueUrl: issue.issueUrl,
          capturedAt: issue.capturedAt
            ? new Date(issue.capturedAt)
            : new Date(),
        },
        update: {
          answerId: answerId ?? undefined,
          issueId: issue.issueId,
          summary: issue.summary,
          status: issue.status,
          assigneeName: cached?.assigneeName ?? null,
          projectKey: issue.projectKey,
          issueUrl: issue.issueUrl,
          capturedAt: issue.capturedAt
            ? new Date(issue.capturedAt)
            : new Date(),
        },
      });

      saved.push(this.toDto(link));
    }

    this.logger.log(
      `Linked ${saved.length} Jira issue(s) to submission ${submissionId} question ${questionId}`,
    );

    return saved;
  }

  async attachPendingLinksToAnswer(params: {
    submissionId: string;
    questionId: string;
    answerId: string;
  }): Promise<void> {
    await this.prisma.answerJiraIssueLink.updateMany({
      where: {
        submissionId: params.submissionId,
        questionId: params.questionId,
        answerId: null,
      },
      data: {
        answerId: params.answerId,
      },
    });
  }

  async getLinksForSubmission(
    submissionId: string,
  ): Promise<LinkedJiraIssueDto[]> {
    const links = await this.prisma.answerJiraIssueLink.findMany({
      where: { submissionId },
      orderBy: [{ questionId: 'asc' }, { issueKey: 'asc' }],
    });

    return links.map((link) => this.toDto(link));
  }

  async getLinksForQuestion(
    submissionId: string,
    questionId: string,
  ): Promise<LinkedJiraIssueDto[]> {
    const links = await this.prisma.answerJiraIssueLink.findMany({
      where: { submissionId, questionId },
      orderBy: { issueKey: 'asc' },
    });

    return links.map((link) => this.toDto(link));
  }

  private toDto(link: {
    id: string;
    issueId: string;
    issueKey: string;
    summary: string;
    status: string | null;
    assigneeName: string | null;
    projectKey: string | null;
    issueUrl: string | null;
    runId: string | null;
    cloudId: string | null;
    capturedAt: Date;
  }): LinkedJiraIssueDto {
    return {
      id: link.id,
      issueId: link.issueId,
      issueKey: link.issueKey,
      summary: link.summary,
      status: link.status,
      assigneeName: link.assigneeName,
      projectKey: link.projectKey,
      issueUrl: link.issueUrl,
      runId: link.runId,
      cloudId: link.cloudId,
      capturedAt: link.capturedAt.toISOString(),
    };
  }
}
