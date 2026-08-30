import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';

import { QuestionType } from '@prisma/client';

import { DmThreadContext, CollectionService } from '../collection/collection.service';

import { CheckInThreadService } from './check-in-thread.service';

import { IncomingMessageDto } from './dto/incoming-message.dto';

import { QuestionPayloadDto } from './dto/question-payload.dto';

import {
  buildBlockerDetailsModal,
  buildBlockerSavedSuccessBlocks,
  buildDmQuestionMessage,
  buildDmThreadCompletionText,
  buildReplyInThreadReminderText,
  formatBlockerAnswerText,
  isBlockerCapableQuestion,
  mapDbQuestionToPayload,
  parseBlockerDetailsModalMetadata,
  validateSlackBlocks,
} from './slack-checkin.views';

import { SlackService } from './slack.service';
import { SlackAiAssistantService } from './slack-ai-assistant.service';
import { JiraSlackListener } from './jira-slack.listener';
import { JiraStandupHookService } from '../jira/jira-standup-hook.service';
import { AnswerJiraLinkService } from '../jira/answer-jira-link.service';
import { JiraIssuePickerService } from '../jira/jira-issue-picker.service';
import { JiraService } from '../jira/jira.service';
import { BlockerFollowUpService } from '../jira/blocker-follow-up.service';
import { WorkspaceMembersService } from '../common/workspace-members.service';
import { SubmitAnswerOptions } from '../collection/collection.service';
import {
  buildBlockedFollowUpModal,
  buildBlockerFollowUpCardBlocks,
  buildBlockerFollowUpIntroBlocks,
  buildResolvedFollowUpModal,
  buildWorkingFollowUpModal,
  BLOCKER_FOLLOWUP_BLOCKED,
  BLOCKER_FOLLOWUP_RESOLVED,
  BLOCKER_FOLLOWUP_WORKING,
  parseFollowUpActionId,
  type BlockerFollowUpModalMetadata,
} from './blocker-follow-up.views';
import type { FollowUpChoice } from '../jira/blocker-follow-up.service';



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

  private readonly jiraLinkFinalizeTimers = new Map<string, NodeJS.Timeout>();

  private static readonly JIRA_LINK_FINALIZE_DELAY_MS = 2000;



  constructor(

    private readonly slackService: SlackService,

    private readonly collectionService: CollectionService,

    private readonly threadService: CheckInThreadService,

    private readonly jiraStandupHookService: JiraStandupHookService,

    private readonly answerJiraLinkService: AnswerJiraLinkService,

    private readonly jiraService: JiraService,

    private readonly jiraIssuePickerService: JiraIssuePickerService,

    private readonly blockerFollowUpService: BlockerFollowUpService,

    private readonly workspaceMembers: WorkspaceMembersService,

    private readonly slackAiAssistant: SlackAiAssistantService,

    @Inject(forwardRef(() => JiraSlackListener))
    private readonly jiraSlackListener: JiraSlackListener,

  ) {}



  /**

   * Creates one parent DM message that becomes the thread anchor for this Standup run.
   * If the user has active blockers (open / in_progress), starts Blocker Follow-up first.

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

    const active = await this.blockerFollowUpService.listActiveBlockersForSlackUser(
      params.slackUserId,
    );

    if (active && active.blockers.length > 0) {
      const intro = buildBlockerFollowUpIntroBlocks({
        checkInName: params.checkInName,
        count: active.blockers.length,
      });

      const parent = await this.slackService.postMessage({
        channelId: dmChannelId,
        text: intro.text,
        blocks: intro.blocks,
      });

      if (!parent.ok || !parent.ts) {
        this.logger.error(
          `[DM] Failed to create follow-up parent for ${params.slackUserId}: ${parent.error ?? 'unknown'}`,
        );
        return null;
      }

      await this.collectionService.setSubmissionDmAnchor(
        params.submissionId,
        dmChannelId,
        parent.ts,
      );

      await this.blockerFollowUpService.startSession({
        submissionId: params.submissionId,
        userId: active.userId,
        blockerIds: active.blockers.map((b) => b.id),
        channelId: dmChannelId,
        threadTs: parent.ts,
      });

      const first = active.blockers[0];
      const card = buildBlockerFollowUpCardBlocks({
        submissionId: params.submissionId,
        blocker: first,
      });

      await this.slackService.postMessage({
        channelId: dmChannelId,
        threadTs: parent.ts,
        text: card.text,
        blocks: card.blocks,
      });

      this.logger.log(
        `[DM] Started blocker follow-up (${active.blockers.length}) for ${params.slackUserId}`,
      );

      return dmChannelId;
    }

    const posted = await this.postDmQuestionMessage({
      channelId: dmChannelId,
      submissionId: params.submissionId,
      question: params.question,
      checkInName: params.checkInName,
      isParent: true,
      slackUserId: params.slackUserId,
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

  async openBlockerFollowUpModal(params: {
    actionId: string;
    triggerId: string;
    channelId: string;
    threadTs: string;
    client: {
      views: {
        open: (args: {
          trigger_id: string;
          view: Record<string, unknown>;
        }) => Promise<unknown>;
      };
    };
  }): Promise<boolean> {
    const parsed = parseFollowUpActionId(params.actionId);
    if (!parsed) return false;

    let choice: FollowUpChoice | null = null;
    if (parsed.prefix === BLOCKER_FOLLOWUP_RESOLVED) choice = 'resolved';
    else if (parsed.prefix === BLOCKER_FOLLOWUP_WORKING) choice = 'working';
    else if (parsed.prefix === BLOCKER_FOLLOWUP_BLOCKED) choice = 'blocked';
    if (!choice) return false;

    const metadata: BlockerFollowUpModalMetadata = {
      submissionId: parsed.submissionId,
      blockerId: parsed.blockerId,
      channelId: params.channelId,
      threadTs: params.threadTs,
      choice,
    };

    const view =
      choice === 'resolved'
        ? buildResolvedFollowUpModal(metadata)
        : choice === 'working'
          ? buildWorkingFollowUpModal(metadata)
          : buildBlockedFollowUpModal(metadata);

    await params.client.views.open({
      trigger_id: params.triggerId,
      view,
    });
    return true;
  }

  async handleBlockerFollowUpSubmit(params: {
    slackUserId: string;
    metadata: BlockerFollowUpModalMetadata;
    notes: string;
    resolutionType?: string | null;
    needsHelp?: boolean | null;
    needsEscalation?: boolean | null;
  }): Promise<{ ok: boolean; error?: string }> {
    const active = await this.blockerFollowUpService.listActiveBlockersForSlackUser(
      params.slackUserId,
    );
    if (!active) {
      return { ok: false, error: 'User not found' };
    }

    const notes = params.notes.trim();
    if (!notes) {
      return { ok: false, error: 'Notes are required.' };
    }

    try {
      await this.blockerFollowUpService.applyFollowUp({
        blockerId: params.metadata.blockerId,
        userId: active.userId,
        choice: params.metadata.choice,
        notes,
        resolutionType: params.resolutionType,
        needsHelp: params.needsHelp,
        needsEscalation: params.needsEscalation,
      });
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to save follow-up',
      };
    }

    await this.slackService.postMessage({
      channelId: params.metadata.channelId,
      threadTs: params.metadata.threadTs,
      text: `✅ Blocker update saved (${params.metadata.choice}).`,
    });

    const { remaining, done } =
      await this.blockerFollowUpService.markBlockerCompletedInSession({
        submissionId: params.metadata.submissionId,
        blockerId: params.metadata.blockerId,
      });

    if (!done && remaining.length > 0) {
      const nextId = remaining[0];
      const nextBlocker = await this.blockerFollowUpService.getBlockerById(nextId);
      if (nextBlocker) {
        const daysOpen = Math.max(
          0,
          Math.floor(
            (Date.now() - nextBlocker.createdAt.getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        );
        const card = buildBlockerFollowUpCardBlocks({
          submissionId: params.metadata.submissionId,
          blocker: {
            id: nextBlocker.id,
            title: nextBlocker.title?.trim() || nextBlocker.description.slice(0, 120),
            description: nextBlocker.description,
            status: nextBlocker.status,
            severity: nextBlocker.severity,
            createdAt: nextBlocker.createdAt,
            daysOpen,
            linkedIssueKey: nextBlocker.linkedIssueKey,
            linkedIssueUrl: nextBlocker.linkedIssueUrl,
          },
        });
        await this.slackService.postMessage({
          channelId: params.metadata.channelId,
          threadTs: params.metadata.threadTs,
          text: card.text,
          blocks: card.blocks,
        });
      }
      return { ok: true };
    }

    await this.startStandupQuestionsAfterFollowUp({
      slackUserId: params.slackUserId,
      submissionId: params.metadata.submissionId,
      channelId: params.metadata.channelId,
      threadTs: params.metadata.threadTs,
    });

    return { ok: true };
  }

  private async startStandupQuestionsAfterFollowUp(params: {
    slackUserId: string;
    submissionId: string;
    channelId: string;
    threadTs: string;
  }) {
    await this.slackService.postMessage({
      channelId: params.channelId,
      threadTs: params.threadTs,
      text: '✅ Blocker follow-up complete. Starting today\'s standup…',
    });

    const question = await this.collectionService.getCurrentQuestionForSubmission(
      params.submissionId,
    );
    if (!question) {
      this.logger.warn(
        `[Follow-up] No current question for submission ${params.submissionId}`,
      );
      return;
    }

    await this.postDmQuestionMessage({
      channelId: params.channelId,
      threadTs: params.threadTs,
      submissionId: params.submissionId,
      question,
      isParent: false,
      slackUserId: params.slackUserId,
    });
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

      // Channel messages (non-DM) are handled by app_mention → Slack AI.
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
        // Idle DM / AI conversation thread → Pulse AI (same AiChatService as Workspace).
        if (!payload.threadTs) {
          const activeOptions =
            await this.collectionService.getActiveCheckInOptions(
              payload.userId,
            );
          const normalized = payload.message.trim().toLowerCase();
          if (
            activeOptions.length > 0 &&
            ['start', 'hi', 'hello'].includes(normalized)
          ) {
            await this.handleMainDmMessage(payload);
            return;
          }

          await this.slackAiAssistant.handleQuestion({
            slackUserId: payload.userId,
            channelId: payload.channelId,
            question: payload.message,
            messageTs: payload.timestamp,
            source: 'dm',
          });
          return;
        }

        // Follow-up in a thread that is not an active CheckIn → AI conversation.
        await this.slackAiAssistant.handleQuestion({
          slackUserId: payload.userId,
          channelId: payload.channelId,
          question: payload.message,
          messageTs: payload.timestamp,
          threadTs: payload.threadTs,
          source: 'dm',
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

    confirmationText?: string;

    confirmationBlocks?: import('@slack/types').KnownBlock[];

    submitOptions?: SubmitAnswerOptions;

    /** Delay before posting the next question (e.g. after blocker save toast). */
    continueDelayMs?: number;

  }): Promise<boolean> {

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

        return false;

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

        return false;

      }



      const nextQuestion = await this.submitAnswerOrThrow(
        params.slackUserId,
        params.questionId,
        params.answer,
        params.submissionId,
        params.submitOptions,
      );

      const confirmation = await this.slackService.postMessage({
        channelId: params.channelId,
        threadTs: params.threadTs,
        text: params.confirmationText ?? `✅ *${params.answer.trim()}*`,
        ...(params.confirmationBlocks
          ? { blocks: params.confirmationBlocks }
          : {}),
      });

      if (!confirmation.ok) {
        this.logger.warn(
          `[DM] Could not post answer confirmation in thread ${params.threadTs}: ${confirmation.error ?? confirmation.slackError ?? 'unknown error'}`,
        );
      }

      if (params.continueDelayMs && params.continueDelayMs > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, params.continueDelayMs),
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

      return true;

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

      return false;

    }

  }

  /**
   * For BLOCKER (or legacy phrase-matched YES_NO) → Yes: open Blocker Details modal.
   * Returns true when the modal was opened so the normal Yes answer path is skipped.
   */
  async tryOpenBlockerDetailsModal(params: {
    slackUserId: string;
    submissionId: string;
    questionId: string;
    answer: string;
    channelId: string;
    threadTs: string;
    triggerId?: string;
    client: { views: { open: (args: unknown) => Promise<unknown> } };
  }): Promise<boolean> {
    if (params.answer.trim().toLowerCase() !== 'yes' || !params.triggerId) {
      return false;
    }

    const currentQuestion =
      await this.collectionService.getCurrentQuestionForSubmission(
        params.submissionId,
      );

    if (
      !currentQuestion ||
      currentQuestion.questionId !== params.questionId ||
      !isBlockerCapableQuestion({
        type: currentQuestion.type,
        text: currentQuestion.text,
      })
    ) {
      return false;
    }

    try {
      await params.client.views.open({
        trigger_id: params.triggerId,
        view: buildBlockerDetailsModal({
          submissionId: params.submissionId,
          questionId: params.questionId,
          channelId: params.channelId,
          threadTs: params.threadTs,
        }),
      });
      return true;
    } catch (error: unknown) {
      this.logger.error(
        `Failed to open blocker details modal: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  async handleBlockerDetailsSubmit(params: {
    slackUserId: string;
    privateMetadata: string | undefined;
    values: Record<
      string,
      Record<
        string,
        {
          value?: string;
          selected_option?: { value?: string; text?: { text?: string } };
          selected_date?: string;
          selected_user?: string;
        }
      >
    >;
  }): Promise<{ ok: boolean; error?: string }> {
    const metadata = parseBlockerDetailsModalMetadata(params.privateMetadata);
    if (!metadata) {
      this.logger.warn('Blocker details submit missing metadata');
      return { ok: false, error: 'Missing blocker modal metadata.' };
    }

    const title =
      params.values.blocker_title_block?.blocker_title?.value?.trim() ?? '';
    const description =
      params.values.blocker_description_block?.blocker_description?.value?.trim() ??
      '';
    const severity =
      params.values.blocker_severity_block?.blocker_severity?.selected_option
        ?.value ?? 'Medium';
    const categoryRaw =
      params.values.blocker_category_block?.blocker_category?.selected_option
        ?.value ?? '';
    const categoryOther =
      params.values.blocker_category_other_block?.blocker_category_other?.value?.trim() ??
      '';
    const category =
      categoryRaw === 'Other' && categoryOther
        ? categoryOther
        : categoryRaw || 'Other';
    const expectedResolution =
      params.values.blocker_resolution_block?.blocker_resolution?.selected_date ??
      null;
    const preventingAllWork =
      params.values.blocker_preventing_block?.blocker_preventing?.selected_option
        ?.value === 'Yes';
    const canContinueOtherTask =
      params.values.blocker_continue_block?.blocker_continue?.selected_option
        ?.value ?? null;
    const ownerUserId =
      params.values.blocker_owner_block?.blocker_owner?.selected_user ?? null;
    // Resolve to a human display name for web UI — never persist raw <@U…>.
    let ownerLabel: string | null = null;
    if (ownerUserId) {
      const fromDb = await this.workspaceMembers.resolveSlackUserIdToLabel(
        null,
        ownerUserId,
      );
      const fromSlack = await this.slackService
        .getUserDisplayName(ownerUserId)
        .catch(() => null);
      ownerLabel = fromDb || fromSlack || ownerUserId;
    }

    const jiraActionId = `checkin_link_jira:${metadata.submissionId}:${metadata.questionId}`;
    const jiraBlock = params.values.blocker_jira_block ?? {};
    const jiraField = jiraBlock[jiraActionId] ?? Object.values(jiraBlock)[0];
    const issuePickerValue = jiraField?.selected_option?.value ?? null;

    if (!title || !description || !categoryRaw) {
      const error =
        'Blocker title, description, and category are required.';
      await this.slackService.postMessage({
        channelId: metadata.channelId,
        threadTs: metadata.threadTs,
        text: `❌ ${error}`,
      });
      return { ok: false, error };
    }

    if (categoryRaw === 'Other' && !categoryOther) {
      const error = 'Please specify a category when Other is selected.';
      await this.slackService.postMessage({
        channelId: metadata.channelId,
        threadTs: metadata.threadTs,
        text: `❌ ${error}`,
      });
      return { ok: false, error };
    }

    let issueKey: string | null = null;
    if (issuePickerValue) {
      const actingUserId = await this.jiraService.resolveJiraActingUserId(
        params.slackUserId,
      );
      if (actingUserId) {
        const snapshot = await this.jiraIssuePickerService.resolveSelectedIssue(
          actingUserId,
          issuePickerValue,
        );
        issueKey = snapshot?.issueKey ?? issuePickerValue;
      } else {
        issueKey = issuePickerValue;
      }
    }

    const blockerPayload = {
      title,
      description,
      severity,
      category,
      owner: ownerLabel,
      jiraIssue: issueKey,
      expectedResolution,
      preventingAllWork,
      canContinueOtherTask,
    };

    const displayText = [
      'Yes',
      '',
      formatBlockerAnswerText({
        title,
        description,
        severity,
        category,
        expectedResolution,
        issueKey,
        preventingAllWork,
        canContinueOtherTask,
        ownerLabel,
      }),
    ].join('\n');

    try {
      const saved = await this.handleInteractiveAnswer({
        slackUserId: params.slackUserId,
        submissionId: metadata.submissionId,
        questionId: metadata.questionId,
        // YES_NO questions only accept Yes/No — details go in structuredValue + displayText
        answer: 'Yes',
        channelId: metadata.channelId,
        threadTs: metadata.threadTs,
        confirmationText: '✅ Blocker saved successfully',
        confirmationBlocks: buildBlockerSavedSuccessBlocks({
          title,
          description,
          severity,
          category,
          issueKey,
          expectedResolution,
          preventingAllWork,
          ownerLabel,
        }),
        submitOptions: {
          displayText,
          structuredExtras: {
            blocked: true,
            blocker: blockerPayload,
          },
        },
        continueDelayMs: 1000,
      });

      if (!saved) {
        return { ok: false, error: 'Failed to save blocker answer.' };
      }

      if (issueKey) {
        await this.linkBlockerJiraIssue({
          slackUserId: params.slackUserId,
          submissionId: metadata.submissionId,
          questionId: metadata.questionId,
          issueKey,
        });
      }

      return { ok: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Blocker details submit failed: ${message}`);
      await this.slackService.postMessage({
        channelId: metadata.channelId,
        threadTs: metadata.threadTs,
        text: `❌ Failed to save blocker: ${message}`,
      });
      return { ok: false, error: message };
    }
  }

  private async linkBlockerJiraIssue(params: {
    slackUserId: string;
    submissionId: string;
    questionId: string;
    issueKey: string;
  }): Promise<void> {
    try {
      const pulseUserId = await this.jiraService.resolveUserIdFromSlack(
        params.slackUserId,
      );
      const actingUserId = await this.jiraService.resolveJiraActingUserId(
        params.slackUserId,
      );
      if (!pulseUserId || !actingUserId) {
        return;
      }

      const snapshot = await this.jiraIssuePickerService.resolveSelectedIssue(
        actingUserId,
        params.issueKey,
      );
      if (!snapshot) {
        return;
      }

      await this.answerJiraLinkService.linkIssueToQuestion({
        userId: pulseUserId,
        submissionId: params.submissionId,
        questionId: params.questionId,
        issue: snapshot,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Could not link Jira issue for blocker: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
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
    options?: SubmitAnswerOptions,
  ): Promise<QuestionPayloadDto | null> {
    return this.collectionService.submitAnswer(
      slackUserId,
      questionId,
      answer,
      submissionId,
      options,
    );
  }

  private async processTextAnswer(
    payload: IncomingMessageDto,
    currentQuestion: QuestionPayloadDto,
    context: DmThreadContext,
  ): Promise<void> {
    this.cancelJiraLinkFinalize(context.submissionId, currentQuestion.questionId);

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
        params.slackUserId,
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

    // Jira proposals are best-effort and must never fail standup completion.
    if (completed) {
      try {
        await this.jiraStandupHookService.afterSubmissionCompleted({
          submissionId: params.submissionId,
          slackUserId: params.slackUserId,
          channelId: params.channelId,
          threadTs: params.threadTs,
          onProposal: async (proposal) => {
            await this.jiraSlackListener.sendProposalMessage({
              channelId: params.channelId,
              threadTs: params.threadTs,
              actionId: proposal.actionId,
              actionType: proposal.actionType,
              issueKey: proposal.issueKey,
              summaryText: proposal.summaryText,
            });
          },
        });
      } catch (error: unknown) {
        this.logger.warn(
          `Jira post-completion hook failed for submission ${params.submissionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await this.slackService.postMessage({
          channelId: params.channelId,
          threadTs: params.threadTs,
          text: '⚠ Could not create Jira issue.\n\n*Reason:*\nUnexpected error while preparing the Jira action.',
        });
      }
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
    slackUserId?: string;
  }): Promise<{
    ok: boolean;
    ts?: string;
    error?: string;
    slackError?: string;
  }> {
    let question = params.question;
    let includeJiraLink = false;
    if (params.slackUserId) {
      question = (await this.jiraStandupHookService.prepareQuestionForDelivery({
        slackUserId: params.slackUserId,
        question: params.question,
      })) as QuestionPayloadDto;
      includeJiraLink =
        await this.jiraStandupHookService.shouldShowJiraLinkPicker(
          params.slackUserId,
        );
    } else {
      includeJiraLink = await this.jiraStandupHookService.isWorkspaceJiraConnected();
    }

    const message = buildDmQuestionMessage({
      question,
      submissionId: params.submissionId,
      checkInName: params.checkInName,
      isParent: params.isParent,
      includeJiraLink,
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
      posted = await this.slackService.postMessage({
        channelId: params.channelId,
        threadTs: params.threadTs,
        text: message.text,
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
    slackUserId?: string,
  ): Promise<void> {
    const posted = await this.postDmQuestionMessage({
      channelId,
      threadTs,
      submissionId,
      question,
      slackUserId,
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

  async scheduleJiraLinkStandupCompletion(params: {
    slackUserId: string;
    submissionId: string;
    questionId: string;
    channelId: string;
    threadTs: string;
  }): Promise<void> {
    const key = `${params.submissionId}:${params.questionId}`;
    const existingTimer = this.jiraLinkFinalizeTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.jiraLinkFinalizeTimers.delete(key);
      void this.finalizeJiraLinkedStandup(params);
    }, SlackGateway.JIRA_LINK_FINALIZE_DELAY_MS);

    this.jiraLinkFinalizeTimers.set(key, timer);

    this.logger.log(
      `[Pipeline] Scheduled Jira-link standup completion for submission ${params.submissionId} question ${params.questionId} in ${SlackGateway.JIRA_LINK_FINALIZE_DELAY_MS}ms`,
    );
  }

  private cancelJiraLinkFinalize(
    submissionId: string,
    questionId: string,
  ): void {
    const key = `${submissionId}:${questionId}`;
    const timer = this.jiraLinkFinalizeTimers.get(key);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.jiraLinkFinalizeTimers.delete(key);
  }

  private async finalizeJiraLinkedStandup(params: {
    slackUserId: string;
    submissionId: string;
    questionId: string;
    channelId: string;
    threadTs: string;
  }): Promise<void> {
    try {
      const existingAnswer =
        await this.collectionService.getAnswerForQuestion(
          params.submissionId,
          params.questionId,
        );
      if (existingAnswer) {
        this.logger.log(
          `[Pipeline] Skipping Jira-link auto-complete for submission ${params.submissionId} — text answer already saved`,
        );
        return;
      }

      const context =
        await this.collectionService.resolveActiveDmSubmissionContext(
          params.slackUserId,
          params.channelId,
          params.threadTs,
        );
      if (!context || context.submissionId !== params.submissionId) {
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
        return;
      }

      const links = await this.answerJiraLinkService.getLinksForQuestion(
        params.submissionId,
        params.questionId,
      );
      if (links.length === 0) {
        return;
      }

      const answerText = links
        .map((link) => `${link.issueKey}: ${link.summary}`)
        .join('\n');

      this.logger.log(
        `[Pipeline] Auto-completing standup from ${links.length} linked Jira issue(s) for submission ${params.submissionId}`,
      );

      await this.processTextAnswer(
        {
          userId: params.slackUserId,
          channelId: params.channelId,
          message: answerText,
          timestamp: String(Date.now()),
          threadTs: params.threadTs,
        },
        currentQuestion,
        context,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[Pipeline] Jira-link auto-complete failed for submission ${params.submissionId}: ${message}`,
      );
    }
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

