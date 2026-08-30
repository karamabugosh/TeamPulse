import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { TeamService } from './team.service';
import { PrismaService } from '../prisma/prisma.service';

type PrismaMock = {
  workspace: {
    findUnique: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
  team: {
    create: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
    findUnique: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
    findMany: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
  user: {
    findUnique: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
  teamMember: {
    upsert: jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;
  };
};

const workspace = {
  id: 'ws-1',
  slackWorkspaceId: 'T001',
  slackWorkspaceName: 'Acme',
  installedAt: new Date('2024-01-01T00:00:00.000Z'),
};

const team = {
  id: 'team-1',
  workspaceId: 'ws-1',
  name: 'Platform',
  slackChannelId: 'C001',
  scheduleCron: '0 0 9 * * 0-4',
  timezone: 'Asia/Riyadh',
  schedulerEnabled: true,
  createdAt: new Date('2024-01-02T00:00:00.000Z'),
  updatedAt: new Date('2024-01-02T00:00:00.000Z'),
};

const user = {
  id: 'user-1',
  workspaceId: 'ws-1',
  slackUserId: 'U001',
  slackDisplayName: 'Ada',
  email: 'ada@example.com',
  timezone: 'Asia/Riyadh',
  createdAt: new Date('2024-01-03T00:00:00.000Z'),
};

const membership = {
  id: 'tm-1',
  teamId: 'team-1',
  userId: 'user-1',
  role: 'member',
  optedOut: false,
  team,
  user,
};

describe('TeamService', () => {
  let service: TeamService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = {
      workspace: { findUnique: jest.fn() },
      team: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      user: { findUnique: jest.fn() },
      teamMember: { upsert: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(TeamService);
  });

  describe('createTeam', () => {
    it('creates a team with defaults when optional fields are omitted', async () => {
      // Arrange
      prisma.workspace.findUnique.mockResolvedValue(workspace);
      prisma.team.create.mockResolvedValue({ ...team, teamMembers: [] });

      // Act
      const result = await service.createTeam({
        workspaceId: '  ws-1  ',
        name: '  Platform  ',
      });

      // Assert
      expect(prisma.workspace.findUnique).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
      });
      expect(prisma.team.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            workspaceId: 'ws-1',
            name: 'Platform',
            slackChannelId: null,
            scheduleCron: '0 0 9 * * 0-4',
            timezone: 'Asia/Riyadh',
            schedulerEnabled: true,
          },
        }),
      );
      expect(result).toEqual({ ...team, teamMembers: [] });
    });

    it('creates a team with provided optional fields including schedulerEnabled false', async () => {
      // Arrange
      prisma.workspace.findUnique.mockResolvedValue(workspace);
      prisma.team.create.mockResolvedValue(team);

      // Act
      await service.createTeam({
        workspaceId: 'ws-1',
        name: 'Platform',
        slackChannelId: '  C001  ',
        scheduleCron: '  0 0 10 * * 1-5  ',
        timezone: '  UTC  ',
        schedulerEnabled: false,
      });

      // Assert
      expect(prisma.team.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slackChannelId: 'C001',
            scheduleCron: '0 0 10 * * 1-5',
            timezone: 'UTC',
            schedulerEnabled: false,
          }),
        }),
      );
    });

    it('throws BadRequestException when workspaceId is undefined', async () => {
      // Arrange
      const input = { name: 'Platform' } as Parameters<
        TeamService['createTeam']
      >[0];

      // Act & Assert
      await expect(service.createTeam(input)).rejects.toThrow(
        'workspaceId is required.',
      );
    });

    it('throws BadRequestException when name is undefined', async () => {
      // Arrange
      const input = { workspaceId: 'ws-1' } as Parameters<
        TeamService['createTeam']
      >[0];

      // Act & Assert
      await expect(service.createTeam(input)).rejects.toThrow(
        'name is required.',
      );
    });

    it('throws BadRequestException when workspaceId is missing', async () => {
      // Arrange
      const input = { workspaceId: '   ', name: 'Platform' };

      // Act & Assert
      await expect(service.createTeam(input)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.createTeam(input)).rejects.toThrow(
        'workspaceId is required.',
      );
      expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when name is missing', async () => {
      // Arrange
      const input = { workspaceId: 'ws-1', name: '' };

      // Act & Assert
      await expect(service.createTeam(input)).rejects.toThrow(
        'name is required.',
      );
      expect(prisma.team.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the workspace does not exist', async () => {
      // Arrange
      prisma.workspace.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.createTeam({ workspaceId: 'ws-missing', name: 'Platform' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.team.create).not.toHaveBeenCalled();
    });

    it('treats whitespace-only optional strings as unset and applies defaults', async () => {
      // Arrange
      prisma.workspace.findUnique.mockResolvedValue(workspace);
      prisma.team.create.mockResolvedValue(team);

      // Act
      await service.createTeam({
        workspaceId: 'ws-1',
        name: 'Platform',
        slackChannelId: '   ',
        scheduleCron: '   ',
        timezone: '   ',
      });

      // Assert
      expect(prisma.team.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            slackChannelId: null,
            scheduleCron: '0 0 9 * * 0-4',
            timezone: 'Asia/Riyadh',
            schedulerEnabled: true,
          }),
        }),
      );
    });

    it('propagates Prisma failure when workspace lookup fails', async () => {
      // Arrange
      prisma.workspace.findUnique.mockRejectedValue(new Error('db down'));

      // Act & Assert
      await expect(
        service.createTeam({ workspaceId: 'ws-1', name: 'Platform' }),
      ).rejects.toThrow('db down');
      expect(prisma.team.create).not.toHaveBeenCalled();
    });

    it('propagates Prisma failure when team create fails', async () => {
      // Arrange
      prisma.workspace.findUnique.mockResolvedValue(workspace);
      prisma.team.create.mockRejectedValue(new Error('unique constraint'));

      // Act & Assert
      await expect(
        service.createTeam({ workspaceId: 'ws-1', name: 'Platform' }),
      ).rejects.toThrow('unique constraint');
    });
  });

  describe('addMember', () => {
    it('adds a member looked up by userId', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue(team);
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.teamMember.upsert.mockResolvedValue(membership);

      // Act
      const result = await service.addMember({
        teamId: '  team-1  ',
        userId: '  user-1  ',
        role: '  admin  ',
      });

      // Assert
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
      expect(prisma.teamMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { teamId_userId: { teamId: 'team-1', userId: 'user-1' } },
          update: { role: 'admin', optedOut: false },
          create: { teamId: 'team-1', userId: 'user-1', role: 'admin' },
        }),
      );
      expect(result).toEqual(membership);
    });

    it('adds a member looked up by slackUserId when userId is omitted', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue(team);
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.teamMember.upsert.mockResolvedValue(membership);

      // Act
      await service.addMember({
        teamId: 'team-1',
        slackUserId: '  U001  ',
      });

      // Assert
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { slackUserId: 'U001' },
      });
      expect(prisma.teamMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { role: 'member', optedOut: false },
          create: expect.objectContaining({ role: 'member' }),
        }),
      );
    });

    it('looks up by slackUserId when userId is whitespace-only', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue(team);
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.teamMember.upsert.mockResolvedValue(membership);

      // Act
      await service.addMember({
        teamId: 'team-1',
        userId: '   ',
        slackUserId: 'U001',
      });

      // Assert
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { slackUserId: 'U001' },
      });
    });

    it('upserts an existing membership (duplicate member) instead of inserting twice', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue(team);
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.teamMember.upsert.mockResolvedValue({
        ...membership,
        role: 'lead',
      });

      // Act
      const result = await service.addMember({
        teamId: 'team-1',
        userId: 'user-1',
        role: 'lead',
      });

      // Assert
      expect(prisma.teamMember.upsert).toHaveBeenCalledTimes(1);
      expect((result as { role: string }).role).toBe('lead');
    });

    it('throws BadRequestException when teamId is undefined', async () => {
      // Arrange
      const input = { userId: 'user-1' } as Parameters<
        TeamService['addMember']
      >[0];

      // Act & Assert
      await expect(service.addMember(input)).rejects.toThrow(
        'teamId is required.',
      );
    });

    it('throws BadRequestException when teamId is missing', async () => {
      // Arrange
      const input = { teamId: '  ', userId: 'user-1' };

      // Act & Assert
      await expect(service.addMember(input)).rejects.toThrow(
        'teamId is required.',
      );
      expect(prisma.team.findUnique).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when neither userId nor slackUserId is provided', async () => {
      // Arrange
      const input = { teamId: 'team-1' };

      // Act & Assert
      await expect(service.addMember(input)).rejects.toThrow(
        'Either userId or slackUserId is required.',
      );
    });

    it('throws BadRequestException when userId and slackUserId are both whitespace', async () => {
      // Arrange
      const input = { teamId: 'team-1', userId: '  ', slackUserId: '  ' };

      // Act & Assert
      await expect(service.addMember(input)).rejects.toThrow(
        'Either userId or slackUserId is required.',
      );
    });

    it('throws NotFoundException when the team does not exist', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.addMember({ teamId: 'missing', userId: 'user-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the user id does not exist', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue(team);
      prisma.user.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.addMember({ teamId: 'team-1', userId: 'missing-user' }),
      ).rejects.toThrow('User missing-user was not found.');
    });

    it('throws NotFoundException when the Slack user does not exist', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue(team);
      prisma.user.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.addMember({ teamId: 'team-1', slackUserId: 'U-missing' }),
      ).rejects.toThrow('Slack user U-missing was not found.');
    });

    it('throws BadRequestException when the user and team are in different workspaces', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue(team);
      prisma.user.findUnique.mockResolvedValue({
        ...user,
        workspaceId: 'ws-other',
      });

      // Act & Assert
      await expect(
        service.addMember({ teamId: 'team-1', userId: 'user-1' }),
      ).rejects.toThrow(
        'The user and team must belong to the same workspace.',
      );
      expect(prisma.teamMember.upsert).not.toHaveBeenCalled();
    });

    it('defaults role to member when role is whitespace-only', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue(team);
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.teamMember.upsert.mockResolvedValue(membership);

      // Act
      await service.addMember({
        teamId: 'team-1',
        userId: 'user-1',
        role: '   ',
      });

      // Assert
      expect(prisma.teamMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { role: 'member', optedOut: false },
          create: expect.objectContaining({ role: 'member' }),
        }),
      );
    });

    it('prefers userId lookup when both userId and slackUserId are provided', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue(team);
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.teamMember.upsert.mockResolvedValue(membership);

      // Act
      await service.addMember({
        teamId: 'team-1',
        userId: 'user-1',
        slackUserId: 'U001',
      });

      // Assert
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('propagates Prisma failure when team lookup fails', async () => {
      // Arrange
      prisma.team.findUnique.mockRejectedValue(new Error('team query failed'));

      // Act & Assert
      await expect(
        service.addMember({ teamId: 'team-1', userId: 'user-1' }),
      ).rejects.toThrow('team query failed');
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('propagates Prisma failure when user lookup fails', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue(team);
      prisma.user.findUnique.mockRejectedValue(new Error('user query failed'));

      // Act & Assert
      await expect(
        service.addMember({ teamId: 'team-1', userId: 'user-1' }),
      ).rejects.toThrow('user query failed');
      expect(prisma.teamMember.upsert).not.toHaveBeenCalled();
    });

    it('propagates Prisma failure when upsert fails', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue(team);
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.teamMember.upsert.mockRejectedValue(new Error('db down'));

      // Act & Assert
      await expect(
        service.addMember({ teamId: 'team-1', userId: 'user-1' }),
      ).rejects.toThrow('db down');
    });
  });

  describe('getTeams', () => {
    it('returns teams ordered by createdAt', async () => {
      // Arrange
      const rows = [team];
      prisma.team.findMany.mockResolvedValue(rows);

      // Act
      const result = await service.getTeams();

      // Assert
      expect(result).toEqual(rows);
      expect(prisma.team.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'asc' },
        include: expect.any(Object),
      });
    });

    it('returns an empty list when no teams exist', async () => {
      // Arrange
      prisma.team.findMany.mockResolvedValue([]);

      // Act
      const result = await service.getTeams();

      // Assert
      expect(result).toEqual([]);
    });

    it('propagates Prisma failure when listing teams fails', async () => {
      // Arrange
      prisma.team.findMany.mockRejectedValue(new Error('query failed'));

      // Act & Assert
      await expect(service.getTeams()).rejects.toThrow('query failed');
    });
  });

  describe('getTeam', () => {
    it('returns an existing team', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue({ ...team, teamMembers: [] });

      // Act
      const result = await service.getTeam('team-1');

      // Assert
      expect(result).toEqual({ ...team, teamMembers: [] });
      expect(prisma.team.findUnique).toHaveBeenCalledWith({
        where: { id: 'team-1' },
        include: expect.any(Object),
      });
    });

    it('throws NotFoundException when the team does not exist', async () => {
      // Arrange
      prisma.team.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.getTeam('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.getTeam('missing')).rejects.toThrow(
        'Team missing was not found.',
      );
    });

    it('propagates Prisma failure when loading a team fails', async () => {
      // Arrange
      prisma.team.findUnique.mockRejectedValue(new Error('timeout'));

      // Act & Assert
      await expect(service.getTeam('team-1')).rejects.toThrow('timeout');
    });
  });
});
