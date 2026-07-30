import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.question.findMany({
      orderBy: { order: 'asc' },
    });
  }

  async findOne(id: string) {
    const question = await this.prisma.question.findUnique({ where: { id } });
    if (!question) {
      throw new NotFoundException(`Question with ID ${id} not found`);
    }
    return question;
  }

  async create(data: { question: string; order: number; isActive?: boolean }) {
    this.validateQuestion(data.question);
    await this.validateOrderUnique(data.order);
    return this.prisma.question.create({ data });
  }

  async update(id: string, data: { question?: string; order?: number; isActive?: boolean }) {
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

  async toggleActive(id: string) {
    const question = await this.findOne(id);
    return this.prisma.question.update({
      where: { id },
      data: { isActive: !question.isActive },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    // Note: Deleting a question might fail if it has answers due to foreign key constraints.
    // Assuming cascading deletes or ignoring for now since it's an admin feature.
    return this.prisma.question.delete({ where: { id } });
  }

  async reorder(updates: { id: string; order: number }[]) {
    // Basic reordering logic using a transaction
    return this.prisma.$transaction(
      updates.map((update) =>
        this.prisma.question.update({
          where: { id: update.id },
          data: { order: update.order },
        })
      )
    );
  }

  private validateQuestion(question: string) {
    if (!question || question.trim().length < 5 || question.trim().length > 255) {
      throw new BadRequestException('Question must be between 5 and 255 characters.');
    }
  }

  private async validateOrderUnique(order: number) {
    const existing = await this.prisma.question.findFirst({ where: { order } });
    if (existing) {
      throw new BadRequestException(`Question with order ${order} already exists.`);
    }
  }
}
