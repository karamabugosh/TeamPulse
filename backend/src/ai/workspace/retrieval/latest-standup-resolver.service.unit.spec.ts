import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { PrismaService } from '../../../prisma/prisma.service';
import { TemporalRetrievalScope } from './temporal-retrieval.util';
import { LatestStandupResolverService } from './latest-standup-resolver.service';

type PrismaMock = {
  standupSubmission: {
    findFirst: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
  pulseBlocker: {
    findMany: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
};

describe('LatestStandupResolverService', () => {
  let service: LatestStandupResolverService;
  let prisma: PrismaMock;

  const temporalScope: TemporalRetrievalScope = 'LATEST_STANDUP';

  beforeEach(async () => {
    prisma = {
      standupSubmission: { findFirst: jest.fn() },
      pulseBlocker: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LatestStandupResolverService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(LatestStandupResolverService);
  });

  describe('resolve', () => {
    it('returns null when workspaceId is blank', async () => {
      const result = await service.resolve({
        workspaceId: '   ',
        temporalScope,
      });

      expect(result).toBeNull();
      expect(prisma.standupSubmission.findFirst).not.toHaveBeenCalled();
    });

    it('returns null when workspaceId is undefined at runtime', async () => {
      const result = await service.resolve({
        workspaceId: undefined as unknown as string,
        temporalScope,
      });

      expect(result).toBeNull();
    });

    it('returns null when no completed submission exists', async () => {
      prisma.standupSubmission.findFirst.mockResolvedValue(null);

      const result = await service.resolve({
        workspaceId: 'ws-1',
        temporalScope,
      });

      expect(result).toBeNull();
      expect(prisma.pulseBlocker.findMany).not.toHaveBeenCalled();
    });

    it('returns null when submission has no run', async () => {
      prisma.standupSubmission.findFirst.mockResolvedValue({
        id: 'sub-1',
        run: null,
      });

      await expect(
        service.resolve({ workspaceId: 'ws-1', temporalScope }),
      ).resolves.toBeNull();
    });

    it('resolves scope with answers and blockers for a workspace-wide latest standup', async () => {
      const completedAt = new Date('2024-06-01T12:00:00.000Z');
      const updatedAt = new Date('2024-06-01T11:00:00.000Z');
      const startedAt = new Date('2024-06-01T10:00:00.000Z');
      prisma.standupSubmission.findFirst.mockResolvedValue({
        id: 'sub-1',
        userId: 'user-1',
        runId: 'run-1',
        completedAt,
        updatedAt,
        user: { id: 'user-1', slackDisplayName: 'Alice' },
        answers: [{ id: 'ans-1' }, { id: 'ans-2' }],
        run: {
          id: 'run-1',
          teamId: 'team-1',
          checkInId: 'ci-1',
          startedAt,
          completedAt: null,
        },
      });
      prisma.pulseBlocker.findMany.mockResolvedValue([
        { id: 'blk-1' },
        { id: 'blk-2' },
      ]);

      const result = await service.resolve({
        workspaceId: '  ws-1  ',
        temporalScope,
      });

      expect(prisma.standupSubmission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'completed',
            user: { workspaceId: 'ws-1' },
          },
          orderBy: { completedAt: 'desc' },
        }),
      );
      expect(result).toEqual({
        temporalScope,
        workspaceId: 'ws-1',
        checkInId: 'ci-1',
        teamId: 'team-1',
        runId: 'run-1',
        submissionId: 'sub-1',
        subjectUserId: 'user-1',
        subjectDisplayName: 'Alice',
        runStartedAt: startedAt,
        runCompletedAt: null,
        submissionCompletedAt: completedAt,
        scopedSourceIds: ['ans-1', 'ans-2', 'blk-1', 'blk-2'],
      });
    });

    it('filters by subjectUserId and checkInId when provided', async () => {
      prisma.standupSubmission.findFirst.mockResolvedValue(null);

      await service.resolve({
        workspaceId: 'ws-1',
        temporalScope,
        subjectUserId: 'user-9',
        checkInId: 'ci-9',
      });

      expect(prisma.standupSubmission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'completed',
            user: { workspaceId: 'ws-1' },
            userId: 'user-9',
            run: { checkInId: 'ci-9' },
          },
        }),
      );
    });

    it('falls back to updatedAt when completedAt is null', async () => {
      const updatedAt = new Date('2024-07-01T00:00:00.000Z');
      prisma.standupSubmission.findFirst.mockResolvedValue({
        id: 'sub-2',
        userId: 'user-2',
        runId: 'run-2',
        completedAt: null,
        updatedAt,
        user: { id: 'user-2', slackDisplayName: 'Bob' },
        answers: [],
        run: {
          id: 'run-2',
          teamId: 'team-2',
          checkInId: null,
          startedAt: updatedAt,
          completedAt: updatedAt,
        },
      });
      prisma.pulseBlocker.findMany.mockResolvedValue([]);

      const result = await service.resolve({
        workspaceId: 'ws-1',
        temporalScope,
      });

      expect(result?.submissionCompletedAt).toEqual(updatedAt);
      expect(result?.scopedSourceIds).toEqual([]);
    });
  });
});
