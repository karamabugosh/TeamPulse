import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { PrismaService } from '../../../prisma/prisma.service';
import { AiEvalExportService } from './ai-eval-export.service';

jest.mock('../../../common/workspace-context', () => ({
  resolveActiveWorkspaceId: jest.fn(),
}));

jest.mock('../slack/simple-pdf.util', () => ({
  buildSimplePdf: jest.fn(),
}));

import { resolveActiveWorkspaceId } from '../../../common/workspace-context';
import { buildSimplePdf } from '../slack/simple-pdf.util';

const resolveWorkspaceIdMock = resolveActiveWorkspaceId as jest.MockedFunction<
  typeof resolveActiveWorkspaceId
>;
const buildSimplePdfMock = buildSimplePdf as jest.MockedFunction<
  typeof buildSimplePdf
>;

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    label: 'Nightly',
    overallScore: 88,
    passed: 8,
    failed: 2,
    totalQuestions: 10,
    averageAccuracy: 0.88,
    averageConfidenceScore: 0.9,
    averageResponseTimeMs: 1200.4,
    passThreshold: 70,
    startedAt: new Date('2024-06-01T10:00:00.000Z'),
    finishedAt: new Date('2024-06-01T11:00:00.000Z'),
    workspace: { slackWorkspaceName: 'Acme' },
    results: [
      {
        caseKey: 'jira-1',
        category: 'Jira',
        question: 'Status of SCRUM-1?',
        expectedAnswer: 'In progress',
        aiAnswer: 'SCRUM-1 is in progress',
        overallScore: 95,
        passed: true,
        aiConfidence: 'High',
        responseTimeMs: 800,
      },
      {
        caseKey: 'csv-quote',
        category: 'Reports',
        question: 'Say "hello"',
        expectedAnswer: 'quoted',
        aiAnswer: 'answer with "quotes"',
        overallScore: 40,
        passed: false,
        aiConfidence: null,
        responseTimeMs: 500,
      },
    ],
    ...overrides,
  };
}

describe('AiEvalExportService', () => {
  let service: AiEvalExportService;
  let prisma: {
    aiEvalRun: {
      findFirst: jest.MockedFunction<(args: unknown) => Promise<unknown>>;
    };
  };

  beforeEach(async () => {
    resolveWorkspaceIdMock.mockReset();
    buildSimplePdfMock.mockReset();
    resolveWorkspaceIdMock.mockResolvedValue('ws-1');
    buildSimplePdfMock.mockReturnValue(Buffer.from('pdf-bytes'));

    prisma = {
      aiEvalRun: {
        findFirst: jest.fn<(args: unknown) => Promise<unknown>>(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiEvalExportService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AiEvalExportService);
  });

  describe('exportRun', () => {
    it('throws NotFoundException when the run does not exist', async () => {
      prisma.aiEvalRun.findFirst.mockResolvedValue(null);

      await expect(
        service.exportRun({ runId: 'missing', format: 'markdown' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.exportRun({ runId: 'missing', format: 'markdown' }),
      ).rejects.toThrow('Evaluation run not found');
    });

    it('exports markdown with run metadata and results', async () => {
      prisma.aiEvalRun.findFirst.mockResolvedValue(makeRun());

      const result = await service.exportRun({
        runId: 'run-1',
        format: 'markdown',
      });

      expect(result.filename).toBe('ai-eval-2024-06-01.md');
      expect(result.contentType).toBe('text/markdown; charset=utf-8');
      expect(typeof result.body).toBe('string');
      expect(result.body).toContain('# AI Evaluation Report');
      expect(result.body).toContain('Workspace: Acme');
      expect(result.body).toContain('### jira-1 (Jira)');
      expect(result.body).toContain('· PASS');
      expect(result.body).toContain('· FAIL');
      expect(result.body).toContain('Confidence: n/a');
    });

    it('uses startedAt for filename when finishedAt is null', async () => {
      prisma.aiEvalRun.findFirst.mockResolvedValue(
        makeRun({ finishedAt: null }),
      );

      const result = await service.exportRun({
        runId: 'run-1',
        format: 'markdown',
      });

      expect(result.filename).toBe('ai-eval-2024-06-01.md');
      expect(result.body).toContain("Finished: n/a");
      expect(result.body).toContain('Run: Nightly');
    });

    it('falls back to run id when label is null', async () => {
      prisma.aiEvalRun.findFirst.mockResolvedValue(
        makeRun({ label: null }),
      );

      const result = await service.exportRun({
        runId: 'run-1',
        format: 'markdown',
      });

      expect(result.body).toContain('- Run: run-1');
    });

    it('exports csv with escaped quotes', async () => {
      prisma.aiEvalRun.findFirst.mockResolvedValue(makeRun());

      const result = await service.exportRun({
        runId: 'run-1',
        format: 'csv',
      });

      expect(result.filename).toBe('ai-eval-2024-06-01.csv');
      expect(result.contentType).toBe('text/csv; charset=utf-8');
      expect(result.body).toContain('"answer with ""quotes"""');
      expect(result.body).toContain('"caseKey","category","passed"');
    });

    it('exports pdf via buildSimplePdf', async () => {
      prisma.aiEvalRun.findFirst.mockResolvedValue(makeRun());

      const result = await service.exportRun({
        runId: 'run-1',
        format: 'pdf',
      });

      expect(result.filename).toBe('ai-eval-2024-06-01.pdf');
      expect(result.contentType).toBe('application/pdf');
      expect(result.body).toEqual(Buffer.from('pdf-bytes'));
      expect(buildSimplePdfMock).toHaveBeenCalledWith(
        'AI Evaluation — Acme',
        expect.stringContaining('# AI Evaluation Report'),
      );
    });

    it('scopes findFirst by workspace when resolved', async () => {
      prisma.aiEvalRun.findFirst.mockResolvedValue(makeRun());

      await service.exportRun({
        runId: 'run-1',
        workspaceId: 'ws-1',
        format: 'markdown',
      });

      expect(prisma.aiEvalRun.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'run-1', workspaceId: 'ws-1' },
        }),
      );
    });

    it('omits workspace filter when resolveActiveWorkspaceId returns null', async () => {
      resolveWorkspaceIdMock.mockResolvedValue(null);
      prisma.aiEvalRun.findFirst.mockResolvedValue(makeRun());

      await service.exportRun({ runId: 'run-1', format: 'markdown' });

      expect(prisma.aiEvalRun.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'run-1' },
        }),
      );
    });
  });
});
