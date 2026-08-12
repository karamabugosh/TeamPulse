import { Injectable, Logger } from '@nestjs/common';

import { QuestionType } from '@prisma/client';

import { DmThreadContext, CollectionService } from '../collection/collection.service';

import { CheckInThreadService } from './check-in-thread.service';

import { IncomingMessageDto } from './dto/incoming-message.dto';

import { QuestionPayloadDto } from './dto/question-payload.dto';

import {
  buildDmQuestionMessage,
  buildDmThreadCompletionText,
  buildReplyInThreadReminderText,
  mapDbQuestionToPayload,
  validateSlackBlocks,
} from './slack-checkin.views';

import { SlackService } from './slack.service';



const DM_ONLY_REPLY =

  'Please answer your CheckIn inside the dedicated thread in our direct message conversation.';



export type CheckInRunDeliveryPayload = {

  checkInName: string;

  totalQuestions?: number;

  run?: {

    id?: string;

    submissions: Array<{

      id: string;

      slackDmChannelId?: string | null;

      slackDmThreadTs?: string | null;

      user: { slackUserId: string | null; slackDisplayName: string | null };

      conversationState?: {

        currentQuestion?: {

          id: string;

          question: string;

          type: import('@prisma/client').QuestionType;

          options: unknown;

        } | null;

      } | null;

    }>;

  } | null;

};



@Injectable()

export class SlackGateway {

  private readonly logger = new Logger(SlackGateway.name);



  constructor(

    private readonly slackService: SlackService,

    private readonly collectionService: CollectionService,

    private readonly threadService: CheckInThreadService,

  ) {}



  /**

   * Creates one parent DM message that becomes the thread anchor for this Standup run.

   */

  async deliverCheckInToParticipant(params: {

    submissionId: string;

    slackUserId: string;

    checkInName: string;

    question: QuestionPayloadDto;

  }): Promise<string | null> {

    this.logger.log(

      `[DM] Creating thread for ${params.slackUserId} — CheckIn "${params.checkInName}"`,

    );



    const dmChannelId = await this.slackService.openDirectMessage(params.slackUserId);

    if (!dmChannelId) {

      this.logger.error(`[DM] Failed to open DM for ${params.slackUserId}`);

      return null;

    }



    const posted = await this.postDmQuestionMessage({
      channelId: dmChannelId,
      submissionId: params.submissionId,
      question: params.question,
      checkInName: params.checkInName,
      isParent: true,
    });



    if (!posted.ok || !posted.ts) {

      this.logger.error(

        `[DM] Failed to create thread parent for ${params.slackUserId}: ${posted.error ?? 'unknown error'}`,

      );

      return null;

    }



    await this.collectionService.setSubmissionDmAnchor(

      params.submissionId,

      dmChannelId,

      posted.ts,

    );



    this.logger.log(

      `[DM] Created thread ${posted.ts} for "${params.checkInName}" in ${dmChannelId}`,

    );



    return dmChannelId;

  }



  async deliverCheckInRun(

    result: CheckInRunDeliveryPayload,

  ): Promise<{ delivered: number; failed: number; skipped: number }> {

    let delivered = 0;

    let failed = 0;

    let skipped = 0;



    if (!result.run?.submissions.length) {

      this.logger.warn(`[DM] No submissions to deliver for CheckIn "${result.checkInName}"`);

      return { delivered, failed, skipped };

    }



    this.logger.log(

      `[DM] Delivering CheckIn "${result.checkInName}" run ${result.run.id ?? 'unknown'} to ${result.run.submissions.length} submission(s)...`,

    );



    for (const submission of result.run.submissions) {

      const slackUserId = submission.user.slackUserId;

      const currentQuestion = submission.conversationState?.currentQuestion;



      if (submission.slackDmThreadTs) {

        this.logger.log(

          `[DM] Skipping ${slackUserId} — thread already created (${submission.slackDmThreadTs})`,

        );

        skipped += 1;

        continue;

      }



      if (!slackUserId || !currentQuestion) {

        this.logger.warn(

          `[DM] Skipping submission ${submission.id}: slackUserId=${slackUserId ?? 'missing'}, question=${currentQuestion ? 'ok' : 'missing'}`,

        );

        if (slackUserId) failed += 1;

        continue;

      }



      const questionPayload = mapDbQuestionToPayload(

        currentQuestion,

        1,

        result.totalQuestions ?? 1,

      );



      const dmChannelId = await this.deliverCheckInToParticipant({

        submissionId: submission.id,

        slackUserId,

        checkInName: result.checkInName,

        question: questionPayload,

      });



      if (dmChannelId) delivered += 1;

      else failed += 1;

    }



    this.logger.log(

      `[DM] Delivery complete for "${result.checkInName}": ${delivered} sent, ${failed} failed, ${skipped} skipped`,

    );



    return { delivered, failed, skipped };

  }



