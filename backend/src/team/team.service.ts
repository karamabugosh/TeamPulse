import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type CreateTeamInput = {
  workspaceId: string;
  name: string;
  slackChannelId?: string;
  scheduleCron?: string;
  timezone?: string;
  schedulerEnabled?: boolean;
};

type AddTeamMemberInput = {
  teamId: string;
  userId?: string;
  slackUserId?: string;
  role?: string;
};

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  private readonly safeTeamInclude = {
    workspace: {
      select: {
        id: true,
        slackWorkspaceId: true,
        slackWorkspaceName: true,
        installedAt: true,
      },
    },
    teamMembers: {
      include: {
        user: {
          select: {
            id: true,
            workspaceId: true,
            slackUserId: true,
            slackDisplayName: true,
            email: true,
            timezone: true,
            createdAt: true,
          },
        },
      },
    },
  };

  async createTeam(input: CreateTeamInput) {
    const workspaceId = input.workspaceId?.trim();
    const name = input.name?.trim();

    if (!workspaceId) {
      throw new BadRequestException(
        'workspaceId is required.',
      );
    }

    if (!name) {
      throw new BadRequestException(
        'name is required.',
      );
    }

    const workspace =
      await this.prisma.workspace.findUnique({
        where: {
          id: workspaceId,
        },
      });

    if (!workspace) {
      throw new NotFoundException(
        `Workspace ${workspaceId} was not found.`,
      );
    }

    return this.prisma.team.create({
      data: {
        workspaceId,
        name,
        slackChannelId:
          input.slackChannelId?.trim() || null,
        scheduleCron:
          input.scheduleCron?.trim() ||
          '0 0 9 * * 0-4',
        timezone:
          input.timezone?.trim() ||
          'Asia/Riyadh',
        schedulerEnabled:
          input.schedulerEnabled ?? true,
      },
      include: this.safeTeamInclude,
    });
  }

  async addMember(input: AddTeamMemberInput) {
    const teamId = input.teamId?.trim();
    const userId = input.userId?.trim();
    const slackUserId =
      input.slackUserId?.trim();

    if (!teamId) {
      throw new BadRequestException(
        'teamId is required.',
      );
    }

    if (!userId && !slackUserId) {
      throw new BadRequestException(
        'Either userId or slackUserId is required.',
      );
    }

    const team =
      await this.prisma.team.findUnique({
        where: {
          id: teamId,
        },
      });

    if (!team) {
      throw new NotFoundException(
        `Team ${teamId} was not found.`,
      );
    }

    const user = userId
      ? await this.prisma.user.findUnique({
          where: {
            id: userId,
          },
        })
      : await this.prisma.user.findUnique({
          where: {
            slackUserId,
          },
        });

    if (!user) {
      throw new NotFoundException(
        userId
          ? `User ${userId} was not found.`
          : `Slack user ${slackUserId} was not found.`,
      );
    }

    if (user.workspaceId !== team.workspaceId) {
      throw new BadRequestException(
        'The user and team must belong to the same workspace.',
      );
    }

    return this.prisma.teamMember.upsert({
      where: {
        teamId_userId: {
          teamId: team.id,
          userId: user.id,
        },
      },
      update: {
        role: input.role?.trim() || 'member',
        optedOut: false,
      },
      create: {
        teamId: team.id,
        userId: user.id,
        role: input.role?.trim() || 'member',
      },
      include: {
        team: {
          select: {
            id: true,
            workspaceId: true,
            name: true,
            slackChannelId: true,
            scheduleCron: true,
            timezone: true,
            schedulerEnabled: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        user: {
          select: {
            id: true,
            workspaceId: true,
            slackUserId: true,
            slackDisplayName: true,
            email: true,
            timezone: true,
            createdAt: true,
          },
        },
      },
    });
  }

  async getTeams() {
    return this.prisma.team.findMany({
      orderBy: {
        createdAt: 'asc',
      },
      include: this.safeTeamInclude,
    });
  }

  async getTeam(teamId: string) {
    const team =
      await this.prisma.team.findUnique({
        where: {
          id: teamId,
        },
        include: this.safeTeamInclude,
      });

    if (!team) {
      throw new NotFoundException(
        `Team ${teamId} was not found.`,
      );
    }

    return team;
  }
}