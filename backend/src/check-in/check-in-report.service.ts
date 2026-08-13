import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import {
  AiDigestResult,
  RawResponseForAnalysis,
  EMPTY_REPORT_SECTIONS,
} from '../ai/dto/ai-result.dto';
import { AiService } from '../ai/ai.service';
import { CollectionService } from '../collection/collection.service';
import { DigestService } from '../digest/digest.service';
import { ReportsService } from '../reports/reports.service';
import { CheckInThreadService } from '../slack/check-in-thread.service';
import { PrismaService } from '../prisma/prisma.service';
import { enrichAnswerForAnalysis } from '../common/question-semantics';
import { QuestionType } from '@prisma/client';
import { buildAiReportHeader } from '../slack/slack-checkin.views';
import { AiReportGenerationError } from '../ai/ai-report-generation.error';
import {
  isCanonicalAiDigest,
  shouldRegenerateReport,
} from './report-content.utils';
import {
  buildParticipantProfiles,
  buildReportStatistics,
  groupBlockersByPerson,
} from './report-participant.utils';

export type RunReportStatus =
  | 'waiting_for_responses'
  | 'generating'
  | 'generated'
  | 'posting'
  | 'completed'
  | 'generation_failed'
  | 'posting_failed';

export type ReportWorkflowResult = {
  runId: string;
  status: 'success' | 'partial_success' | 'skipped' | 'failed';
  reportStatus: RunReportStatus;
  responseCount: number;
  slackDelivered: boolean;
  slackError?: string | null;
  message?: string;
};

