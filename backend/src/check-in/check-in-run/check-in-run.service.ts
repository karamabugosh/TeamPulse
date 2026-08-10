import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
@Injectable()
export class CheckInRunService {
  private readonly logger = new Logger(CheckInRunService.name);

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async startCheckInRun(
    checkInId: string,
    scheduledFor: Date,
    triggerSource = 'scheduler',
  ) {
    const checkIn = await this.prisma.checkIn.findUnique({
      where: {
        id: checkInId,
      },
      include: {
        team: {
          select: {
            id: true,
            name: true,
          },
        },
        questions: {
          where: {
            isActive: true,
          },
          orderBy: {
            order: 'asc',
          },
        },
        participants: {
          where: {
            isActive: true,
          },
          include: {
            teamMember: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    if (!checkIn) {
      throw new NotFoundException(
        `CheckIn ${checkInId} was not found.`,
      );
    }

    if (!checkIn.enabled) {
      throw new BadRequestException(
        `CheckIn "${checkIn.name}" is disabled.`,
      );
    }

    if (checkIn.questions.length === 0) {
      throw new BadRequestException(
        `CheckIn "${checkIn.name}" has no active questions.`,
      );
    }

    const activeParticipants =
      checkIn.participants.filter(
        (participant) =>
          !participant.teamMember.optedOut,
      );

    if (activeParticipants.length === 0) {
      throw new BadRequestException(
        `CheckIn "${checkIn.name}" has no active participants.`,
      );
    }

    try {
      const run = await this.prisma.$transaction(
        async (tx) => {
          const createdRun =
            await tx.standupRun.create({
              data: {
                teamId: checkIn.teamId,
                checkInId: checkIn.id,
                scheduledFor,
                status: 'collecting',
                triggerSource,
              },
            });

          for (const participant of activeParticipants) {
            const submission =
              await tx.standupSubmission.create({
                data: {
                  runId: createdRun.id,
                  userId:
                    participant.teamMember.userId,
                  status: 'pending',
                },
              });

            await tx.conversationState.create({
              data: {
                userId:
                  participant.teamMember.userId,
                submissionId: submission.id,
                currentQuestionId:
                  checkIn.questions[0].id,
                isCompleted: false,
              },
            });
          }

          return tx.standupRun.findUnique({
            where: {
              id: createdRun.id,
            },
            include: {
              checkIn: {
                select: {
                  id: true,
                  name: true,
                },
              },
              submissions: {
                include: {
                  user: {
                    select: {
                      id: true,
                      slackUserId: true,
                      slackDisplayName: true,
                    },
                  },
                  conversationState: {
                    include: {
                      currentQuestion: true,
                    },
                  },
                },
              },
            },
          });
        },
      );

      this.logger.log(
        `Created CheckIn run ${run?.id} for "${checkIn.name}" with ${activeParticipants.length} participant(s).`,
      );

      return {
        status: 'created',
        checkInId: checkIn.id,
        checkInName: checkIn.name,
        teamId: checkIn.team.id,
        teamName: checkIn.team.name,
        run,
      };
    } catch (error: unknown) {
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existingRun =
          await this.prisma.standupRun.findFirst({
            where: {
              checkInId: checkIn.id,
              scheduledFor,
            },
            include: {
              checkIn: {
                select: {
                  id: true,
                  name: true,
                },
              },
              submissions: {
                include: {
                  user: {
                    select: {
                      id: true,
                      slackUserId: true,
                      slackDisplayName: true,
                    },
                  },
                  conversationState: {
                    include: {
                      currentQuestion: true,
                    },
                  },
                },
              },
            },
          });

        this.logger.warn(
          `Duplicate CheckIn run prevented for "${checkIn.name}" at ${scheduledFor.toISOString()}.`,
        );

        return {
          status: 'existing',
          checkInId: checkIn.id,
          checkInName: checkIn.name,
          teamId: checkIn.team.id,
          teamName: checkIn.team.name,
          run: existingRun,
        };
      }

      throw error;
    }
  }
}