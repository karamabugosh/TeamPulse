import { SchedulerRegistry } from '@nestjs/schedule';
import { SchedulerService } from './scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionService } from '../collection/collection.service';
import { DigestService } from '../digest/digest.service';
import { SlackService } from '../slack/slack.service';
import {
  StandupNonResponder,
  StandupResponse,
} from '../common/types/standup-response.type';

describe('SchedulerService', () => {
  let service: SchedulerService;

  let prisma: {
    team: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
    };
  };

  let schedulerRegistry: {
    doesExist: jest.Mock;
    deleteCronJob: jest.Mock;
    addCronJob: jest.Mock;
  };

  let collectionService: {
    getCompletedStandupResponses: jest.Mock;
    getTeamNonResponders: jest.Mock;
  };

  let digestService: {
    generateDailyDigest: jest.Mock;
  };

  let slackService: {
    sendMessage: jest.Mock;
  };

  const originalEnvironment = process.env;

  const team = {
    id: 'team-1',
    workspaceId: 'workspace-1',
    name: 'Pulse Test Team',
    slackChannelId: 'C123',
    scheduleCron: '0 0 9 * * 0-4',
    timezone: 'Asia/Riyadh',
    schedulerEnabled: true,
    createdAt: new Date('2026-08-05T08:00:00.000Z'),
    updatedAt: new Date('2026-08-05T08:00:00.000Z'),
  };

  const responses: StandupResponse[] = [
    {
      userId: 'U123',
      name: 'Ghassan',
      update: 'Completed scheduler testing',
      blocker: 'No blockers',
      submittedAt: '2026-08-05T10:00:00.000Z',
    },
  ];

  const nonResponders: StandupNonResponder[] = [];

  beforeEach(() => {
    process.env = {
      ...originalEnvironment,
      DIGEST_SCHEDULER_ENABLED: 'true',
      SLACK_DIGEST_ENABLED: 'true',
      SEND_EMPTY_DIGEST: 'false',
      SLACK_DIGEST_CHANNEL_ID: 'C-FALLBACK',
    };

    prisma = {
      team: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };

    schedulerRegistry = {
      doesExist: jest.fn().mockReturnValue(false),
      deleteCronJob: jest.fn(),
      addCronJob: jest.fn(),
    };

    collectionService = {
      getCompletedStandupResponses: jest
        .fn()
        .mockResolvedValue(responses),
      getTeamNonResponders: jest
        .fn()
        .mockResolvedValue(nonResponders),
    };

    digestService = {
      generateDailyDigest: jest
        .fn()
        .mockReturnValue('*Daily Standup Digest*'),
    };

    slackService = {
      sendMessage: jest.fn().mockResolvedValue(true),
    };

    service = new SchedulerService(
      prisma as unknown as PrismaService,
      schedulerRegistry as unknown as SchedulerRegistry,
      collectionService as unknown as CollectionService,
      digestService as unknown as DigestService,
      slackService as unknown as SlackService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnvironment;
  });

  it('does not register team jobs when the scheduler is disabled', async () => {
    process.env.DIGEST_SCHEDULER_ENABLED = 'false';

    const registerSpy = jest.spyOn(
      service as unknown as {
        registerTeamDigestJobs: () => Promise<void>;
      },
      'registerTeamDigestJobs',
    );

    await service.onModuleInit();

    expect(registerSpy).not.toHaveBeenCalled();
  });

  it('registers team jobs when the scheduler is enabled', async () => {
    const registerSpy = jest
      .spyOn(
        service as unknown as {
          registerTeamDigestJobs: () => Promise<void>;
        },
        'registerTeamDigestJobs',
      )
      .mockResolvedValue();

    await service.onModuleInit();

    expect(registerSpy).toHaveBeenCalledTimes(1);
  });

  it('returns disabled when manually triggered while disabled', async () => {
    process.env.DIGEST_SCHEDULER_ENABLED = 'false';

    const result = await service.runDailyDigest();

    expect(result.status).toBe('disabled');
    expect(prisma.team.findMany).not.toHaveBeenCalled();
  });

  it('runs all enabled database teams', async () => {
    prisma.team.findMany.mockResolvedValue([team]);

    const runTeamDigestSpy = jest
      .spyOn(service, 'runTeamDigest')
      .mockResolvedValue({
        teamId: team.id,
        teamName: team.name,
        status: 'success',
        responseCount: 1,
        digest: '*Daily Standup Digest*',
        slackDelivered: true,
        slackError: null,
        generatedAt: new Date().toISOString(),
      });

    const result = await service.runDailyDigest();

    expect(result).toMatchObject({
      status: 'success',
      mode: 'database-teams',
      teamCount: 1,
    });

    expect(runTeamDigestSpy).toHaveBeenCalledWith(team.id);
  });

  it('returns partial success when one team result is partial', async () => {
    prisma.team.findMany.mockResolvedValue([team]);

    jest.spyOn(service, 'runTeamDigest').mockResolvedValue({
      teamId: team.id,
      teamName: team.name,
      status: 'partial_success',
      responseCount: 1,
      digest: '*Daily Standup Digest*',
      slackDelivered: false,
      slackError: 'Slack delivery failed.',
      generatedAt: new Date().toISOString(),
    });

    const result = await service.runDailyDigest();

    expect(result.status).toBe('partial_success');
  });

  it('skips a duplicate digest run for the same team', async () => {
    const runningTeamIds = (
      service as unknown as {
        runningTeamIds: Set<string>;
      }
    ).runningTeamIds;

    runningTeamIds.add(team.id);

    const result = await service.runTeamDigest(team.id);

    expect(result).toMatchObject({
      status: 'skipped',
      teamId: team.id,
      responseCount: 0,
      slackDelivered: false,
      slackError:
        'A digest run is already in progress for this team.',
    });

    expect(prisma.team.findUnique).not.toHaveBeenCalled();
  });

  it('returns failed when the team does not exist', async () => {
    prisma.team.findUnique.mockResolvedValue(null);

    const result = await service.runTeamDigest(
      'missing-team',
    );

    expect(result.status).toBe('failed');
    expect(result.slackDelivered).toBe(false);
    expect(result.slackError).toContain(
      'Team missing-team was not found.',
    );
  });

  it('skips a team when scheduling is disabled', async () => {
    prisma.team.findUnique.mockResolvedValue({
      ...team,
      schedulerEnabled: false,
    });

    const result = await service.runTeamDigest(team.id);

    expect(result).toMatchObject({
      status: 'skipped',
      teamName: team.name,
      responseCount: 0,
      slackDelivered: false,
      slackError: 'Team scheduling is disabled.',
    });

    expect(
      collectionService.getCompletedStandupResponses,
    ).not.toHaveBeenCalled();
  });

  it('returns partial success when the team has no Slack channel', async () => {
    prisma.team.findUnique.mockResolvedValue({
      ...team,
      slackChannelId: null,
    });

    const result = await service.runTeamDigest(team.id);

    expect(
      collectionService.getCompletedStandupResponses,
    ).toHaveBeenCalledWith(team.id);

    expect(
      collectionService.getTeamNonResponders,
    ).toHaveBeenCalledWith(team.id, responses);

    expect(result).toMatchObject({
      status: 'partial_success',
      responseCount: 1,
      slackDelivered: false,
      slackError:
        'The team does not have a Slack channel configured.',
    });

    expect(slackService.sendMessage).not.toHaveBeenCalled();
  });

  it('skips posting when there are no responses and empty digests are disabled', async () => {
    prisma.team.findUnique.mockResolvedValue(team);

    collectionService.getCompletedStandupResponses.mockResolvedValue(
      [],
    );

    collectionService.getTeamNonResponders.mockResolvedValue([
      {
        userId: 'U456',
        name: 'Intern 2',
      },
    ]);

    const result = await service.runTeamDigest(team.id);

    expect(result).toMatchObject({
      status: 'skipped',
      responseCount: 0,
      slackDelivered: false,
      slackError:
        'No completed responses were found.',
    });

    expect(slackService.sendMessage).not.toHaveBeenCalled();
  });

  it('generates a team digest with responses and non-responders', async () => {
    const missingMembers: StandupNonResponder[] = [
      {
        userId: 'U456',
        name: 'Intern 2',
      },
    ];

    prisma.team.findUnique.mockResolvedValue(team);

    collectionService.getTeamNonResponders.mockResolvedValue(
      missingMembers,
    );

    const result = await service.runTeamDigest(team.id);

    expect(
      collectionService.getCompletedStandupResponses,
    ).toHaveBeenCalledWith(team.id);

    expect(
      collectionService.getTeamNonResponders,
    ).toHaveBeenCalledWith(team.id, responses);

    expect(
      digestService.generateDailyDigest,
    ).toHaveBeenCalledWith(
      responses,
      missingMembers,
    );

    expect(slackService.sendMessage).toHaveBeenCalledWith({
      channelId: team.slackChannelId,
      text: '*Daily Standup Digest*',
    });

    expect(result).toMatchObject({
      status: 'success',
      responseCount: 1,
      slackDelivered: true,
      slackError: null,
    });
  });

  it('returns partial success when Slack delivery is disabled', async () => {
    process.env.SLACK_DIGEST_ENABLED = 'false';
    prisma.team.findUnique.mockResolvedValue(team);

    const result = await service.runTeamDigest(team.id);

    expect(result).toMatchObject({
      status: 'partial_success',
      responseCount: 1,
      slackDelivered: false,
      slackError:
        'SLACK_DIGEST_ENABLED is not true.',
    });

    expect(slackService.sendMessage).not.toHaveBeenCalled();
  });

  it('returns partial success when Slack delivery fails', async () => {
    prisma.team.findUnique.mockResolvedValue(team);
    slackService.sendMessage.mockResolvedValue(false);

    const result = await service.runTeamDigest(team.id);

    expect(result).toMatchObject({
      status: 'partial_success',
      responseCount: 1,
      slackDelivered: false,
      slackError:
        'SlackService could not deliver the digest.',
    });
  });

  it('successfully posts a digest to the team channel', async () => {
    prisma.team.findUnique.mockResolvedValue(team);

    const result = await service.runTeamDigest(team.id);

    expect(slackService.sendMessage).toHaveBeenCalledWith({
      channelId: 'C123',
      text: '*Daily Standup Digest*',
    });

    expect(result).toMatchObject({
      teamId: team.id,
      teamName: team.name,
      status: 'success',
      responseCount: 1,
      slackDelivered: true,
      slackError: null,
    });
  });
});