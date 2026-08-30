import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JiraAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(params: {
    userId: string;
    proposedActionId?: string;
    actionType: string;
    jiraIssueKey?: string | null;
    status: string;
    metadata?: Record<string, unknown>;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: params.userId },
      select: { workspaceId: true },
    });
    if (!user?.workspaceId) {
      throw new Error(`Cannot record Jira audit — user ${params.userId} has no workspace`);
    }

    return this.prisma.jiraAuditLog.create({
      data: {
        workspaceId: user.workspaceId,
        userId: params.userId,
        proposedActionId: params.proposedActionId ?? null,
        actionType: params.actionType,
        jiraIssueKey: params.jiraIssueKey ?? null,
        status: params.status,
        metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async listForUser(userId: string, limit = 50) {
    return this.prisma.jiraAuditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        actionType: true,
        jiraIssueKey: true,
        status: true,
        metadata: true,
        createdAt: true,
        proposedActionId: true,
      },
    });
  }
}