@Injectable()
export class CheckInReportService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CheckInReportService.name);

  private readonly maxGenerationAttempts = 3;
  private readonly maxPostAttempts = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
    private readonly collectionService: CollectionService,
    private readonly digestService: DigestService,
    private readonly reportsService: ReportsService,
    private readonly checkInThreadService: CheckInThreadService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.regeneratePlaceholderReports();
      await this.refreshCanonicalSlackReports();
      await this.backfillMissingCanonicalReports();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[Report] Startup canonical report backfill failed: ${message}`,
      );
    }
  }

  async executeForRun(
    runId: string,
    options?: {
      skipTriggerValidation?: boolean;
      allowRetry?: boolean;
      forceRegenerate?: boolean;
    },
  ): Promise<ReportWorkflowResult> {
    const runMeta = await this.prisma.standupRun.findUnique({
      where: { id: runId },
      select: { checkInId: true },
    });

    if (!runMeta?.checkInId) {
      return {
        runId,
        status: 'failed',
        reportStatus: 'generation_failed',
        responseCount: 0,
        slackDelivered: false,
        message: 'Run is not linked to a Check-In.',
      };
    }

    return this.execute(runMeta.checkInId, runId, options);
  }

  async execute(
    checkInId: string,
    runId: string,
    options?: {
      skipTriggerValidation?: boolean;
      allowRetry?: boolean;
      forceRegenerate?: boolean;
    },
  ): Promise<ReportWorkflowResult> {
    const run = await this.prisma.standupRun.findUnique({
      where: { id: runId },
      include: {
        checkIn: true,
        submissions: {
          include: {
            user: true,
            answers: {
              include: { question: true },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    if (!run?.checkIn || run.checkIn.id !== checkInId) {
      return {
        runId,
        status: 'failed',
        reportStatus: 'generation_failed',
        responseCount: 0,
        slackDelivered: false,
        message: `Run ${runId} was not found for CheckIn ${checkInId}.`,
      };
    }

    if (
      run.reportGeneratedAt &&
      run.reportStatus === 'completed' &&
      !options?.forceRegenerate
    ) {
      const canonical = await this.prisma.aiDigest.findUnique({
        where: { runId: run.id },
        select: { slackReportText: true, source: true, summary: true, generationError: true },
      });

      if (canonical?.slackReportText && isCanonicalAiDigest(canonical)) {
        return {
          runId,
          status: 'skipped',
          reportStatus: 'completed',
          responseCount: 0,
          slackDelivered: true,
          message: 'Report already posted.',
        };
      }

      this.logger.warn(
        `[Report] Run ${run.id} was posted to Slack without a canonical saved report — backfilling database record.`,
      );
    }

    const inProgress =
      run.reportStatus === 'generating' ||
      run.reportStatus === 'posting';

    if (
      inProgress &&
      !options?.allowRetry &&
      !this.isStaleInProgress(run.updatedAt)
    ) {
      return {
        runId,
        status: 'skipped',
        reportStatus: run.reportStatus as RunReportStatus,
        responseCount: 0,
        slackDelivered: false,
        message: 'Report workflow already in progress.',
      };
    }

    if (
      !options?.skipTriggerValidation &&
      !this.isTriggerMet(run)
    ) {
      return {
        runId,
        status: 'skipped',
        reportStatus: run.reportStatus as RunReportStatus,
        responseCount: 0,
        slackDelivered: false,
        message: 'Report trigger conditions are not met yet.',
      };
    }

    const threadAnchor = await this.checkInThreadService.ensureThreadAnchor(
      run.id,
    );

    if (!threadAnchor.ok) {
      return {
        runId: run.id,
        status: 'skipped',
        reportStatus: run.reportStatus as RunReportStatus,
        responseCount: 0,
        slackDelivered: false,
        message:
          threadAnchor.reason ??
          'Check-In never started in Slack — skipping report workflow.',
      };
    }

    const responses = await this.collectionService.getRunResponses(run.id);
    const nonResponders =
      await this.collectionService.getRunNonResponders(run.id);

    const existingRecord = await this.prisma.aiDigest.findUnique({
      where: { runId: run.id },
    });

    let aiDigest: AiDigestResult | null = existingRecord
      ? this.mapStoredDigest(existingRecord)
      : null;

    let slackReportText = existingRecord?.slackReportText ?? null;
    let slackReportBlocks =
      (existingRecord?.slackReportBlocks as unknown[] | null) ?? null;

    const hasCanonicalAiReport =
      !!existingRecord && isCanonicalAiDigest(existingRecord);

    const needsAiGeneration =
      options?.forceRegenerate ||
      shouldRegenerateReport(existingRecord);

    if (needsAiGeneration) {
      await this.setReportStatus(run.id, 'generating');

      try {
        aiDigest = await this.generateReportWithRetry(
          run.checkIn.teamId,
          run.id,
          run.submissions,
          responses.length,
          options?.forceRegenerate === true,
        );
        const persisted = await this.persistReportForRun(
          aiDigest,
          run,
          nonResponders.map((member) => member.name),
        );
        aiDigest = persisted.digest;
        slackReportText = persisted.slackReportText;
        slackReportBlocks = persisted.slackReportBlocks;
        await this.setReportStatus(run.id, 'generated');
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Report generation failed for run ${run.id}: ${message}`,
        );
        await this.persistFailedReport(run, message);
        await this.setReportStatus(run.id, 'generation_failed');
        return {
          runId: run.id,
          status: 'failed',
          reportStatus: 'generation_failed',
          responseCount: responses.length,
          slackDelivered: false,
          message,
        };
      }
    } else if (!hasCanonicalAiReport && aiDigest) {
      const additionalUpdatesByUser =
        await this.fetchAdditionalUpdatesByUser(run.id);
      aiDigest = this.enrichDigestWithParticipants(
        aiDigest,
        run.submissions,
        additionalUpdatesByUser,
      );
      const persisted = await this.persistReportForRun(
        aiDigest,
        run,
        nonResponders.map((member) => member.name),
      );
      aiDigest = persisted.digest;
      slackReportText = persisted.slackReportText;
      slackReportBlocks = persisted.slackReportBlocks;
    }

    if (!aiDigest || aiDigest.source === 'failed') {
      await this.setReportStatus(run.id, 'generation_failed');
      return {
        runId: run.id,
        status: 'failed',
        reportStatus: 'generation_failed',
        responseCount: responses.length,
        slackDelivered: false,
        message:
          aiDigest?.generationError ||
          aiDigest?.reportSections?.generationError ||
          'No report could be generated.',
      };
    }

    await this.ensureThread(run.id);

    const refreshedRun = await this.prisma.standupRun.findUnique({
      where: { id: run.id },
      select: {
        slackChannelId: true,
        slackThreadTs: true,
      },
    });

    if (
      !refreshedRun?.slackChannelId ||
      !refreshedRun.slackThreadTs
    ) {
      await this.setReportStatus(run.id, 'generated');
      return {
        runId: run.id,
        status: 'partial_success',
        reportStatus: 'generated',
        responseCount: responses.length,
        slackDelivered: false,
        slackError:
          'CheckIn run has no Slack thread — report saved but not posted to Slack.',
        message: 'Report saved in database but Slack thread is unavailable.',
      };
    }

    if (
      responses.length === 0 &&
      process.env.SEND_EMPTY_DIGEST !== 'true'
    ) {
      await this.setReportStatus(run.id, 'generated');
      return {
        runId: run.id,
        status: 'skipped',
        reportStatus: 'generated',
        responseCount: 0,
        slackDelivered: false,
        message: 'No completed responses — report stored but not posted.',
      };
    }

    await this.setReportStatus(run.id, 'posting');

    if (!slackReportText) {
      const persisted = await this.persistReportForRun(
        aiDigest,
        run,
        nonResponders.map((member) => member.name),
      );
      slackReportText = persisted.slackReportText;
      slackReportBlocks = persisted.slackReportBlocks;
    }

    if (run.reportGeneratedAt && slackReportText && !options?.forceRegenerate) {
      await this.setReportStatus(run.id, 'completed');
      return {
        runId: run.id,
        status: 'success',
        reportStatus: 'completed',
        responseCount: responses.length,
        slackDelivered: true,
        message: 'Canonical report backfilled in database (already posted to Slack).',
      };
    }

    if (options?.forceRegenerate) {
      await this.prisma.standupRun.update({
        where: { id: run.id },
        data: { reportGeneratedAt: null },
      });
    }

    const posted = await this.postReportWithRetry(
      run.id,
      slackReportText,
      slackReportBlocks ?? [],
    );

    if (posted) {
      await this.setReportStatus(run.id, 'completed');
      return {
        runId: run.id,
        status: 'success',
        reportStatus: 'completed',
        responseCount: responses.length,
        slackDelivered: true,
      };
    }

    await this.setReportStatus(run.id, 'posting_failed');
    return {
      runId: run.id,
      status: 'partial_success',
      reportStatus: 'posting_failed',
      responseCount: responses.length,
      slackDelivered: false,
      slackError: 'SlackService could not deliver the CheckIn report.',
      message: 'Report saved in database but Slack posting failed.',
    };
  }

  async processDueReports(): Promise<void> {
    await this.backfillMissingCanonicalReports();

    const now = new Date();

    const dueRuns = await this.prisma.standupRun.findMany({
      where: {
        checkInId: { not: null },
        reportGeneratedAt: null,
        OR: [
          {
            reportDueAt: { lte: now },
            checkIn: { reportTriggerMode: 'timeout' },
            reportStatus: {
              in: [
                'waiting_for_responses',
                'generation_failed',
                'posting_failed',
                'generated',
              ],
            },
          },
          {
            checkIn: { reportTriggerMode: 'all_answered' },
            reportStatus: {
              in: [
                'waiting_for_responses',
                'generation_failed',
                'posting_failed',
                'generated',
              ],
            },
          },
          {
            reportStatus: 'generation_failed',
          },
          {
            reportStatus: 'posting_failed',
          },
        ],
      },
      orderBy: { reportDueAt: 'asc' },
      take: 50,
      include: {
        submissions: { select: { status: true } },
        checkIn: { select: { reportTriggerMode: true } },
      },
    });

    for (const dueRun of dueRuns) {
      if (!dueRun.checkInId) continue;

      if (dueRun.checkIn?.reportTriggerMode === 'all_answered') {
        const total = dueRun.submissions.length;
        const completed = dueRun.submissions.filter(
          (submission) => submission.status === 'completed',
        ).length;
        if (total === 0 || completed < total) {
          continue;
        }
      }

      const threadAnchor = await this.checkInThreadService.ensureThreadAnchor(
        dueRun.id,
      );
      if (!threadAnchor.ok) {
        this.logger.warn(
          `[Report] Skipping due report for run ${dueRun.id}: ${threadAnchor.reason ?? 'no Slack thread anchor.'}`,
        );
        continue;
      }

      try {
        await this.execute(dueRun.checkInId, dueRun.id, {
          skipTriggerValidation: true,
          allowRetry: true,
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed processing due report for run ${dueRun.id}: ${message}`,
        );
      }
    }
  }

  async findScheduledRunForReport(
    checkInId: string,
  ): Promise<string | null> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const run = await this.prisma.standupRun.findFirst({
      where: {
        checkInId,
        reportGeneratedAt: null,
        reportStatus: {
          notIn: ['completed', 'generating', 'posting'],
        },
        startedAt: { gte: startOfToday },
      },
      orderBy: { scheduledFor: 'desc' },
      select: { id: true },
    });

    return run?.id ?? null;
  }

  private isTriggerMet(
    run: {
      reportDueAt: Date | null;
      submissions: { status: string }[];
      checkIn: { reportTriggerMode: string };
    },
  ): boolean {
    switch (run.checkIn.reportTriggerMode) {
      case 'all_answered':
        return (
          run.submissions.length > 0 &&
          run.submissions.every(
            (submission) => submission.status === 'completed',
          )
        );
      case 'timeout':
        return !!run.reportDueAt && run.reportDueAt <= new Date();
      case 'scheduled':
        return true;
      default:
        return true;
    }
  }

  private isStaleInProgress(updatedAt: Date): boolean {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    return updatedAt.getTime() < fiveMinutesAgo;
  }

  private async setReportStatus(
    runId: string,
    reportStatus: RunReportStatus,
  ): Promise<void> {
    await this.prisma.standupRun.update({
      where: { id: runId },
      data: { reportStatus },
    });
  }

  private async ensureThread(runId: string): Promise<boolean> {
    const anchor = await this.checkInThreadService.ensureThreadAnchor(runId);
    if (!anchor.ok) {
      this.logger.warn(
        `[Report] Run ${runId} has no Slack thread anchor — ${anchor.reason ?? 'cannot post to Slack.'}`,
      );
      return false;
    }
    return true;
  }

  private async generateReportWithRetry(
    teamId: string,
    runId: string,
    submissions: Array<{
      status: string;
      answers: Array<{
        questionId: string;
        text: string;
        structuredValue?: unknown;
        question: { question: string; type: QuestionType };
      }>;
      user: { slackUserId: string; slackDisplayName: string };
    }>,
    responseCount: number,
    forceRegenerate = false,
  ): Promise<AiDigestResult> {
    const existingDigest = await this.prisma.aiDigest.findUnique({
      where: { runId },
    });

    if (
      !forceRegenerate &&
      existingDigest &&
      isCanonicalAiDigest(existingDigest)
    ) {
      return this.mapStoredDigest(existingDigest);
    }

    const additionalUpdatesByUser =
      await this.fetchAdditionalUpdatesByUser(runId);

    const aiResponses: RawResponseForAnalysis[] = submissions
      .filter(
        (submission) =>
          submission.status === 'completed' && submission.answers.length > 0,
      )
      .map((submission) => ({
        userId: submission.user.slackUserId,
        answers: submission.answers.map((answer) => {
          const enriched = enrichAnswerForAnalysis({
            questionText: answer.question.question,
            questionType: answer.question.type,
            text: answer.text,
            structuredValue: answer.structuredValue,
          });

          return {
            questionId: answer.questionId,
            questionText: answer.question.question,
            questionType: answer.question.type,
            text: answer.text,
            formattedAnswer: enriched.formattedAnswer,
            semanticInterpretation: enriched.semanticInterpretation,
            sentiment: enriched.sentiment,
          };
        }),
      }));

    this.appendAdditionalUpdatesToResponses(
      aiResponses,
      additionalUpdatesByUser,
    );

    let lastError: unknown = null;
    let generated: AiDigestResult | null = null;

    for (
      let attempt = 1;
      attempt <= this.maxGenerationAttempts;
      attempt += 1
    ) {
      try {
        if (attempt > 1) {
          this.logger.warn(
            `Retrying AI report generation for run ${runId} (${attempt}/${this.maxGenerationAttempts})`,
          );
        }

        if (attempt === 1) {
          this.logger.log(
            `[Report] Generating AI report for run ${runId} — ${aiResponses.length} participant(s) with answers`,
          );
        }

        generated = await this.aiService.analyzeRun(
          teamId,
          runId,
          aiResponses,
          false,
          { allowRulesFallback: false },
        );
        break;
      } catch (error: unknown) {
        lastError = error;
        const message =
          error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `AI report attempt ${attempt}/${this.maxGenerationAttempts} failed for run ${runId}: ${message}`,
        );
      }
    }

    if (!generated) {
      throw lastError instanceof AiReportGenerationError
        ? lastError
        : lastError instanceof Error
          ? lastError
          : new AiReportGenerationError(String(lastError));
    }

    return this.enrichDigestWithParticipants(
      generated,
      submissions,
      additionalUpdatesByUser,
    );
  }

  private async fetchAdditionalUpdatesByUser(
    runId: string,
  ): Promise<Map<string, string[]>> {
    const updates = await this.prisma.standupThreadUpdate.findMany({
      where: {
        runId,
        type: 'additional_update',
      },
      include: {
        user: { select: { slackUserId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const byUser = new Map<string, string[]>();

    for (const update of updates) {
      const slackUserId = update.user.slackUserId;
      const existing = byUser.get(slackUserId) ?? [];
      existing.push(update.content);
      byUser.set(slackUserId, existing);
    }

    return byUser;
  }

  private appendAdditionalUpdatesToResponses(
    responses: RawResponseForAnalysis[],
    additionalUpdatesByUser: Map<string, string[]>,
  ): void {
    for (const [slackUserId, texts] of additionalUpdatesByUser.entries()) {
      let response = responses.find((item) => item.userId === slackUserId);

      if (!response) {
        response = { userId: slackUserId, answers: [] };
        responses.push(response);
      }

      texts.forEach((text, index) => {
        response!.answers.push({
          questionId: `additional_update_${index + 1}`,
          questionText: 'Additional update',
          questionType: QuestionType.FREE_TEXT,
          text,
          formattedAnswer: text,
          semanticInterpretation: null,
          sentiment: undefined,
        });
      });
    }
  }

  private async persistReportForRun(
    digest: AiDigestResult,
    run: {
      id: string;
      checkIn: { name: string };
      submissions: Array<{
        status: string;
        answers: Array<{
          text: string;
          structuredValue?: unknown;
          question: { question: string; type: QuestionType; order?: number };
        }>;
        user: { slackUserId: string; slackDisplayName: string };
      }>;
    },
    nonResponderNames: string[],
  ): Promise<{
    digest: AiDigestResult;
    slackReportText: string;
    slackReportBlocks: unknown[];
  }> {
    const completedCount = run.submissions.filter(
      (submission) => submission.status === 'completed',
    ).length;
    const totalCount = run.submissions.length;
    const reportSections = this.buildPersistedReportSections(
      digest,
      run,
      nonResponderNames,
    );
    const digestWithSections: AiDigestResult = {
      ...digest,
      reportSections,
    };
    const { slackReportText, slackReportBlocks } =
      this.buildPublishedSlackPayload(digestWithSections, {
        checkInName: run.checkIn.name,
        completedCount,
        totalCount,
        nonResponderNames,
      });

    await this.prisma.aiDigest.upsert({
      where: { runId: run.id },
      create: {
        teamId: digest.teamId,
        runId: digest.runId,
        generatedAt: new Date(digest.generatedAt),
        source: digest.source,
        summary: digest.summary,
        blockers: digest.blockers as any,
        themes: digest.themes as any,
        reportSections: reportSections as any,
        slackReportText,
        nonResponderNames: nonResponderNames as any,
        slackReportBlocks: slackReportBlocks as any,
        generationError: digest.generationError ?? null,
      },
      update: {
        generatedAt: new Date(digest.generatedAt),
        source: digest.source,
        summary: digest.summary,
        blockers: digest.blockers as any,
        themes: digest.themes as any,
        reportSections: reportSections as any,
        slackReportText,
        nonResponderNames: nonResponderNames as any,
        slackReportBlocks: slackReportBlocks as any,
        generationError: digest.generationError ?? null,
      },
    });

    this.logger.log(
      `[Report] Saved canonical report for run ${run.id} (source=${digest.source})`,
    );

    return { digest: digestWithSections, slackReportText, slackReportBlocks };
  }

  private buildPublishedSlackPayload(
    digest: AiDigestResult,
    params: {
      checkInName: string;
      completedCount: number;
      totalCount: number;
      nonResponderNames: string[];
    },
  ): { slackReportText: string; slackReportBlocks: unknown[] } {
    const header = buildAiReportHeader({
      checkInName: params.checkInName,
      completedCount: params.completedCount,
      totalCount: params.totalCount,
    });
    const digestBody = this.buildSlackDigestText(
      digest,
      params.nonResponderNames,
    );
    const slackReportText = `${header}\n\n${digestBody}`;
    const slackReportBlocks = this.reportsService.buildDigestBlocks(
      digest,
      params.nonResponderNames,
    );

    return { slackReportText, slackReportBlocks };
  }

  async refreshCanonicalSlackReports(): Promise<number> {
    const digests = await this.prisma.aiDigest.findMany({
      where: { source: 'ai' },
      include: {
        run: {
          include: {
            checkIn: true,
            submissions: {
              include: {
                user: {
                  select: {
                    slackUserId: true,
                    slackDisplayName: true,
                  },
                },
                answers: {
                  include: { question: true },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
      },
      take: 25,
      orderBy: { generatedAt: 'desc' },
    });

    let refreshed = 0;

    for (const digestRecord of digests) {
      if (!digestRecord.run?.checkIn) {
        continue;
      }

      const nonResponders = await this.collectionService.getRunNonResponders(
        digestRecord.runId,
      );
      const digest = this.mapStoredDigest(digestRecord);

      await this.persistReportForRun(
        digest,
        digestRecord.run,
        nonResponders.map((member) => member.name),
      );
      refreshed += 1;
    }

    if (refreshed > 0) {
      this.logger.log(
        `[Report] Refreshed ${refreshed} canonical Slack report payload(s) from stored AI digests.`,
      );
    }

    return refreshed;
  }

  async regeneratePlaceholderReports(): Promise<number> {
    const runs = await this.prisma.standupRun.findMany({
      where: {
        checkInId: { not: null },
        submissions: {
          some: {
            status: 'completed',
            answers: { some: {} },
          },
        },
        OR: [
          { aiDigest: { is: { source: 'rules_fallback' } } },
          { aiDigest: { is: { source: 'failed' } } },
          {
            aiDigest: {
              is: {
                summary: {
                  contains: 'AI analysis is unavailable',
                  mode: 'insensitive',
                },
              },
            },
          },
        ],
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true, checkInId: true },
    });

    let regenerated = 0;

    for (const run of runs) {
      if (!run.checkInId) {
        continue;
      }

      try {
        await this.prisma.aiDigest.updateMany({
          where: { runId: run.id },
          data: {
            slackReportText: null,
            slackReportBlocks: null,
            generationError: null,
          },
        });

        await this.prisma.standupRun.update({
          where: { id: run.id },
          data: {
            reportGeneratedAt: null,
            reportStatus: 'waiting_for_responses',
          },
        });

        const result = await this.execute(run.checkInId, run.id, {
          skipTriggerValidation: true,
          allowRetry: true,
          forceRegenerate: true,
        });

        if (result.status === 'success') {
          regenerated += 1;
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[Report] Failed regenerating AI report for run ${run.id}: ${message}`,
        );
      }
    }

    if (regenerated > 0) {
      this.logger.log(
        `[Report] Regenerated ${regenerated} AI report(s) from submitted answers.`,
      );
    }

    return regenerated;
  }

  async backfillMissingCanonicalReports(): Promise<number> {
    const runs = await this.prisma.standupRun.findMany({
      where: {
        checkInId: { not: null },
        aiDigest: {
          is: {
            source: 'ai',
            slackReportText: null,
            generationError: null,
          },
        },
      },
      orderBy: { startedAt: 'desc' },
      take: 25,
      select: { id: true, checkInId: true },
    });

    let backfilled = 0;

    for (const run of runs) {
      if (!run.checkInId) {
        continue;
      }

      try {
        const result = await this.execute(run.checkInId, run.id, {
          skipTriggerValidation: true,
          allowRetry: true,
        });

        if (result.status !== 'failed') {
          backfilled += 1;
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[Report] Failed backfilling canonical report for run ${run.id}: ${message}`,
        );
      }
    }

    if (backfilled > 0) {
      this.logger.log(
        `[Report] Backfilled ${backfilled} canonical report record(s) in the database.`,
      );
    }

    return backfilled;
  }

  private buildPersistedReportSections(
    digest: AiDigestResult,
    run: {
      submissions: Array<{
        status: string;
        answers: Array<{
          text: string;
          structuredValue?: unknown;
          question: { question: string; type: QuestionType; order?: number };
        }>;
        user: { slackUserId: string; slackDisplayName: string };
      }>;
    },
    nonResponderNames: string[],
  ) {
    const completedCount = run.submissions.filter(
      (submission) => submission.status === 'completed',
    ).length;
    const totalCount = run.submissions.length;
    const completionRate =
      totalCount > 0
        ? Math.round((completedCount / totalCount) * 100)
        : 0;

    const participationSummary =
      nonResponderNames.length > 0
        ? `${completedCount} of ${totalCount} participants responded (${completionRate}%). Pending: ${nonResponderNames.join(', ')}.`
        : `${completedCount} of ${totalCount} participants responded (${completionRate}%). Everyone submitted.`;

    const participantProfiles = buildParticipantProfiles(run.submissions);
    const statistics = buildReportStatistics(
      run.submissions,
      digest.blockers,
      participantProfiles,
      completedCount,
      totalCount,
    );

    const userIdToName = new Map(
      run.submissions.map((submission) => [
        submission.user.slackUserId,
        submission.user.slackDisplayName,
      ]),
    );

    const namedBlockers =
      digest.reportSections.namedBlockers &&
      digest.reportSections.namedBlockers.length > 0
        ? digest.reportSections.namedBlockers
        : groupBlockersByPerson(digest.blockers, userIdToName);

    return {
      ...digest.reportSections,
      participationSummary,
      runStats: {
        completedCount,
        totalCount,
        completionRate,
      },
      participantProfiles,
      statistics,
      namedBlockers,
      teamProgress:
        digest.reportSections.teamProgress &&
        digest.reportSections.teamProgress.length > 0
          ? digest.reportSections.teamProgress
          : statistics.teamProgressBullets,
    };
  }

  private async persistFailedReport(
    run: {
      id: string;
      checkIn: { teamId: string };
    },
    errorMessage: string,
  ): Promise<void> {
    await this.prisma.aiDigest.upsert({
      where: { runId: run.id },
      create: {
        teamId: run.checkIn.teamId,
        runId: run.id,
        source: 'failed',
        summary: '',
        blockers: [],
        themes: [],
        reportSections: {
          keyAccomplishments: [],
          risks: [],
          aiInsights: [],
          actionItems: [],
          participantUpdates: [],
          overallProgress: '',
          generationError: errorMessage,
        } as any,
        generationError: errorMessage,
        slackReportText: null,
        slackReportBlocks: null,
        nonResponderNames: [],
      },
      update: {
        source: 'failed',
        summary: '',
        blockers: [],
        themes: [],
        reportSections: {
          keyAccomplishments: [],
          risks: [],
          aiInsights: [],
          actionItems: [],
          participantUpdates: [],
          overallProgress: '',
          generationError: errorMessage,
        } as any,
        generationError: errorMessage,
        slackReportText: null,
        slackReportBlocks: null,
      },
    });
  }

  private async postReportWithRetry(
    runId: string,
    digestText: string,
    digestBlocks: unknown[],
  ): Promise<boolean> {
    for (
      let attempt = 1;
      attempt <= this.maxPostAttempts;
      attempt += 1
    ) {
      if (attempt > 1) {
        this.logger.warn(
          `Retrying Slack report post for run ${runId} (${attempt}/${this.maxPostAttempts})`,
        );
        await this.delay(attempt * 1000);
      }

      const posted = await this.checkInThreadService.postAiReportToThread(
        runId,
        digestText,
        digestBlocks,
        { skipHeader: true },
      );

      if (posted) {
        return true;
      }
    }

    return false;
  }

  private buildSlackDigestText(
    digest: AiDigestResult,
    _nonResponderNames: string[],
  ): string {
    return this.reportsService.formatDigestForSlack(digest);
  }

  private mapStoredDigest(digest: {
    teamId: string;
    runId: string;
    generatedAt: Date;
    source: string;
    summary: string;
    blockers: unknown;
    themes: unknown;
    reportSections?: unknown;
    slackReportText?: string | null;
    nonResponderNames?: unknown;
    slackReportBlocks?: unknown;
    generationError?: string | null;
  }): AiDigestResult {
    const sections = this.parseReportSections(digest.reportSections);

    return {
      teamId: digest.teamId,
      runId: digest.runId,
      generatedAt: digest.generatedAt.toISOString(),
      source:
        digest.source === 'ai'
          ? 'ai'
          : digest.source === 'failed'
            ? 'failed'
            : 'rules_fallback',
      summary: digest.summary,
      blockers: Array.isArray(digest.blockers)
        ? (digest.blockers as AiDigestResult['blockers'])
        : [],
      themes: Array.isArray(digest.themes)
        ? (digest.themes as AiDigestResult['themes'])
        : [],
      reportSections: sections,
      generationError: digest.generationError,
    };
  }

  private parseReportSections(value: unknown): AiDigestResult['reportSections'] {
    if (!value || typeof value !== 'object') {
      return { ...EMPTY_REPORT_SECTIONS };
    }

    const record = value as Record<string, unknown>;
    const toStringArray = (input: unknown) =>
      Array.isArray(input)
        ? input.filter((item): item is string => typeof item === 'string')
        : [];

    return {
      keyAccomplishments: toStringArray(record.keyAccomplishments),
      risks: toStringArray(record.risks),
      aiInsights: toStringArray(record.aiInsights),
      actionItems: toStringArray(record.actionItems),
      participantUpdates: Array.isArray(record.participantUpdates)
        ? (record.participantUpdates as AiDigestResult['reportSections']['participantUpdates'])
        : [],
      overallProgress:
        typeof record.overallProgress === 'string'
          ? record.overallProgress
          : '',
    };
  }

  private enrichDigestWithParticipants(
    digest: AiDigestResult,
    submissions: Array<{
      status: string;
      answers: Array<{
        text: string;
        structuredValue?: unknown;
        question: { question: string; type: QuestionType; order?: number };
      }>;
      user: { slackUserId: string; slackDisplayName: string };
    }>,
    additionalUpdatesByUser: Map<string, string[]> = new Map(),
  ): AiDigestResult {
    const participantUpdates = submissions
      .filter(
        (submission) =>
          submission.status === 'completed' && submission.answers.length > 0,
      )
      .map((submission) => {
        const answers = [...submission.answers]
          .sort((a, b) => (a.question.order ?? 0) - (b.question.order ?? 0))
          .map((answer) => {
            const enriched = enrichAnswerForAnalysis({
              questionText: answer.question.question,
              questionType: answer.question.type,
              text: answer.text,
              structuredValue: answer.structuredValue,
            });

            return {
              question: answer.question.question,
              answer: answer.text,
              formattedAnswer: enriched.formattedAnswer,
              sentiment: enriched.sentiment,
              semanticInterpretation: enriched.semanticInterpretation,
            };
          });

        const extras =
          additionalUpdatesByUser.get(submission.user.slackUserId) ?? [];

        for (const extraText of extras) {
          answers.push({
            question: 'Additional update',
            answer: extraText,
            formattedAnswer: extraText,
            sentiment: undefined,
            semanticInterpretation: null,
          });
        }

        return {
          slackUserId: submission.user.slackUserId,
          displayName: submission.user.slackDisplayName,
          answers,
        };
      });

    return {
      ...digest,
      reportSections: {
        ...digest.reportSections,
        participantUpdates:
          digest.reportSections.participantUpdates.length > 0
            ? digest.reportSections.participantUpdates
            : participantUpdates,
        overallProgress:
          digest.reportSections.overallProgress ||
          digest.summary,
      },
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
