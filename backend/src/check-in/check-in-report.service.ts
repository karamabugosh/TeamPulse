import {
  Injectable,
  Logger,
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
export class CheckInReportService {
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

  async execute(
    checkInId: string,
    runId: string,
    options?: {
      skipTriggerValidation?: boolean;
      allowRetry?: boolean;
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
      run.reportStatus === 'completed'
    ) {
      const canonical = await this.prisma.aiDigest.findUnique({
        where: { runId: run.id },
        select: { slackReportText: true },
      });

      if (canonical?.slackReportText) {
        return {
          runId,
          status: 'skipped',
          reportStatus: 'completed',
          responseCount: 0,
          slackDelivered: true,
          message: 'Report already posted.',
        };
      }
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

    const isCanonical = !!existingRecord?.slackReportText;

    const needsAiGeneration =
      !existingRecord || run.reportStatus === 'generation_failed';

    if (needsAiGeneration && !isCanonical) {
      await this.setReportStatus(run.id, 'generating');

      try {
        aiDigest = await this.generateReportWithRetry(
          run.checkIn.teamId,
          run.id,
          run.submissions,
          responses.length,
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
    } else if (!isCanonical && aiDigest) {
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

    if (!aiDigest) {
      await this.setReportStatus(run.id, 'generation_failed');
      return {
        runId: run.id,
        status: 'failed',
        reportStatus: 'generation_failed',
        responseCount: responses.length,
        slackDelivered: false,
        message: 'No report could be generated.',
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
      await this.setReportStatus(run.id, 'posting_failed');
      return {
        runId: run.id,
        status: 'partial_success',
        reportStatus: 'posting_failed',
        responseCount: responses.length,
        slackDelivered: false,
        slackError:
          'CheckIn run has no Slack thread — configure updatesChannelId or SLACK_UPDATES_CHANNEL_ID.',
        message: 'Report saved but Slack thread is unavailable.',
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

    if (run.reportGeneratedAt && slackReportText) {
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

  private async ensureThread(runId: string): Promise<void> {
    const run = await this.prisma.standupRun.findUnique({
      where: { id: runId },
      select: { slackChannelId: true, slackThreadTs: true },
    });

    if (!run?.slackChannelId || !run?.slackThreadTs) {
      this.logger.error(
        `[Report] Run ${runId} has no Slack thread anchor — will not create a new public message.`,
      );
    }
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
  ): Promise<AiDigestResult> {
    const existingDigest = await this.prisma.aiDigest.findUnique({
      where: { runId },
    });

    if (existingDigest?.slackReportText) {
      return this.mapStoredDigest(existingDigest);
    }

    const additionalUpdatesByUser =
      await this.fetchAdditionalUpdatesByUser(runId);

    const aiResponses: RawResponseForAnalysis[] = submissions
      .filter((submission) => submission.answers.length > 0)
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

        generated = await this.aiService.analyzeRun(
          teamId,
          runId,
          aiResponses,
          false,
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
      throw lastError instanceof Error
        ? lastError
        : new Error(String(lastError));
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
      submissions: { status: string }[];
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
    const { slackReportText, slackReportBlocks } =
      this.buildPublishedSlackPayload(digest, {
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
        reportSections: digest.reportSections as any,
        slackReportText,
        nonResponderNames: nonResponderNames as any,
        slackReportBlocks: slackReportBlocks as any,
      },
      update: {
        generatedAt: new Date(digest.generatedAt),
        source: digest.source,
        summary: digest.summary,
        blockers: digest.blockers as any,
        themes: digest.themes as any,
        reportSections: digest.reportSections as any,
        slackReportText,
        nonResponderNames: nonResponderNames as any,
        slackReportBlocks: slackReportBlocks as any,
      },
    });

    this.logger.log(
      `[Report] Saved canonical report for run ${run.id} (source=${digest.source})`,
    );

    return { digest, slackReportText, slackReportBlocks };
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
    nonResponderNames: string[],
  ): string {
    const formatted = this.reportsService.formatDigestForSlack(digest);
    const nonResponderSection =
      nonResponderNames.length > 0
        ? [
            '*⏳ No Response*',
            ...nonResponderNames.map((name) => `• ${name}`),
          ].join('\n')
        : '*⏳ No Response*\n• Everyone submitted.';

    return `${formatted}\n\n${nonResponderSection}`;
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
  }): AiDigestResult {
    const sections = this.parseReportSections(digest.reportSections);

    return {
      teamId: digest.teamId,
      runId: digest.runId,
      generatedAt: digest.generatedAt.toISOString(),
      source: digest.source === 'ai' ? 'ai' : 'rules_fallback',
      summary: digest.summary,
      blockers: Array.isArray(digest.blockers)
        ? (digest.blockers as AiDigestResult['blockers'])
        : [],
      themes: Array.isArray(digest.themes)
        ? (digest.themes as AiDigestResult['themes'])
        : [],
      reportSections: sections,
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
