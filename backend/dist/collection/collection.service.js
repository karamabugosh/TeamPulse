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
    async resolveInternalUserId(userIdentifier) {
        const userBySlackId = await this.prisma.user.findUnique({
            where: {
                slackUserId: userIdentifier,
            },
            select: {
                id: true,
            },
        });
        if (userBySlackId) {
            return userBySlackId.id;
        }
        const userByInternalId = await this.prisma.user.findUnique({
            where: {
                id: userIdentifier,
            },
            select: {
                id: true,
            },
        });
        if (userByInternalId) {
            return userByInternalId.id;
        }
        throw new common_1.NotFoundException(`User with identifier "${userIdentifier}" was not found in the database.`);
    }
    async getAppHomeSummary(userIdentifier) {
        var _a;
        const internalUserId = await this.resolveInternalUserId(userIdentifier);
        const activeQuestionCount = await this.prisma.question.count({
            where: {
                isActive: true,
            },
        });
        const session = await this.prisma.conversationState.findUnique({
            where: {
                userId: internalUserId,
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
        const internalUserId = await this.resolveInternalUserId(userIdentifier);
        this.logger.log(`Starting conversation for user ${userIdentifier} ` +
            `(internal ID: ${internalUserId})`);
        let session = await this.prisma.conversationState.findUnique({
            where: {
                userId: internalUserId,
            },
        });
        if (session && !session.isCompleted) {
            const currentQuestion = await this.getCurrentQuestion(userIdentifier);
            if (currentQuestion) {
                return currentQuestion;
            }
            return this.getNextQuestion(userIdentifier);
        }
        if (session === null || session === void 0 ? void 0 : session.isCompleted) {
            await this.prisma.answer.deleteMany({
                where: {
                    userId: internalUserId,
                },
            });
            session = await this.prisma.conversationState.update({
                where: {
                    userId: internalUserId,
                },
                data: {
                    isCompleted: false,
                    currentQuestionId: null,
                    completedAt: null,
                    startedAt: new Date(),
                },
            });
        }
        if (!session) {
            session = await this.prisma.conversationState.create({
                data: {
                    userId: internalUserId,
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
            return null;
        }
        await this.prisma.conversationState.update({
            where: {
                userId: internalUserId,
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
        const internalUserId = await this.resolveInternalUserId(userIdentifier);
        this.logger.log(`Submitting answer for question ${questionId} ` +
            `from user ${userIdentifier}`);
        const normalizedAnswer = answer === null || answer === void 0 ? void 0 : answer.trim();
        if (!normalizedAnswer) {
            throw new common_1.BadRequestException('Answer cannot be empty.');
        }
        const session = await this.prisma.conversationState.findUnique({
            where: {
                userId: internalUserId,
            },
        });
        if (!session || session.isCompleted) {
            this.logger.warn(`User ${userIdentifier} attempted to submit an answer ` +
                'without an active conversation.');
            throw new common_1.BadRequestException('No active conversation exists for this user.');
        }
        if (session.currentQuestionId !== questionId) {
            this.logger.warn(`User ${userIdentifier} answered question ${questionId}, ` +
                `but the current question is ${session.currentQuestionId}.`);
        }
        const existingAnswer = await this.prisma.answer.findFirst({
            where: {
                userId: internalUserId,
                questionId,
                createdAt: {
                    gte: session.startedAt,
                },
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
                userId: internalUserId,
                questionId,
                text: normalizedAnswer,
            },
        });
    }
    async getNextQuestion(userIdentifier) {
        const internalUserId = await this.resolveInternalUserId(userIdentifier);
        const session = await this.prisma.conversationState.findUnique({
            where: {
                userId: internalUserId,
            },
        });
        if (!session || session.isCompleted) {
            return null;
        }
        const answers = await this.prisma.answer.findMany({
            where: {
                userId: internalUserId,
                createdAt: {
                    gte: session.startedAt,
                },
            },
            select: {
                questionId: true,
            },
        });
        const answeredQuestionIds = answers.map((answerItem) => answerItem.questionId);
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
                userId: internalUserId,
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
        const internalUserId = await this.resolveInternalUserId(userIdentifier);
        this.logger.log(`Finishing conversation for user ${userIdentifier}`);
        const session = await this.prisma.conversationState.findUnique({
            where: {
                userId: internalUserId,
            },
        });
        if (!session) {
            throw new common_1.BadRequestException('No conversation exists for this user.');
        }
        if (session.isCompleted) {
            return;
        }
        await this.prisma.conversationState.update({
            where: {
                userId: internalUserId,
            },
            data: {
                isCompleted: true,
                currentQuestionId: null,
                completedAt: new Date(),
            },
        });
    }
    async getCurrentQuestion(userIdentifier) {
        const internalUserId = await this.resolveInternalUserId(userIdentifier);
        const session = await this.prisma.conversationState.findUnique({
            where: {
                userId: internalUserId,
            },
        });
        if (!session ||
            session.isCompleted ||
            !session.currentQuestionId) {
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
};
exports.CollectionService = CollectionService;
exports.CollectionService = CollectionService = CollectionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CollectionService);
//# sourceMappingURL=collection.service.js.map