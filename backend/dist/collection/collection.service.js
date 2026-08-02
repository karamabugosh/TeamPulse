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
    async getAppHomeSummary(userId) {
        var _a;
        const activeQuestionCount = await this.prisma.question.count({
            where: { isActive: true },
        });
        const session = await this.prisma.conversationState.findUnique({
            where: { userId },
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
    async startConversation(userId) {
        this.logger.log(`Starting conversation for user ${userId}`);
        let session = await this.prisma.conversationState.findUnique({
            where: { userId },
        });
        if (session && !session.isCompleted) {
            const current = await this.getCurrentQuestion(userId);
            if (current) {
                return current;
            }
            return this.getNextQuestion(userId);
        }
        if (session && session.isCompleted) {
            await this.prisma.answer.deleteMany({ where: { userId } });
            session = await this.prisma.conversationState.update({
                where: { userId },
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
                data: { userId },
            });
        }
        const firstQuestion = await this.prisma.question.findFirst({
            where: { isActive: true },
            orderBy: { order: 'asc' },
        });
        if (!firstQuestion) {
            return null;
        }
        await this.prisma.conversationState.update({
            where: { userId },
            data: { currentQuestionId: firstQuestion.id },
        });
        return { questionId: firstQuestion.id, text: firstQuestion.question };
    }
    async submitAnswer(userId, questionId, answer) {
        this.logger.log(`Submitting answer for question ${questionId} from user ${userId}`);
        if (!answer || answer.trim() === '') {
            throw new common_1.BadRequestException('Answer cannot be empty.');
        }
        const session = await this.prisma.conversationState.findUnique({
            where: { userId },
        });
        if (!session || session.isCompleted) {
            this.logger.warn(`Attempted to submit answer for user ${userId} but no active session exists.`);
            return;
        }
        if (session.currentQuestionId !== questionId) {
            this.logger.warn(`User ${userId} answered question ${questionId} but current question is ${session.currentQuestionId}`);
        }
        const existingAnswer = await this.prisma.answer.findFirst({
            where: { userId, questionId }
        });
        if (existingAnswer) {
            await this.prisma.answer.update({
                where: { id: existingAnswer.id },
                data: { text: answer }
            });
        }
        else {
            await this.prisma.answer.create({
                data: {
                    userId,
                    questionId,
                    text: answer,
                },
            });
        }
    }
    async getNextQuestion(userId) {
        const session = await this.prisma.conversationState.findUnique({
            where: { userId },
        });
        if (!session || session.isCompleted) {
            return null;
        }
        const answers = await this.prisma.answer.findMany({
            where: {
                userId,
                createdAt: { gte: session.startedAt },
            },
            select: { questionId: true },
        });
        const answeredQuestionIds = answers.map((a) => a.questionId);
        const nextQuestion = await this.prisma.question.findFirst({
            where: {
                isActive: true,
                id: { notIn: answeredQuestionIds },
            },
            orderBy: { order: 'asc' },
        });
        if (nextQuestion) {
            await this.prisma.conversationState.update({
                where: { userId },
                data: { currentQuestionId: nextQuestion.id },
            });
            return { questionId: nextQuestion.id, text: nextQuestion.question };
        }
        return null;
    }
    async finishConversation(userId) {
        this.logger.log(`Finishing conversation for user ${userId}`);
        await this.prisma.conversationState.update({
            where: { userId },
            data: {
                isCompleted: true,
                currentQuestionId: null,
                completedAt: new Date(),
            },
        });
    }
    async getCurrentQuestion(userId) {
        const session = await this.prisma.conversationState.findUnique({
            where: { userId },
        });
        if (session && session.currentQuestionId && !session.isCompleted) {
            const question = await this.prisma.question.findUnique({
                where: { id: session.currentQuestionId },
            });
            if (question) {
                return { questionId: question.id, text: question.question };
            }
        }
        return null;
    }
};
exports.CollectionService = CollectionService;
exports.CollectionService = CollectionService = CollectionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CollectionService);
//# sourceMappingURL=collection.service.js.map