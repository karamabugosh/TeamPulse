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
import { CreateCheckInDto } from './dto/create-check-in.dto';
import { UpdateCheckInDto } from './dto/update-check-in.dto';

type QuestionConfigInput = {
  id?: string;
  ref?: string;
  question: string;
  order: number;
  type?: QuestionType;
  options?: string[];
  isRequired?: boolean;
  isActive?: boolean;
  dependsOnQuestionId?: string | null;
  showWhenAnswers?: string[] | null;
};

type BranchQuestionMeta = {
  id: string;
  order: number;
  type: QuestionType;
  options: Prisma.JsonValue | null;
  isActive: boolean;
};

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

                enabled:
                  dto.enabled ?? true,

                timezone:
                  dto.timezone.trim(),

                collectionCron:
                  dto.collectionCron.trim(),

                reminderEnabled:
                  dto.reminderEnabled ??
                  true,

                reminderMinutesAfter:
                  dto.reminderMinutesAfter ??
                  30,

                reportCron:
                  dto.reportCron?.trim() ||
                  null,

                reportChannelId:
                  dto.reportChannelId?.trim() ||
                  null,

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
              },
            });

          if (
            dto.questions &&
            dto.questions.length > 0
          ) {
            const createdQuestions:
              Array<{
                sourceIndex: number;
                row: BranchQuestionMeta;
              }> = [];

            const refToQuestionId =
              new Map<string, string>();

            for (
              let index = 0;
              index < dto.questions.length;
              index += 1
            ) {
              const question =
                dto.questions[index];

              const row =
                await tx.question.create({
                  data: {
                    checkInId:
                      checkIn.id,

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

                    dependsOnQuestionId:
                      null,

                    showWhenAnswers:
                      Prisma.JsonNull,
                  },
                });

              createdQuestions.push({
                sourceIndex:
                  index,

                row: {
                  id:
                    row.id,

                  order:
                    row.order,

                  type:
                    row.type,

                  options:
                    row.options,

                  isActive:
                    row.isActive,
                },
              });

              const ref =
                question.ref?.trim();

              if (ref) {
                refToQuestionId.set(
                  ref,
                  row.id,
                );
              }
            }

            const questionById =
              new Map(
                createdQuestions.map(
                  ({ row }) => [
                    row.id,
                    row,
                  ] as const,
                ),
              );

            const branchEdges:
              Array<{
                id: string;
                dependsOnQuestionId:
                  string | null;
              }> = [];

            for (
              const createdQuestion
              of createdQuestions
            ) {
              const source =
                dto.questions[
                  createdQuestion.sourceIndex
                ];

              const dependencyReference =
                source.dependsOnQuestionId
                  ?.trim() ||
                null;

              if (!dependencyReference) {
                branchEdges.push({
                  id:
                    createdQuestion.row.id,

                  dependsOnQuestionId:
                    null,
                });

                continue;
              }

              const parentId =
                refToQuestionId.get(
                  dependencyReference,
                );

              if (!parentId) {
                throw new BadRequestException(
                  `Question ${source.order} depends on "${dependencyReference}", but that reference does not match any question ref in this create request.`,
                );
              }

              const parent =
                questionById.get(
                  parentId,
                );

              if (!parent) {
                throw new BadRequestException(
                  `Could not resolve the parent question for question ${source.order}.`,
                );
              }

              this.validateBranchRule(
                createdQuestion.row,
                parent,
                source.showWhenAnswers,
              );

              await tx.question.update({
                where: {
                  id:
                    createdQuestion.row.id,
                },

                data: {
                  dependsOnQuestionId:
                    parent.id,

                  showWhenAnswers:
                    this.branchAnswersForStorage(
                      source.showWhenAnswers,
                    ),
                },
              });

              branchEdges.push({
                id:
                  createdQuestion.row.id,

                dependsOnQuestionId:
                  parent.id,
              });
            }

            this.validateNoBranchCycles(
              branchEdges,
            );
          }

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

      include:
        this.includeRelations,

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

          if (
            dto.questions !== undefined
          ) {
            const existingQuestions =
              await tx.question.findMany({
                where: {
                  checkInId:
                    id,
                },

                include: {
                  _count: {
                    select: {
                      answers:
                        true,
                    },
                  },
                },
              });

            const existingById =
              new Map(
                existingQuestions.map(
                  (question) => [
                    question.id,
                    question,
                  ] as const,
                ),
              );

            const suppliedIds =
              dto.questions
                .map(
                  (question) =>
                    question.id?.trim(),
                )
                .filter(
                  (
                    questionId,
                  ): questionId is string =>
                    Boolean(questionId),
                );

            const uniqueSuppliedIds =
              new Set(
                suppliedIds,
              );

            if (
              uniqueSuppliedIds.size !==
              suppliedIds.length
            ) {
              throw new BadRequestException(
                'The question update contains duplicate question IDs.',
              );
            }

            for (
              const suppliedId
              of suppliedIds
            ) {
              if (
                !existingById.has(
                  suppliedId,
                )
              ) {
                throw new BadRequestException(
                  `Question ${suppliedId} does not belong to check-in ${id}.`,
                );
              }
            }

            const resultingQuestions:
              Array<{
                sourceIndex: number;
                row: BranchQuestionMeta;
              }> = [];

            for (
              let index = 0;
              index < dto.questions.length;
              index += 1
            ) {
              const question =
                dto.questions[index];

              const questionId =
                question.id?.trim();

              const priorQuestion =
                questionId
                  ? existingById.get(
                      questionId,
                    )
                  : undefined;

              const baseData = {
                question:
                  question.question.trim(),

                order:
                  question.order,

                type:
                  question.type ??
                  priorQuestion?.type ??
                  QuestionType.FREE_TEXT,

                options:
                  question.options !==
                  undefined
                    ? question.options
                    : priorQuestion?.options ??
                      Prisma.JsonNull,

                isRequired:
                  question.isRequired ??
                  priorQuestion?.isRequired ??
                  true,

                isActive:
                  question.isActive ??
                  priorQuestion?.isActive ??
                  true,

                dependsOnQuestionId:
                  null,

                showWhenAnswers:
                  Prisma.JsonNull,
              };

              const row =
                questionId
                  ? await tx.question.update({
                      where: {
                        id:
                          questionId,
                      },

                      data:
                        baseData,
                    })
                  : await tx.question.create({
                      data: {
                        checkInId:
                          id,

                        ...baseData,
                      },
                    });

              resultingQuestions.push({
                sourceIndex:
                  index,

                row: {
                  id:
                    row.id,

                  order:
                    row.order,

                  type:
                    row.type,

                  options:
                    row.options,

                  isActive:
                    row.isActive,
                },
              });
            }

            const resultingIds =
              new Set(
                resultingQuestions.map(
                  ({ row }) =>
                    row.id,
                ),
              );

            const omittedQuestions =
              existingQuestions.filter(
                (question) =>
                  !resultingIds.has(
                    question.id,
                  ),
              );

            const deletableQuestionIds =
              omittedQuestions
                .filter(
                  (question) =>
                    question._count.answers ===
                    0,
                )
                .map(
                  (question) =>
                    question.id,
                );

            const historicalQuestionIds =
              omittedQuestions
                .filter(
                  (question) =>
                    question._count.answers >
                    0,
                )
                .map(
                  (question) =>
                    question.id,
                );

            if (
              deletableQuestionIds.length >
              0
            ) {
              await tx.question.deleteMany({
                where: {
                  id: {
                    in:
                      deletableQuestionIds,
                  },
                },
              });
            }

            if (
              historicalQuestionIds.length >
              0
            ) {
              await tx.question.updateMany({
                where: {
                  id: {
                    in:
                      historicalQuestionIds,
                  },
                },

                data: {
                  isActive:
                    false,

                  dependsOnQuestionId:
                    null,

                  showWhenAnswers:
                    Prisma.JsonNull,
                },
              });
            }

            const resultingById =
              new Map(
                resultingQuestions.map(
                  ({ row }) => [
                    row.id,
                    row,
                  ] as const,
                ),
              );

            const branchEdges:
              Array<{
                id: string;
                dependsOnQuestionId:
                  string | null;
              }> = [];

            for (
              const resultingQuestion
              of resultingQuestions
            ) {
              const source =
                dto.questions[
                  resultingQuestion.sourceIndex
                ];

              const dependencyId =
                source.dependsOnQuestionId
                  ?.trim() ||
                null;

              if (!dependencyId) {
                branchEdges.push({
                  id:
                    resultingQuestion.row.id,

                  dependsOnQuestionId:
                    null,
                });

                continue;
              }

              const parent =
                resultingById.get(
                  dependencyId,
                );

              if (!parent) {
                throw new BadRequestException(
                  `Question ${source.order} depends on ${dependencyId}, but the parent question is not part of the active question configuration for this check-in.`,
                );
              }

              this.validateBranchRule(
                resultingQuestion.row,
                parent,
                source.showWhenAnswers,
              );

              await tx.question.update({
                where: {
                  id:
                    resultingQuestion.row.id,
                },

                data: {
                  dependsOnQuestionId:
                    parent.id,

                  showWhenAnswers:
                    this.branchAnswersForStorage(
                      source.showWhenAnswers,
                    ),
                },
              });

              branchEdges.push({
                id:
                  resultingQuestion.row.id,

                dependsOnQuestionId:
                  parent.id,
              });
            }

            this.validateNoBranchCycles(
              branchEdges,
            );
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

              reminderEnabled:
                dto.reminderEnabled,

              reminderMinutesAfter:
                dto.reminderMinutesAfter,

              reportCron:
                dto.reportCron !== undefined
                  ? dto.reportCron?.trim() ||
                    null
                  : undefined,

              reportChannelId:
                dto.reportChannelId !==
                undefined
                  ? dto.reportChannelId?.trim() ||
                    null
                  : undefined,
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

  async remove(id: string) {
    const checkIn =
      await this.prisma.checkIn.findUnique({
        where: {
          id,
        },

        include: {
          _count: {
            select: {
              runs:
                true,
            },
          },
        },
      });

    if (!checkIn) {
      throw new NotFoundException(
        `Check-in ${id} was not found.`,
      );
    }

    if (
      checkIn._count.runs > 0
    ) {
      const disabled =
        await this.prisma.checkIn.update({
          where: {
            id,
          },

          data: {
            enabled:
              false,
          },
        });

      await this.refreshSchedulerAfterMutation(
        `disable ${id} during delete`,
      );

      return {
        deleted:
          false,

        disabled:
          true,

        message:
          'Check-in has historical runs, so it was disabled instead of deleted.',

        checkIn:
          disabled,
      };
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.checkInParticipant.deleteMany({
          where: {
            checkInId:
              id,
          },
        });

        await tx.question.deleteMany({
          where: {
            checkInId:
              id,
          },
        });

        await tx.checkIn.delete({
          where: {
            id,
          },
        });
      },
    );

    await this.refreshSchedulerAfterMutation(
      `delete ${id}`,
    );

    return {
      deleted:
        true,

      disabled:
        false,

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
  // QUESTION VALIDATION
  // =========================================================

  private validateQuestions(
    questions:
      | QuestionConfigInput[]
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

    const refs =
      new Set<string>();

    const ids =
      new Set<string>();

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

      const questionId =
        question.id?.trim();

      if (questionId) {
        if (
          ids.has(
            questionId,
          )
        ) {
          throw new BadRequestException(
            `Duplicate question ID "${questionId}".`,
          );
        }

        ids.add(
          questionId,
        );
      }

      const ref =
        question.ref?.trim();

      if (ref) {
        if (
          refs.has(
            ref,
          )
        ) {
          throw new BadRequestException(
            `Duplicate question ref "${ref}".`,
          );
        }

        refs.add(
          ref,
        );
      }

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

      const dependency =
        question.dependsOnQuestionId
          ?.trim() ||
        null;

      const branchAnswers =
        question.showWhenAnswers ??
        null;

      if (
        dependency &&
        questionId &&
        dependency ===
          questionId
      ) {
        throw new BadRequestException(
          `Question ${question.order} cannot depend on itself.`,
        );
      }

      if (
        dependency &&
        ref &&
        dependency ===
          ref
      ) {
        throw new BadRequestException(
          `Question ${question.order} cannot depend on itself.`,
        );
      }

      if (
        dependency &&
        (
          !Array.isArray(
            branchAnswers,
          ) ||
          branchAnswers.length ===
            0
        )
      ) {
        throw new BadRequestException(
          `Question ${question.order} must provide showWhenAnswers when dependsOnQuestionId is set.`,
        );
      }

      if (
        !dependency &&
        Array.isArray(
          branchAnswers,
        ) &&
        branchAnswers.length >
          0
      ) {
        throw new BadRequestException(
          `Question ${question.order} has showWhenAnswers but no dependsOnQuestionId.`,
        );
      }

      if (
        branchAnswers !== null &&
        branchAnswers !== undefined
      ) {
        if (
          !Array.isArray(
            branchAnswers,
          )
        ) {
          throw new BadRequestException(
            `showWhenAnswers for question ${question.order} must be an array.`,
          );
        }

        const cleanedBranchAnswers =
          branchAnswers.map(
            (answer) =>
              answer?.trim(),
          );

        if (
          cleanedBranchAnswers.some(
            (answer) =>
              !answer,
          )
        ) {
          throw new BadRequestException(
            `Question ${question.order} contains an empty branch answer.`,
          );
        }

        const normalizedBranchAnswers =
          cleanedBranchAnswers.map(
            (answer) =>
              answer.toLowerCase(),
          );

        if (
          new Set(
            normalizedBranchAnswers,
          ).size !==
          normalizedBranchAnswers.length
        ) {
          throw new BadRequestException(
            `Question ${question.order} contains duplicate branch answers.`,
          );
        }
      }
    }
  }

  private branchAnswersForStorage(
    answers:
      | string[]
      | null
      | undefined,
  ):
    | Prisma.InputJsonValue
    | typeof Prisma.JsonNull {
    if (
      !answers ||
      answers.length === 0
    ) {
      return Prisma.JsonNull;
    }

    return answers.map(
      (answer) =>
        answer
          .trim()
          .toLowerCase(),
    );
  }

  private parseStringOptions(
    value: Prisma.JsonValue | null,
  ): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter(
        (
          option,
        ): option is string =>
          typeof option ===
          'string',
      )
      .map(
        (option) =>
          option
            .trim()
            .toLowerCase(),
      )
      .filter(Boolean);
  }

  private validateBranchRule(
    child: BranchQuestionMeta,
    parent: BranchQuestionMeta,
    showWhenAnswers:
      | string[]
      | null
      | undefined,
  ): void {
    if (
      child.id ===
      parent.id
    ) {
      throw new BadRequestException(
        `Question ${child.order} cannot depend on itself.`,
      );
    }

    if (!parent.isActive) {
      throw new BadRequestException(
        `Question ${child.order} cannot depend on inactive question ${parent.order}.`,
      );
    }

    if (
      parent.order >=
      child.order
    ) {
      throw new BadRequestException(
        `Question ${child.order} must appear after its parent question ${parent.order}.`,
      );
    }

    if (
      !showWhenAnswers ||
      showWhenAnswers.length ===
        0
    ) {
      throw new BadRequestException(
        `Question ${child.order} must define at least one showWhenAnswers value.`,
      );
    }

    const normalized =
      showWhenAnswers.map(
        (answer) =>
          answer
            .trim()
            .toLowerCase(),
      );

    let allowed:
      Set<string> | null =
      null;

    switch (parent.type) {
      case QuestionType.YES_NO:
        allowed =
          new Set([
            'yes',
            'no',
          ]);
        break;

      case QuestionType.YES_NO_MAYBE:
        allowed =
          new Set([
            'yes',
            'no',
            'maybe',
          ]);
        break;

      case QuestionType.SCALE_1_5:
        allowed =
          new Set([
            '1',
            '2',
            '3',
            '4',
            '5',
          ]);
        break;

      case QuestionType.MULTIPLE_CHOICE:
        allowed =
          new Set(
            this.parseStringOptions(
              parent.options,
            ),
          );
        break;

      case QuestionType.FREE_TEXT:
        allowed =
          null;
        break;

      default:
        allowed =
          null;
    }

    if (allowed) {
      const invalidAnswers =
        normalized.filter(
          (answer) =>
            !allowed!.has(
              answer,
            ),
        );

      if (
        invalidAnswers.length >
        0
      ) {
        throw new BadRequestException(
          `Question ${child.order} contains invalid branch answer(s) for parent question ${parent.order}: ${invalidAnswers.join(
            ', ',
          )}.`,
        );
      }
    }
  }

  private validateNoBranchCycles(
    questions:
      Array<{
        id: string;
        dependsOnQuestionId:
          string | null;
      }>,
  ): void {
    const parentByQuestionId =
      new Map(
        questions.map(
          (question) => [
            question.id,
            question.dependsOnQuestionId,
          ] as const,
        ),
      );

    for (
      const question
      of questions
    ) {
      const visited =
        new Set<string>();

      let currentId:
        string | null =
        question.id;

      while (currentId) {
        if (
          visited.has(
            currentId,
          )
        ) {
          throw new BadRequestException(
            'Question branching contains a circular dependency.',
          );
        }

        visited.add(
          currentId,
        );

        currentId =
          parentByQuestionId.get(
            currentId,
          ) ??
          null;
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
          id:
            true,
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
          !validIds.has(
            id,
          ),
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
}