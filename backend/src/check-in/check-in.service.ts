import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  QuestionType,
} from '@prisma/client';
import { ModuleRef } from '@nestjs/core';
import { CronTime } from 'cron';
import { PrismaService } from '../prisma/prisma.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { buildSlackArchiveUrl, buildSlackThreadUrl } from '../slack/slack-checkin.views';
import { SlackService } from '../slack/slack.service';
import { CreateCheckInDto } from './dto/create-check-in.dto';
import { UpdateCheckInDto } from './dto/update-check-in.dto';
import {
  buildHistoryRunView,
  matchesHistorySearch,
  parseHistorySearch,
} from './run-history.utils';

@Injectable()
export class CheckInService {
  private readonly logger =
    new Logger(CheckInService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleRef: ModuleRef,
  ) {}

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

  /**
   * Reconciles the runtime scheduler after a successful
   * CheckIn configuration mutation.
   *
   * ModuleRef is used here instead of constructor-injecting
   * SchedulerService directly because SchedulerService already
   * depends on the CheckIn run layer. Runtime lookup keeps the
   * configuration service from introducing a constructor-level
   * circular dependency.
   *
   * PostgreSQL remains the source of truth. If reconciliation
   * fails, the configuration stays persisted and the operational
   * /scheduler/refresh endpoint remains available as recovery.
   */
  private async refreshSchedulerAfterMutation(
    operation: string,
  ): Promise<void> {
    try {
      const schedulerService =
        this.moduleRef.get(
          SchedulerService,
          {
            strict: false,
          },
        );

      const result =
        await schedulerService.refreshCheckInJobs();

      this.logger.log(
        `Scheduler reconciliation after CheckIn ${operation}: ${result.status}.`,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      this.logger.error(
        `CheckIn ${operation} was persisted, but scheduler reconciliation failed: ${message}`,
        error instanceof Error
          ? error.stack
          : undefined,
      );
    }
  }

  async create(dto: CreateCheckInDto) {
    this.validateBasicConfiguration(dto);

    const team =
      await this.prisma.team.findUnique({
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
      ...new Set(
        dto.participantIds ?? [],
      ),
    ];

    if (participantIds.length > 0) {
      await this.validateParticipants(
        dto.teamId,
        participantIds,
      );
    }

    const created =
      await this.prisma.$transaction(
        async (tx) => {
          const checkIn =
            await tx.checkIn.create({
              data: {
                teamId:
                  dto.teamId,

                name:
                  dto.name.trim(),

                description:
                  dto.description?.trim() ||
                  null,

                introMessage:
                  dto.introMessage?.trim() ||
                  null,

                outroMessage:
                  dto.outroMessage?.trim() ||
                  null,

                enabled:
                  dto.enabled ?? true,

                timezone:
                  dto.timezone.trim(),

                collectionCron:
                  dto.collectionCron.trim(),

                updatesChannelId:
                  dto.updatesChannelId?.trim() ||
                  null,

                reminderEnabled:
                  dto.reminderEnabled ??
                  true,

                reminderMinutesAfter:
                  dto.reminderMinutesAfter ??
                  30,

                reminderRecurringEnabled:
                  dto.reminderRecurringEnabled ??
                  false,

                reminderIntervalMinutes:
                  dto.reminderIntervalMinutes ??
                  null,

                reminderOnlyNonResponders:
                  dto.reminderOnlyNonResponders ??
                  true,

                reminderOnSlackActive:
                  dto.reminderOnSlackActive ??
                  false,

                reportCron:
                  dto.reportCron?.trim() ||
                  null,

                reportTriggerMode:
                  dto.reportTriggerMode ??
                  'scheduled',

                reportTimeoutMinutes:
                  dto.reportTimeoutMinutes ??
                  null,

                publishStatus:
                  dto.publishStatus ?? 'published',

                scheduleEnabled:
                  dto.scheduleEnabled ?? true,

                participants:
                  participantIds.length > 0
                    ? {
                        create:
                          participantIds.map(
                            (
                              teamMemberId,
                            ) => ({
                              teamMemberId,
                            }),
                          ),
                      }
                    : undefined,

                questions:
                  dto.questions &&
                  dto.questions.length > 0
                    ? {
                        create:
                          dto.questions.map(
                            (question) => ({
                              question:
                                question.question.trim(),

                              order:
                                question.order,

                              type:
                                question.type ??
                                QuestionType.FREE_TEXT,

                              options:
                                question.options ??
                                Prisma.JsonNull,

                              isRequired:
                                question.isRequired ??
                                true,

                              isActive:
                                question.isActive ??
                                true,
                            }),
                          ),
                      }
                    : undefined,
              },
            });

          return tx.checkIn.findUnique({
            where: {
              id:
                checkIn.id,
            },

            include:
              this.includeRelations,
          });
        },
      );

    await this.refreshSchedulerAfterMutation(
      `create ${created?.id ?? 'unknown'}`,
    );

    return created;
  }

  async findAll(teamId?: string) {
    return this.prisma.checkIn.findMany({
      where: teamId
        ? {
            teamId,
          }
        : undefined,

      include: {
        ...this.includeRelations,
        _count: {
          select: {
            runs: true,
          },
        },
      },

      orderBy: {
        createdAt:
          'desc',
      },
    });
  }

  async findOne(id: string) {
    const checkIn =
      await this.prisma.checkIn.findUnique({
        where: {
          id,
        },

        include:
          this.includeRelations,
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

    /*
     * Validate the effective timezone + cron pair.
     * If only one field changes, use the existing
     * value for the other field.
     */
    const effectiveTimezone =
      dto.timezone?.trim() ||
      existing.timezone;

    const effectiveCollectionCron =
      dto.collectionCron?.trim() ||
      existing.collectionCron;

    this.validateTimezone(
      effectiveTimezone,
    );

    this.validateCron(
      effectiveCollectionCron,
      effectiveTimezone,
      'collectionCron',
    );

    if (
      dto.reportCron !== undefined
    ) {
      if (
        dto.reportCron !== null &&
        dto.reportCron.trim()
      ) {
        this.validateCron(
          dto.reportCron,
          effectiveTimezone,
          'reportCron',
        );
      }
    } else if (
      existing.reportCron
    ) {
      this.validateCron(
        existing.reportCron,
        effectiveTimezone,
        'reportCron',
      );
    }

    const participantIds =
      dto.participantIds !== undefined
        ? [
            ...new Set(
              dto.participantIds,
            ),
          ]
        : undefined;

    if (
      participantIds !== undefined
    ) {
      await this.validateParticipants(
        existing.teamId,
        participantIds,
      );
    }

    const updated =
      await this.prisma.$transaction(
        async (tx) => {
          /*
           * Replace participant configuration when explicitly
           * supplied by the update request.
           */
          if (
            participantIds !== undefined
          ) {
            await tx.checkInParticipant.deleteMany({
              where: {
                checkInId:
                  id,
              },
            });

            if (
              participantIds.length > 0
            ) {
              await tx.checkInParticipant.createMany({
                data:
                  participantIds.map(
                    (
                      teamMemberId,
                    ) => ({
                      checkInId:
                        id,

                      teamMemberId,

                      isActive:
                        true,
                    }),
                  ),
              });
            }
          }

          if (dto.questions !== undefined) {
            await this.syncCheckInQuestions(tx, id, dto.questions);
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
                  ? dto.description?.trim() ||
                    null
                  : undefined,

              introMessage:
                dto.introMessage !== undefined
                  ? dto.introMessage?.trim() || null
                  : undefined,

              outroMessage:
                dto.outroMessage !== undefined
                  ? dto.outroMessage?.trim() || null
                  : undefined,

              enabled:
                dto.enabled,

              timezone:
                dto.timezone !== undefined
                  ? dto.timezone.trim()
                  : undefined,

              collectionCron:
                dto.collectionCron !==
                undefined
                  ? dto.collectionCron.trim()
                  : undefined,

              updatesChannelId:
                dto.updatesChannelId !== undefined
                  ? dto.updatesChannelId?.trim() || null
                  : undefined,

              reminderEnabled:
                dto.reminderEnabled,

              reminderMinutesAfter:
                dto.reminderMinutesAfter,

              reminderRecurringEnabled:
                dto.reminderRecurringEnabled,

              reminderIntervalMinutes:
                dto.reminderIntervalMinutes !== undefined
                  ? dto.reminderIntervalMinutes
                  : undefined,

              reminderOnlyNonResponders:
                dto.reminderOnlyNonResponders,

              reminderOnSlackActive:
                dto.reminderOnSlackActive,

              reportCron:
                dto.reportCron !== undefined
                  ? dto.reportCron?.trim() ||
                    null
                  : undefined,

              reportTriggerMode:
                dto.reportTriggerMode,

              reportTimeoutMinutes:
                dto.reportTimeoutMinutes !== undefined
                  ? dto.reportTimeoutMinutes
                  : undefined,

              publishStatus:
                dto.publishStatus,

              scheduleEnabled:
                dto.scheduleEnabled,
            },
          });

          return tx.checkIn.findUnique({
            where: {
              id,
            },

            include:
              this.includeRelations,
          });
        },
      );

    await this.refreshSchedulerAfterMutation(
      `update ${id}`,
    );

    return updated;
  }

  private async deleteCheckInWithRuns(
    tx: Prisma.TransactionClient,
    checkInId: string,
  ) {
    const runs = await tx.standupRun.findMany({
      where: { checkInId },
      select: { id: true },
    });
    const runIds = runs.map((run) => run.id);

    if (runIds.length > 0) {
      const submissions = await tx.standupSubmission.findMany({
        where: { runId: { in: runIds } },
        select: { id: true },
      });
      const submissionIds = submissions.map((s) => s.id);

      if (submissionIds.length > 0) {
        await tx.answer.deleteMany({
          where: { submissionId: { in: submissionIds } },
        });
        await tx.conversationState.deleteMany({
          where: { submissionId: { in: submissionIds } },
        });
      }

      await tx.standupThreadUpdate.deleteMany({
        where: { runId: { in: runIds } },
      });
      await tx.standupSubmission.deleteMany({
        where: { runId: { in: runIds } },
      });
      await tx.aiDigest.deleteMany({
        where: { runId: { in: runIds } },
      });
      await tx.standupRun.deleteMany({
        where: { checkInId },
      });
    }

    await tx.checkInParticipant.deleteMany({
      where: { checkInId },
    });
    await tx.question.deleteMany({
      where: { checkInId },
    });
    await tx.checkIn.delete({
      where: { id: checkInId },
    });
  }

  async remove(id: string) {
    const checkIn =
      await this.prisma.checkIn.findUnique({
        where: { id },
      });

    if (!checkIn) {
      throw new NotFoundException(
        `Check-in ${id} was not found.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await this.deleteCheckInWithRuns(tx, id);
    });

    await this.refreshSchedulerAfterMutation(`delete ${id}`);

    return {
      deleted: true,
      id,
    };
  }

  async setEnabled(
    id: string,
    enabled: boolean,
  ) {
    await this.findOne(id);

    const updated =
      await this.prisma.checkIn.update({
        where: {
          id,
        },

        data: {
          enabled,
        },

        include:
          this.includeRelations,
      });

    await this.refreshSchedulerAfterMutation(
      `${enabled ? 'enable' : 'disable'} ${id}`,
    );

    return updated;
  }

  // =========================================================
  // CONFIGURATION VALIDATION
  // =========================================================

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

    if (
      !dto.collectionCron?.trim()
    ) {
      throw new BadRequestException(
        'collectionCron is required.',
      );
    }

    if (
      dto.reminderMinutesAfter !==
        undefined &&
      (
        !Number.isInteger(
          dto.reminderMinutesAfter,
        ) ||
        dto.reminderMinutesAfter <
          0
      )
    ) {
      throw new BadRequestException(
        'reminderMinutesAfter must be a non-negative integer.',
      );
    }

    this.validateTimezone(
      dto.timezone,
    );

    this.validateCron(
      dto.collectionCron,
      dto.timezone,
      'collectionCron',
    );

    if (
      dto.reportCron?.trim()
    ) {
      this.validateCron(
        dto.reportCron,
        dto.timezone,
        'reportCron',
      );
    }

    this.validateQuestions(
      dto.questions,
    );
  }

  private validateUpdate(
    dto: UpdateCheckInDto,
  ) {
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
      dto.collectionCron !==
        undefined &&
      !dto.collectionCron.trim()
    ) {
      throw new BadRequestException(
        'collectionCron cannot be empty.',
      );
    }

    if (
      dto.reminderMinutesAfter !==
        undefined &&
      (
        !Number.isInteger(
          dto.reminderMinutesAfter,
        ) ||
        dto.reminderMinutesAfter <
          0
      )
    ) {
      throw new BadRequestException(
        'reminderMinutesAfter must be a non-negative integer.',
      );
    }

    if (
      dto.timezone !== undefined
    ) {
      this.validateTimezone(
        dto.timezone,
      );
    }

    this.validateQuestions(
      dto.questions,
    );
  }

  private validateTimezone(
    timezone: string,
  ) {
    const cleanTimezone =
      timezone?.trim();

    if (!cleanTimezone) {
      throw new BadRequestException(
        'timezone is required.',
      );
    }

    try {
      new Intl.DateTimeFormat(
        'en-US',
        {
          timeZone:
            cleanTimezone,
        },
      ).format(
        new Date(),
      );
    } catch {
      throw new BadRequestException(
        `Invalid timezone "${cleanTimezone}". Use a valid IANA timezone such as "Asia/Riyadh".`,
      );
    }
  }

  private validateCron(
    expression: string,
    timezone: string,
    fieldName: string,
  ) {
    const cleanExpression =
      expression?.trim();

    const cleanTimezone =
      timezone?.trim();

    this.validateTimezone(
      cleanTimezone,
    );

    this.validateCronSyntax(
      cleanExpression,
      fieldName,
      cleanTimezone,
    );
  }

  private validateCronSyntax(
    expression: string,
    fieldName: string,
    timezone?: string,
  ) {
    const cleanExpression =
      expression?.trim();

    if (!cleanExpression) {
      throw new BadRequestException(
        `${fieldName} cannot be empty.`,
      );
    }

    try {
      new CronTime(
        cleanExpression,
        timezone?.trim() ||
          undefined,
      );
    } catch {
      throw new BadRequestException(
        `${fieldName} is not a valid cron expression.`,
      );
    }
  }

  // =========================================================
  // QUESTION SYNC
  // =========================================================

  private async syncCheckInQuestions(
    tx: Prisma.TransactionClient,
    checkInId: string,
    questions: NonNullable<UpdateCheckInDto['questions']>,
  ): Promise<void> {
    const existingQuestions = await tx.question.findMany({
      where: { checkInId },
      include: {
        _count: {
          select: { answers: true },
        },
      },
    });

    const existingById = new Map(
      existingQuestions.map((question) => [question.id, question]),
    );

    const retainedExistingIds = new Set<string>();

    for (const question of questions) {
      const data = {
        question: question.question.trim(),
        order: question.order,
        type: question.type ?? QuestionType.FREE_TEXT,
        options:
          question.type === QuestionType.MULTIPLE_CHOICE
            ? (question.options ?? [])
            : Prisma.JsonNull,
        isRequired: question.isRequired ?? true,
        isActive: question.isActive ?? true,
      };

      if (question.id && existingById.has(question.id)) {
        retainedExistingIds.add(question.id);

        await tx.question.update({
          where: { id: question.id },
          data,
        });
        continue;
      }

      await tx.question.create({
        data: {
          checkInId,
          ...data,
        },
      });
    }

    for (const existing of existingQuestions) {
      if (retainedExistingIds.has(existing.id)) {
        continue;
      }

      if (existing._count.answers > 0) {
        await tx.question.update({
          where: { id: existing.id },
          data: { isActive: false },
        });
        continue;
      }

      await tx.question.delete({
        where: { id: existing.id },
      });
    }
  }

  // =========================================================
  // QUESTION VALIDATION
  // =========================================================

  private validateQuestions(
    questions:
      | Array<{
          question: string;
          order: number;
          type?: QuestionType;
          options?: string[];
          isRequired?: boolean;
          isActive?: boolean;
        }>
      | undefined,
  ) {
    if (!questions) {
      return;
    }

    const orders =
      new Set<number>();

    const validTypes =
      new Set<string>(
        Object.values(
          QuestionType,
        ),
      );

    for (
      const question
      of questions
    ) {
      if (
        !question.question?.trim()
      ) {
        throw new BadRequestException(
          'Question text cannot be empty.',
        );
      }

      if (
        !Number.isInteger(
          question.order,
        ) ||
        question.order < 1
      ) {
        throw new BadRequestException(
          'Question order must be a positive integer.',
        );
      }

      if (
        orders.has(
          question.order,
        )
      ) {
        throw new BadRequestException(
          `Duplicate question order ${question.order}.`,
        );
      }

      orders.add(
        question.order,
      );

      const type =
        question.type ??
        QuestionType.FREE_TEXT;

      if (
        !validTypes.has(
          type,
        )
      ) {
        throw new BadRequestException(
          `Invalid question type "${String(
            type,
          )}".`,
        );
      }

      if (
        question.options !==
        undefined
      ) {
        if (
          !Array.isArray(
            question.options,
          )
        ) {
          throw new BadRequestException(
            `Options for question ${question.order} must be an array.`,
          );
        }

        const cleanedOptions =
          question.options.map(
            (option) =>
              option?.trim(),
          );

        if (
          cleanedOptions.some(
            (option) =>
              !option,
          )
        ) {
          throw new BadRequestException(
            `Question ${question.order} contains an empty option.`,
          );
        }

        /*
         * Option matching during collection is case-insensitive,
         * so prevent configuration that is only different by case.
         */
        const normalizedOptions =
          cleanedOptions.map(
            (option) =>
              option.toLowerCase(),
          );

        const uniqueOptions =
          new Set(
            normalizedOptions,
          );

        if (
          uniqueOptions.size !==
          normalizedOptions.length
        ) {
          throw new BadRequestException(
            `Question ${question.order} contains duplicate options.`,
          );
        }
      }

      if (
        type ===
        QuestionType.MULTIPLE_CHOICE
      ) {
        const optionCount =
          question.options?.length ??
          0;

        if (
          optionCount < 2
        ) {
          throw new BadRequestException(
            `Multiple-choice question ${question.order} must have at least two options.`,
          );
        }
      }

      if (
        type !==
          QuestionType.MULTIPLE_CHOICE &&
        question.options &&
        question.options.length >
          0
      ) {
        throw new BadRequestException(
          `Question ${question.order} only supports custom options when type is MULTIPLE_CHOICE.`,
        );
      }
    }
  }

  // =========================================================
  // PARTICIPANT VALIDATION
  // =========================================================

  private async validateParticipants(
    teamId: string,
    participantIds: string[],
  ) {
    if (
      participantIds.length ===
      0
    ) {
      return;
    }

    const teamMembers =
      await this.prisma.teamMember.findMany({
        where: {
          id: {
            in:
              participantIds,
          },

          teamId,

          optedOut:
            false,
        },

        select: {
          id: true,
        },
      });

    const validIds =
      new Set(
        teamMembers.map(
          (member) =>
            member.id,
        ),
      );

    const invalidIds =
      participantIds.filter(
        (id) =>
          !validIds.has(id),
      );

    if (
      invalidIds.length >
      0
    ) {
      throw new BadRequestException(
        `Invalid participant TeamMember IDs: ${invalidIds.join(
          ', ',
        )}`,
      );
    }
  }

  async duplicate(id: string) {
    const existing = await this.findOne(id);
    const participantIds = existing.participants.map((p) => p.teamMemberId);

    const created = await this.prisma.checkIn.create({
      data: {
        teamId: existing.teamId,
        name: `${existing.name} (Copy)`,
        description: existing.description,
        introMessage: existing.introMessage,
        outroMessage: existing.outroMessage,
        enabled: false,
        timezone: existing.timezone,
        collectionCron: existing.collectionCron,
        updatesChannelId: existing.updatesChannelId,
        reminderEnabled: existing.reminderEnabled,
        reminderMinutesAfter: existing.reminderMinutesAfter,
        reminderRecurringEnabled: existing.reminderRecurringEnabled,
        reminderIntervalMinutes: existing.reminderIntervalMinutes,
        reminderOnlyNonResponders: existing.reminderOnlyNonResponders,
        reminderOnSlackActive: existing.reminderOnSlackActive,
        reportCron: existing.reportCron,
        reportTriggerMode: existing.reportTriggerMode,
        reportTimeoutMinutes: existing.reportTimeoutMinutes,
        participants: participantIds.length > 0 ? {
          create: participantIds.map((teamMemberId) => ({ teamMemberId })),
        } : undefined,
        questions: {
          create: existing.questions.map((q) => ({
            question: q.question,
            order: q.order,
            type: q.type,
            options: q.options ? (q.options as any) : undefined,
            isRequired: q.isRequired,
            isActive: q.isActive,
          })),
        },
      },
      include: this.includeRelations,
    });

    await this.refreshSchedulerAfterMutation(`duplicate ${existing.id}`);

    return created;
  }

  async getActiveRuns() {
    const runs = await this.prisma.standupRun.findMany({
      where: {
        checkInId: { not: null },
        status: 'collecting',
      },
      include: this.runIncludeRelations,
      orderBy: { startedAt: 'desc' },
      take: 50,
    });

    const seenCheckInIds = new Set<string>();
    const dedupedRuns = runs.filter((run) => {
      if (!run.checkInId || seenCheckInIds.has(run.checkInId)) {
        return false;
      }
      seenCheckInIds.add(run.checkInId);
      return true;
    });

    return Promise.all(
      dedupedRuns.map(async (run) => {
        try {
          return await this.enrichRun(run);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Failed to enrich run ${run.id}: ${message}`,
          );
          return this.buildFallbackHistoryRun({
            ...run,
            slackThreadUrl: null,
          });
        }
      }),
    );
  }

  async getRunHistory(options?: {
    page?: number;
    limit?: number;
    checkInId?: string;
    search?: string;
  }) {
    const page = Math.max(1, options?.page ?? 1);
    const limit = Math.min(100, Math.max(1, options?.limit ?? 25));
    const skip = (page - 1) * limit;
    const search = options?.search?.trim();
    const parsedSearch = search ? parseHistorySearch(search) : {};

    const where: Prisma.StandupRunWhereInput = {
      checkInId: options?.checkInId
        ? options.checkInId
        : { not: null },
      ...(parsedSearch.text
        ? {
            OR: [
              {
                checkIn: {
                  name: { contains: parsedSearch.text, mode: 'insensitive' },
                },
              },
              {
                team: {
                  name: { contains: parsedSearch.text, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
      ...(parsedSearch.date
        ? {
            startedAt: {
              gte: new Date(
                parsedSearch.date.getFullYear(),
                parsedSearch.date.getMonth(),
                parsedSearch.date.getDate(),
              ),
              lt: new Date(
                parsedSearch.date.getFullYear(),
                parsedSearch.date.getMonth(),
                parsedSearch.date.getDate() + 1,
              ),
            },
          }
        : {}),
      ...(parsedSearch.status === 'in_progress'
        ? { status: 'collecting' }
        : parsedSearch.status === 'failed'
          ? { status: 'failed' }
          : parsedSearch.status === 'cancelled'
            ? { status: 'cancelled' }
            : {}),
    };

    const runs = await this.prisma.standupRun.findMany({
      where,
      include: this.runIncludeRelations,
      orderBy: { startedAt: 'desc' },
    });

    const enriched = await Promise.all(
      runs.map(async (run) => {
        try {
          return await this.enrichRun(run);
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Failed to enrich history run ${run.id}: ${message}`,
          );
          return this.buildFallbackHistoryRun(run);
        }
      }),
    );

    const filtered = search
      ? enriched.filter((run) => matchesHistorySearch(run, search))
      : enriched;

    const total = filtered.length;
    const paginatedRuns = filtered.slice(skip, skip + limit);

    return {
      runs: paginatedRuns,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  private readonly runIncludeRelations = {
    checkIn: {
      select: {
        id: true,
        name: true,
        timezone: true,
        updatesChannelId: true,
        reportTriggerMode: true,
        reportTimeoutMinutes: true,
        questions: {
          where: { isActive: true },
          select: {
            id: true,
            isRequired: true,
            isActive: true,
          },
          orderBy: { order: 'asc' as const },
        },
      },
    },
    team: {
      select: {
        id: true,
        name: true,
        workspace: {
          select: {
            slackWorkspaceId: true,
            slackWorkspaceName: true,
          },
        },
      },
    },
    submissions: {
      include: {
        user: {
          select: {
            id: true,
            slackDisplayName: true,
            slackUserId: true,
          },
        },
        answers: {
          select: {
            questionId: true,
          },
        },
      },
    },
    aiDigest: {
      select: {
        id: true,
        generatedAt: true,
        source: true,
        summary: true,
        generationError: true,
      },
    },
    _count: {
      select: { submissions: true },
    },
  };

  private buildFallbackHistoryRun(run: any) {
    const view = buildHistoryRunView(run);
    return {
      ...run,
      ...view,
      slackThreadUrl: run.slackThreadUrl ?? null,
      aiReport: run.aiDigest ?? null,
    };
  }

  private async enrichRun(run: any) {
    const slackWorkspaceId =
      run.team?.workspace?.slackWorkspaceId ||
      process.env.SLACK_TEAM_ID ||
      '';

    const view = buildHistoryRunView(run);

    let slackThreadUrl: string | null = run.slackThreadUrl ?? null;
    if (!slackThreadUrl && run.slackChannelId && run.slackThreadTs) {
      slackThreadUrl = await this.resolveSlackThreadUrl(
        run.slackChannelId,
        run.slackThreadTs,
        slackWorkspaceId,
        run.team?.workspace?.slackWorkspaceName,
      );
    }

    return {
      ...run,
      participantsResponded: view.participantsResponded,
      totalParticipants: view.totalParticipants,
      displayStatus: view.displayStatus,
      threadStatus: view.threadStatus,
      reportStatus: view.reportStatus,
      durationMinutes: view.durationMinutes,
      durationLabel: view.durationLabel,
      durationKind: view.durationKind,
      durationDefinition: view.durationDefinition,
      slackThreadUrl,
      aiReport: run.aiDigest ?? null,
    };
  }

  private async resolveSlackThreadUrl(
    channelId: string,
    threadTs: string,
    slackWorkspaceId: string,
    workspaceName?: string | null,
  ): Promise<string | null> {
    const fallback = this.buildFallbackSlackThreadUrl(
      channelId,
      threadTs,
      slackWorkspaceId,
      workspaceName,
    );

    try {
      const slackService = this.moduleRef.get(SlackService, {
        strict: false,
      });
      const permalink = await slackService.getPermalink(
        channelId,
        threadTs,
      );
      if (permalink) {
        return permalink;
      }
    } catch {
      // Use constructed fallback URL.
    }

    return fallback;
  }

  private buildFallbackSlackThreadUrl(
    channelId: string,
    threadTs: string,
    slackWorkspaceId: string,
    workspaceName?: string | null,
  ): string | null {
    if (slackWorkspaceId && !slackWorkspaceId.startsWith('T0000')) {
      return buildSlackThreadUrl(
        slackWorkspaceId,
        channelId,
        threadTs,
      );
    }

    const domain = workspaceName
      ?.toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (domain && domain.length > 2) {
      return buildSlackArchiveUrl(domain, channelId, threadTs);
    }

    return slackWorkspaceId
      ? buildSlackThreadUrl(slackWorkspaceId, channelId, threadTs)
      : null;
  }

  async deleteRun(runId: string) {
    const run = await this.prisma.standupRun.findUnique({
      where: { id: runId },
      select: { id: true, checkInId: true },
    });

    if (!run) {
      throw new NotFoundException(`Run ${runId} was not found.`);
    }

    await this.prisma.$transaction(async (tx) => {
      const submissions = await tx.standupSubmission.findMany({
        where: { runId },
        select: { id: true },
      });
      const submissionIds = submissions.map((submission) => submission.id);

      if (submissionIds.length > 0) {
        await tx.answer.deleteMany({
          where: { submissionId: { in: submissionIds } },
        });
        await tx.conversationState.deleteMany({
          where: { submissionId: { in: submissionIds } },
        });
      }

      await tx.standupThreadUpdate.deleteMany({ where: { runId } });
      await tx.standupSubmission.deleteMany({ where: { runId } });
      await tx.aiDigest.deleteMany({ where: { runId } });
      await tx.standupRun.delete({ where: { id: runId } });
    });

    return { deleted: true, id: runId };
  }

  async exportRunCsv(runId: string): Promise<string> {
    const run = await this.prisma.standupRun.findUnique({
      where: { id: runId },
      include: {
        checkIn: { select: { name: true, timezone: true } },
        team: { select: { name: true } },
        aiDigest: true,
        submissions: {
          include: {
            user: {
              select: {
                slackDisplayName: true,
                slackUserId: true,
              },
            },
            answers: {
              include: { question: true },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { completedAt: 'asc' },
        },
        threadUpdates: {
          where: { type: 'additional_update' },
          include: {
            user: {
              select: { slackDisplayName: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!run) {
      throw new NotFoundException(`Run ${runId} was not found.`);
    }

    if (!run.aiDigest?.slackReportText && !run.aiDigest?.summary) {
      throw new NotFoundException('Report is not generated yet for this run.');
    }

    const escape = (value: string) =>
      `"${value.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

    const lines: string[] = [];
    lines.push('Section,Field,Value');
    lines.push(
      ['Run', 'CheckIn', escape(run.checkIn?.name ?? '')].join(','),
    );
    lines.push(['Run', 'Team', escape(run.team.name)].join(','));
    lines.push(['Run', 'Run ID', escape(run.id)].join(','));
    lines.push(
      ['Run', 'Started At', escape(run.startedAt.toISOString())].join(','),
    );
    lines.push(
      ['Run', 'Completed At', escape(run.completedAt?.toISOString() ?? '')].join(','),
    );
    lines.push(['Run', 'Status', escape(run.status)].join(','));
    lines.push(
      [
        'Run',
        'Participants',
        escape(
          `${run.submissions.filter((submission) => submission.status === 'completed').length}/${run.submissions.length}`,
        ),
      ].join(','),
    );

    if (run.aiDigest) {
      lines.push(
        ['Report', 'Generated At', escape(run.aiDigest.generatedAt.toISOString())].join(','),
      );
      lines.push(['Report', 'Source', escape(run.aiDigest.source)].join(','));
      lines.push(['Report', 'Summary', escape(run.aiDigest.summary)].join(','));
      if (run.aiDigest.slackReportText) {
        lines.push(
          ['Report', 'Full Text', escape(run.aiDigest.slackReportText)].join(','),
        );
      }
    }

    lines.push('');
    lines.push('Participant,Question,Answer,Status');

    for (const submission of run.submissions) {
      for (const answer of submission.answers) {
        lines.push(
          [
            escape(submission.user.slackDisplayName),
            escape(answer.question.question),
            escape(answer.text),
            escape(submission.status),
          ].join(','),
        );
      }
    }

    if (run.threadUpdates.length > 0) {
      lines.push('');
      lines.push('Additional Updates');
      lines.push('Participant,Content,Created At');
      for (const update of run.threadUpdates) {
        lines.push(
          [
            escape(update.user.slackDisplayName),
            escape(update.content),
            escape(update.createdAt.toISOString()),
          ].join(','),
        );
      }
    }

    return '\uFEFF' + lines.join('\n');
  }

  async exportRunPdf(runId: string): Promise<string> {
    const run = await this.prisma.standupRun.findUnique({
      where: { id: runId },
      include: {
        checkIn: { select: { name: true } },
        team: { select: { name: true } },
        aiDigest: true,
        submissions: {
          include: {
            user: {
              select: { slackDisplayName: true },
            },
            answers: {
              include: { question: true },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { completedAt: 'asc' },
        },
      },
    });

    if (!run) {
      throw new NotFoundException(`Run ${runId} was not found.`);
    }

    const digest = run.aiDigest;
    if (!digest?.slackReportText && !digest?.summary) {
      throw new NotFoundException('Report is not generated yet for this run.');
    }

    const participantLines = run.submissions
      .flatMap((submission) =>
        submission.answers.map(
          (answer) =>
            `- ${submission.user.slackDisplayName} | ${answer.question.question}: ${answer.text}`,
        ),
      )
      .join('\n');

    return `
==================================================
PULSE CHECK-IN RUN REPORT
==================================================
Check-In: ${run.checkIn?.name ?? 'Unknown'}
Team: ${run.team.name}
Run ID: ${run.id}
Started: ${run.startedAt.toISOString()}
Completed: ${run.completedAt?.toISOString() ?? '—'}
Participants: ${run.submissions.filter((submission) => submission.status === 'completed').length}/${run.submissions.length}

AI REPORT
--------------------------------------------------
${digest.slackReportText ?? digest.summary}

PARTICIPANT ANSWERS
--------------------------------------------------
${participantLines || 'No answers recorded.'}
==================================================
`;
  }
}