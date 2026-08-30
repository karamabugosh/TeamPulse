import { Test, TestingModule } from '@nestjs/testing';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

type PrismaMock = {
  workspace: {
    upsert: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
  user: {
    upsert: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
  teamMember: {
    findFirst: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
    upsert: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
  team: {
    findFirst: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
    create: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
};

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaMock;
  const originalBotToken = process.env.SLACK_BOT_TOKEN;

  beforeEach(async () => {
    prisma = {
      workspace: { upsert: jest.fn() },
      user: { upsert: jest.fn() },
      teamMember: { findFirst: jest.fn(), upsert: jest.fn() },
      team: { findFirst: jest.fn(), create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  afterEach(() => {
    if (originalBotToken === undefined) {
      delete process.env.SLACK_BOT_TOKEN;
    } else {
      process.env.SLACK_BOT_TOKEN = originalBotToken;
    }
  });

  describe('syncSlackUser', () => {
    const slackUserId = 'U123';
    const slackWorkspaceId = 'T456';
    const workspace = { id: 'ws-1', slackWorkspaceId };
    const user = {
      id: 'user-1',
      slackUserId,
      workspaceId: workspace.id,
    };

    it('upserts workspace and user, and skips team provisioning when membership exists', async () => {
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      prisma.workspace.upsert.mockResolvedValue(workspace);
      prisma.user.upsert.mockResolvedValue(user);
      prisma.teamMember.findFirst.mockResolvedValue({
        id: 'tm-1',
        userId: user.id,
      });

      const result = await service.syncSlackUser(
        slackUserId,
        slackWorkspaceId,
        'Acme Corp',
      );

      expect(result).toEqual(user);
      expect(prisma.workspace.upsert).toHaveBeenCalledWith({
        where: { slackWorkspaceId },
        update: {},
        create: {
          slackWorkspaceId,
          slackWorkspaceName: 'Acme Corp',
          botToken: 'xoxb-test',
        },
      });
      expect(prisma.user.upsert).toHaveBeenCalledWith({
        where: { slackUserId },
        update: {},
        create: {
          slackUserId,
          workspaceId: workspace.id,
          slackDisplayName: slackUserId,
        },
      });
      expect(prisma.team.findFirst).not.toHaveBeenCalled();
      expect(prisma.team.create).not.toHaveBeenCalled();
      expect(prisma.teamMember.upsert).not.toHaveBeenCalled();
    });

    it('uses default workspace name and empty bot token when env and name are omitted', async () => {
      delete process.env.SLACK_BOT_TOKEN;
      prisma.workspace.upsert.mockResolvedValue(workspace);
      prisma.user.upsert.mockResolvedValue(user);
      prisma.teamMember.findFirst.mockResolvedValue({ id: 'tm-1' });

      await service.syncSlackUser(slackUserId, slackWorkspaceId);

      expect(prisma.workspace.upsert).toHaveBeenCalledWith({
        where: { slackWorkspaceId },
        update: {},
        create: {
          slackWorkspaceId,
          slackWorkspaceName: 'Unknown Workspace',
          botToken: '',
        },
      });
    });

    it('creates a General team and membership when user has no team and workspace has no teams', async () => {
      const newTeam = { id: 'team-new', workspaceId: workspace.id, name: 'General' };
      prisma.workspace.upsert.mockResolvedValue(workspace);
      prisma.user.upsert.mockResolvedValue(user);
      prisma.teamMember.findFirst.mockResolvedValue(null);
      prisma.team.findFirst.mockResolvedValue(null);
      prisma.team.create.mockResolvedValue(newTeam);
      prisma.teamMember.upsert.mockResolvedValue({ id: 'tm-new' });

      const result = await service.syncSlackUser(slackUserId, slackWorkspaceId);

      expect(result).toEqual(user);
      expect(prisma.team.findFirst).toHaveBeenCalledWith({
        where: { workspaceId: workspace.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(prisma.team.create).toHaveBeenCalledWith({
        data: {
          workspaceId: workspace.id,
          name: 'General',
          scheduleCron: '0 0 9 * * 0-4',
          timezone: 'Asia/Riyadh',
          schedulerEnabled: true,
        },
      });
      expect(prisma.teamMember.upsert).toHaveBeenCalledWith({
        where: {
          teamId_userId: {
            teamId: newTeam.id,
            userId: user.id,
          },
        },
        update: { optedOut: false },
        create: {
          teamId: newTeam.id,
          userId: user.id,
          role: 'member',
          optedOut: false,
        },
      });
    });

    it('joins the oldest existing team when membership is missing', async () => {
      const existingTeam = {
        id: 'team-old',
        workspaceId: workspace.id,
        name: 'Engineering',
      };
      prisma.workspace.upsert.mockResolvedValue(workspace);
      prisma.user.upsert.mockResolvedValue(user);
      prisma.teamMember.findFirst.mockResolvedValue(null);
      prisma.team.findFirst.mockResolvedValue(existingTeam);
      prisma.teamMember.upsert.mockResolvedValue({ id: 'tm-2' });

      await service.syncSlackUser(slackUserId, slackWorkspaceId);

      expect(prisma.team.create).not.toHaveBeenCalled();
      expect(prisma.teamMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            teamId_userId: {
              teamId: existingTeam.id,
              userId: user.id,
            },
          },
        }),
      );
    });

    it('propagates workspace upsert failures', async () => {
      prisma.workspace.upsert.mockRejectedValue(new Error('workspace write failed'));

      await expect(
        service.syncSlackUser(slackUserId, slackWorkspaceId),
      ).rejects.toThrow('workspace write failed');
      expect(prisma.user.upsert).not.toHaveBeenCalled();
    });

    it('propagates user upsert failures after workspace succeeds', async () => {
      prisma.workspace.upsert.mockResolvedValue(workspace);
      prisma.user.upsert.mockRejectedValue(new Error('user write failed'));

      await expect(
        service.syncSlackUser(slackUserId, slackWorkspaceId),
      ).rejects.toThrow('user write failed');
    });

    it('propagates teamMember upsert failures when provisioning a new membership', async () => {
      prisma.workspace.upsert.mockResolvedValue(workspace);
      prisma.user.upsert.mockResolvedValue(user);
      prisma.teamMember.findFirst.mockResolvedValue(null);
      prisma.team.findFirst.mockResolvedValue({ id: 'team-1' });
      prisma.teamMember.upsert.mockRejectedValue(new Error('member write failed'));

      await expect(
        service.syncSlackUser(slackUserId, slackWorkspaceId),
      ).rejects.toThrow('member write failed');
    });
  });
});
