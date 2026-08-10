import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCheckInDto } from './dto/create-check-in.dto';
import { UpdateCheckInDto } from './dto/update-check-in.dto';

@Injectable()
export class CheckInService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly includeRelations = {
    team: {
      select: {
        id: true,
        name: true,
        slackChannelId: true,
        timezone: true,
      },
    },
    questions: {
      orderBy: {
        order: 'asc' as const,
      },
    },
    participants: {
      where: {
        isActive: true,
      },
      include: {
        teamMember: {
          include: {
            user: {
              select: {
                id: true,
                slackUserId: true,
                slackDisplayName: true,
                email: true,
                timezone: true,
              },
            },
          },
        },
      },
    },
    runs: {
      orderBy: {
        scheduledFor: 'desc' as const,
      },
      take: 1,
      select: {
        id: true,
        scheduledFor: true,
        status: true,
        startedAt: true,
        completedAt: true,
      },
    },
  };

  async create(dto: CreateCheckInDto) {
    this.validateBasicConfiguration(dto);

    const team = await this.prisma.team.findUnique({
      where: {
        id: dto.teamId,
      },
    });

    if (!team) {
      throw new NotFoundException(
        `Team ${dto.teamId} was not found.`,
      );
    }

    const participantIds = [
      ...new Set(dto.participantIds ?? []),
    ];

    if (participantIds.length > 0) {
      await this.validateParticipants(
        dto.teamId,
        participantIds,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const checkIn = await tx.checkIn.create({
        data: {
          teamId: dto.teamId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,

          enabled: dto.enabled ?? true,

          timezone: dto.timezone.trim(),
          collectionCron: dto.collectionCron.trim(),

          reminderEnabled:
            dto.reminderEnabled ?? true,

          reminderMinutesAfter:
            dto.reminderMinutesAfter ?? 30,

          reportCron:
            dto.reportCron?.trim() || null,

          reportChannelId:
            dto.reportChannelId?.trim() || null,

          participants:
            participantIds.length > 0
              ? {
                  create: participantIds.map(
                    (teamMemberId) => ({
                      teamMemberId,
                    }),
                  ),
                }
              : undefined,

          questions:
            dto.questions &&
            dto.questions.length > 0
              ? {
                  create: dto.questions.map(
                    (question) => ({
                      question:
                        question.question.trim(),
                      order: question.order,
                      type:
                        question.type ??
                        'FREE_TEXT',
                      options:
                        question.options ??
                        Prisma.JsonNull,
                      isRequired:
                        question.isRequired ??
                        true,
                      isActive:
                        question.isActive ?? true,
                    }),
                  ),
                }
              : undefined,
        },
      });

      return tx.checkIn.findUnique({
        where: {
          id: checkIn.id,
        },
        include: this.includeRelations,
      });
    });
  }

  async findAll(teamId?: string) {
    return this.prisma.checkIn.findMany({
      where: teamId
        ? {
            teamId,
          }
        : undefined,

      include: this.includeRelations,

      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const checkIn =
      await this.prisma.checkIn.findUnique({
        where: {
          id,
        },
        include: this.includeRelations,
      });

    if (!checkIn) {
      throw new NotFoundException(
        `Check-in ${id} was not found.`,
      );
    }

    return checkIn;
  }

  async update(
    id: string,
    dto: UpdateCheckInDto,
  ) {
    const existing =
      await this.prisma.checkIn.findUnique({
        where: {
          id,
        },
      });

    if (!existing) {
      throw new NotFoundException(
        `Check-in ${id} was not found.`,
      );
    }

    this.validateUpdate(dto);

    const participantIds =
      dto.participantIds !== undefined
        ? [...new Set(dto.participantIds)]
        : undefined;

    if (participantIds !== undefined) {
      await this.validateParticipants(
        existing.teamId,
        participantIds,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      if (participantIds !== undefined) {
        await tx.checkInParticipant.deleteMany({
          where: {
            checkInId: id,
          },
        });

        if (participantIds.length > 0) {
          await tx.checkInParticipant.createMany({
            data: participantIds.map(
              (teamMemberId) => ({
                checkInId: id,
                teamMemberId,
                isActive: true,
              }),
            ),
          });
        }
      }

      if (dto.questions !== undefined) {
        const existingQuestions =
          await tx.question.findMany({
            where: {
              checkInId: id,
            },
            include: {
              _count: {
                select: {
                  answers: true,
                },
              },
            },
          });

        const deletableQuestionIds =
          existingQuestions
            .filter(
              (question) =>
                question._count.answers === 0,
            )
            .map((question) => question.id);

        const historicalQuestionIds =
          existingQuestions
            .filter(
              (question) =>
                question._count.answers > 0,
            )
            .map((question) => question.id);

        if (deletableQuestionIds.length > 0) {
          await tx.question.deleteMany({
            where: {
              id: {
                in: deletableQuestionIds,
              },
            },
          });
        }

        if (historicalQuestionIds.length > 0) {
          await tx.question.updateMany({
            where: {
              id: {
                in: historicalQuestionIds,
              },
            },
            data: {
              isActive: false,
            },
          });
        }

        if (dto.questions.length > 0) {
          await tx.question.createMany({
            data: dto.questions.map(
              (question) => ({
                checkInId: id,
                question:
                  question.question.trim(),
                order: question.order,
                type:
                  question.type ?? 'FREE_TEXT',
                options:
                  question.options ??
                  Prisma.JsonNull,
                isRequired:
                  question.isRequired ?? true,
                isActive:
                  question.isActive ?? true,
              }),
            ),
          });
        }
      }

      await tx.checkIn.update({
        where: {
          id,
        },
        data: {
          name:
            dto.name !== undefined
              ? dto.name.trim()
              : undefined,

          description:
            dto.description !== undefined
              ? dto.description?.trim() || null
              : undefined,

          enabled: dto.enabled,

          timezone:
            dto.timezone !== undefined
              ? dto.timezone.trim()
              : undefined,

          collectionCron:
            dto.collectionCron !== undefined
              ? dto.collectionCron.trim()
              : undefined,

          reminderEnabled:
            dto.reminderEnabled,

          reminderMinutesAfter:
            dto.reminderMinutesAfter,

          reportCron:
            dto.reportCron !== undefined
              ? dto.reportCron?.trim() || null
              : undefined,

          reportChannelId:
            dto.reportChannelId !== undefined
              ? dto.reportChannelId?.trim() ||
                null
              : undefined,
        },
      });

      return tx.checkIn.findUnique({
        where: {
          id,
        },
        include: this.includeRelations,
      });
    });
  }

  async remove(id: string) {
    const checkIn =
      await this.prisma.checkIn.findUnique({
        where: {
          id,
        },
        include: {
          _count: {
            select: {
              runs: true,
            },
          },
        },
      });

    if (!checkIn) {
      throw new NotFoundException(
        `Check-in ${id} was not found.`,
      );
    }

    if (checkIn._count.runs > 0) {
      const disabled =
        await this.prisma.checkIn.update({
          where: {
            id,
          },
          data: {
            enabled: false,
          },
        });

      return {
        deleted: false,
        disabled: true,
        message:
          'Check-in has historical runs, so it was disabled instead of deleted.',
        checkIn: disabled,
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.checkInParticipant.deleteMany({
        where: {
          checkInId: id,
        },
      });

      await tx.question.deleteMany({
        where: {
          checkInId: id,
        },
      });

      await tx.checkIn.delete({
        where: {
          id,
        },
      });
    });

    return {
      deleted: true,
      disabled: false,
      id,
    };
  }

  async setEnabled(
    id: string,
    enabled: boolean,
  ) {
    await this.findOne(id);

    return this.prisma.checkIn.update({
      where: {
        id,
      },
      data: {
        enabled,
      },
      include: this.includeRelations,
    });
  }

  private validateBasicConfiguration(
    dto: CreateCheckInDto,
  ) {
    if (!dto.teamId?.trim()) {
      throw new BadRequestException(
        'teamId is required.',
      );
    }

    if (!dto.name?.trim()) {
      throw new BadRequestException(
        'Check-in name is required.',
      );
    }

    if (!dto.timezone?.trim()) {
      throw new BadRequestException(
        'timezone is required.',
      );
    }

    if (!dto.collectionCron?.trim()) {
      throw new BadRequestException(
        'collectionCron is required.',
      );
    }

    if (
      dto.reminderMinutesAfter !== undefined &&
      dto.reminderMinutesAfter < 0
    ) {
      throw new BadRequestException(
        'reminderMinutesAfter cannot be negative.',
      );
    }

    this.validateQuestions(dto.questions);
  }

  private validateUpdate(dto: UpdateCheckInDto) {
    if (
      dto.name !== undefined &&
      !dto.name.trim()
    ) {
      throw new BadRequestException(
        'Check-in name cannot be empty.',
      );
    }

    if (
      dto.timezone !== undefined &&
      !dto.timezone.trim()
    ) {
      throw new BadRequestException(
        'timezone cannot be empty.',
      );
    }

    if (
      dto.collectionCron !== undefined &&
      !dto.collectionCron.trim()
    ) {
      throw new BadRequestException(
        'collectionCron cannot be empty.',
      );
    }

    if (
      dto.reminderMinutesAfter !== undefined &&
      dto.reminderMinutesAfter < 0
    ) {
      throw new BadRequestException(
        'reminderMinutesAfter cannot be negative.',
      );
    }

    this.validateQuestions(dto.questions);
  }

  private validateQuestions(
    questions:
      | Array<{
          question: string;
          order: number;
          options?: string[];
        }>
      | undefined,
  ) {
    if (!questions) {
      return;
    }

    const orders = new Set<number>();

    for (const question of questions) {
      if (!question.question?.trim()) {
        throw new BadRequestException(
          'Question text cannot be empty.',
        );
      }

      if (
        !Number.isInteger(question.order) ||
        question.order < 1
      ) {
        throw new BadRequestException(
          'Question order must be a positive integer.',
        );
      }

      if (orders.has(question.order)) {
        throw new BadRequestException(
          `Duplicate question order ${question.order}.`,
        );
      }

      orders.add(question.order);
    }
  }

  private async validateParticipants(
    teamId: string,
    participantIds: string[],
  ) {
    if (participantIds.length === 0) {
      return;
    }

    const teamMembers =
      await this.prisma.teamMember.findMany({
        where: {
          id: {
            in: participantIds,
          },
          teamId,
          optedOut: false,
        },
        select: {
          id: true,
        },
      });

    const validIds = new Set(
      teamMembers.map((member) => member.id),
    );

    const invalidIds = participantIds.filter(
      (id) => !validIds.has(id),
    );

    if (invalidIds.length > 0) {
      throw new BadRequestException(
        `Invalid participant TeamMember IDs: ${invalidIds.join(
          ', ',
        )}`,
      );
    }
  }
}