  async handleIncomingMessage(payload: IncomingMessageDto): Promise<void> {
    this.logger.log(
      `[DM Reply] Received from user ${payload.userId} in channel ${payload.channelId}` +
        (payload.threadTs ? ` thread_ts=${payload.threadTs}` : ' (no thread_ts)'),
    );

    try {
      await this.syncUserDisplayName(payload.userId);

      if (!payload.channelId.startsWith('D')) {
        await this.slackService.sendMessage({
          channelId: payload.channelId,
          text: DM_ONLY_REPLY,
        });
        return;
      }

      const context =
        await this.collectionService.resolveActiveDmSubmissionContext(
          payload.userId,
          payload.channelId,
          payload.threadTs,
        );

      if (!context) {
        if (!payload.threadTs) {
          await this.handleMainDmMessage(payload);
          return;
        }

        await this.slackService.postMessage({
          channelId: payload.channelId,
          threadTs: payload.threadTs,
          text: 'This CheckIn thread is no longer active.',
        });
        return;
      }

      this.logger.log(
        `[DM Reply] Matched submission ${context.submissionId} — thread anchor ${context.threadTs}`,
      );

      const currentQuestion =
        await this.collectionService.getCurrentQuestionForSubmission(
          context.submissionId,
        );

      if (!currentQuestion) {
        this.logger.warn(
          `[DM Reply] Submission ${context.submissionId} has no remaining questions`,
        );
        await this.slackService.postMessage({
          channelId: context.channelId,
          threadTs: context.threadTs,
          text: 'This CheckIn has no remaining questions.',
        });
        return;
      }

      this.logger.log(
        `[DM Reply] Processing answer for question #${currentQuestion.questionNumber}/${currentQuestion.totalQuestions} (${currentQuestion.questionId})`,
      );

      await this.processTextAnswer(payload, currentQuestion, context);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error handling message for ${payload.userId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.slackService.sendMessage({
        channelId: payload.channelId,
        ...(payload.threadTs ? { threadTs: payload.threadTs } : {}),
        text: '❌ An error occurred processing your request.',
      });
    }
  }



  async handleInteractiveAnswer(params: {

    slackUserId: string;

    submissionId: string;

    questionId: string;

    answer: string;

    channelId: string;

    threadTs: string;

  }): Promise<void> {

    try {

      await this.syncUserDisplayName(params.slackUserId);



      const context =
        await this.collectionService.resolveActiveDmSubmissionContext(
          params.slackUserId,
          params.channelId,
          params.threadTs,
        );



      if (!context || context.submissionId !== params.submissionId) {

        await this.slackService.postMessage({

          channelId: params.channelId,

          threadTs: params.threadTs,

          text: 'This CheckIn thread is no longer active.',

        });

        return;

      }



      const currentQuestion =

        await this.collectionService.getCurrentQuestionForSubmission(

          params.submissionId,

        );



      if (

        !currentQuestion ||

        currentQuestion.questionId !== params.questionId

      ) {

        await this.slackService.postMessage({

          channelId: params.channelId,

          threadTs: params.threadTs,

          text: 'This question is no longer active. Please answer the latest question above.',

        });

        return;

      }



      const nextQuestion = await this.submitAnswerOrThrow(
        params.slackUserId,
        params.questionId,
        params.answer,
        params.submissionId,
      );

      const confirmation = await this.slackService.postMessage({
        channelId: params.channelId,
        threadTs: params.threadTs,
        text: `✅ *${params.answer.trim()}*`,
      });

      if (!confirmation.ok) {
        this.logger.warn(
          `[DM] Could not post answer confirmation in thread ${params.threadTs}: ${confirmation.error ?? confirmation.slackError ?? 'unknown error'}`,
        );
      }

      await this.advanceAfterAnswer({
        slackUserId: params.slackUserId,
        submissionId: params.submissionId,
        channelId: params.channelId,
        threadTs: params.threadTs,
        checkInName: context.checkInName,
        nextQuestion,
      });

    } catch (error: unknown) {

      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(
        `[Pipeline] interactive answer FAILED user=${params.slackUserId} submission=${params.submissionId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );



      await this.slackService.postMessage({

        channelId: params.channelId,

        threadTs: params.threadTs,

        text: `❌ ${message}`,

      });

    }

  }



  private async handleMainDmMessage(payload: IncomingMessageDto): Promise<void> {

    const activeOptions = await this.collectionService.getActiveCheckInOptions(

      payload.userId,

    );



    if (activeOptions.length === 0) {

      const normalizedMessage = payload.message.trim().toLowerCase();

      if (['start', 'hi', 'hello'].includes(normalizedMessage)) {

        await this.slackService.sendMessage({

          channelId: payload.channelId,

          text: "You don't have an active CheckIn right now. CheckIns start automatically at their scheduled time.",

        });

        return;

      }



      await this.slackService.sendMessage({

        channelId: payload.channelId,

        text: "You don't have an active CheckIn right now. CheckIns start automatically at their scheduled time.",

      });

      return;

    }



    if (activeOptions.length === 1) {

      await this.slackService.sendMessage({

        channelId: payload.channelId,

        text: buildReplyInThreadReminderText({

          checkInName: activeOptions[0].checkInName,

        }),

      });

      return;

    }



    const list = activeOptions

      .map((option) => `• *${option.checkInName}* — open its 📋 thread and reply there`)

      .join('\n');



    await this.slackService.sendMessage({

      channelId: payload.channelId,

      text: [

        'You have multiple active CheckIns.',

        '',

        list,

        '',

        'Please reply inside the correct CheckIn thread.',

      ].join('\n'),

    });

  }



  async sendStandupReminder(

    userId: string,

    channelId: string,

    checkInName: string,

    _questionText: string,

  ): Promise<void> {

    await this.slackService.sendMessage({

      channelId,

      text:

        `⏰ *Reminder — ${checkInName}*\n\n` +

        'Please open the 📋 CheckIn thread in our DM and complete your answers there.',

    });

  }



  async triggerAutomaticStandupForUser(userId: string, channelId: string): Promise<void> {

    await this.handleMainDmMessage({

      userId,

      channelId,

      message: 'hello',

      timestamp: String(Date.now()),

    });

  }



  async startConversationFlow(userId: string, channelId: string): Promise<void> {

    await this.handleMainDmMessage({

      userId,

      channelId,

      message: 'start',

      timestamp: String(Date.now()),

    });

  }



  private async syncUserDisplayName(slackUserId: string): Promise<void> {

    const displayName = await this.slackService.getUserDisplayName(slackUserId);

    await this.collectionService.syncSlackUserProfile(slackUserId, displayName);

  }



  private async submitAnswerOrThrow(
    slackUserId: string,
    questionId: string,
    answer: string,
    submissionId: string,
  ): Promise<QuestionPayloadDto | null> {
    return this.collectionService.submitAnswer(
      slackUserId,
      questionId,
      answer,
      submissionId,
    );
  }

  private async processTextAnswer(
    payload: IncomingMessageDto,
    currentQuestion: QuestionPayloadDto,
    context: DmThreadContext,
  ): Promise<void> {
    this.logger.log(
      `[Pipeline] submitAnswer START submission=${context.submissionId} question=${currentQuestion.questionId} (#${currentQuestion.questionNumber}/${currentQuestion.totalQuestions})`,
    );

    let nextQuestion: QuestionPayloadDto | null;

    try {
      nextQuestion = await this.submitAnswerOrThrow(
        payload.userId,
        currentQuestion.questionId,
        payload.message,
        context.submissionId,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[Pipeline] submitAnswer FAILED submission=${context.submissionId} question=${currentQuestion.questionId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.slackService.postMessage({
        channelId: context.channelId,
        threadTs: context.threadTs,
        text: `❌ ${message}`,
      });
      return;
    }

    this.logger.log(
      `[Pipeline] submitAnswer DONE submission=${context.submissionId} nextQuestion=${nextQuestion?.questionId ?? 'COMPLETE'}`,
    );

    try {
      await this.sendNextQuestionOrComplete({
        slackUserId: payload.userId,
        submissionId: context.submissionId,
        channelId: context.channelId,
        threadTs: context.threadTs,
        checkInName: context.checkInName,
        nextQuestion,
      });
      this.logger.log(
        `[Pipeline] sendNextQuestionOrComplete DONE submission=${context.submissionId}`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[Pipeline] sendNextQuestionOrComplete FAILED submission=${context.submissionId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.slackService.postMessage({
        channelId: context.channelId,
        threadTs: context.threadTs,
        text: `❌ Failed to continue CheckIn: ${message}`,
      });
      throw error;
    }
  }

  private async sendNextQuestionOrComplete(params: {
    slackUserId: string;
    submissionId: string;
    channelId: string;
    threadTs: string;
    checkInName: string;
    nextQuestion: QuestionPayloadDto | null;
  }): Promise<void> {
    const checkInConfig =
      await this.collectionService.getCheckInConfigForSubmission(
        params.submissionId,
      );

    if (params.nextQuestion) {
      this.logger.log(
        `[Pipeline] sendNextQuestion START submission=${params.submissionId} question=${params.nextQuestion.questionId} (#${params.nextQuestion.questionNumber}/${params.nextQuestion.totalQuestions}) thread=${params.threadTs}`,
      );
      await this.postQuestionInThread(
        params.channelId,
        params.threadTs,
        params.submissionId,
        params.nextQuestion,
      );
      this.logger.log(
        `[Pipeline] sendNextQuestion DONE submission=${params.submissionId} question=${params.nextQuestion.questionId}`,
      );
      return;
    }

    this.logger.log(
      `[Pipeline] completeConversation START submission=${params.submissionId}`,
    );

    const completed = await this.collectionService.completeConversation(
      params.slackUserId,
      params.submissionId,
    );

    if (completed) {
      await this.postParticipantSummaryWithRetry(completed.submissionId);
    }

    const checkInName =
      completed?.checkInName ||
      checkInConfig?.name ||
      params.checkInName;

    const outro =
      checkInConfig?.outroMessage?.trim() ||
      buildDmThreadCompletionText({ checkInName });

    const outroResult = await this.slackService.postMessage({
      channelId: params.channelId,
      threadTs: params.threadTs,
      text: outro,
    });

    if (!outroResult.ok) {
      throw new Error(
        outroResult.error ??
          outroResult.slackError ??
          'Failed to post CheckIn completion message to Slack.',
      );
    }

    if (completed?.runId) {
      await this.threadService.postAdditionalUpdateButtonForUser({
        runId: completed.runId,
        slackUserId: params.slackUserId,
      });
    }

    this.logger.log(
      `[Pipeline] completeConversation DONE submission=${params.submissionId}`,
    );
  }

  private async postDmQuestionMessage(params: {
    channelId: string;
    threadTs?: string;
    submissionId: string;
    question: QuestionPayloadDto;
    checkInName?: string;
    isParent?: boolean;
  }): Promise<{
    ok: boolean;
    ts?: string;
    error?: string;
    slackError?: string;
  }> {
    const message = buildDmQuestionMessage({
      question: params.question,
      submissionId: params.submissionId,
      checkInName: params.checkInName,
      isParent: params.isParent,
    });

    const debugContext = `question=${params.question.questionId} type=${params.question.type}`;

    if (message.usedBlocks) {
      const validation = validateSlackBlocks(message.blocks);
      if (!validation.valid) {
        this.logger.warn(
          `[Pipeline] Block validation failed for ${debugContext}: ${validation.errors.join('; ')}`,
        );
      }
    } else if (
      params.question.type &&
      params.question.type !== QuestionType.FREE_TEXT
    ) {
      this.logger.log(
        `[Pipeline] Using plain-text fallback for ${debugContext} (no interactive blocks).`,
      );
    }

    let posted = await this.slackService.postMessage({
      channelId: params.channelId,
      threadTs: params.threadTs,
      text: message.text,
      ...(message.usedBlocks ? { blocks: message.blocks } : {}),
      debugContext,
    });

    if (
      !posted.ok &&
      posted.slackError === 'invalid_blocks' &&
      message.usedBlocks
    ) {
      this.logger.error(
        `[Pipeline] Slack rejected blocks for ${debugContext}; retrying as plain text.`,
      );
      const fallbackText = message.text.includes('reply with your answer')
        ? message.text
        : `${message.text}\n\n_Please reply with your answer in this thread._`;

      posted = await this.slackService.postMessage({
        channelId: params.channelId,
        threadTs: params.threadTs,
        text: fallbackText,
        debugContext: `${debugContext} fallback`,
      });
    }

    return posted;
  }

  private async postQuestionInThread(
    channelId: string,
    threadTs: string,
    submissionId: string,
    question: QuestionPayloadDto,
  ): Promise<void> {
    const posted = await this.postDmQuestionMessage({
      channelId,
      threadTs,
      submissionId,
      question,
    });

    if (!posted.ok) {
      const detail =
        posted.error ??
        posted.slackError ??
        'unknown Slack API error';
      throw new Error(
        `Failed to post question ${question.questionId} in thread ${threadTs}: ${detail}`,
      );
    }

    this.logger.log(
      `[Pipeline] Slack postMessage OK question=${question.questionId} ts=${posted.ts ?? 'unknown'}`,
    );
  }

  private async advanceAfterAnswer(params: {
    slackUserId: string;
    submissionId: string;
    channelId: string;
    threadTs: string;
    checkInName: string;
    nextQuestion: QuestionPayloadDto | null;
  }): Promise<void> {
    await this.sendNextQuestionOrComplete(params);
  }



  private async postParticipantSummaryWithRetry(

    submissionId: string,

    attempts = 3,

  ): Promise<void> {

    for (let attempt = 1; attempt <= attempts; attempt += 1) {

      try {

        await this.threadService.postParticipantSummary(submissionId);

        return;

      } catch (error: unknown) {

        const message = error instanceof Error ? error.message : String(error);

        if (attempt >= attempts) {

          this.logger.error(

            `[Thread] Failed to post participant summary for ${submissionId} after ${attempts} attempts: ${message}`,

          );

          return;

        }

        await new Promise((resolve) => setTimeout(resolve, attempt * 500));

      }

    }

  }

}



export default SlackGateway;

