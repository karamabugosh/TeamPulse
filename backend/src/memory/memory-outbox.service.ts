import { Injectable, Logger } from '@nestjs/common';
import {
  MemoryOutboxOperation,
  MemoryOutboxStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MemorySourceType } from './memory-source.constants';

/** Prisma client or interactive transaction client. */
export type MemoryOutboxDb = Prisma.TransactionClient | PrismaService;

export type MemoryOutboxEnqueueParams = {
  workspaceId: string;
  sourceType: MemorySourceType;
  sourceId: string;
  /** When provided, write uses this client (same transaction as the source write). */
  tx?: MemoryOutboxDb;
};

/**
 * Pulse V2 Phase 2A — writes MemoryOutboxEvent rows only.
 * Does NOT process events, chunk, embed, or touch MemoryChunk / RAG.
 */
@Injectable()
export class MemoryOutboxService {
  private readonly logger = new Logger(MemoryOutboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  async enqueueUpsert(params: MemoryOutboxEnqueueParams) {
    return this.enqueue({
      ...params,
      operation: MemoryOutboxOperation.UPSERT,
    });
  }

  async enqueueDelete(params: MemoryOutboxEnqueueParams) {
    return this.enqueue({
      ...params,
      operation: MemoryOutboxOperation.DELETE,
    });
  }

  private async enqueue(params: MemoryOutboxEnqueueParams & {
    operation: MemoryOutboxOperation;
  }) {
    const workspaceId = params.workspaceId?.trim();
    const sourceId = params.sourceId?.trim();
    if (!workspaceId) {
      throw new Error('MemoryOutboxService: workspaceId is required');
    }
    if (!sourceId) {
      throw new Error('MemoryOutboxService: sourceId is required');
    }

    const db = params.tx ?? this.prisma;
    const event = await db.memoryOutboxEvent.create({
      data: {
        workspaceId,
        sourceType: params.sourceType,
        sourceId,
        operation: params.operation,
        status: MemoryOutboxStatus.PENDING,
        attempts: 0,
        availableAt: new Date(),
      },
    });

    this.logger.log(
      `Memory outbox enqueued op=${params.operation} source=${params.sourceType}:${sourceId} workspace=${workspaceId} event=${event.id}`,
    );

    return event;
  }
}
