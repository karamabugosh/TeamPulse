import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { QuestionType } from '@prisma/client';
import { MEMORY_SOURCE } from '../memory/memory-source.constants';
import { MemoryOutboxService } from '../memory/memory-outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { SlackService } from '../slack/slack.service';
import { CheckInService } from './check-in.service';
import { CreateCheckInDto } from './dto/create-check-in.dto';

jest.mock('../common/workspace-context', () => ({
  resolveActiveWorkspaceId: jest.fn(),
}));

import { resolveActiveWorkspaceId } from '../common/workspace-context';

const resolveWorkspaceIdMock = resolveActiveWorkspaceId as jest.MockedFunction<
  typeof resolveActiveWorkspaceId
>;

type AsyncMock = jest.MockedFunction<(args?: unknown) => Promise<unknown>>;

type TxMock = {
  checkIn: {
    create: AsyncMock;
    findUnique: AsyncMock;
    update: AsyncMock;
    delete: AsyncMock;
  };
  checkInParticipant: {
    deleteMany: AsyncMock;
    createMany: AsyncMock;
  };
  question: {
    findMany: AsyncMock;
    create: AsyncMock;
    update: AsyncMock;
    delete: AsyncMock;
    deleteMany: AsyncMock;
  };
  standupRun: {
    findMany: AsyncMock;
    deleteMany: AsyncMock;
    delete: AsyncMock;
  };
  standupSubmission: {
    findMany: AsyncMock;
    deleteMany: AsyncMock;
  };
  answer: {
    findMany: AsyncMock;
    deleteMany: AsyncMock;
  };
  conversationState: {
    deleteMany: AsyncMock;
  };
  standupThreadUpdate: {
    deleteMany: AsyncMock;
  };
  aiDigest: {
    findMany: AsyncMock;
    deleteMany: AsyncMock;
  };
};

type PrismaMock = {
  team: { findUnique: AsyncMock };
  teamMember: { findMany: AsyncMock };
  checkIn: {
    create: AsyncMock;
    findMany: AsyncMock;
    findFirst: AsyncMock;
    findUnique: AsyncMock;
    update: AsyncMock;
  };
  standupRun: {
    findMany: AsyncMock;
    findUnique: AsyncMock;
    count: AsyncMock;
  };
  $transaction: jest.MockedFunction<
    (fn: (tx: TxMock) => Promise<unknown>) => Promise<unknown>
  >;
};

const TEAM_ID = 'team-1';
const CHECK_IN_ID = 'ci-1';
const WORKSPACE_ID = 'ws-1';
const MEMBER_ID = 'tm-1';
const RUN_ID = 'run-1';

function makeTeam(overrides: Record<string, unknown> = {}) {
  return {
    id: TEAM_ID,
    workspaceId: WORKSPACE_ID,
    name: 'Platform',
    slackChannelId: 'C001',
    timezone: 'Asia/Riyadh',
    ...overrides,
  };
}

function makeCheckIn(overrides: Record<string, unknown> = {}) {
  return {
    id: CHECK_IN_ID,
    teamId: TEAM_ID,
    name: 'Daily Standup',
    description: 'desc',
    introMessage: 'intro',
    outroMessage: 'outro',
    enabled: true,
    timezone: 'Asia/Riyadh',
    collectionCron: '0 9 * * 1-5',
    updatesChannelId: 'C-updates',
    reminderEnabled: true,
    reminderMinutesAfter: 30,
    reminderRecurringEnabled: false,
    reminderIntervalMinutes: null,
    reminderOnlyNonResponders: true,
    reminderOnSlackActive: false,
    reportCron: '0 10 * * 1-5',
    reportTriggerMode: 'scheduled',
    reportTimeoutMinutes: null,
    publishStatus: 'published',
    scheduleEnabled: true,
    questions: [
      {
        id: 'q-1',
        question: 'What did you do?',
        order: 1,
        type: QuestionType.FREE_TEXT,
        options: null,
        isRequired: true,
        isActive: true,
      },
    ],
    participants: [
      {
        id: 'cp-1',
        teamMemberId: MEMBER_ID,
        isActive: true,
        teamMember: {
          id: MEMBER_ID,
          user: {
            id: 'u-1',
            slackUserId: 'U001',
            slackDisplayName: 'Ada',
            email: 'ada@example.com',
            timezone: 'Asia/Riyadh',
          },
        },
      },
    ],
    runs: [],
    ...overrides,
  };
}

function makeCreateDto(
  overrides: Partial<CreateCheckInDto> = {},
): CreateCheckInDto {
  return {
    teamId: TEAM_ID,
    name: 'Daily Standup',
    timezone: 'Asia/Riyadh',
    collectionCron: '0 9 * * 1-5',
    ...overrides,
  };
}

function makeRun(overrides: Record<string, unknown> = {}) {
  const startedAt = new Date(Date.now() - 60_000);
  return {
    id: RUN_ID,
    checkInId: CHECK_IN_ID,
    status: 'collecting',
    startedAt,
    completedAt: null,
    slackChannelId: 'C001',
    slackThreadTs: '1234.5678',
    slackThreadUrl: null,
    reportStatus: null,
    reportGeneratedAt: null,
    reportDueAt: null,
    checkIn: {
      id: CHECK_IN_ID,
      name: 'Daily Standup',
      timezone: 'Asia/Riyadh',
      updatesChannelId: 'C-updates',
      reportTriggerMode: 'scheduled',
    },
    team: {
      id: TEAM_ID,
      name: 'Platform',
      workspaceId: WORKSPACE_ID,
      workspace: {
        slackWorkspaceId: 'T12345678',
        slackWorkspaceName: 'Acme Corp',
      },
    },
    submissions: [
      { id: 'sub-1', status: 'completed', user: { id: 'u-1', slackDisplayName: 'Ada', slackUserId: 'U001' } },
      { id: 'sub-2', status: 'pending', user: { id: 'u-2', slackDisplayName: 'Bob', slackUserId: 'U002' } },
    ],
    aiDigest: null,
    _count: { submissions: 2 },
    ...overrides,
  };
}

function createTxMock(): TxMock {
  return {
    checkIn: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    checkInParticipant: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    question: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    standupRun: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      delete: jest.fn(),
    },
    standupSubmission: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    answer: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    conversationState: {
      deleteMany: jest.fn(),
    },
    standupThreadUpdate: {
      deleteMany: jest.fn(),
    },
    aiDigest: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
}

