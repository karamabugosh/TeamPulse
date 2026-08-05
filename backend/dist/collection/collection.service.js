"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var CollectionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectionService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let CollectionService = CollectionService_1 = class CollectionService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger(CollectionService_1.name);
    }
    async getOrCreateUser(userIdentifier) {
        const userBySlackId = await this.prisma.user.findUnique({
            where: {
                slackUserId: userIdentifier,
            },
        });
        if (userBySlackId) {
            return userBySlackId;
        }
        const userByInternalId = await this.prisma.user.findUnique({
            where: {
                id: userIdentifier,
            },
        });
        if (userByInternalId) {
            return userByInternalId;
        }
        const workspace = await this.prisma.workspace.findFirst({
            orderBy: {
                installedAt: 'desc',
            },
        });
        if (!workspace) {
            throw new common_1.NotFoundException('No Slack workspace exists in the database. Install the Slack app first.');
        }
        this.logger.log(`Creating database user for Slack user ${userIdentifier}`);
        return this.prisma.user.create({
            data: {
                workspaceId: workspace.id,
                slackUserId: userIdentifier,
                slackDisplayName: userIdentifier,
            },
        });
    }
    async getUserTeam(userId) {
        const membership = await this.prisma.teamMember.findFirst({
            where: {
                userId,
                optedOut: false,
                team: {
                    schedulerEnabled: true,
                },
            },
            include: {
                team: true,
            },
            orderBy: {
                joinedAt: 'asc',
            },
        });
        if (!membership) {
            throw new common_1.NotFoundException('This user is not assigned to an active team.');
        }
        return membership.team;
    }
    async createStandupSubmission(userId) {
        const team = await this.getUserTeam(userId);
        const now = new Date();
        const run = await this.prisma.standupRun.create({
            data: {
                teamId: team.id,
                scheduledFor: now,
                status: 'collecting',
                startedAt: now,
            },
        });
        const submission = await this.prisma.standupSubmission.create({
            data: {
                runId: run.id,
                userId,
                status: 'in_progress',
                startedAt: now,
            },
        });
        return {
            team,
            run,
            submission,
        };
    }
    async syncSlackUserProfile(slackUserId, slackDisplayName) {
        const user = await this.getOrCreateUser(slackUserId);
        const cleanDisplayName = slackDisplayName === null || slackDisplayName === void 0 ? void 0 : slackDisplayName.trim();
        if (!cleanDisplayName ||
            cleanDisplayName === slackUserId ||
            user.slackDisplayName === cleanDisplayName) {
            return;
        }
        await this.prisma.user.update({
            where: {
                id: user.id,
            },
            data: {
                slackDisplayName: cleanDisplayName,
            },
        });
        this.logger.log(`Updated display name for Slack user ${slackUserId}`);
    }
    async getAppHomeSummary(userIdentifier) {
        var _a;
        const user = await this.getOrCreateUser(userIdentifier);
        const activeQuestionCount = await this.prisma.question.count({
            where: {
                isActive: true,
            },
        });
        const session = await this.prisma.conversationState.findUnique({
            where: {
                userId: user.id,
            },
        });
        let status = 'not_started';
        if (session === null || session === void 0 ? void 0 : session.isCompleted) {
            status = 'completed';
        }
        else if (session === null || session === void 0 ? void 0 : session.currentQuestionId) {
            status = 'in_progress';
        }
        return {
            activeQuestionCount,
            status,
            lastCompletedAt: (_a = session === null || session === void 0 ? void 0 : session.completedAt) !== null && _a !== void 0 ? _a : null,
        };
    }
    async startConversation(userIdentifier) {
        this.logger.log(`Starting conversation for user ${userIdentifier}`);
        const user = await this.getOrCreateUser(userIdentifier);
        const userId = user.id;
        let session = await this.prisma.conversationState.findUnique({
            where: {
                userId,
            },
        });
        if (session && !session.isCompleted) {
            const currentQuestion = await this.getCurrentQuestion(userIdentifier);
            if (currentQuestion) {
                return currentQuestion;
            }
            return this.getNextQuestion(userIdentifier);
        }
        const { submission } = await this.createStandupSubmission(userId);
        const startedAt = new Date();
        if (session) {
            session =
                await this.prisma.conversationState.update({
                    where: {
                        userId,
                    },
                    data: {
                        submissionId: submission.id,
                        isCompleted: false,
                        currentQuestionId: null,
                        completedAt: null,
                        startedAt,
                    },
                });
        }
        else {
            session =
                await this.prisma.conversationState.create({
                    data: {
                        userId,
                        submissionId: submission.id,
                        startedAt,
                    },
                });
        }
        const firstQuestion = await this.prisma.question.findFirst({
            where: {
                isActive: true,
            },
            orderBy: {
                order: 'asc',
            },
        });
        if (!firstQuestion) {
            this.logger.warn('No active questions were found.');
            await this.prisma.standupSubmission.update({
                where: {
                    id: submission.id,
                },
                data: {
                    status: 'cancelled',
                    completedAt: new Date(),
                },
            });
            return null;
        }
        await this.prisma.conversationState.update({
            where: {
                userId,
            },
            data: {
                currentQuestionId: firstQuestion.id,
            },
        });
        return {
            questionId: firstQuestion.id,
            text: firstQuestion.question,
        };
    }
    async submitAnswer(userIdentifier, questionId, answer) {
        this.logger.log(`Submitting answer for question ${questionId} from user ${userIdentifier}`);
        const normalizedAnswer = answer === null || answer === void 0 ? void 0 : answer.trim();
        if (!normalizedAnswer) {
            throw new common_1.BadRequestException('Answer cannot be empty.');
        }
        const user = await this.getOrCreateUser(userIdentifier);
        const userId = user.id;
        const session = await this.prisma.conversationState.findUnique({
            where: {
                userId,
            },
        });
        if (!session ||
            session.isCompleted ||
            !session.submissionId) {
            this.logger.warn(`User ${userIdentifier} attempted to answer without an active standup submission.`);
            throw new common_1.BadRequestException('No active conversation exists for this user.');
        }
        if (session.currentQuestionId !== questionId) {
            this.logger.warn(`User ${userIdentifier} answered question ${questionId}, ` +
                `but their current question is ${session.currentQuestionId}.`);
        }
        const existingAnswer = await this.prisma.answer.findFirst({
            where: {
                submissionId: session.submissionId,
                questionId,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
        if (existingAnswer) {
            await this.prisma.answer.update({
                where: {
                    id: existingAnswer.id,
                },
                data: {
                    text: normalizedAnswer,
                },
            });
            return;
        }
        await this.prisma.answer.create({
            data: {
                userId,
                questionId,
                submissionId: session.submissionId,
                text: normalizedAnswer,
            },
        });
    }
    async getNextQuestion(userIdentifier) {
        const user = await this.getOrCreateUser(userIdentifier);
        const userId = user.id;
        const session = await this.prisma.conversationState.findUnique({
            where: {
                userId,
            },
        });
        if (!session ||
            session.isCompleted ||
            !session.submissionId) {
            return null;
        }
        const answers = await this.prisma.answer.findMany({
            where: {
                submissionId: session.submissionId,
            },
            select: {
                questionId: true,
            },
        });
        const answeredQuestionIds = answers.map((answer) => answer.questionId);
        const nextQuestion = await this.prisma.question.findFirst({
            where: {
                isActive: true,
                id: {
                    notIn: answeredQuestionIds,
                },
            },
            orderBy: {
                order: 'asc',
            },
        });
        if (!nextQuestion) {
            return null;
        }
        await this.prisma.conversationState.update({
            where: {
                userId,
            },
            data: {
                currentQuestionId: nextQuestion.id,
            },
        });
        return {
            questionId: nextQuestion.id,
            text: nextQuestion.question,
        };
    }
    async finishConversation(userIdentifier) {
        this.logger.log(`Finishing conversation for user ${userIdentifier}`);
        const user = await this.getOrCreateUser(userIdentifier);
        const userId = user.id;
        const session = await this.prisma.conversationState.findUnique({
            where: {
                userId,
            },
            include: {
                submission: true,
            },
        });
        if (!session) {
            this.logger.warn(`No conversation exists for user ${userIdentifier}`);
            throw new common_1.BadRequestException('No conversation exists for this user.');
        }
        if (session.isCompleted) {
            return;
        }
        const completedAt = new Date();
        await this.prisma.conversationState.update({
            where: {
                userId,
            },
            data: {
                isCompleted: true,
                currentQuestionId: null,
                completedAt,
            },
        });
        if (!session.submissionId || !session.submission) {
            this.logger.warn(`Conversation completed for ${userIdentifier}, but no StandupSubmission was attached.`);
            return;
        }
        await this.prisma.standupSubmission.update({
            where: {
                id: session.submissionId,
            },
            data: {
                status: 'completed',
                completedAt,
            },
        });
        const incompleteSubmissionCount = await this.prisma.standupSubmission.count({
            where: {
                runId: session.submission.runId,
                status: {
                    not: 'completed',
                },
            },
        });
        if (incompleteSubmissionCount === 0) {
            await this.prisma.standupRun.update({
                where: {
                    id: session.submission.runId,
                },
                data: {
                    status: 'completed',
                    completedAt,
                },
            });
        }
    }
    async getCurrentQuestion(userIdentifier) {
        const user = await this.getOrCreateUser(userIdentifier);
        const userId = user.id;
        const session = await this.prisma.conversationState.findUnique({
            where: {
                userId,
            },
        });
        if (!session ||
            !session.currentQuestionId ||
            session.isCompleted) {
            return null;
        }
        const question = await this.prisma.question.findUnique({
            where: {
                id: session.currentQuestionId,
            },
        });
        if (!question || !question.isActive) {
            return null;
        }
        return {
            questionId: question.id,
            text: question.question,
        };
    }
    async getCompletedStandupResponses(teamId) {
        var _a;
        const submissions = await this.prisma.standupSubmission.findMany({
            where: {
                status: 'completed',
                completedAt: {
                    not: null,
                },
                run: teamId
                    ? {
                        teamId,
                    }
                    : undefined,
                user: teamId
                    ? {
                        teamMembers: {
                            some: {
                                teamId,
                                optedOut: false,
                            },
                        },
                    }
                    : undefined,
            },
            include: {
                user: true,
                answers: {
                    include: {
                        question: true,
                    },
                    orderBy: {
                        createdAt: 'asc',
                    },
                },
            },
            orderBy: {
                completedAt: 'desc',
            },
        });
        const newestSubmissionByUser = new Map();
        for (const submission of submissions) {
            if (!newestSubmissionByUser.has(submission.userId)) {
                newestSubmissionByUser.set(submission.userId, submission);
            }
        }
        const responses = [];
        for (const submission of newestSubmissionByUser.values()) {
            if (submission.answers.length === 0) {
                continue;
            }
            const blockerAnswer = submission.answers.find((answer) => answer.question.question
                .toLowerCase()
                .includes('blocker'));
            const updateAnswers = submission.answers.filter((answer) => answer.id !== (blockerAnswer === null || blockerAnswer === void 0 ? void 0 : blockerAnswer.id));
            responses.push({
                userId: submission.user.slackUserId,
                name: submission.user.slackDisplayName ||
                    submission.user.slackUserId,
                update: updateAnswers
                    .map((answer) => `*${answer.question.question}*\n${answer.text}`)
                    .join('\n'),
                blocker: (blockerAnswer === null || blockerAnswer === void 0 ? void 0 : blockerAnswer.text) || undefined,
                submittedAt: ((_a = submission.completedAt) !== null && _a !== void 0 ? _a : new Date()).toISOString(),
            });
        }
        if (responses.length === 0) {
            return this.getLegacyCompletedResponses(teamId);
        }
        return responses;
    }
    async getLegacyCompletedResponses(teamId) {
        var _a;
        const completedSessions = await this.prisma.conversationState.findMany({
            where: {
                isCompleted: true,
                completedAt: {
                    not: null,
                },
                user: teamId
                    ? {
                        teamMembers: {
                            some: {
                                teamId,
                                optedOut: false,
                            },
                        },
                    }
                    : undefined,
            },
            include: {
                user: true,
            },
            orderBy: {
                completedAt: 'desc',
            },
        });
        const responses = [];
        for (const session of completedSessions) {
            const answers = await this.prisma.answer.findMany({
                where: {
                    userId: session.userId,
                    submissionId: null,
                    createdAt: {
                        gte: session.startedAt,
                    },
                },
                include: {
                    question: true,
                },
                orderBy: {
                    createdAt: 'asc',
                },
            });
            if (answers.length === 0) {
                continue;
            }
            const blockerAnswer = answers.find((answer) => answer.question.question
                .toLowerCase()
                .includes('blocker'));
            const updateAnswers = answers.filter((answer) => answer.id !== (blockerAnswer === null || blockerAnswer === void 0 ? void 0 : blockerAnswer.id));
            responses.push({
                userId: session.user.slackUserId,
                name: session.user.slackDisplayName ||
                    session.user.slackUserId,
                update: updateAnswers
                    .map((answer) => `*${answer.question.question}*\n${answer.text}`)
                    .join('\n'),
                blocker: (blockerAnswer === null || blockerAnswer === void 0 ? void 0 : blockerAnswer.text) || undefined,
                submittedAt: ((_a = session.completedAt) !== null && _a !== void 0 ? _a : new Date()).toISOString(),
            });
        }
        return responses;
    }
    async getTeamNonResponders(teamId, completedResponses) {
        const completedUserIds = completedResponses.map((response) => response.userId);
        const teamMembers = await this.prisma.teamMember.findMany({
            where: {
                teamId,
                optedOut: false,
                user: {
                    slackUserId: {
                        notIn: completedUserIds,
                    },
                },
            },
            include: {
                user: true,
            },
            orderBy: {
                joinedAt: 'asc',
            },
        });
        return teamMembers.map((member) => ({
            userId: member.user.slackUserId,
            name: member.user.slackDisplayName ||
                member.user.slackUserId,
        }));
    }
};
exports.CollectionService = CollectionService;
exports.CollectionService = CollectionService = CollectionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CollectionService);
//# sourceMappingURL=collection.service.js.map