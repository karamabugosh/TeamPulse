import { Injectable, Logger } from '@nestjs/common';

import { IncomingMessageDto } from './dto/incoming-message.dto';

import { SlackService } from './slack.service';

import { QuestionPayloadDto } from './dto/question-payload.dto';

import { CollectionService } from '../collection/collection.service';
import { CheckInThreadService } from './check-in-thread.service';

const ACK_MESSAGES = ['Great! ✅', 'Awesome.', 'Got it! 👍', 'Perfect!', 'Thanks! ✅'];



export type CheckInRunDeliveryPayload = {

  checkInName: string;

  run?: {

    id?: string;

    submissions: Array<{

      id: string;

      slackDmChannelId?: string | null;

      user: { slackUserId: string | null; slackDisplayName: string | null };

      conversationState?: { currentQuestion?: { question: string } | null } | null;

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

   * Geekbot-style DM kickoff: intro + first question in ONE continuous DM thread.

   */

  async deliverCheckInToParticipant(params: {

    submissionId: string;

    slackUserId: string;

    displayName: string;

    checkInName: string;

    introMessage?: string | null;

    firstQuestionText: string;

    questionNumber: number;

  }): Promise<string | null> {

    this.logger.log(

      `[DM] Starting delivery for ${params.displayName} (${params.slackUserId}) — CheckIn "${params.checkInName}"`,

    );



    const dmChannelId = await this.slackService.openDirectMessage(params.slackUserId);

    if (!dmChannelId) {

      this.logger.error(

        `[DM] Failed to open DM for ${params.slackUserId} — check bot token and im:write scope`,

      );

      return null;

    }



    const firstName = params.displayName.split(' ')[0] || params.displayName;

    const intro =

      params.introMessage?.trim() ||

      `👋 Good morning ${firstName}!\n\nIt's time for your *${params.checkInName}*.\n\nLet's get started.`;



    const introSent = await this.slackService.sendMessage({ channelId: dmChannelId, text: intro });

    if (!introSent) {

      this.logger.error(`[DM] Intro message failed for ${params.slackUserId} in channel ${dmChannelId}`);

      return null;

    }



    const questionSent = await this.slackService.sendMessage({

      channelId: dmChannelId,

      text: `*Question ${params.questionNumber}:*\n${params.firstQuestionText}`,

    });



    if (!questionSent) {

      this.logger.error(`[DM] Question 1 failed for ${params.slackUserId} in channel ${dmChannelId}`);

      return null;

    }



    await this.collectionService.setSubmissionDmChannel(params.submissionId, dmChannelId);



    this.logger.log(

      `[DM] Successfully delivered intro + Q1 to ${params.displayName} (${params.slackUserId}) in ${dmChannelId}`,

    );



    return dmChannelId;

  }



  /**

   * Deliver Geekbot-style DMs to all submissions on a run.

   * Skips submissions that already have a DM channel (already delivered).

   */

  async deliverCheckInRun(

    result: CheckInRunDeliveryPayload,

    introMessage?: string | null,

  ): Promise<{ delivered: number; failed: number; skipped: number }> {

    let delivered = 0;

    let failed = 0;

    let skipped = 0;



    if (!result.run?.submissions.length) {

      this.logger.warn(

        `[DM] No submissions to deliver for CheckIn "${result.checkInName}"`,

      );

      return { delivered, failed, skipped };

    }



    this.logger.log(

      `[DM] Delivering CheckIn "${result.checkInName}" run ${result.run.id ?? 'unknown'} to ${result.run.submissions.length} submission(s)...`,

    );



    for (const submission of result.run.submissions) {

      const slackUserId = submission.user.slackUserId;

      const currentQuestion = submission.conversationState?.currentQuestion;



      if (submission.slackDmChannelId) {

        this.logger.log(

          `[DM] Skipping ${slackUserId} — already delivered to ${submission.slackDmChannelId}`,

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



      const dmChannelId = await this.deliverCheckInToParticipant({

        submissionId: submission.id,

        slackUserId,

        displayName: submission.user.slackDisplayName || slackUserId,

        checkInName: result.checkInName,

        introMessage,

        firstQuestionText: currentQuestion.question,

        questionNumber: 1,

      });



      if (dmChannelId) delivered += 1;

      else failed += 1;

    }



    this.logger.log(

      `[DM] Delivery complete for "${result.checkInName}": ${delivered} sent, ${failed} failed, ${skipped} already delivered`,

    );



    return { delivered, failed, skipped };

  }



  async handleIncomingMessage(payload: IncomingMessageDto): Promise<void> {

    this.logger.log(

      `Received message from user ${payload.userId} in channel ${payload.channelId}`,

    );



    try {

      await this.syncUserDisplayName(payload.userId);



      const currentQuestion = await this.collectionService.getCurrentQuestion(payload.userId);



      if (currentQuestion) {

        await this.processAnswer(payload, currentQuestion);

        return;

      }



      const normalizedMessage = payload.message.trim().toLowerCase();

      if (['start', 'hi', 'hello'].includes(normalizedMessage)) {

        await this.startConversationFlow(payload.userId, payload.channelId);

        return;

      }



      this.logger.debug(`No active conversation for user ${payload.userId}.`);

      await this.slackService.sendMessage({

        channelId: payload.channelId,

        text: "You don't have an active check-in right now. Check-ins start automatically at their scheduled time.",

      });

    } catch (error: unknown) {

      const message = error instanceof Error ? error.message : String(error);

      this.logger.error(`Error handling message for ${payload.userId}: ${message}`, error instanceof Error ? error.stack : undefined);

      await this.slackService.sendMessage({

        channelId: payload.channelId,

        text: '❌ An error occurred processing your request.',

      });

    }

  }



  private async syncUserDisplayName(slackUserId: string): Promise<void> {

    const displayName = await this.slackService.getUserDisplayName(slackUserId);

    await this.collectionService.syncSlackUserProfile(slackUserId, displayName);

  }



  async sendStandupReminder(userId: string, channelId: string, checkInName: string, questionText: string): Promise<void> {

    await this.slackService.sendMessage({

      channelId,

      text: `⏰ *Reminder — ${checkInName}*\n\n${questionText}\n\n_Reply here to continue your check-in._`,

    });

  }



  /** Legacy V1: open DM and start standup if user has an active check-in. */

  async triggerAutomaticStandupForUser(userId: string, channelId: string): Promise<void> {

    await this.startConversationFlow(userId, channelId);

  }



  async startConversationFlow(userId: string, channelId: string): Promise<void> {

    const firstQuestion = await this.collectionService.startConversation(userId);

    if (firstQuestion) {

      await this.slackService.sendMessage({

        channelId,

        text: `*Question ${firstQuestion.questionNumber || 1}:*\n${firstQuestion.text}`,

      });

      return;

    }

    await this.slackService.sendMessage({

      channelId,

      text: '✅ There are no questions for you right now.',

    });

  }



  /**

   * Geekbot-style: acknowledge answer → ask next question → outro when done.

   * All messages stay in the same DM channel (payload.channelId).

   */

  private async processAnswer(

    payload: IncomingMessageDto,

    currentQuestion: QuestionPayloadDto,

  ): Promise<void> {

    const channelId = payload.channelId;



    try {

      await this.collectionService.submitAnswer(

        payload.userId,

        currentQuestion.questionId,

        payload.message,

      );

    } catch (error: unknown) {

      const message = error instanceof Error ? error.message : String(error);

      await this.slackService.sendMessage({ channelId, text: `❌ ${message}` });

      return;

    }



    const checkInConfig = await this.collectionService.getActiveCheckInConfigForUser(payload.userId);

    const nextQuestion = await this.collectionService.getNextQuestion(payload.userId);



    if (nextQuestion) {

      const ack = ACK_MESSAGES[Math.floor(Math.random() * ACK_MESSAGES.length)];

      await this.slackService.sendMessage({ channelId, text: ack });

      await this.slackService.sendMessage({

        channelId,

        text: `*Question ${nextQuestion.questionNumber}:*\n${nextQuestion.text}`,

      });

      return;

    }



    const submissionId = await this.collectionService.finishConversation(payload.userId);
    if (submissionId) {
      await this.threadService.postParticipantSummary(submissionId);
    }

    const outro =

      checkInConfig?.outroMessage?.trim() ||

      'Perfect! Your responses have been recorded successfully. ✅';

    await this.slackService.sendMessage({ channelId, text: outro });

  }

}



export default SlackGateway;


