import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolveActiveWorkspaceId } from '../../../common/workspace-context';
import { AiChatService } from '../chat/ai-chat.service';
import { AiEvalDatasetService } from './ai-eval-dataset.service';
import { GOLD_EVAL_DATASET } from './gold-dataset';
import { detectHallucinations } from './hallucination.detector';
import { detectMissingContext } from './missing-context.detector';
import { computeEvalScores } from './scoring.util';

const DEFAULT_PASS_THRESHOLD = 60;

@Injectable()
export class AiEvalRunnerService {
  private readonly logger = new Logger(AiEvalRunnerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: AiChatService,
    private readonly dataset: AiEvalDatasetService,
  ) {}

  /**
   * Run evaluation for one workspace. Does not modify AiChatService internals —
   * only calls chat() like any other client.
   */
  async run(params: {
    workspaceId?: string | null;
    preferDemo?: boolean;
    label?: string | null;
    caseKeys?: string[] | null;
    limit?: number | null;
    passThreshold?: number | null;
    seedIfEmpty?: boolean;
  }) {
    if (this.running) {
      throw new BadRequestException(
        'An evaluation run is already in progress on this server.',
      );
    }

    this.running = true;
    const startedAt = new Date();

    try {
      const workspace = await this.dataset.resolveWorkspace({
        workspaceId: params.workspaceId,
        preferDemo: params.preferDemo,
      });

      if (params.seedIfEmpty !== false) {
        const existing = await this.prisma.aiEvalCase.count({
          where: { workspaceId: workspace.id, enabled: true },
        });
        if (existing === 0) {
          await this.dataset.seedForWorkspace({
            workspaceId: workspace.id,
          });
        }
      }

      const threshold = params.passThreshold ?? DEFAULT_PASS_THRESHOLD;
      let cases = await this.prisma.aiEvalCase.findMany({
        where: {
          workspaceId: workspace.id,
          enabled: true,
          ...(params.caseKeys?.length
            ? { caseKey: { in: params.caseKeys } }
            : {}),
        },
        orderBy: [{ category: 'asc' }, { caseKey: 'asc' }],
      });

      if (params.limit && params.limit > 0) {
        cases = cases.slice(0, params.limit);
      }

      if (cases.length === 0) {
        throw new BadRequestException(
          'No evaluation cases found for this workspace. Seed the gold dataset first.',
        );
      }

      const run = await this.prisma.aiEvalRun.create({
        data: {
          workspaceId: workspace.id,
          label:
            params.label?.trim() ||
            `Eval ${new Date().toISOString().slice(0, 16)}`,
          status: 'running',
          passThreshold: threshold,
          totalQuestions: cases.length,
          meta: {
            preferDemo: Boolean(params.preferDemo),
            slackWorkspaceId: workspace.slackWorkspaceId,
            workspaceName: workspace.slackWorkspaceName,
          } as Prisma.InputJsonValue,
        },
      });

      const known = await this.loadWorkspaceFacts(workspace.id);

      let passed = 0;
      let failed = 0;
      let accuracySum = 0;
      let confidenceSum = 0;
      let timeSum = 0;
      let overallSum = 0;

      for (const evalCase of cases) {
        const result = await this.evaluateOne({
          runId: run.id,
          workspaceId: workspace.id,
          evalCase,
          knownIssueKeys: known.issueKeys,
          knownUserNames: known.userNames,
          passThreshold: threshold,
        });

        if (result.passed) passed += 1;
        else failed += 1;
        accuracySum += result.scores.answerAccuracy;
        confidenceSum += result.scores.confidenceCalibration;
        timeSum += result.responseTimeMs;
        overallSum += result.overallScore;
      }

      const total = cases.length;
      const finished = await this.prisma.aiEvalRun.update({
        where: { id: run.id },
        data: {
          status: 'completed',
          passed,
          failed,
          averageAccuracy: round2(accuracySum / total),
          averageConfidenceScore: round2(confidenceSum / total),
          averageResponseTimeMs: round2(timeSum / total),
          overallScore: round2(overallSum / total),
          finishedAt: new Date(),
        },
        include: {
          results: { orderBy: { createdAt: 'asc' } },
        },
      });

      this.logger.log(
        `Eval run ${run.id} complete workspace=${workspace.id} score=${finished.overallScore} passed=${passed}/${total} durationMs=${Date.now() - startedAt.getTime()}`,
      );

      return finished;
    } catch (error: unknown) {
      this.logger.error(
        `Eval run failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    } finally {
      this.running = false;
    }
  }

  async getRun(params: { runId: string; workspaceId?: string | null }) {
    const workspaceId = await resolveActiveWorkspaceId(
      this.prisma,
      params.workspaceId,
    );
    const run = await this.prisma.aiEvalRun.findFirst({
      where: {
        id: params.runId,
        ...(workspaceId ? { workspaceId } : {}),
      },
      include: {
        results: { orderBy: { createdAt: 'asc' } },
        workspace: {
          select: { id: true, slackWorkspaceName: true, slackWorkspaceId: true },
        },
      },
    });
    if (!run) throw new NotFoundException('Evaluation run not found');
    return run;
  }

  async listRuns(params: { workspaceId?: string | null; limit?: number }) {
    const workspaceId = await resolveActiveWorkspaceId(
      this.prisma,
      params.workspaceId,
    );
    if (!workspaceId) {
      return { workspaceId: null, runs: [] };
    }
    const runs = await this.prisma.aiEvalRun.findMany({
      where: { workspaceId },
      orderBy: { startedAt: 'desc' },
      take: Math.min(params.limit ?? 20, 100),
    });
    return { workspaceId, runs };
  }

  async dashboard(params: { workspaceId?: string | null }) {
    const workspaceId = await resolveActiveWorkspaceId(
      this.prisma,
      params.workspaceId,
    );
    if (!workspaceId) {
      return {
        workspaceId: null,
        totalQuestions: 0,
        passed: 0,
        failed: 0,
        averageAccuracy: 0,
        averageConfidence: 0,
        averageResponseTimeMs: 0,
        overallScore: 0,
        latestRunId: null,
        caseCount: 0,
        runs: 0,
      };
    }

    const [caseCount, runs, latest] = await Promise.all([
      this.prisma.aiEvalCase.count({
        where: { workspaceId, enabled: true },
      }),
      this.prisma.aiEvalRun.count({ where: { workspaceId } }),
      this.prisma.aiEvalRun.findFirst({
        where: { workspaceId, status: 'completed' },
        orderBy: { finishedAt: 'desc' },
      }),
    ]);

    return {
      workspaceId,
      totalQuestions: latest?.totalQuestions ?? 0,
      passed: latest?.passed ?? 0,
      failed: latest?.failed ?? 0,
      averageAccuracy: latest?.averageAccuracy ?? 0,
      averageConfidence: latest?.averageConfidenceScore ?? 0,
      averageResponseTimeMs: latest?.averageResponseTimeMs ?? 0,
      overallScore: latest?.overallScore ?? 0,
      latestRunId: latest?.id ?? null,
      caseCount,
      runs,
      passThreshold: latest?.passThreshold ?? DEFAULT_PASS_THRESHOLD,
    };
  }

  private async evaluateOne(params: {
    runId: string;
    workspaceId: string;
    evalCase: {
      id: string;
      caseKey: string;
      category: string;
      question: string;
      expectedAnswer: string;
      expectedSources: Prisma.JsonValue;
      expectedConfidence: string | null;
      tags: Prisma.JsonValue;
    };
    knownIssueKeys: string[];
    knownUserNames: string[];
    passThreshold: number;
  }) {
    const tags = asStringArray(params.evalCase.tags);
    const expectedSources = asStringArray(params.evalCase.expectedSources);
    const mustInclude = [
      ...tags
        .filter((tag) => tag.startsWith('must:'))
        .map((tag) => tag.slice(5)),
      ...(GOLD_EVAL_DATASET.find((item) => item.id === params.evalCase.caseKey)
        ?.mustInclude ?? []),
    ];

    const started = Date.now();
    let aiAnswer = '';
    let aiConfidence: string | null = null;
    let aiSources: string[] = [];
    let insufficientData = false;
    let diagnostics = null as
      | import('../types/workspace-ai.types').RetrievalDiagnostics
      | null
      | undefined;

    try {
      const response = await this.chat.chat({
        workspaceId: params.workspaceId,
        conversationId: null,
        question: params.evalCase.question,
      });
      aiAnswer = response.answer || response.report?.markdown || '';
      aiConfidence = response.confidence;
      aiSources = (response.sources ?? []).map(
        (source) => source.source || source.label,
      );
      if (response.report?.sourcesUsed?.length) {
        aiSources = Array.from(
          new Set([...aiSources, ...response.report.sourcesUsed]),
        );
      }
      insufficientData = response.insufficientData;
      diagnostics = response.retrievalDiagnostics;
    } catch (error: unknown) {
      aiAnswer = `ERROR: ${error instanceof Error ? error.message : String(error)}`;
      aiConfidence = 'Low';
      insufficientData = true;
    }

    const responseTimeMs = Date.now() - started;
    const hallucination = detectHallucinations({
      aiAnswer,
      expectedAnswer: params.evalCase.expectedAnswer,
      knownIssueKeys: params.knownIssueKeys,
      knownUserNames: params.knownUserNames,
      aiSources,
      tags,
    });
    const missing = detectMissingContext({
      question: params.evalCase.question,
      aiAnswer,
      insufficientData,
      diagnostics,
      tags,
    });

    const scores = computeEvalScores({
      expectedAnswer: params.evalCase.expectedAnswer,
      aiAnswer,
      expectedSources,
      aiSources,
      expectedConfidence: params.evalCase.expectedConfidence,
      aiConfidence,
      mustInclude,
      hallucinationPenalty: hallucination.penalty,
      missingContextPenalty: missing.penalty,
    });

    const passed = scores.overall >= params.passThreshold;

    const row = await this.prisma.aiEvalResult.create({
      data: {
        runId: params.runId,
        caseId: params.evalCase.id,
        caseKey: params.evalCase.caseKey,
        category: params.evalCase.category,
        question: params.evalCase.question,
        expectedAnswer: params.evalCase.expectedAnswer,
        aiAnswer,
        expectedSources: expectedSources as Prisma.InputJsonValue,
        aiSources: aiSources as Prisma.InputJsonValue,
        expectedConfidence: params.evalCase.expectedConfidence,
        aiConfidence,
        scores: scores as unknown as Prisma.InputJsonValue,
        overallScore: scores.overall,
        passed,
        hallucinationFlags: hallucination.flags as unknown as Prisma.InputJsonValue,
        missingContext: missing.findings as unknown as Prisma.InputJsonValue,
        responseTimeMs,
        responseLength: aiAnswer.length,
      },
    });

    return {
      ...row,
      scores,
    };
  }

  private async loadWorkspaceFacts(workspaceId: string) {
    const [users, cacheKeys, blockers, memory] = await Promise.all([
      this.prisma.user.findMany({
        where: { workspaceId },
        select: { slackDisplayName: true, slackRealName: true },
        take: 500,
      }),
      this.prisma.jiraIssueCacheEntry.findMany({
        where: { user: { workspaceId } },
        select: { issueKey: true },
        take: 2000,
      }),
      this.prisma.pulseBlocker.findMany({
        where: { user: { workspaceId } },
        select: { linkedIssueKey: true, title: true },
        take: 500,
      }),
      this.prisma.teamMemoryDocument.findMany({
        where: { workspaceId },
        select: { issueKey: true },
        take: 500,
      }),
    ]);

    const userNames = users
      .flatMap((user) => [user.slackDisplayName, user.slackRealName])
      .filter((name): name is string => Boolean(name?.trim()));

    const issueKeys = Array.from(
      new Set(
        [
          ...cacheKeys.map((row) => row.issueKey),
          ...blockers.map((row) => row.linkedIssueKey),
          ...memory.map((row) => row.issueKey),
        ].filter((key): key is string => Boolean(key?.trim())),
      ),
    );

    return { userNames, issueKeys };
  }
}

function asStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
