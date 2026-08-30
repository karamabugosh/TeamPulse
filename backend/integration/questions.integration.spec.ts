import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { QuestionsModule } from '../src/questions/questions.module';
import { PrismaService } from '../src/prisma/prisma.service';

const FIXTURE_PREFIX = '[itest]';

function fixtureText(label: string): string {
  return `${FIXTURE_PREFIX} ${label} standup question`;
}

describe('QuestionsModule (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let orderSeq: number;

  beforeAll(async () => {
    const dbUrl = process.env.DATABASE_URL ?? '';
    if (!dbUrl.includes('/pulse_test')) {
      throw new Error(
        `Integration tests must use pulse_test. Current DATABASE_URL=${dbUrl}`,
      );
    }

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [QuestionsModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.question.deleteMany();
    orderSeq = 800000;
  });

  afterEach(async () => {
    await prisma.question.deleteMany();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.question.deleteMany();
    }
    if (app) {
      await app.close();
    }
  });

  function nextOrder(): number {
    orderSeq += 1;
    return orderSeq;
  }

  async function createQuestion(overrides: {
    question?: string;
    order?: number;
    isActive?: boolean;
  } = {}) {
    const body = {
      question: overrides.question ?? fixtureText(`create ${nextOrder()}`),
      order: overrides.order ?? nextOrder(),
      isActive: overrides.isActive,
    };
    const response = await request(app.getHttpServer())
      .post('/api/questions')
      .send(body)
      .expect(201);
    return response.body;
  }

  describe('GET /api/questions', () => {
    it('returns all questions ordered by order', async () => {
      // Arrange
      const second = await createQuestion({
        question: fixtureText('second'),
        order: nextOrder() + 1,
      });
      const first = await createQuestion({
        question: fixtureText('first'),
        order: second.order - 1,
      });

      // Act
      const response = await request(app.getHttpServer()).get('/api/questions');

      // Assert
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].id).toBe(first.id);
      expect(response.body[1].id).toBe(second.id);
    });
  });

  describe('GET /api/questions/:id', () => {
    it('returns an existing question', async () => {
      // Arrange
      const created = await createQuestion({
        question: fixtureText('lookup'),
      });

      // Act
      const response = await request(app.getHttpServer()).get(
        `/api/questions/${created.id}`,
      );

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.id).toBe(created.id);
      expect(response.body.question).toBe(created.question);
    });

    it('returns 404 for a non-existing question', async () => {
      // Arrange
      const missingId = '00000000-0000-4000-8000-000000000099';

      // Act
      const response = await request(app.getHttpServer()).get(
        `/api/questions/${missingId}`,
      );

      // Assert
      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/questions', () => {
    it('creates a valid question', async () => {
      // Arrange
      const body = {
        question: fixtureText('valid create'),
        order: nextOrder(),
        isActive: true,
      };

      // Act
      const response = await request(app.getHttpServer())
        .post('/api/questions')
        .send(body);

      // Assert
      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();
      expect(response.body.question).toBe(body.question);
      expect(response.body.order).toBe(body.order);

      const persisted = await prisma.question.findUnique({
        where: { id: response.body.id },
      });
      expect(persisted).not.toBeNull();
      expect(persisted?.question).toBe(body.question);
    });

    it('rejects invalid input (question too short)', async () => {
      // Arrange
      const body = { question: 'ab', order: nextOrder() };

      // Act
      const response = await request(app.getHttpServer())
        .post('/api/questions')
        .send(body);

      // Assert
      expect(response.status).toBe(400);
    });

    it('rejects a duplicate order', async () => {
      // Arrange
      const order = nextOrder();
      await createQuestion({
        question: fixtureText('original order'),
        order,
      });

      // Act
      const response = await request(app.getHttpServer())
        .post('/api/questions')
        .send({
          question: fixtureText('duplicate order'),
          order,
        });

      // Assert
      expect(response.status).toBe(400);
    });
  });

  describe('PUT /api/questions/:id', () => {
    it('updates an existing question', async () => {
      // Arrange
      const created = await createQuestion({
        question: fixtureText('before update'),
      });
      const updatedText = fixtureText('after update');

      // Act
      const response = await request(app.getHttpServer())
        .put(`/api/questions/${created.id}`)
        .send({ question: updatedText });

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.question).toBe(updatedText);

      const persisted = await prisma.question.findUnique({
        where: { id: created.id },
      });
      expect(persisted?.question).toBe(updatedText);
    });

    it('returns 404 if the question does not exist', async () => {
      // Arrange
      const missingId = '00000000-0000-4000-8000-000000000098';

      // Act
      // Include `order` so QuestionsService.findOne runs before Prisma update.
      const response = await request(app.getHttpServer())
        .put(`/api/questions/${missingId}`)
        .send({
          question: fixtureText('missing update'),
          order: nextOrder(),
        });

      // Assert
      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/questions/:id/toggle', () => {
    it('updates the isActive field (partial update)', async () => {
      // Arrange
      const created = await createQuestion({
        question: fixtureText('toggle'),
        isActive: true,
      });
      expect(created.isActive).toBe(true);

      // Act
      const response = await request(app.getHttpServer()).patch(
        `/api/questions/${created.id}/toggle`,
      );

      // Assert
      expect(response.status).toBe(200);
      expect(response.body.isActive).toBe(false);

      const persisted = await prisma.question.findUnique({
        where: { id: created.id },
      });
      expect(persisted?.isActive).toBe(false);
    });

    it('returns 404 if the question does not exist', async () => {
      // Arrange
      const missingId = '00000000-0000-4000-8000-000000000097';

      // Act
      const response = await request(app.getHttpServer()).patch(
        `/api/questions/${missingId}/toggle`,
      );

      // Assert
      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/questions/:id', () => {
    it('deletes an existing question', async () => {
      // Arrange
      const created = await createQuestion({
        question: fixtureText('to delete'),
      });

      // Act
      const response = await request(app.getHttpServer()).delete(
        `/api/questions/${created.id}`,
      );

      // Assert
      expect(response.status).toBe(200);
      const persisted = await prisma.question.findUnique({
        where: { id: created.id },
      });
      expect(persisted).toBeNull();
    });

    it('returns 404 when deleting a missing question', async () => {
      // Arrange
      const missingId = '00000000-0000-4000-8000-000000000096';

      // Act
      const response = await request(app.getHttpServer()).delete(
        `/api/questions/${missingId}`,
      );

      // Assert
      expect(response.status).toBe(404);
    });
  });
});
