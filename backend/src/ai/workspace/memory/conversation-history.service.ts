import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolveActiveWorkspaceId } from '../../../common/workspace-context';
import { ConversationMemoryService } from '../memory/conversation-memory.service';
import { AiChatConfidence, AiChatSourceItem } from '../types/workspace-ai.types';

export type ConversationListItem = {
  id: string;
  workspaceId: string;
  title: string;
  preview: string | null;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
};

export type ConversationDetail = {
  id: string;
  workspaceId: string;
  title: string;
  preview: string | null;
  updatedAt: string;
  createdAt: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    intent: string | null;
    createdAt: string;
    citations: AiChatSourceItem[];
    confidence: AiChatConfidence | null;
  }>;
};

/**
 * Lists, searches, and restores persisted AI conversations (workspace-isolated).
 */
@Injectable()
export class ConversationHistoryService {
  private readonly logger = new Logger(ConversationHistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memory: ConversationMemoryService,
  ) {}

  async list(params: {
    workspaceId?: string | null;
    limit?: number;
    /** Search title, preview, and message content (workspace-scoped). */
    q?: string | null;
  }): Promise<{ workspaceId: string; conversations: ConversationListItem[] }> {
    const workspaceId = await resolveActiveWorkspaceId(
      this.prisma,
      params.workspaceId,
    );
    if (!workspaceId) {
      return { workspaceId: 'unknown', conversations: [] };
    }

    const q = params.q?.trim() ?? '';
    const take = Math.min(params.limit ?? 40, 100);

    const where: Prisma.AiConversationWhereInput = {
      workspaceId,
      messages: { some: {} },
    };

    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { preview: { contains: q, mode: 'insensitive' } },
        {
          messages: {
            some: { content: { contains: q, mode: 'insensitive' } },
          },
        },
      ];
    }

    const rows = await this.prisma.aiConversation.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take,
      include: {
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { content: true, role: true },
        },
      },
    });

    const conversations = rows.map((row) => {
      const firstUser = row.messages.find((m) => m.role === 'user');
      const title =
        row.title?.trim() ||
        firstUser?.content?.trim().slice(0, 80) ||
        'Untitled conversation';
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        title,
        preview: row.preview,
        updatedAt: row.updatedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        messageCount: row._count.messages,
      };
    });

    this.logger.log(
      `Listed ${conversations.length} conversation(s) for workspace=${workspaceId}${q ? ` q="${q.slice(0, 40)}"` : ''}`,
    );
    return { workspaceId, conversations };
  }

  async get(params: {
    conversationId: string;
    workspaceId?: string | null;
  }): Promise<ConversationDetail> {
    const workspaceId = await resolveActiveWorkspaceId(
      this.prisma,
      params.workspaceId,
    );
    if (!workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    const row = await this.prisma.aiConversation.findFirst({
      where: {
        id: params.conversationId,
        workspaceId,
      },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!row) {
      throw new NotFoundException('Conversation not found in this workspace');
    }

    // Warm in-memory session so follow-up chat keeps context.
    await this.memory.ensureLoaded({
      conversationId: row.id,
      workspaceId,
    });

    const firstUser = row.messages.find((m) => m.role === 'user');
    const title =
      row.title?.trim() ||
      firstUser?.content?.trim().slice(0, 80) ||
      'Untitled conversation';

    return {
      id: row.id,
      workspaceId: row.workspaceId,
      title,
      preview: row.preview,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      messages: row.messages.map((msg) => {
        const packed = unpackHistoryCitations(msg.citations);
        const columnConfidence = (msg as { confidence?: string | null })
          .confidence;
        return {
          id: msg.id,
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content,
          intent: msg.intent,
          createdAt: msg.createdAt.toISOString(),
          citations: packed.citations,
          confidence:
            packed.confidence ?? parseConfidence(columnConfidence ?? null),
        };
      }),
    };
  }

  async delete(params: {
    conversationId: string;
    workspaceId?: string | null;
  }): Promise<{ ok: true }> {
    const workspaceId = await resolveActiveWorkspaceId(
      this.prisma,
      params.workspaceId,
    );
    if (!workspaceId) {
      throw new NotFoundException('Workspace not found');
    }

    const result = await this.prisma.aiConversation.deleteMany({
      where: { id: params.conversationId, workspaceId },
    });
    if (result.count === 0) {
      throw new NotFoundException('Conversation not found in this workspace');
    }
    return { ok: true };
  }
}

function parseConfidence(value: string | null | undefined): AiChatConfidence | null {
  if (value === 'High' || value === 'Medium' || value === 'Low') return value;
  return null;
}

function unpackHistoryCitations(value: unknown): {
  citations: AiChatSourceItem[];
  confidence: AiChatConfidence | null;
} {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      citations: parseCitationSources(record.sources),
      confidence: parseConfidence(
        typeof record.confidence === 'string' ? record.confidence : null,
      ),
    };
  }
  return {
    citations: parseCitationSources(value),
    confidence: null,
  };
}

function parseCitationSources(value: unknown): AiChatSourceItem[] {
  if (!Array.isArray(value)) return [];
  const out: AiChatSourceItem[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string') continue;
    out.push({
      id: row.id,
      source: (row.sourceType as AiChatSourceItem['source']) ?? 'slack',
      label: typeof row.label === 'string' ? row.label : 'Source',
      title: typeof row.title === 'string' ? row.title : '',
      date: null,
      url: typeof row.url === 'string' ? row.url : null,
      entity: 'ai_chat',
    });
  }
  return out;
}
