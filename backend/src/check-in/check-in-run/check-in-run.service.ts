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
  private readonly logger =
    new Logger(CheckInRunService.name);

  /** Conversations older than this are auto-completed when blocking a new CheckIn. */
  private readonly staleConversationMs = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async startCheckInRun(
    checkInId: string,
    scheduledFor: Date,
    triggerSource = 'scheduler',
  ) {
    const checkIn =
      await this.prisma.checkIn.findUnique({
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

    if (!checkIn.enabled && triggerSource !== 'manual') {
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

    /*
     * Reminder lifecycle belongs to the run itself rather than
     * to the scheduler transport.
     *
     * This means scheduled runs, manual runs, API-triggered runs,
     * and future run sources all receive identical reminder state.
     */
    const reminderDueAt =
      checkIn.reminderEnabled &&
      Number.isInteger(
        checkIn.reminderMinutesAfter,
      ) &&
      checkIn.reminderMinutesAfter >= 0
        ? new Date(
            scheduledFor.getTime() +
              checkIn.reminderMinutesAfter *
                60 *
                1000,
          )
        : null;

    const reportDueAt =
      checkIn.reportTriggerMode === 'timeout' &&
      checkIn.reportTimeoutMinutes &&
      checkIn.reportTimeoutMinutes > 0
        ? new Date(
            scheduledFor.getTime() +
              checkIn.reportTimeoutMinutes * 60 * 1000,
          )
        : null;

    try {
      const skippedParticipants: Array<{
        userId: string;
        slackUserId: string;
        reason: string;
      }> = [];

      const run =
        await this.prisma.$transaction(
          async (tx) => {
            const createdRun =
              await tx.standupRun.create({
                data: {
                  teamId:
                    checkIn.teamId,

                  checkInId:
                    checkIn.id,

                  scheduledFor,

                  status:
                    'collecting',

                  triggerSource,

                  reminderDueAt,

                  reminderSentAt:
                    null,

                  reportDueAt,
                },
              });

            // Close any previous collecting runs for this CheckIn so
            // participants are not permanently blocked by stale sessions.
            const supersededRuns = await tx.standupRun.findMany({
              where: {
                checkInId: checkIn.id,
                status: 'collecting',
                id: { not: createdRun.id },
              },
              select: { id: true },
            });

            if (supersededRuns.length > 0) {
              const supersededRunIds = supersededRuns.map((r) => r.id);

              await tx.standupSubmission.updateMany({
                where: {
                  runId: { in: supersededRunIds },
                  status: { in: ['pending', 'in_progress'] },
                },
                data: {
                  status: 'completed',
                  completedAt: new Date(),
                },
              });

              await tx.conversationState.updateMany({
                where: {
                  submission: { runId: { in: supersededRunIds } },
                  isCompleted: false,
                },
                data: {
                  isCompleted: true,
                  completedAt: new Date(),
                },
              });

              await tx.standupRun.updateMany({
                where: { id: { in: supersededRunIds } },
                data: {
                  status: 'completed',
                  completedAt: new Date(),
                  reminderDueAt: null,
                },
              });

              this.logger.log(
                `Closed ${supersededRunIds.length} superseded collecting run(s) for CheckIn "${checkIn.name}".`,
              );
            }

            let createdSubmissionCount =
              0;

            for (
              const participant
              of activeParticipants
            ) {
              const user =
                participant.teamMember.user;

              /*
               * A plain Slack DM does not contain a CheckIn,
               * run, or submission identifier.
               *
               * Until Slack interactions carry explicit
               * submission metadata, Pulse therefore permits
               * only one unfinished conversation per user.
               */
              const existingConversation =
                await tx.conversationState.findFirst({
                  where: {
                    userId:
                      user.id,

                    isCompleted:
                      false,
                  },

                  include: {
                    submission: {
                      include: {
                        run: {
                          select: {
                            id: true,
                            checkInId: true,
                            status: true,
                            startedAt: true,
                            checkIn: {
                              select: {
                                id: true,
                                name: true,
                              },
                            },
                          },
                        },
                      },
                    },
                  },

                  orderBy: {
                    updatedAt:
                      'desc',
                  },
                });

              if (existingConversation) {
                const shouldRelease =
                  this.shouldReleaseBlockingConversation(
                    existingConversation,
                    checkIn.id,
                  );

                if (shouldRelease) {
                  await tx.conversationState.update({
                    where: { id: existingConversation.id },
                    data: {
                      isCompleted: true,
                      completedAt: new Date(),
                    },
                  });

                  await tx.standupSubmission.update({
                    where: { id: existingConversation.submissionId },
                    data: {
                      status: 'completed',
                      completedAt: new Date(),
                    },
                  });

                  this.logger.warn(
                    `Released stale conversation for user ${user.slackUserId} to allow CheckIn "${checkIn.name}".`,
                  );
                } else {
                  const existingCheckInName =
                    existingConversation
                      .submission
                      .run
                      .checkIn
                      ?.name;

                  skippedParticipants.push({
                    userId: user.id,
                    slackUserId: user.slackUserId,
                    reason:
                      existingCheckInName
                        ? `User already has an active CheckIn: "${existingCheckInName}".`
                        : 'User already has an active standup conversation.',
                  });

                  this.logger.warn(
                    `Skipping user ${user.slackUserId} for CheckIn "${checkIn.name}" because an unfinished conversation already exists.`,
                  );

                  continue;
                }
              }

              const submission =
                await tx.standupSubmission.create({
                  data: {
                    runId:
                      createdRun.id,

                    userId:
                      user.id,

                    status:
                      'pending',
                  },
                });

              await tx.conversationState.create({
                data: {
                  userId:
                    user.id,

                  submissionId:
                    submission.id,

                  currentQuestionId:
                    checkIn.questions[0]
                      .id,

                  isCompleted:
                    false,
                },
              });

              createdSubmissionCount +=
                1;
            }

            /*
             * If every participant was skipped because they
             * already had another active conversation, this
             * occurrence has nothing left to collect.
             *
             * Complete it immediately and remove reminder state
             * so the reminder worker never tries to process it.
             */
            if (
              createdSubmissionCount ===
              0
            ) {
              await tx.standupRun.update({
                where: {
                  id:
                    createdRun.id,
                },

                data: {
                  status:
                    'completed',

                  completedAt:
                    new Date(),

                  reminderDueAt:
                    null,

                  reminderSentAt:
                    null,
                },
              });
            }

            return tx.standupRun.findUnique({
              where: {
                id:
                  createdRun.id,
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
                        slackUserId:
                          true,
                        slackDisplayName:
                          true,
                      },
                    },

                    conversationState: {
                      include: {
                        currentQuestion:
                          true,
                      },
                    },
                  },
                },
              },
            });
          },
        );

      const createdCount =
        run?.submissions.length ??
        0;

      this.logger.log(
        `Created CheckIn run ${run?.id} for "${checkIn.name}" with ${createdCount} active submission(s); ${skippedParticipants.length} participant(s) skipped.`,
      );

      if (
        run?.reminderDueAt
      ) {
        this.logger.log(
          `Reminder for CheckIn run ${run.id} is due at ${run.reminderDueAt.toISOString()}.`,
        );
      }

      return {
        status:
          'created',

        checkInId:
          checkIn.id,

        checkInName:
          checkIn.name,

        teamId:
          checkIn.team.id,

        teamName:
          checkIn.team.name,

        participantCount:
          activeParticipants.length,

        createdSubmissionCount:
          createdCount,

        skippedParticipantCount:
          skippedParticipants.length,

        skippedParticipants,

        run,
      };
    } catch (error: unknown) {
      /*
       * [checkInId, scheduledFor] remains the occurrence-level
       * idempotency boundary. Scheduler retries cannot create
       * duplicate runs for the same scheduled occurrence.
       */
      if (
        error instanceof
          Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existingRun =
          await this.prisma.standupRun.findFirst({
            where: {
              checkInId:
                checkIn.id,

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
                      slackUserId:
                        true,
                      slackDisplayName:
                        true,
                    },
                  },

                  conversationState: {
                    include: {
                      currentQuestion:
                        true,
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
          status:
            'existing',

          checkInId:
            checkIn.id,

          checkInName:
            checkIn.name,

          teamId:
            checkIn.team.id,

          teamName:
            checkIn.team.name,

          participantCount:
            activeParticipants.length,

          createdSubmissionCount:
            existingRun
              ?.submissions
              .length ?? 0,

          skippedParticipantCount:
            0,

          skippedParticipants: [],

          run:
            existingRun,
        };
      }

      throw error;
    }
  }

  async getRunForDelivery(runId: string) {
    const run = await this.prisma.standupRun.findUnique({
      where: { id: runId },
      include: {
        checkIn: {
          select: {
            id: true,
            name: true,
            introMessage: true,
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

    if (!run) {
      throw new NotFoundException(`Run ${runId} was not found.`);
    }

    if (!run.checkIn) {
      throw new BadRequestException(
        `Run ${runId} is not linked to a V2 CheckIn.`,
      );
    }

    return {
      checkInName: run.checkIn.name,
      introMessage: run.checkIn.introMessage,
      run: {
        id: run.id,
        submissions: run.submissions,
      },
    };
  }

  /**
   * Determines whether an existing unfinished conversation should be
   * auto-completed so a new CheckIn can deliver a DM to this user.
   */
  private shouldReleaseBlockingConversation(
    conversation: {
      updatedAt: Date;
      submission: {
        slackDmChannelId?: string | null;
        run: {
          checkInId: string | null;
          status: string;
          startedAt: Date;
        };
      };
    },
    targetCheckInId: string,
  ): boolean {
    const run = conversation.submission.run;

    // Legacy V1 runs without a CheckIn should not block V2 delivery.
    if (!run.checkInId) {
      return true;
    }

    // A different CheckIn's conversation should not block this one.
    if (run.checkInId !== targetCheckInId) {
      return true;
    }

    // Stale conversations (e.g. user never replied) should not block forever.
    const ageMs = Date.now() - conversation.updatedAt.getTime();
    if (ageMs > this.staleConversationMs) {
      return true;
    }

    // DM was never delivered for a collecting run — release and retry.
    if (
      !conversation.submission.slackDmChannelId &&
      run.status === 'collecting'
    ) {
      const runAgeMs = Date.now() - run.startedAt.getTime();
      if (runAgeMs > 5 * 60 * 1000) {
        return true;
      }
    }

    return false;
  }
}