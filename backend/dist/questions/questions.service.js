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
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuestionsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let QuestionsService = class QuestionsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll() {
        return this.prisma.question.findMany({
            orderBy: { order: 'asc' },
        });
    }
    async findOne(id) {
        const question = await this.prisma.question.findUnique({ where: { id } });
        if (!question) {
            throw new common_1.NotFoundException(`Question with ID ${id} not found`);
        }
        return question;
    }
    async create(data) {
        this.validateQuestion(data.question);
        await this.validateOrderUnique(data.order);
        return this.prisma.question.create({ data });
    }
    async update(id, data) {
        if (data.question !== undefined) {
            this.validateQuestion(data.question);
        }
        if (data.order !== undefined) {
            const existing = await this.findOne(id);
            if (existing.order !== data.order) {
                await this.validateOrderUnique(data.order);
            }
        }
        return this.prisma.question.update({ where: { id }, data });
    }
    async toggleActive(id) {
        const question = await this.findOne(id);
        return this.prisma.question.update({
            where: { id },
            data: { isActive: !question.isActive },
        });
    }
    async remove(id) {
        await this.findOne(id);
        return this.prisma.question.delete({ where: { id } });
    }
    async reorder(updates) {
        return this.prisma.$transaction(updates.map((update) => this.prisma.question.update({
            where: { id: update.id },
            data: { order: update.order },
        })));
    }
    validateQuestion(question) {
        if (!question || question.trim().length < 5 || question.trim().length > 255) {
            throw new common_1.BadRequestException('Question must be between 5 and 255 characters.');
        }
    }
    async validateOrderUnique(order) {
        const existing = await this.prisma.question.findFirst({ where: { order } });
        if (existing) {
            throw new common_1.BadRequestException(`Question with order ${order} already exists.`);
        }
    }
};
exports.QuestionsService = QuestionsService;
exports.QuestionsService = QuestionsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], QuestionsService);
//# sourceMappingURL=questions.service.js.map