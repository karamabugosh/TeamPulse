import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  WORKSPACE_KNOWLEDGE_CHANGED,
} from '../ai/workspace/retrieval/knowledge-events';

export type TeamMemorySourceType =
  | 'standup_answer'
  | 'jira_link'
  | 'report'
  | 'ai_summary';

@Injectable()
export class TeamMemoryService {
  private readonly logger = new Logger(TeamMemoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async upsertDocument(params: {
    workspaceId: string;
    userId?: string | null;
    sourceType: TeamMemorySourceType;
    sourceId: string;
    title: string;
    content: string;
    issueKey?: string | null;
    runId?: string | null;
    submissionId?: string | null;
    metadata?: Prisma.InputJsonValue | null;
  }) {
    const doc = await this.prisma.teamMemoryDocument.upsert({
      where: {
        sourceType_sourceId: {
          sourceType: params.sourceType,
          sourceId: params.sourceId,
        },
      },
      create: {
        workspaceId: params.workspaceId,
        userId: params.userId ?? null,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        title: params.title,
        content: params.content,
        issueKey: params.issueKey ?? null,
        runId: params.runId ?? null,
        submissionId: params.submissionId ?? null,
        metadata: params.metadata ?? undefined,
      },
      update: {
        title: params.title,
        content: params.content,
        issueKey: params.issueKey ?? null,
        runId: params.runId ?? null,
        submissionId: params.submissionId ?? null,
        metadata: params.metadata ?? undefined,
        indexedAt: new Date(),
      },
    });

    this.events.emit(WORKSPACE_KNOWLEDGE_CHANGED, {
      workspaceId: params.workspaceId,
      reason: `team_memory:${params.sourceType}`,
    });

    return doc;
  }

  async indexJiraLink(linkId: string) {
    const link = await this.prisma.answerJiraIssueLink.findUnique({
      where: { id: linkId },
      include: {
        user: { select: { workspaceId: true, slackDisplayName: true } },
        submission: {
          select: {
            run: { select: { checkIn: { select: { name: true } } } },
          },
        },
      },
    });

    if (!link) {
      return null;
    }

    return this.upsertDocument({
      workspaceId: link.user.workspaceId,
      userId: link.userId,
      sourceType: 'jira_link',
      sourceId: link.id,
      title: `${link.issueKey} — ${link.summary}`,
      content: [
        link.issueKey,
        link.summary,
        link.status ?? '',
        link.projectKey ?? '',
        link.user.slackDisplayName,
        link.submission.run.checkIn?.name ?? '',
      ]
        .filter(Boolean)
        .join('\n'),
      issueKey: link.issueKey,
      runId: link.runId,
      submissionId: link.submissionId,
      metadata: {
        issueUrl: link.issueUrl,
        linkedAt: link.createdAt.toISOString(),
      },
    });
  }

  async search(workspaceId: string, query: string, limit = 20) {
    const trimmed = query.trim();
    if (!trimmed) {
      return { results: [] };
    }

    const documents = await this.prisma.teamMemoryDocument.findMany({
      where: {
        workspaceId,
        OR: [
          { title: { contains: trimmed, mode: 'insensitive' } },
          { content: { contains: trimmed, mode: 'insensitive' } },
          { issueKey: { contains: trimmed, mode: 'insensitive' } },
        ],
      },
      orderBy: { indexedAt: 'desc' },
      take: limit,
    });

    if (documents.length > 0) {
      return {
        results: documents.map((doc) => ({
          id: doc.id,
          sourceType: doc.sourceType,
          sourceId: doc.sourceId,
          title: doc.title,
          excerpt: doc.content.slice(0, 240),
          issueKey: doc.issueKey,
          runId: doc.runId,
          submissionId: doc.submissionId,
          indexedAt: doc.indexedAt.toISOString(),
        })),
      };
    }

    const [answers, links, digests] = await Promise.all([
      this.prisma.answer.findMany({
        where: {
          text: { contains: trimmed, mode: 'insensitive' },
          submission: { user: { workspaceId } },
        },
        include: {
          submission: {
            select: {
              id: true,
              runId: true,
              run: { select: { checkIn: { select: { name: true } } } },
            },
          },
        },
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.answerJiraIssueLink.findMany({
        where: {
          user: { workspaceId },
          OR: [
            { summary: { contains: trimmed, mode: 'insensitive' } },
            { issueKey: { contains: trimmed, mode: 'insensitive' } },
          ],
        },
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.aiDigest.findMany({
        where: {
          team: { workspaceId },
          OR: [
            { summary: { contains: trimmed, mode: 'insensitive' } },
            { slackReportText: { contains: trimmed, mode: 'insensitive' } },
          ],
        },
        take: limit,
        orderBy: { generatedAt: 'desc' },
      }),
    ]);

    const results = [
      ...answers.map((answer) => ({
        id: answer.id,
        sourceType: 'standup_answer' as const,
        sourceId: answer.id,
        title: answer.submission?.run.checkIn?.name ?? 'Standup answer',
        excerpt: answer.text.slice(0, 240),
        issueKey: null,
        runId: answer.submission?.runId ?? null,
        submissionId: answer.submissionId,
        indexedAt: answer.createdAt.toISOString(),
      })),
      ...links.map((link) => ({
        id: link.id,
        sourceType: 'jira_link' as const,
        sourceId: link.id,
        title: `${link.issueKey} — ${link.summary}`,
        excerpt: link.summary.slice(0, 240),
        issueKey: link.issueKey,
        runId: link.runId,
        submissionId: link.submissionId,
        indexedAt: link.createdAt.toISOString(),
      })),
      ...digests.map((digest) => ({
        id: digest.id,
        sourceType: 'ai_summary' as const,
        sourceId: digest.id,
        title: 'AI Standup Report',
        excerpt: digest.summary.slice(0, 240),
        issueKey: null,
        runId: digest.runId,
        submissionId: null,
        indexedAt: digest.generatedAt.toISOString(),
      })),
    ]
      .sort(
        (a, b) =>
          new Date(b.indexedAt).getTime() - new Date(a.indexedAt).getTime(),
      )
      .slice(0, limit);

    return { results };
  }
}
