import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Question, QuestionType } from '@prisma/client';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { QuestionsService } from './questions.service';
import { PrismaService } from '../prisma/prisma.service';

type PrismaQuestionMock = {
  findMany: jest.MockedFunction<(...args: unknown[]) => Promise<Question[]>>;
  findUnique: jest.MockedFunction<
    (...args: unknown[]) => Promise<Question | null>
  >;
  findFirst: jest.MockedFunction<
    (...args: unknown[]) => Promise<Question | null>
  >;
  create: jest.MockedFunction<(...args: unknown[]) => Promise<Question>>;
  update: jest.MockedFunction<(...args: unknown[]) => Promise<Question>>;
  delete: jest.MockedFunction<(...args: unknown[]) => Promise<Question>>;
};

type PrismaMock = {
  question: PrismaQuestionMock;
  $transaction: jest.MockedFunction<(ops: unknown) => Promise<unknown>>;
};

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: 'q-1',
    checkInId: null,
    question: 'What did you work on today?',
    order: 1,
    type: QuestionType.FREE_TEXT,
    options: null,
    isRequired: true,
    isActive: true,
    retiredAt: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('QuestionsService', () => {
  let service: QuestionsService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = {
      question: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(QuestionsService);
  });

  describe('findAll', () => {
    it('returns questions ordered by order ascending', async () => {
      // Arrange
      const rows = [
        makeQuestion({ id: 'q-1', order: 1 }),
        makeQuestion({ id: 'q-2', order: 2 }),
      ];
      prisma.question.findMany.mockResolvedValue(rows);

      // Act
      const result = await service.findAll();

      // Assert
      expect(result).toEqual(rows);
      expect(prisma.question.findMany).toHaveBeenCalledWith({
        orderBy: { order: 'asc' },
      });
    });

    it('returns an empty list when no questions exist', async () => {
      // Arrange
      prisma.question.findMany.mockResolvedValue([]);

      // Act
      const result = await service.findAll();

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('returns an existing question', async () => {
      // Arrange
      const row = makeQuestion({ id: 'q-1' });
      prisma.question.findUnique.mockResolvedValue(row);

      // Act
      const result = await service.findOne('q-1');

      // Assert
      expect(result).toEqual(row);
      expect(prisma.question.findUnique).toHaveBeenCalledWith({
        where: { id: 'q-1' },
      });
    });

    it('throws NotFoundException when the question does not exist', async () => {
      // Arrange
      prisma.question.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.findOne('missing')).rejects.toThrow(
        'Question with ID missing not found',
      );
    });
  });

  describe('create', () => {
    it('creates a valid question', async () => {
      // Arrange
      const data = { question: 'What are your blockers today?', order: 3 };
      const created = makeQuestion({ ...data, id: 'q-new' });
      prisma.question.findFirst.mockResolvedValue(null);
      prisma.question.create.mockResolvedValue(created);

      // Act
      const result = await service.create(data);

      // Assert
      expect(result).toEqual(created);
      expect(prisma.question.findFirst).toHaveBeenCalledWith({
        where: { order: 3 },
      });
      expect(prisma.question.create).toHaveBeenCalledWith({ data });
    });

    it('throws BadRequestException when the question text is too short', async () => {
      // Arrange
      const data = { question: 'Hi', order: 1 };

      // Act & Assert
      await expect(service.create(data)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.question.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the question text is empty', async () => {
      // Arrange
      const data = { question: '', order: 1 };

      // Act & Assert
      await expect(service.create(data)).rejects.toThrow(
        'Question must be between 5 and 255 characters.',
      );
    });

    it('throws BadRequestException when the question text exceeds 255 characters', async () => {
      // Arrange
      const data = { question: 'x'.repeat(256), order: 1 };

      // Act & Assert
      await expect(service.create(data)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('throws BadRequestException when the order is already taken', async () => {
      // Arrange
      prisma.question.findFirst.mockResolvedValue(makeQuestion({ order: 1 }));

      // Act & Assert
      await expect(
        service.create({ question: 'Valid standup question?', order: 1 }),
      ).rejects.toThrow('Question with order 1 already exists.');
      expect(prisma.question.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates question text successfully', async () => {
      // Arrange
      const updated = makeQuestion({ question: 'Updated standup question?' });
      prisma.question.update.mockResolvedValue(updated);

      // Act
      const result = await service.update('q-1', {
        question: 'Updated standup question?',
      });

      // Assert
      expect(result).toEqual(updated);
      expect(prisma.question.findUnique).not.toHaveBeenCalled();
      expect(prisma.question.update).toHaveBeenCalledWith({
        where: { id: 'q-1' },
        data: { question: 'Updated standup question?' },
      });
    });

    it('skips unique-order validation when the order is unchanged', async () => {
      // Arrange
      const existing = makeQuestion({ id: 'q-1', order: 2 });
      prisma.question.findUnique.mockResolvedValue(existing);
      prisma.question.update.mockResolvedValue(existing);

      // Act
      await service.update('q-1', { order: 2 });

      // Assert
      expect(prisma.question.findFirst).not.toHaveBeenCalled();
      expect(prisma.question.update).toHaveBeenCalled();
    });

    it('validates uniqueness when the order is changing', async () => {
      // Arrange
      const existing = makeQuestion({ id: 'q-1', order: 1 });
      const updated = makeQuestion({ id: 'q-1', order: 5 });
      prisma.question.findUnique.mockResolvedValue(existing);
      prisma.question.findFirst.mockResolvedValue(null);
      prisma.question.update.mockResolvedValue(updated);

      // Act
      const result = await service.update('q-1', { order: 5 });

      // Assert
      expect(result).toEqual(updated);
      expect(prisma.question.findFirst).toHaveBeenCalledWith({
        where: { order: 5 },
      });
    });

    it('throws NotFoundException when updating order on a missing question', async () => {
      // Arrange
      prisma.question.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.update('missing', { order: 9 })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.question.update).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the new order already exists', async () => {
      // Arrange
      prisma.question.findUnique.mockResolvedValue(
        makeQuestion({ id: 'q-1', order: 1 }),
      );
      prisma.question.findFirst.mockResolvedValue(
        makeQuestion({ id: 'q-2', order: 4 }),
      );

      // Act & Assert
      await expect(service.update('q-1', { order: 4 })).rejects.toThrow(
        'Question with order 4 already exists.',
      );
    });

    it('throws BadRequestException when the new question text is invalid', async () => {
      // Arrange
      const data = { question: 'no' };

      // Act & Assert
      await expect(service.update('q-1', data)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.question.update).not.toHaveBeenCalled();
    });
  });

  describe('toggleActive', () => {
    it('toggles isActive from true to false', async () => {
      // Arrange
      const existing = makeQuestion({ id: 'q-1', isActive: true });
      const toggled = makeQuestion({ id: 'q-1', isActive: false });
      prisma.question.findUnique.mockResolvedValue(existing);
      prisma.question.update.mockResolvedValue(toggled);

      // Act
      const result = await service.toggleActive('q-1');

      // Assert
      expect(result).toEqual(toggled);
      expect(prisma.question.update).toHaveBeenCalledWith({
        where: { id: 'q-1' },
        data: { isActive: false },
      });
    });

    it('toggles isActive from false to true', async () => {
      // Arrange
      const existing = makeQuestion({ id: 'q-1', isActive: false });
      prisma.question.findUnique.mockResolvedValue(existing);
      prisma.question.update.mockResolvedValue(
        makeQuestion({ id: 'q-1', isActive: true }),
      );

      // Act
      await service.toggleActive('q-1');

      // Assert
      expect(prisma.question.update).toHaveBeenCalledWith({
        where: { id: 'q-1' },
        data: { isActive: true },
      });
    });

    it('throws NotFoundException when toggling a missing question', async () => {
      // Arrange
      prisma.question.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.toggleActive('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.question.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes an existing question', async () => {
      // Arrange
      const existing = makeQuestion({ id: 'q-1' });
      prisma.question.findUnique.mockResolvedValue(existing);
      prisma.question.delete.mockResolvedValue(existing);

      // Act
      const result = await service.remove('q-1');

      // Assert
      expect(result).toEqual(existing);
      expect(prisma.question.delete).toHaveBeenCalledWith({
        where: { id: 'q-1' },
      });
    });

    it('throws NotFoundException when deleting a missing question', async () => {
      // Arrange
      prisma.question.findUnique.mockResolvedValue(null);

      // Act & Assert
      await expect(service.remove('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.question.delete).not.toHaveBeenCalled();
    });
  });

  describe('reorder', () => {
    it('reorders questions inside a transaction', async () => {
      // Arrange
      const updates = [
        { id: 'q-1', order: 2 },
        { id: 'q-2', order: 1 },
      ];
      const q1 = makeQuestion({ id: 'q-1', order: 2 });
      const q2 = makeQuestion({ id: 'q-2', order: 1 });
      prisma.question.update
        .mockResolvedValueOnce(q1)
        .mockResolvedValueOnce(q2);
      prisma.$transaction.mockImplementation((ops: unknown) => {
        if (Array.isArray(ops)) {
          return Promise.all(ops);
        }
        return Promise.resolve(ops);
      });

      // Act
      const result = await service.reorder(updates);

      // Assert
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.question.update).toHaveBeenCalledTimes(2);
      expect(result).toEqual([q1, q2]);
    });

    it('passes an empty update list through to the transaction', async () => {
      // Arrange
      prisma.$transaction.mockResolvedValue([]);

      // Act
      const result = await service.reorder([]);

      // Assert
      expect(prisma.$transaction).toHaveBeenCalledWith([]);
      expect(result).toEqual([]);
    });

    it('propagates transaction failure', async () => {
      // Arrange
      prisma.question.update.mockResolvedValue(makeQuestion());
      prisma.$transaction.mockRejectedValue(new Error('transaction failed'));

      // Act & Assert
      await expect(
        service.reorder([{ id: 'q-1', order: 1 }]),
      ).rejects.toThrow('transaction failed');
    });

    it('does not enforce unique order before the transaction (current service behavior)', async () => {
      // Arrange
      const updates = [
        { id: 'q-1', order: 1 },
        { id: 'q-2', order: 1 },
      ];
      prisma.question.update.mockResolvedValue(makeQuestion());
      prisma.$transaction.mockResolvedValue([]);

      // Act
      await service.reorder(updates);

      // Assert
      expect(prisma.question.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('swapOrder', () => {
    const list = [
      makeQuestion({ id: 'q-1', order: 1 }),
      makeQuestion({ id: 'q-2', order: 2 }),
      makeQuestion({ id: 'q-3', order: 3 }),
    ];

    it('swaps a question up with the previous item', async () => {
      // Arrange
      prisma.question.findMany.mockResolvedValue(list);
      prisma.question.update.mockResolvedValue(makeQuestion());
      prisma.$transaction.mockResolvedValue([]);

      // Act
      await service.swapOrder('q-2', 'up');

      // Assert
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.question.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'q-2' },
        data: { order: 1 },
      });
      expect(prisma.question.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'q-1' },
        data: { order: 2 },
      });
    });

    it('swaps a question down with the next item', async () => {
      // Arrange
      prisma.question.findMany.mockResolvedValue(list);
      prisma.question.update.mockResolvedValue(makeQuestion());
      prisma.$transaction.mockResolvedValue([]);

      // Act
      await service.swapOrder('q-2', 'down');

      // Assert
      expect(prisma.question.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'q-2' },
        data: { order: 3 },
      });
      expect(prisma.question.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'q-3' },
        data: { order: 2 },
      });
    });

    it('throws NotFoundException when the question is not in the list', async () => {
      // Arrange
      prisma.question.findMany.mockResolvedValue(list);

      // Act & Assert
      await expect(service.swapOrder('missing', 'up')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns without swapping when moving the first question up', async () => {
      // Arrange
      prisma.question.findMany.mockResolvedValue(list);

      // Act
      const result = await service.swapOrder('q-1', 'up');

      // Assert
      expect(result).toBeUndefined();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('returns without swapping when moving the last question down', async () => {
      // Arrange
      prisma.question.findMany.mockResolvedValue(list);

      // Act
      const result = await service.swapOrder('q-3', 'down');

      // Assert
      expect(result).toBeUndefined();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
