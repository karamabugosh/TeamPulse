import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  ConversationSession,
  ConversationTurn,
  AiChatConfidence,
  WorkspaceAiIntent,
  WorkspaceCitation,
} from '../types/workspace-ai.types';

type VacationPendingState = {
  awaiting: 'start' | 'end';
  startIso?: string;
  focusUserName?: string | null;
};

/**
 * Conversation memory with Postgres persistence + in-process cache.
 * Survives server restart while keeping workspace isolation.
 */
@Injectable()
export class ConversationMemoryService {
  private readonly logger = new Logger(ConversationMemoryService.name);
  private readonly sessions = new Map<string, ConversationSession>();
  private readonly maxTurns = 20;

  constructor(private readonly prisma: PrismaService) {}

  getOrCreate(params: {
    conversationId?: string | null;
    workspaceId: string;
  }): ConversationSession {
    // Sync API kept for callers; hydrate from DB asynchronously via ensureLoaded.
    const requestedId = params.conversationId?.trim() || null;
    if (requestedId) {
      const existing = this.sessions.get(requestedId);
      if (existing) {
        const sameWorkspace =
          !params.workspaceId ||
          params.workspaceId === 'unknown' ||
          existing.workspaceId === 'unknown' ||
          existing.workspaceId === params.workspaceId;

        if (sameWorkspace) {
          if (
            params.workspaceId &&
            params.workspaceId !== 'unknown' &&
            existing.workspaceId === 'unknown'
          ) {
            existing.workspaceId = params.workspaceId;
          }
          return existing;
        }
      }
    }

    const now = new Date().toISOString();
    const session: ConversationSession = {
      id:
        requestedId && !this.sessions.has(requestedId)
          ? requestedId
          : randomUUID(),
      workspaceId: params.workspaceId,
      turns: [],
      createdAt: now,
      updatedAt: now,
      vacationPending: null,
    };
    this.sessions.set(session.id, session);

    // Fire-and-forget create row when workspace is known (awaited path uses ensureLoaded).
    if (params.workspaceId && params.workspaceId !== 'unknown') {
      void this.persistSessionCreate(session).catch((err) => {
        this.logger.warn(
          `Failed to persist conversation create: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    return session;
  }

  /**
   * Preferred entry: load from Postgres if present, else create.
   * Enforces workspace isolation on restore.
   */
  async ensureLoaded(params: {
    conversationId?: string | null;
    workspaceId: string;
  }): Promise<ConversationSession> {
    const requestedId = params.conversationId?.trim() || null;

    if (requestedId) {
      const cached = this.sessions.get(requestedId);
      if (
        cached &&
        (cached.workspaceId === params.workspaceId ||
          params.workspaceId === 'unknown' ||
          cached.workspaceId === 'unknown')
      ) {
        return cached;
      }

      if (params.workspaceId && params.workspaceId !== 'unknown') {
        const row = await this.prisma.aiConversation.findFirst({
          where: { id: requestedId, workspaceId: params.workspaceId },
          include: {
            messages: { orderBy: { createdAt: 'asc' }, take: this.maxTurns },
          },
        });
        if (row) {
          const session = this.rowToSession(row);
          this.sessions.set(session.id, session);
          return session;
        }
      }
    }

    return this.getOrCreate(params);
  }

  get(conversationId: string): ConversationSession | null {
    return this.sessions.get(conversationId) ?? null;
  }

  appendUserTurn(session: ConversationSession, content: string): ConversationTurn {
    const turn: ConversationTurn = {
      id: randomUUID(),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    session.turns.push(turn);
    this.trim(session);
    session.updatedAt = turn.createdAt;
    void this.persistTurn(session, turn).catch((err) => {
      this.logger.warn(
        `Failed to persist user turn: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return turn;
  }

  appendAssistantTurn(
    session: ConversationSession,
    params: {
      content: string;
      intent: WorkspaceAiIntent;
      citations: WorkspaceCitation[];
      confidence?: AiChatConfidence;
    },
  ): ConversationTurn {
    const turn: ConversationTurn = {
      id: randomUUID(),
      role: 'assistant',
      content: params.content,
      intent: params.intent,
      citations: params.citations,
      confidence: params.confidence,
      createdAt: new Date().toISOString(),
    };
    session.turns.push(turn);
    this.trim(session);
    session.updatedAt = turn.createdAt;
    void this.persistTurn(session, turn).catch((err) => {
      this.logger.warn(
        `Failed to persist assistant turn: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    return turn;
  }

  clearVacationPending(session: ConversationSession): void {
    if (session.vacationPending) {
      session.vacationPending = null;
      session.updatedAt = new Date().toISOString();
      void this.persistVacationPending(session).catch(() => undefined);
    }
  }

  setVacationPending(
    session: ConversationSession,
    pending: VacationPendingState | null,
  ): void {
    session.vacationPending = pending;
    session.updatedAt = new Date().toISOString();
    void this.persistVacationPending(session).catch(() => undefined);
  }

  getLastAssistantIntent(
    session: ConversationSession,
  ): WorkspaceAiIntent | null {
    for (let i = session.turns.length - 1; i >= 0; i -= 1) {
      const turn = session.turns[i];
      if (turn.role === 'assistant' && turn.intent) {
        return turn.intent;
      }
    }
    return null;
  }

  toProviderHistory(
    session: ConversationSession,
    excludeLastUser = true,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const turns = excludeLastUser
      ? session.turns.slice(0, -1)
      : session.turns;

    return turns
      .filter((turn) => turn.role === 'user' || turn.role === 'assistant')
      .slice(-10)
      .map((turn) => ({
        role: turn.role,
        content: turn.content,
      }));
  }

  private trim(session: ConversationSession) {
    if (session.turns.length > this.maxTurns) {
      session.turns = session.turns.slice(-this.maxTurns);
    }
  }

  private rowToSession(row: {
    id: string;
    workspaceId: string;
    createdAt: Date;
    updatedAt: Date;
    vacationPending: Prisma.JsonValue | null;
    messages: Array<{
      id: string;
      role: string;
      content: string;
      intent: string | null;
      citations: Prisma.JsonValue | null;
      createdAt: Date;
    }>;
  }): ConversationSession {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      vacationPending: parseVacationPending(row.vacationPending),
      turns: row.messages.map((msg) => {
        const packed = unpackCitations(msg.citations);
        return {
          id: msg.id,
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: msg.content,
          intent: (msg.intent as WorkspaceAiIntent | null) ?? undefined,
          citations: packed.citations,
          confidence: packed.confidence,
          createdAt: msg.createdAt.toISOString(),
        };
      }),
    };
  }

  private async persistSessionCreate(session: ConversationSession): Promise<void> {
    if (session.workspaceId === 'unknown') return;
    await this.prisma.aiConversation.upsert({
      where: { id: session.id },
      create: {
        id: session.id,
        workspaceId: session.workspaceId,
        vacationPending: session.vacationPending
          ? (session.vacationPending as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
      update: {
        updatedAt: new Date(),
      },
    });
  }

  private async persistTurn(
    session: ConversationSession,
    turn: ConversationTurn,
  ): Promise<void> {
    if (session.workspaceId === 'unknown') return;
    await this.persistSessionCreate(session);
    await this.prisma.aiConversationMessage.create({
      data: {
        id: turn.id,
        conversationId: session.id,
        role: turn.role,
        content: turn.content,
        intent: turn.intent ?? null,
        citations: packCitations(turn.citations, turn.confidence),
        createdAt: new Date(turn.createdAt),
      },
    });

    // Persist confidence column when migration is applied (best-effort; JSON pack is primary).
    if (turn.confidence) {
      try {
        await this.prisma.$executeRawUnsafe(
          `UPDATE "AiConversationMessage" SET confidence = $1 WHERE id = $2`,
          turn.confidence,
          turn.id,
        );
      } catch {
        // Column may be missing on older DBs — citations pack still carries confidence.
      }
    }

    const meta: Prisma.AiConversationUpdateInput = {
      updatedAt: new Date(turn.createdAt),
    };

    // First user message becomes the conversation title.
    if (turn.role === 'user') {
      const existing = await this.prisma.aiConversation.findUnique({
        where: { id: session.id },
        select: { title: true },
      });
      if (!existing?.title) {
        meta.title = turn.content.trim().slice(0, 120) || 'Untitled conversation';
      }
    }

    if (turn.role === 'assistant') {
      meta.preview = turn.content.trim().slice(0, 200);
    }

    await this.prisma.aiConversation.update({
      where: { id: session.id },
      data: meta,
    });
  }

  private async persistVacationPending(
    session: ConversationSession,
  ): Promise<void> {
    if (session.workspaceId === 'unknown') return;
    await this.prisma.aiConversation.updateMany({
      where: { id: session.id, workspaceId: session.workspaceId },
      data: {
        vacationPending: session.vacationPending
          ? (session.vacationPending as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        updatedAt: new Date(),
      },
    });
  }
}

function parseVacationPending(
  value: Prisma.JsonValue | null,
): ConversationSession['vacationPending'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.awaiting !== 'start' && record.awaiting !== 'end') return null;
  return {
    awaiting: record.awaiting,
    startIso: typeof record.startIso === 'string' ? record.startIso : undefined,
    focusUserName:
      typeof record.focusUserName === 'string' || record.focusUserName === null
        ? (record.focusUserName as string | null)
        : undefined,
  };
}

function unpackCitations(value: Prisma.JsonValue | null): {
  citations: WorkspaceCitation[] | undefined;
  confidence: AiChatConfidence | undefined;
} {
  if (value == null) return { citations: undefined, confidence: undefined };

  // New packed shape: { sources: [...], confidence?: "High"|"Medium"|"Low" }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const sources = Array.isArray(record.sources)
      ? parseCitations(record.sources as Prisma.JsonValue)
      : undefined;
    return {
      citations: sources,
      confidence: parseConfidence(
        typeof record.confidence === 'string' ? record.confidence : null,
      ),
    };
  }

  // Legacy: citations stored as a bare array
  return {
    citations: parseCitations(value),
    confidence: undefined,
  };
}

function packCitations(
  citations: WorkspaceCitation[] | undefined,
  confidence: AiChatConfidence | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if ((!citations || citations.length === 0) && !confidence) {
    return Prisma.JsonNull;
  }
  return {
    sources: (citations ?? []) as unknown as Prisma.InputJsonValue,
    confidence: confidence ?? null,
  } as Prisma.InputJsonValue;
}

function parseCitations(
  value: Prisma.JsonValue | null | unknown,
): WorkspaceCitation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: WorkspaceCitation[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.label !== 'string') continue;
    out.push({
      id: row.id,
      sourceType: (row.sourceType as WorkspaceCitation['sourceType']) ?? 'slack',
      label: row.label,
      title: typeof row.title === 'string' ? row.title : '',
      url: typeof row.url === 'string' ? row.url : null,
    });
  }
  return out;
}

function parseConfidence(
  value: string | null | undefined,
): AiChatConfidence | undefined {
  if (value === 'High' || value === 'Medium' || value === 'Low') return value;
  return undefined;
}