describe('CheckInService', () => {
  let service: CheckInService;
  let prisma: PrismaMock;
  let tx: TxMock;
  let moduleRefGet: jest.MockedFunction<(token?: unknown) => unknown>;
  let memoryOutbox: { enqueueDelete: AsyncMock };
  let schedulerRefresh: AsyncMock;
  let slackGetPermalink: AsyncMock;

  beforeEach(async () => {
    tx = createTxMock();
    schedulerRefresh = jest.fn(async () => ({ status: 'ok' }));
    slackGetPermalink = jest.fn(async () => null);
    moduleRefGet = jest.fn((token?: unknown) => {
      if (token === SchedulerService) {
        return { refreshCheckInJobs: schedulerRefresh };
      }
      if (token === SlackService) {
        return { getPermalink: slackGetPermalink };
      }
      return undefined;
    });
    memoryOutbox = { enqueueDelete: jest.fn(async () => undefined) };

    prisma = {
      team: { findUnique: jest.fn() },
      teamMember: { findMany: jest.fn() },
      checkIn: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      standupRun: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (client: TxMock) => Promise<unknown>) =>
        fn(tx),
      ),
    };

    resolveWorkspaceIdMock.mockResolvedValue(WORKSPACE_ID);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CheckInService,
        { provide: PrismaService, useValue: prisma },
        { provide: ModuleRef, useValue: { get: moduleRefGet } },
        { provide: MemoryOutboxService, useValue: memoryOutbox },
      ],
    }).compile();

    service = module.get(CheckInService);
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------

  describe('create', () => {
    it('creates a check-in with defaults when optional fields are omitted', async () => {
      // Arrange
      const created = makeCheckIn({ questions: [], participants: [] });
      prisma.team.findUnique.mockResolvedValue(makeTeam());
      tx.checkIn.create.mockResolvedValue({ id: CHECK_IN_ID });
      tx.checkIn.findUnique.mockResolvedValue(created);

      // Act
      const result = await service.create(makeCreateDto());

      // Assert
      expect(tx.checkIn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            teamId: TEAM_ID,
            name: 'Daily Standup',
            description: null,
            introMessage: null,
            outroMessage: null,
            enabled: true,
            timezone: 'Asia/Riyadh',
            collectionCron: '0 9 * * 1-5',
            updatesChannelId: null,
            reminderEnabled: true,
            reminderMinutesAfter: 30,
            reminderRecurringEnabled: false,
            reminderIntervalMinutes: null,
            reminderOnlyNonResponders: true,
            reminderOnSlackActive: false,
            reportCron: null,
            reportTriggerMode: 'scheduled',
            reportTimeoutMinutes: null,
            publishStatus: 'published',
            scheduleEnabled: true,
            participants: undefined,
            questions: undefined,
          }),
        }),
      );
      expect(schedulerRefresh).toHaveBeenCalled();
      expect(result).toEqual(created);
    });

    it('creates with questions, participants, and trimmed optional fields', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue(makeTeam());
      prisma.teamMember.findMany.mockResolvedValue([{ id: MEMBER_ID }]);
      const created = makeCheckIn();
      tx.checkIn.create.mockResolvedValue({ id: CHECK_IN_ID });
      tx.checkIn.findUnique.mockResolvedValue(created);

      // Act
      await service.create(
        makeCreateDto({
          name: '  Standup  ',
          description: '  hello  ',
          introMessage: '  hi  ',
          outroMessage: '  bye  ',
          enabled: false,
          timezone: '  UTC  ',
          collectionCron: '  0 10 * * 1-5  ',
          updatesChannelId: '  C99  ',
          reminderEnabled: false,
          reminderMinutesAfter: 15,
          reminderRecurringEnabled: true,
          reminderIntervalMinutes: 10,
          reminderOnlyNonResponders: false,
          reminderOnSlackActive: true,
          reportCron: '0 11 * * 1-5',
          reportTriggerMode: 'all_answered',
          reportTimeoutMinutes: 60,
          publishStatus: 'draft',
          scheduleEnabled: false,
          participantIds: [MEMBER_ID, MEMBER_ID],
          questions: [
            {
              question: '  Done?  ',
              order: 1,
              type: QuestionType.MULTIPLE_CHOICE,
              options: ['Yes', 'No'],
              isRequired: false,
              isActive: false,
            },
            {
              question: 'Blockers?',
              order: 2,
            },
          ],
        }),
      );

      // Assert
      expect(prisma.teamMember.findMany).toHaveBeenCalled();
      const createArg = tx.checkIn.create.mock.calls[0][0] as {
        data: {
          name: string;
          participants: { create: Array<{ teamMemberId: string }> };
          questions: { create: Array<{ question: string; type: string }> };
        };
      };
      expect(createArg.data.name).toBe('Standup');
      expect(createArg.data.participants.create).toHaveLength(1);
      expect(createArg.data.questions.create).toHaveLength(2);
      expect(createArg.data.questions.create[0].question).toBe('Done?');
      expect(createArg.data.questions.create[1].type).toBe(QuestionType.FREE_TEXT);
    });

    it('continues when scheduler reconciliation fails after create', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue(makeTeam());
      tx.checkIn.create.mockResolvedValue({ id: CHECK_IN_ID });
      tx.checkIn.findUnique.mockResolvedValue(makeCheckIn());
      schedulerRefresh.mockRejectedValue(new Error('scheduler down'));

      // Act
      const result = await service.create(makeCreateDto());

      // Assert
      expect(result).toEqual(makeCheckIn());
    });

    it('continues when moduleRef cannot resolve SchedulerService', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue(makeTeam());
      tx.checkIn.create.mockResolvedValue({ id: CHECK_IN_ID });
      tx.checkIn.findUnique.mockResolvedValue(makeCheckIn());
      moduleRefGet.mockImplementation(() => {
        throw new Error('circular dependency');
      });

      // Act
      const result = await service.create(makeCreateDto());

      // Assert
      expect(result).toEqual(makeCheckIn());
    });

    it('logs non-Error scheduler failures after create', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue(makeTeam());
      tx.checkIn.create.mockResolvedValue({ id: CHECK_IN_ID });
      tx.checkIn.findUnique.mockResolvedValue(null);
      schedulerRefresh.mockRejectedValue('string-fail');

      // Act
      await expect(service.create(makeCreateDto())).resolves.toBeNull();
    });

    it('throws when teamId is missing', async () => {
      await expect(
        service.create(makeCreateDto({ teamId: '  ' })),
      ).rejects.toThrow(new BadRequestException('teamId is required.'));
    });

    it('throws when name is missing', async () => {
      await expect(
        service.create(makeCreateDto({ name: '' })),
      ).rejects.toThrow(new BadRequestException('Check-in name is required.'));
    });

    it('throws when timezone is missing', async () => {
      await expect(
        service.create(makeCreateDto({ timezone: ' ' })),
      ).rejects.toThrow(new BadRequestException('timezone is required.'));
    });

    it('throws when collectionCron is missing', async () => {
      await expect(
        service.create(makeCreateDto({ collectionCron: '' })),
      ).rejects.toThrow(
        new BadRequestException('collectionCron is required.'),
      );
    });

    it('throws when reminderMinutesAfter is negative', async () => {
      await expect(
        service.create(makeCreateDto({ reminderMinutesAfter: -1 })),
      ).rejects.toThrow(
        'reminderMinutesAfter must be a non-negative integer.',
      );
    });

    it('throws when reminderMinutesAfter is not an integer', async () => {
      await expect(
        service.create(makeCreateDto({ reminderMinutesAfter: 1.5 })),
      ).rejects.toThrow(
        'reminderMinutesAfter must be a non-negative integer.',
      );
    });

    it('throws for invalid timezone', async () => {
      await expect(
        service.create(makeCreateDto({ timezone: 'Not/AZone' })),
      ).rejects.toThrow(/Invalid timezone/);
    });

    it('throws for invalid collectionCron', async () => {
      await expect(
        service.create(makeCreateDto({ collectionCron: 'not-a-cron' })),
      ).rejects.toThrow('collectionCron is not a valid cron expression.');
    });

    it('throws for invalid reportCron', async () => {
      await expect(
        service.create(
          makeCreateDto({ reportCron: 'bad cron expression here' }),
        ),
      ).rejects.toThrow('reportCron is not a valid cron expression.');
    });

    it('throws when team is not found', async () => {
      prisma.team.findUnique.mockResolvedValue(null);

      await expect(service.create(makeCreateDto())).rejects.toThrow(
        new NotFoundException(`Team ${TEAM_ID} was not found.`),
      );
    });

    it('throws when team is outside active workspace', async () => {
      prisma.team.findUnique.mockResolvedValue(
        makeTeam({ workspaceId: 'other-ws' }),
      );

      await expect(service.create(makeCreateDto())).rejects.toThrow(
        new NotFoundException(`Team ${TEAM_ID} was not found.`),
      );
    });

    it('allows create when no active workspace is resolved', async () => {
      resolveWorkspaceIdMock.mockResolvedValue(null);
      prisma.team.findUnique.mockResolvedValue(makeTeam());
      tx.checkIn.create.mockResolvedValue({ id: CHECK_IN_ID });
      tx.checkIn.findUnique.mockResolvedValue(makeCheckIn());

      await expect(service.create(makeCreateDto())).resolves.toBeDefined();
    });

    it('throws when participant IDs are invalid', async () => {
      prisma.team.findUnique.mockResolvedValue(makeTeam());
      prisma.teamMember.findMany.mockResolvedValue([]);

      await expect(
        service.create(makeCreateDto({ participantIds: ['bad-tm'] })),
      ).rejects.toThrow(/Invalid participant TeamMember IDs/);
    });

    it('throws when question text is empty', async () => {
      await expect(
        service.create(
          makeCreateDto({
            questions: [{ question: '  ', order: 1 }],
          }),
        ),
      ).rejects.toThrow('Question text cannot be empty.');
    });

    it('throws when question order is not a positive integer', async () => {
      await expect(
        service.create(
          makeCreateDto({
            questions: [{ question: 'Q', order: 0 }],
          }),
        ),
      ).rejects.toThrow('Question order must be a positive integer.');
    });

    it('throws on duplicate question order', async () => {
      await expect(
        service.create(
          makeCreateDto({
            questions: [
              { question: 'Q1', order: 1 },
              { question: 'Q2', order: 1 },
            ],
          }),
        ),
      ).rejects.toThrow('Duplicate question order 1.');
    });

    it('throws on invalid question type', async () => {
      await expect(
        service.create(
          makeCreateDto({
            questions: [
              {
                question: 'Q',
                order: 1,
                type: 'NOT_A_TYPE' as unknown as QuestionType,
              },
            ],
          }),
        ),
      ).rejects.toThrow(/Invalid question type/);
    });

    it('throws when options is not an array', async () => {
      await expect(
        service.create(
          makeCreateDto({
            questions: [
              {
                question: 'Q',
                order: 1,
                options: 'bad' as unknown as string[],
              },
            ],
          }),
        ),
      ).rejects.toThrow('Options for question 1 must be an array.');
    });

    it('throws when an option is empty', async () => {
      await expect(
        service.create(
          makeCreateDto({
            questions: [
              {
                question: 'Q',
                order: 1,
                type: QuestionType.MULTIPLE_CHOICE,
                options: ['Yes', '  '],
              },
            ],
          }),
        ),
      ).rejects.toThrow('Question 1 contains an empty option.');
    });

    it('throws when options differ only by case', async () => {
      await expect(
        service.create(
          makeCreateDto({
            questions: [
              {
                question: 'Q',
                order: 1,
                type: QuestionType.MULTIPLE_CHOICE,
                options: ['Yes', 'YES'],
              },
            ],
          }),
        ),
      ).rejects.toThrow('Question 1 contains duplicate options.');
    });

    it('throws when multiple-choice has fewer than two options', async () => {
      await expect(
        service.create(
          makeCreateDto({
            questions: [
              {
                question: 'Q',
                order: 1,
                type: QuestionType.MULTIPLE_CHOICE,
                options: ['Only'],
              },
            ],
          }),
        ),
      ).rejects.toThrow(
        'Multiple-choice question 1 must have at least two options.',
      );
    });

    it('throws when non-multiple-choice has options', async () => {
      await expect(
        service.create(
          makeCreateDto({
            questions: [
              {
                question: 'Q',
                order: 1,
                type: QuestionType.FREE_TEXT,
                options: ['A'],
              },
            ],
          }),
        ),
      ).rejects.toThrow(
        'Question 1 only supports custom options when type is MULTIPLE_CHOICE.',
      );
    });
  });

  // -----------------------------------------------------------------------
  // findAll / findOne
  // -----------------------------------------------------------------------

  describe('findAll', () => {
    it('lists check-ins scoped to active workspace', async () => {
      const rows = [makeCheckIn()];
      prisma.checkIn.findMany.mockResolvedValue(rows);

      const result = await service.findAll();

      expect(prisma.checkIn.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { team: { workspaceId: WORKSPACE_ID } },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result).toEqual(rows);
    });

    it('filters by teamId when provided', async () => {
      prisma.checkIn.findMany.mockResolvedValue([]);

      await service.findAll(TEAM_ID);

      expect(prisma.checkIn.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            teamId: TEAM_ID,
            team: { workspaceId: WORKSPACE_ID },
          },
        }),
      );
    });

    it('omits workspace filter when no active workspace', async () => {
      resolveWorkspaceIdMock.mockResolvedValue(null);
      prisma.checkIn.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(prisma.checkIn.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  describe('findOne', () => {
    it('returns a check-in when found', async () => {
      const checkIn = makeCheckIn();
      prisma.checkIn.findFirst.mockResolvedValue(checkIn);

      await expect(service.findOne(CHECK_IN_ID)).resolves.toEqual(checkIn);
    });

    it('throws NotFoundException when missing', async () => {
      prisma.checkIn.findFirst.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        new NotFoundException('Check-in missing was not found.'),
      );
    });

    it('queries without workspace filter when none is active', async () => {
      resolveWorkspaceIdMock.mockResolvedValue(null);
      prisma.checkIn.findFirst.mockResolvedValue(makeCheckIn());

      await service.findOne(CHECK_IN_ID);

      expect(prisma.checkIn.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: CHECK_IN_ID } }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------

  describe('update', () => {
    function stubExistingCheckIn() {
      prisma.checkIn.findFirst.mockResolvedValue(
        makeCheckIn({
          timezone: 'Asia/Riyadh',
          collectionCron: '0 9 * * 1-5',
          reportCron: '0 10 * * 1-5',
        }),
      );
    }

    it('updates scalar fields and refreshes scheduler', async () => {
      stubExistingCheckIn();
      const updated = makeCheckIn({ name: 'Renamed' });
      tx.checkIn.update.mockResolvedValue({});
      tx.checkIn.findUnique.mockResolvedValue(updated);

      const result = await service.update(CHECK_IN_ID, {
        name: '  Renamed  ',
        description: '  d  ',
        introMessage: '  i  ',
        outroMessage: '  o  ',
        enabled: false,
        timezone: 'UTC',
        collectionCron: '0 8 * * 1-5',
        updatesChannelId: '  C2  ',
        reminderEnabled: false,
        reminderMinutesAfter: 5,
        reminderRecurringEnabled: true,
        reminderIntervalMinutes: 20,
        reminderOnlyNonResponders: false,
        reminderOnSlackActive: true,
        reportCron: '0 9 * * 1-5',
        reportTriggerMode: 'timeout',
        reportTimeoutMinutes: 45,
        publishStatus: 'draft',
        scheduleEnabled: false,
      });

      expect(tx.checkIn.update).toHaveBeenCalled();
      expect(schedulerRefresh).toHaveBeenCalled();
      expect(result).toEqual(updated);
    });

    it('clears nullable string fields when blank', async () => {
      stubExistingCheckIn();
      tx.checkIn.update.mockResolvedValue({});
      tx.checkIn.findUnique.mockResolvedValue(makeCheckIn());

      await service.update(CHECK_IN_ID, {
        description: '   ',
        introMessage: null,
        outroMessage: '',
        updatesChannelId: '  ',
        reportCron: '  ',
        reminderIntervalMinutes: null,
        reportTimeoutMinutes: null,
      });

      const data = (tx.checkIn.update.mock.calls[0][0] as { data: Record<string, unknown> })
        .data;
      expect(data.description).toBeNull();
      expect(data.introMessage).toBeNull();
      expect(data.outroMessage).toBeNull();
      expect(data.updatesChannelId).toBeNull();
      expect(data.reportCron).toBeNull();
    });

    it('moves check-in to another team in the workspace', async () => {
      stubExistingCheckIn();
      prisma.team.findUnique.mockResolvedValue(
        makeTeam({ id: 'team-2', workspaceId: WORKSPACE_ID }),
      );
      tx.checkIn.update.mockResolvedValue({});
      tx.checkIn.findUnique.mockResolvedValue(makeCheckIn({ teamId: 'team-2' }));

      await service.update(CHECK_IN_ID, { teamId: '  team-2  ' });

      expect(tx.checkIn.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ teamId: 'team-2' }),
        }),
      );
    });

    it('replaces participants including empty list', async () => {
      stubExistingCheckIn();
      prisma.teamMember.findMany.mockResolvedValue([{ id: MEMBER_ID }]);
      tx.checkInParticipant.deleteMany.mockResolvedValue({ count: 1 });
      tx.checkInParticipant.createMany.mockResolvedValue({ count: 1 });
      tx.checkIn.update.mockResolvedValue({});
      tx.checkIn.findUnique.mockResolvedValue(makeCheckIn());

      await service.update(CHECK_IN_ID, { participantIds: [MEMBER_ID, MEMBER_ID] });

      expect(tx.checkInParticipant.deleteMany).toHaveBeenCalledWith({
        where: { checkInId: CHECK_IN_ID },
      });
      expect(tx.checkInParticipant.createMany).toHaveBeenCalled();

      await service.update(CHECK_IN_ID, { participantIds: [] });
      expect(tx.checkInParticipant.createMany).toHaveBeenCalledTimes(1);
    });

    it('syncs questions: update existing, create new, retire answered, delete unused', async () => {
      stubExistingCheckIn();
      tx.question.findMany.mockResolvedValue([
        { id: 'q-keep', _count: { answers: 0 } },
        { id: 'q-retire', _count: { answers: 2 } },
        { id: 'q-delete', _count: { answers: 0 } },
      ]);
      tx.question.update.mockResolvedValue({});
      tx.question.create.mockResolvedValue({});
      tx.question.delete.mockResolvedValue({});
      tx.checkIn.update.mockResolvedValue({});
      tx.checkIn.findUnique.mockResolvedValue(makeCheckIn());

      await service.update(CHECK_IN_ID, {
        questions: [
          {
            id: 'q-keep',
            question: '  Updated  ',
            order: 1,
            type: QuestionType.MULTIPLE_CHOICE,
            options: ['A', 'B'],
          },
          {
            question: 'Brand new',
            order: 2,
            type: QuestionType.FREE_TEXT,
          },
        ],
      });

      expect(tx.question.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q-keep' },
          data: expect.objectContaining({
            question: 'Updated',
            retiredAt: null,
            options: ['A', 'B'],
          }),
        }),
      );
      expect(tx.question.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            checkInId: CHECK_IN_ID,
            question: 'Brand new',
            options: expect.anything(),
          }),
        }),
      );
      expect(tx.question.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q-retire' },
          data: expect.objectContaining({
            isActive: false,
          }),
        }),
      );
      expect(tx.question.delete).toHaveBeenCalledWith({
        where: { id: 'q-delete' },
      });
    });

    it('uses existing reportCron for revalidation when timezone changes', async () => {
      stubExistingCheckIn();
      tx.checkIn.update.mockResolvedValue({});
      tx.checkIn.findUnique.mockResolvedValue(makeCheckIn());

      await expect(
        service.update(CHECK_IN_ID, { timezone: 'UTC' }),
      ).resolves.toBeDefined();
    });

    it('skips reportCron validation when clearing reportCron', async () => {
      stubExistingCheckIn();
      tx.checkIn.update.mockResolvedValue({});
      tx.checkIn.findUnique.mockResolvedValue(makeCheckIn());

      await expect(
        service.update(CHECK_IN_ID, { reportCron: null }),
      ).resolves.toBeDefined();
    });

    it('throws when effective timezone from existing record is empty', async () => {
      prisma.checkIn.findFirst.mockResolvedValue(
        makeCheckIn({
          timezone: '',
          collectionCron: '0 9 * * 1-5',
          reportCron: null,
        }),
      );

      await expect(
        service.update(CHECK_IN_ID, { name: 'Still Valid' }),
      ).rejects.toThrow('timezone is required.');
    });

    it('throws when existing reportCron is whitespace-only during revalidation', async () => {
      prisma.checkIn.findFirst.mockResolvedValue(
        makeCheckIn({
          timezone: 'Asia/Riyadh',
          collectionCron: '0 9 * * 1-5',
          reportCron: '   ',
        }),
      );

      await expect(
        service.update(CHECK_IN_ID, { timezone: 'UTC' }),
      ).rejects.toThrow('reportCron cannot be empty.');
    });

    it('throws when check-in is not found', async () => {
      prisma.checkIn.findFirst.mockResolvedValue(null);

      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws when teamId in update is empty', async () => {
      stubExistingCheckIn();

      await expect(
        service.update(CHECK_IN_ID, { teamId: '   ' }),
      ).rejects.toThrow('teamId cannot be empty.');
    });

    it('throws when name is empty', async () => {
      stubExistingCheckIn();

      await expect(service.update(CHECK_IN_ID, { name: ' ' })).rejects.toThrow(
        'Check-in name cannot be empty.',
      );
    });

    it('throws when timezone is empty', async () => {
      stubExistingCheckIn();

      await expect(
        service.update(CHECK_IN_ID, { timezone: '' }),
      ).rejects.toThrow('timezone cannot be empty.');
    });

    it('throws when collectionCron is empty', async () => {
      stubExistingCheckIn();

      await expect(
        service.update(CHECK_IN_ID, { collectionCron: '  ' }),
      ).rejects.toThrow('collectionCron cannot be empty.');
    });

    it('throws when reminderMinutesAfter is invalid on update', async () => {
      stubExistingCheckIn();

      await expect(
        service.update(CHECK_IN_ID, { reminderMinutesAfter: -3 }),
      ).rejects.toThrow(
        'reminderMinutesAfter must be a non-negative integer.',
      );
    });

    it('throws when new reportCron is invalid', async () => {
      stubExistingCheckIn();

      await expect(
        service.update(CHECK_IN_ID, { reportCron: 'nope' }),
      ).rejects.toThrow('reportCron is not a valid cron expression.');
    });

    it('validates new reportCron against effective timezone', async () => {
      stubExistingCheckIn();
      tx.checkIn.update.mockResolvedValue({});
      tx.checkIn.findUnique.mockResolvedValue(makeCheckIn());

      await expect(
        service.update(CHECK_IN_ID, {
          reportCron: '0 12 * * 1-5',
          timezone: 'UTC',
        }),
      ).resolves.toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // remove / setEnabled
  // -----------------------------------------------------------------------

  describe('remove', () => {
    it('deletes a check-in with no runs and refreshes scheduler', async () => {
      prisma.checkIn.findFirst.mockResolvedValue(makeCheckIn());
      tx.checkIn.findUnique.mockResolvedValue({
        team: { workspaceId: WORKSPACE_ID },
      });
      tx.standupRun.findMany.mockResolvedValue([]);
      tx.checkInParticipant.deleteMany.mockResolvedValue({ count: 0 });
      tx.question.deleteMany.mockResolvedValue({ count: 0 });
      tx.checkIn.delete.mockResolvedValue({});

      const result = await service.remove(CHECK_IN_ID);

      expect(result).toEqual({ deleted: true, id: CHECK_IN_ID });
      expect(tx.checkIn.delete).toHaveBeenCalledWith({
        where: { id: CHECK_IN_ID },
      });
      expect(schedulerRefresh).toHaveBeenCalled();
    });

    it('cascades run deletion and enqueues memory deletes for eligible answers and digests', async () => {
      prisma.checkIn.findFirst.mockResolvedValue(makeCheckIn());
      tx.checkIn.findUnique.mockResolvedValue({
        team: { workspaceId: WORKSPACE_ID },
      });
      tx.standupRun.findMany.mockResolvedValue([{ id: RUN_ID }]);
      tx.standupSubmission.findMany.mockResolvedValue([{ id: 'sub-1' }]);
      tx.answer.findMany.mockResolvedValue([
        { id: 'a-1', question: { type: QuestionType.FREE_TEXT } },
        { id: 'a-2', question: { type: QuestionType.ISSUE_REF } },
      ]);
      tx.aiDigest.findMany.mockResolvedValue([{ id: 'digest-1' }]);
      tx.answer.deleteMany.mockResolvedValue({ count: 2 });
      tx.conversationState.deleteMany.mockResolvedValue({ count: 0 });
      tx.standupThreadUpdate.deleteMany.mockResolvedValue({ count: 0 });
      tx.standupSubmission.deleteMany.mockResolvedValue({ count: 1 });
      tx.aiDigest.deleteMany.mockResolvedValue({ count: 1 });
      tx.standupRun.deleteMany.mockResolvedValue({ count: 1 });
      tx.checkInParticipant.deleteMany.mockResolvedValue({ count: 0 });
      tx.question.deleteMany.mockResolvedValue({ count: 0 });
      tx.checkIn.delete.mockResolvedValue({});

      await service.remove(CHECK_IN_ID);

      expect(memoryOutbox.enqueueDelete).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
          sourceId: 'a-1',
        }),
      );
      expect(memoryOutbox.enqueueDelete).not.toHaveBeenCalledWith(
        expect.objectContaining({ sourceId: 'a-2' }),
      );
      expect(memoryOutbox.enqueueDelete).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: MEMORY_SOURCE.REPORT,
          sourceId: 'digest-1',
        }),
      );
    });

    it('skips memory enqueue when workspaceId is null on delete cascade', async () => {
      prisma.checkIn.findFirst.mockResolvedValue(makeCheckIn());
      tx.checkIn.findUnique.mockResolvedValue({ team: { workspaceId: null } });
      tx.standupRun.findMany.mockResolvedValue([{ id: RUN_ID }]);
      tx.standupSubmission.findMany.mockResolvedValue([{ id: 'sub-1' }]);
      tx.answer.deleteMany.mockResolvedValue({ count: 0 });
      tx.conversationState.deleteMany.mockResolvedValue({ count: 0 });
      tx.standupThreadUpdate.deleteMany.mockResolvedValue({ count: 0 });
      tx.standupSubmission.deleteMany.mockResolvedValue({ count: 1 });
      tx.aiDigest.deleteMany.mockResolvedValue({ count: 0 });
      tx.standupRun.deleteMany.mockResolvedValue({ count: 1 });
      tx.checkInParticipant.deleteMany.mockResolvedValue({ count: 0 });
      tx.question.deleteMany.mockResolvedValue({ count: 0 });
      tx.checkIn.delete.mockResolvedValue({});

      await service.remove(CHECK_IN_ID);

      expect(memoryOutbox.enqueueDelete).not.toHaveBeenCalled();
      expect(tx.answer.findMany).not.toHaveBeenCalled();
    });

    it('handles runs with no submissions', async () => {
      prisma.checkIn.findFirst.mockResolvedValue(makeCheckIn());
      tx.checkIn.findUnique.mockResolvedValue({
        team: { workspaceId: WORKSPACE_ID },
      });
      tx.standupRun.findMany.mockResolvedValue([{ id: RUN_ID }]);
      tx.standupSubmission.findMany.mockResolvedValue([]);
      tx.aiDigest.findMany.mockResolvedValue([]);
      tx.standupThreadUpdate.deleteMany.mockResolvedValue({ count: 0 });
      tx.standupSubmission.deleteMany.mockResolvedValue({ count: 0 });
      tx.aiDigest.deleteMany.mockResolvedValue({ count: 0 });
      tx.standupRun.deleteMany.mockResolvedValue({ count: 1 });
      tx.checkInParticipant.deleteMany.mockResolvedValue({ count: 0 });
      tx.question.deleteMany.mockResolvedValue({ count: 0 });
      tx.checkIn.delete.mockResolvedValue({});

      await expect(service.remove(CHECK_IN_ID)).resolves.toEqual({
        deleted: true,
        id: CHECK_IN_ID,
      });
      expect(tx.answer.deleteMany).not.toHaveBeenCalled();
    });

    it('throws when check-in is not found', async () => {
      prisma.checkIn.findFirst.mockResolvedValue(null);

      await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('setEnabled', () => {
    it('enables a check-in and refreshes scheduler', async () => {
      prisma.checkIn.findFirst.mockResolvedValue(makeCheckIn());
      const updated = makeCheckIn({ enabled: true });
      prisma.checkIn.update.mockResolvedValue(updated);

      const result = await service.setEnabled(CHECK_IN_ID, true);

      expect(prisma.checkIn.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: CHECK_IN_ID },
          data: { enabled: true },
        }),
      );
      expect(schedulerRefresh).toHaveBeenCalled();
      expect(result).toEqual(updated);
    });

    it('disables a check-in', async () => {
      prisma.checkIn.findFirst.mockResolvedValue(makeCheckIn());
      prisma.checkIn.update.mockResolvedValue(makeCheckIn({ enabled: false }));

      await service.setEnabled(CHECK_IN_ID, false);

      expect(schedulerRefresh).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // duplicate
  // -----------------------------------------------------------------------

  describe('duplicate', () => {
    it('duplicates a check-in as disabled with copy name', async () => {
      const existing = makeCheckIn({
        questions: [
          {
            id: 'q-1',
            question: 'Q1',
            order: 1,
            type: QuestionType.FREE_TEXT,
            options: null,
            isRequired: true,
            isActive: true,
          },
          {
            id: 'q-2',
            question: 'Q2',
            order: 2,
            type: QuestionType.MULTIPLE_CHOICE,
            options: ['A', 'B'],
            isRequired: true,
            isActive: true,
          },
        ],
      });
      prisma.checkIn.findFirst.mockResolvedValue(existing);
      const duplicated = makeCheckIn({
        id: 'ci-copy',
        name: 'Daily Standup (Copy)',
        enabled: false,
      });
      prisma.checkIn.create.mockResolvedValue(duplicated);

      const result = await service.duplicate(CHECK_IN_ID);

      expect(prisma.checkIn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Daily Standup (Copy)',
            enabled: false,
            participants: {
              create: [{ teamMemberId: MEMBER_ID }],
            },
            questions: {
              create: expect.arrayContaining([
                expect.objectContaining({ question: 'Q1' }),
                expect.objectContaining({
                  question: 'Q2',
                  options: ['A', 'B'],
                }),
              ]),
            },
          }),
        }),
      );
      expect(schedulerRefresh).toHaveBeenCalled();
      expect(result).toEqual(duplicated);
    });

    it('omits participants when source has none', async () => {
      prisma.checkIn.findFirst.mockResolvedValue(
        makeCheckIn({ participants: [], questions: [] }),
      );
      prisma.checkIn.create.mockResolvedValue(makeCheckIn({ id: 'ci-2' }));

      await service.duplicate(CHECK_IN_ID);

      const data = (prisma.checkIn.create.mock.calls[0][0] as {
        data: { participants?: unknown };
      }).data;
      expect(data.participants).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // getActiveRuns / getRunHistory
  // -----------------------------------------------------------------------

  describe('getActiveRuns', () => {
    it('returns enriched, deduped active runs', async () => {
      const runA = makeRun({ id: 'run-a', checkInId: 'ci-a' });
      const runB = makeRun({ id: 'run-b', checkInId: 'ci-a' });
      const runC = makeRun({
        id: 'run-c',
        checkInId: 'ci-c',
        slackThreadUrl: 'https://existing.example/thread',
        startedAt: new Date(Date.now() - 10 * 60_000),
        completedAt: new Date(),
      });
      prisma.standupRun.findMany.mockResolvedValue([runA, runB, runC]);
      slackGetPermalink.mockResolvedValue('https://slack.com/permalink');

      const result = await service.getActiveRuns();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 'run-a',
          participantsResponded: 1,
          totalParticipants: 2,
          slackThreadUrl: 'https://slack.com/permalink',
          threadStatus: expect.objectContaining({ code: 'active' }),
        }),
      );
      expect(result[1]).toEqual(
        expect.objectContaining({
          id: 'run-c',
          durationMinutes: expect.any(Number),
          slackThreadUrl: 'https://existing.example/thread',
        }),
      );
    });

    it('falls back when enrichRun throws with Error', async () => {
      const run = makeRun({
        id: 'run-bad',
        submissions: null,
      });
      prisma.standupRun.findMany.mockResolvedValue([run]);

      const result = await service.getActiveRuns();

      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 'run-bad',
          participantsResponded: 0,
          totalParticipants: 0,
          slackThreadUrl: null,
          durationMinutes: null,
        }),
      );
    });

    it('counts completed submissions in enrich fallback when submissions remain readable', async () => {
      const base = makeRun({
        id: 'run-proxy',
        submissions: [
          {
            id: 'sub-1',
            status: 'completed',
            user: { id: 'u-1', slackDisplayName: 'Ada', slackUserId: 'U001' },
          },
          {
            id: 'sub-2',
            status: 'pending',
            user: { id: 'u-2', slackDisplayName: 'Bob', slackUserId: 'U002' },
          },
        ],
      });
      const run = new Proxy(base, {
        get(target, prop, receiver) {
          if (prop === 'team') {
            throw new Error('team access failed');
          }
          return Reflect.get(target, prop, receiver);
        },
      });
      prisma.standupRun.findMany.mockResolvedValue([run]);

      const result = await service.getActiveRuns();

      expect(result[0]).toEqual(
        expect.objectContaining({
          id: 'run-proxy',
          participantsResponded: 1,
          totalParticipants: 2,
          slackThreadUrl: null,
        }),
      );
    });

    it('filters out runs without checkInId during dedupe', async () => {
      prisma.standupRun.findMany.mockResolvedValue([
        makeRun({ id: 'r1', checkInId: null }),
        makeRun({ id: 'r2', checkInId: 'ci-2' }),
      ]);

      const result = await service.getActiveRuns();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('r2');
    });

    it('builds fallback Slack URL when permalink is unavailable', async () => {
      prisma.standupRun.findMany.mockResolvedValue([
        makeRun({ slackThreadUrl: null }),
      ]);
      slackGetPermalink.mockResolvedValue(null);

      const result = await service.getActiveRuns();

      expect(result[0].slackThreadUrl).toContain('app.slack.com/client/T12345678');
    });

    it('uses archive URL when workspace id is placeholder and name is usable', async () => {
      prisma.standupRun.findMany.mockResolvedValue([
        makeRun({
          slackThreadUrl: null,
          team: {
            id: TEAM_ID,
            name: 'Platform',
            workspace: {
              slackWorkspaceId: 'T0000PLACEHOLDER',
              slackWorkspaceName: 'Acme Corp!!',
            },
          },
        }),
      ]);
      moduleRefGet.mockImplementation(() => {
        throw new Error('no slack');
      });

      const result = await service.getActiveRuns();

      expect(result[0].slackThreadUrl).toContain('acme-corp.slack.com/archives');
    });

    it('returns null Slack URL when no workspace id or usable domain', async () => {
      const prev = process.env.SLACK_TEAM_ID;
      delete process.env.SLACK_TEAM_ID;
      try {
        prisma.standupRun.findMany.mockResolvedValue([
          makeRun({
            slackThreadUrl: null,
            slackChannelId: 'C001',
            slackThreadTs: '1.2',
            team: {
              id: TEAM_ID,
              name: 'Platform',
              workspace: {
                slackWorkspaceId: '',
                slackWorkspaceName: 'ab',
              },
            },
          }),
        ]);
        slackGetPermalink.mockResolvedValue(null);

        const result = await service.getActiveRuns();

        expect(result[0].slackThreadUrl).toBeNull();
      } finally {
        if (prev !== undefined) {
          process.env.SLACK_TEAM_ID = prev;
        }
      }
    });

    it('uses placeholder workspace id fallback thread URL when domain is short', async () => {
      prisma.standupRun.findMany.mockResolvedValue([
        makeRun({
          slackThreadUrl: null,
          team: {
            id: TEAM_ID,
            name: 'Platform',
            workspace: {
              slackWorkspaceId: 'T0000X',
              slackWorkspaceName: 'ab',
            },
          },
        }),
      ]);
      slackGetPermalink.mockResolvedValue(null);

      const result = await service.getActiveRuns();

      expect(result[0].slackThreadUrl).toContain('T0000X');
    });

    it('resolves thread creating/failed statuses without slack anchors', async () => {
      const fresh = makeRun({
        id: 'fresh',
        checkInId: 'ci-fresh',
        slackChannelId: null,
        slackThreadTs: null,
        status: 'collecting',
        startedAt: new Date(Date.now() - 5_000),
      });
      const waiting = makeRun({
        id: 'waiting',
        checkInId: 'ci-wait',
        slackChannelId: null,
        slackThreadTs: null,
        status: 'collecting',
        startedAt: new Date(Date.now() - 60_000),
      });
      const failed = makeRun({
        id: 'failed',
        checkInId: 'ci-fail',
        slackChannelId: null,
        slackThreadTs: null,
        status: 'collecting',
        startedAt: new Date(Date.now() - 10 * 60_000),
      });
      prisma.standupRun.findMany.mockResolvedValue([fresh, waiting, failed]);

      const result = await service.getActiveRuns();

      expect(result.map((r) => r.threadStatus.code)).toEqual([
        'creating',
        'creating',
        'failed',
      ]);
    });

    it('maps reportStatus values and trigger-mode generating transitions', async () => {
      const now = new Date();
      const runs = [
        makeRun({
          id: 'r-wait',
          checkInId: 'c1',
          reportStatus: 'waiting_for_responses',
          checkIn: {
            id: 'c1',
            name: 'A',
            timezone: 'UTC',
            updatesChannelId: null,
            reportTriggerMode: 'scheduled',
          },
        }),
        makeRun({
          id: 'r-all',
          checkInId: 'c2',
          reportStatus: 'waiting_for_responses',
          submissions: [
            { id: 's1', status: 'completed', user: { id: 'u1', slackDisplayName: 'A', slackUserId: 'U1' } },
          ],
          checkIn: {
            id: 'c2',
            name: 'B',
            timezone: 'UTC',
            updatesChannelId: null,
            reportTriggerMode: 'all_answered',
          },
        }),
        makeRun({
          id: 'r-timeout',
          checkInId: 'c3',
          reportStatus: 'waiting_for_responses',
          reportDueAt: new Date(now.getTime() - 1000),
          checkIn: {
            id: 'c3',
            name: 'C',
            timezone: 'UTC',
            updatesChannelId: null,
            reportTriggerMode: 'timeout',
          },
        }),
        makeRun({
          id: 'r-gen',
          checkInId: 'c4',
          reportStatus: 'generating',
        }),
        makeRun({
          id: 'r-ready',
          checkInId: 'c5',
          reportStatus: 'generated',
        }),
        makeRun({
          id: 'r-posting',
          checkInId: 'c6',
          reportStatus: 'posting',
        }),
        makeRun({
          id: 'r-done',
          checkInId: 'c7',
          reportStatus: 'completed',
        }),
        makeRun({
          id: 'r-gfail',
          checkInId: 'c8',
          reportStatus: 'generation_failed',
        }),
        makeRun({
          id: 'r-pfail',
          checkInId: 'c9',
          reportStatus: 'posting_failed',
        }),
      ];
      prisma.standupRun.findMany.mockResolvedValue(runs);

      const result = await service.getActiveRuns();

      expect(result[0].reportStatus.code).toBe('waiting');
      expect(result[1].reportStatus.code).toBe('generating');
      expect(result[2].reportStatus.code).toBe('generating');
      expect(result[3].reportStatus.code).toBe('generating');
      expect(result[4].reportStatus.code).toBe('ready');
      expect(result[5].reportStatus.code).toBe('posting');
      expect(result[6].reportStatus.code).toBe('posted');
      expect(result[7].reportStatus.code).toBe('generation_failed');
      expect(result[8].reportStatus.code).toBe('posting_failed');
    });

    it('infers report status from reportGeneratedAt and trigger modes without reportStatus', async () => {
      const runs = [
        makeRun({
          id: 'r-legacy',
          checkInId: 'c1',
          reportStatus: null,
          reportGeneratedAt: new Date(),
        }),
        makeRun({
          id: 'r-all2',
          checkInId: 'c2',
          reportStatus: null,
          submissions: [
            { id: 's1', status: 'completed', user: { id: 'u1', slackDisplayName: 'A', slackUserId: 'U1' } },
          ],
          checkIn: {
            id: 'c2',
            name: 'B',
            timezone: 'UTC',
            updatesChannelId: null,
            reportTriggerMode: 'all_answered',
          },
        }),
        makeRun({
          id: 'r-to2',
          checkInId: 'c3',
          reportStatus: null,
          reportDueAt: new Date(Date.now() - 1000),
          checkIn: {
            id: 'c3',
            name: 'C',
            timezone: 'UTC',
            updatesChannelId: null,
            reportTriggerMode: 'timeout',
          },
        }),
        makeRun({
          id: 'r-wait2',
          checkInId: 'c4',
          reportStatus: null,
          reportGeneratedAt: null,
          reportDueAt: null,
        }),
      ];
      prisma.standupRun.findMany.mockResolvedValue(runs);

      const result = await service.getActiveRuns();

      expect(result.map((r) => r.reportStatus.code)).toEqual([
        'posted',
        'generating',
        'generating',
        'waiting',
      ]);
    });
  });

  describe('getRunHistory', () => {
    it('returns paginated enriched history with defaults', async () => {
      const run = makeRun({ status: 'completed', completedAt: new Date() });
      prisma.standupRun.findMany.mockResolvedValue([run]);
      prisma.standupRun.count.mockResolvedValue(1);

      const result = await service.getRunHistory();

      expect(result.pagination).toEqual({
        page: 1,
        limit: 25,
        total: 1,
        totalPages: 1,
      });
      expect(result.runs[0]).toEqual(
        expect.objectContaining({ participantsResponded: 1 }),
      );
    });

    it('clamps page/limit and filters by checkInId', async () => {
      prisma.standupRun.findMany.mockResolvedValue([]);
      prisma.standupRun.count.mockResolvedValue(0);

      const result = await service.getRunHistory({
        page: 0,
        limit: 500,
        checkInId: CHECK_IN_ID,
      });

      expect(prisma.standupRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'completed',
            checkInId: CHECK_IN_ID,
          }),
          skip: 0,
          take: 100,
        }),
      );
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(100);
    });

    it('falls back when history enrichment fails', async () => {
      prisma.standupRun.findMany.mockResolvedValue([
        makeRun({ submissions: null, status: 'completed' }),
      ]);
      prisma.standupRun.count.mockResolvedValue(1);

      const result = await service.getRunHistory({ page: 2, limit: 10 });

      expect(result.runs[0]).toEqual(
        expect.objectContaining({
          participantsResponded: 0,
          totalParticipants: 0,
          slackThreadUrl: null,
        }),
      );
      expect(result.pagination.page).toBe(2);
    });

    it('falls back with non-Error enrichment failure in history', async () => {
      prisma.standupRun.findMany.mockResolvedValue([
        makeRun({
          status: 'completed',
          submissions: {
            filter() {
              throw 42;
            },
            length: 3,
          },
        }),
      ]);
      prisma.standupRun.count.mockResolvedValue(3);

      const result = await service.getRunHistory();

      expect(result.runs[0].totalParticipants).toBe(3);
      expect(result.runs[0].participantsResponded).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // deleteRun
  // -----------------------------------------------------------------------

  describe('deleteRun', () => {
    it('deletes a run and related records with memory outbox', async () => {
      prisma.standupRun.findUnique.mockResolvedValue({
        id: RUN_ID,
        checkInId: CHECK_IN_ID,
        team: { workspaceId: WORKSPACE_ID },
      });
      tx.standupSubmission.findMany.mockResolvedValue([{ id: 'sub-1' }]);
      tx.answer.findMany.mockResolvedValue([
        { id: 'a-1', question: { type: QuestionType.BLOCKER } },
        { id: 'a-2', question: { type: QuestionType.ISSUE_REF } },
      ]);
      tx.aiDigest.findMany.mockResolvedValue([{ id: 'd-1' }]);
      tx.answer.deleteMany.mockResolvedValue({ count: 2 });
      tx.conversationState.deleteMany.mockResolvedValue({ count: 0 });
      tx.standupThreadUpdate.deleteMany.mockResolvedValue({ count: 0 });
      tx.standupSubmission.deleteMany.mockResolvedValue({ count: 1 });
      tx.aiDigest.deleteMany.mockResolvedValue({ count: 1 });
      tx.standupRun.delete.mockResolvedValue({});

      const result = await service.deleteRun(RUN_ID);

      expect(result).toEqual({ deleted: true, id: RUN_ID });
      expect(memoryOutbox.enqueueDelete).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
          sourceId: 'a-1',
        }),
      );
      expect(memoryOutbox.enqueueDelete).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceType: MEMORY_SOURCE.REPORT,
          sourceId: 'd-1',
        }),
      );
      expect(tx.standupRun.delete).toHaveBeenCalledWith({
        where: { id: RUN_ID },
      });
    });

    it('handles runs with no submissions', async () => {
      prisma.standupRun.findUnique.mockResolvedValue({
        id: RUN_ID,
        checkInId: CHECK_IN_ID,
        team: { workspaceId: WORKSPACE_ID },
      });
      tx.standupSubmission.findMany.mockResolvedValue([]);
      tx.aiDigest.findMany.mockResolvedValue([]);
      tx.standupThreadUpdate.deleteMany.mockResolvedValue({ count: 0 });
      tx.standupSubmission.deleteMany.mockResolvedValue({ count: 0 });
      tx.aiDigest.deleteMany.mockResolvedValue({ count: 0 });
      tx.standupRun.delete.mockResolvedValue({});

      await expect(service.deleteRun(RUN_ID)).resolves.toEqual({
        deleted: true,
        id: RUN_ID,
      });
      expect(tx.answer.findMany).not.toHaveBeenCalled();
    });

    it('throws when run is not found', async () => {
      prisma.standupRun.findUnique.mockResolvedValue(null);

      await expect(service.deleteRun('missing')).rejects.toThrow(
        new NotFoundException('Run missing was not found.'),
      );
    });
  });

  // -----------------------------------------------------------------------
  // exportRunCsv / exportRunPdf
  // -----------------------------------------------------------------------

  describe('exportRunCsv', () => {
    function makeExportRun(overrides: Record<string, unknown> = {}) {
      return {
        id: RUN_ID,
        status: 'completed',
        startedAt: new Date('2024-01-01T09:00:00.000Z'),
        completedAt: new Date('2024-01-01T09:30:00.000Z'),
        checkIn: { name: 'Daily', timezone: 'UTC' },
        team: { name: 'Platform' },
        aiDigest: {
          generatedAt: new Date('2024-01-01T09:25:00.000Z'),
          source: 'ai',
          summary: 'All good',
          slackReportText: 'Full report "quoted"',
        },
        submissions: [
          {
            status: 'completed',
            user: { slackDisplayName: 'Ada', slackUserId: 'U1' },
            answers: [
              {
                text: 'Shipped\nfeature',
                question: { question: 'What did you do?' },
              },
            ],
          },
          {
            status: 'pending',
            user: { slackDisplayName: 'Bob', slackUserId: 'U2' },
            answers: [],
          },
        ],
        threadUpdates: [
          {
            content: 'Extra note',
            createdAt: new Date('2024-01-01T09:40:00.000Z'),
            user: { slackDisplayName: 'Ada' },
          },
        ],
        ...overrides,
      };
    }

    it('exports CSV with report, answers, and additional updates', async () => {
      prisma.standupRun.findUnique.mockResolvedValue(makeExportRun());

      const csv = await service.exportRunCsv(RUN_ID);

      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain('Section,Field,Value');
      expect(csv).toContain('Daily');
      expect(csv).toContain('Full Text');
      expect(csv).toContain('Participant,Question,Answer,Status');
      expect(csv).toContain('Additional Updates');
      expect(csv).toContain('Extra note');
    });

    it('exports CSV without slackReportText and without thread updates', async () => {
      prisma.standupRun.findUnique.mockResolvedValue(
        makeExportRun({
          completedAt: null,
          checkIn: null,
          aiDigest: {
            generatedAt: new Date('2024-01-01T09:25:00.000Z'),
            source: 'rules',
            summary: 'Summary only',
            slackReportText: null,
          },
          threadUpdates: [],
        }),
      );

      const csv = await service.exportRunCsv(RUN_ID);

      expect(csv).toContain('Summary only');
      expect(csv).not.toContain('Full Text');
      expect(csv).not.toContain('Additional Updates');
    });

    it('throws when run is missing', async () => {
      prisma.standupRun.findUnique.mockResolvedValue(null);

      await expect(service.exportRunCsv('x')).rejects.toThrow(
        new NotFoundException('Run x was not found.'),
      );
    });

    it('throws when report is not generated', async () => {
      prisma.standupRun.findUnique.mockResolvedValue(
        makeExportRun({
          aiDigest: { summary: null, slackReportText: null },
        }),
      );

      await expect(service.exportRunCsv(RUN_ID)).rejects.toThrow(
        'Report is not generated yet for this run.',
      );
    });

    it('throws when aiDigest is null', async () => {
      prisma.standupRun.findUnique.mockResolvedValue(
        makeExportRun({ aiDigest: null }),
      );

      await expect(service.exportRunCsv(RUN_ID)).rejects.toThrow(
        'Report is not generated yet for this run.',
      );
    });
  });

  describe('exportRunPdf', () => {
    function makePdfRun(overrides: Record<string, unknown> = {}) {
      return {
        id: RUN_ID,
        startedAt: new Date('2024-01-01T09:00:00.000Z'),
        completedAt: new Date('2024-01-01T09:30:00.000Z'),
        checkIn: { name: 'Daily' },
        team: { name: 'Platform' },
        aiDigest: {
          summary: 'Summary',
          slackReportText: 'Full PDF text',
        },
        submissions: [
          {
            status: 'completed',
            user: { slackDisplayName: 'Ada' },
            answers: [
              {
                text: 'Done',
                question: { question: 'Update?' },
              },
            ],
          },
        ],
        ...overrides,
      };
    }

    it('exports a text PDF report with answers', async () => {
      prisma.standupRun.findUnique.mockResolvedValue(makePdfRun());

      const pdf = await service.exportRunPdf(RUN_ID);

      expect(pdf).toContain('PULSE CHECK-IN RUN REPORT');
      expect(pdf).toContain('Daily');
      expect(pdf).toContain('Full PDF text');
      expect(pdf).toContain('Ada | Update?: Done');
    });

    it('falls back to summary and empty answers message', async () => {
      prisma.standupRun.findUnique.mockResolvedValue(
        makePdfRun({
          checkIn: null,
          completedAt: null,
          aiDigest: { summary: 'Only summary', slackReportText: null },
          submissions: [],
        }),
      );

      const pdf = await service.exportRunPdf(RUN_ID);

      expect(pdf).toContain('Unknown');
      expect(pdf).toContain('Only summary');
      expect(pdf).toContain('No answers recorded.');
      expect(pdf).toContain('—');
    });

    it('throws when run is missing', async () => {
      prisma.standupRun.findUnique.mockResolvedValue(null);

      await expect(service.exportRunPdf('x')).rejects.toThrow(
        new NotFoundException('Run x was not found.'),
      );
    });

    it('throws when report is not generated', async () => {
      prisma.standupRun.findUnique.mockResolvedValue(
        makePdfRun({ aiDigest: null }),
      );

      await expect(service.exportRunPdf(RUN_ID)).rejects.toThrow(
        'Report is not generated yet for this run.',
      );
    });
  });
});
