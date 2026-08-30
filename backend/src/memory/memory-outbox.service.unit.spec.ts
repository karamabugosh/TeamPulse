import { Test, TestingModule } from '@nestjs/testing';
import {
  MemoryOutboxOperation,
  MemoryOutboxStatus,
} from '@prisma/client';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { PrismaService } from '../prisma/prisma.service';
import { MEMORY_SOURCE } from './memory-source.constants';
import { MemoryOutboxService } from './memory-outbox.service';

type PrismaMock = {
  memoryOutboxEvent: {
    create: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
};

describe('MemoryOutboxService', () => {
  let service: MemoryOutboxService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = {
      memoryOutboxEvent: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryOutboxService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(MemoryOutboxService);
  });

  describe('enqueueUpsert', () => {
    it('creates a PENDING UPSERT outbox event via Prisma', async () => {
      const event = { id: 'evt-1', operation: MemoryOutboxOperation.UPSERT };
      prisma.memoryOutboxEvent.create.mockResolvedValue(event);

      const result = await service.enqueueUpsert({
        workspaceId: 'ws-1',
        sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
        sourceId: 'ans-1',
      });

      expect(result).toEqual(event);
      expect(prisma.memoryOutboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
          sourceId: 'ans-1',
          operation: MemoryOutboxOperation.UPSERT,
          status: MemoryOutboxStatus.PENDING,
          attempts: 0,
        }),
      });
      const data = (prisma.memoryOutboxEvent.create.mock.calls[0][0] as {
        data: { availableAt: Date };
      }).data;
      expect(data.availableAt).toBeInstanceOf(Date);
    });

    it('trims workspaceId and sourceId before writing', async () => {
      prisma.memoryOutboxEvent.create.mockResolvedValue({ id: 'evt-2' });

      await service.enqueueUpsert({
        workspaceId: '  ws-trim  ',
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: '  blk-9  ',
      });

      expect(prisma.memoryOutboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-trim',
          sourceId: 'blk-9',
        }),
      });
    });

    it('uses an injected transaction client when tx is provided', async () => {
      const tx = {
        memoryOutboxEvent: {
          create: jest.fn(async () => ({ id: 'evt-tx' })),
        },
      };
      prisma.memoryOutboxEvent.create.mockResolvedValue({ id: 'should-not' });

      const result = await service.enqueueUpsert({
        workspaceId: 'ws-1',
        sourceType: MEMORY_SOURCE.REPORT,
        sourceId: 'rep-1',
        tx: tx as never,
      });

      expect(result).toEqual({ id: 'evt-tx' });
      expect(tx.memoryOutboxEvent.create).toHaveBeenCalled();
      expect(prisma.memoryOutboxEvent.create).not.toHaveBeenCalled();
    });

    it('throws when workspaceId is missing or blank', async () => {
      await expect(
        service.enqueueUpsert({
          workspaceId: '   ',
          sourceType: MEMORY_SOURCE.BLOCKER,
          sourceId: 'x',
        }),
      ).rejects.toThrow('MemoryOutboxService: workspaceId is required');
      expect(prisma.memoryOutboxEvent.create).not.toHaveBeenCalled();
    });

    it('throws when workspaceId is undefined at runtime', async () => {
      await expect(
        service.enqueueUpsert({
          workspaceId: undefined as unknown as string,
          sourceType: MEMORY_SOURCE.BLOCKER,
          sourceId: 'x',
        }),
      ).rejects.toThrow('MemoryOutboxService: workspaceId is required');
    });

    it('throws when sourceId is missing or blank', async () => {
      await expect(
        service.enqueueUpsert({
          workspaceId: 'ws-1',
          sourceType: MEMORY_SOURCE.BLOCKER,
          sourceId: '',
        }),
      ).rejects.toThrow('MemoryOutboxService: sourceId is required');
      expect(prisma.memoryOutboxEvent.create).not.toHaveBeenCalled();
    });

    it('throws when sourceId is undefined at runtime', async () => {
      await expect(
        service.enqueueUpsert({
          workspaceId: 'ws-1',
          sourceType: MEMORY_SOURCE.BLOCKER,
          sourceId: undefined as unknown as string,
        }),
      ).rejects.toThrow('MemoryOutboxService: sourceId is required');
    });
  });

  describe('enqueueDelete', () => {
    it('creates a PENDING DELETE outbox event', async () => {
      const event = { id: 'evt-del', operation: MemoryOutboxOperation.DELETE };
      prisma.memoryOutboxEvent.create.mockResolvedValue(event);

      const result = await service.enqueueDelete({
        workspaceId: 'ws-1',
        sourceType: MEMORY_SOURCE.BLOCKER_RESOLUTION,
        sourceId: 'res-1',
      });

      expect(result).toEqual(event);
      expect(prisma.memoryOutboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          operation: MemoryOutboxOperation.DELETE,
          status: MemoryOutboxStatus.PENDING,
          sourceType: MEMORY_SOURCE.BLOCKER_RESOLUTION,
          sourceId: 'res-1',
        }),
      });
    });

    it('propagates create failures', async () => {
      prisma.memoryOutboxEvent.create.mockRejectedValue(new Error('outbox write failed'));

      await expect(
        service.enqueueDelete({
          workspaceId: 'ws-1',
          sourceType: MEMORY_SOURCE.REPORT,
          sourceId: 'r1',
        }),
      ).rejects.toThrow('outbox write failed');
    });
  });
});
