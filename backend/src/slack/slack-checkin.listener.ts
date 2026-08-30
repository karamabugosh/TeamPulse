import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { CheckInThreadService } from './check-in-thread.service';
import { SlackGateway } from './slack.gateway';
import { SlackService } from './slack.service';
import {
  buildAdditionalUpdateModal,
  CHECKIN_ANSWER_ACTION,
  CHECKIN_ANSWER_SELECT_ACTION,
  CHECKIN_BLOCKER_MODAL_CALLBACK,
  parseCheckinAnswerActionId,
  parseCheckinAnswerSelectActionId,
} from './slack-checkin.views';
import {
  BLOCKER_FOLLOWUP_BLOCKED,
  BLOCKER_FOLLOWUP_BLOCKED_MODAL,
  BLOCKER_FOLLOWUP_RESOLVED,
  BLOCKER_FOLLOWUP_RESOLVED_MODAL,
  BLOCKER_FOLLOWUP_WORKING,
  BLOCKER_FOLLOWUP_WORKING_MODAL,
  parseFollowUpModalMetadata,
} from './blocker-follow-up.views';

@Injectable()
export class SlackCheckInListener implements OnApplicationBootstrap {
  private readonly logger = new Logger(SlackCheckInListener.name);

  constructor(
    private readonly slackService: SlackService,
    private readonly threadService: CheckInThreadService,
    private readonly slackGateway: SlackGateway,
  ) {}

  onApplicationBootstrap(): void {
    this.registerListeners();
  }

  private registerListeners(): void {
    const app = this.slackService.getSlackApp();
    if (!app) {
      this.logger.warn(
        'Slack app not initialized — CheckIn thread listeners skipped.',
      );
      return;
    }

    app.action(
      new RegExp(`^${CHECKIN_ANSWER_ACTION}:`),
      async ({ action, ack, body, client }) => {
        await ack();

        const actionId = (action as { action_id?: string }).action_id;
        const value = (action as { value?: string }).value;
        const parsed = actionId ? parseCheckinAnswerActionId(actionId) : null;
        const slackUserId = (body as { user?: { id?: string } }).user?.id;
        const channelId = (body as { channel?: { id?: string } }).channel?.id;
        const message = (
          body as { message?: { ts?: string; thread_ts?: string } }
        ).message;
        const threadTs = message?.thread_ts ?? message?.ts;
        const triggerId = (body as { trigger_id?: string }).trigger_id;

        if (
          !parsed ||
          !value?.trim() ||
          !slackUserId ||
          !channelId ||
          !threadTs
        ) {
          this.logger.warn('Ignoring malformed check-in answer button action.');
          return;
        }

        const openedModal = await this.slackGateway.tryOpenBlockerDetailsModal({
          slackUserId,
          submissionId: parsed.submissionId,
          questionId: parsed.questionId,
          answer: value,
          channelId,
          threadTs,
          triggerId,
          client,
        });

        if (openedModal) {
          return;
        }

        await this.slackGateway.handleInteractiveAnswer({
          slackUserId,
          submissionId: parsed.submissionId,
          questionId: parsed.questionId,
          answer: value,
          channelId,
          threadTs,
        });
      },
    );

    app.action(
      new RegExp(`^${CHECKIN_ANSWER_SELECT_ACTION}:`),
      async ({ action, ack, body }) => {
        await ack();

        const actionId = (action as { action_id?: string }).action_id;
        const selectedOption = (
          action as { selected_option?: { value?: string } }
        ).selected_option;
        const parsed = actionId
          ? parseCheckinAnswerSelectActionId(actionId)
          : null;
        const slackUserId = (body as { user?: { id?: string } }).user?.id;
        const channelId = (body as { channel?: { id?: string } }).channel?.id;
        const message = (
          body as { message?: { ts?: string; thread_ts?: string } }
        ).message;
        const threadTs = message?.thread_ts ?? message?.ts;
        const value = selectedOption?.value;

        if (
          !parsed ||
          !value?.trim() ||
          !slackUserId ||
          !channelId ||
          !threadTs
        ) {
          this.logger.warn('Ignoring malformed check-in answer select action.');
          return;
        }

        await this.slackGateway.handleInteractiveAnswer({
          slackUserId,
          submissionId: parsed.submissionId,
          questionId: parsed.questionId,
          answer: value,
          channelId,
          threadTs,
        });
      },
    );

    app.view(
      new RegExp(`^${CHECKIN_BLOCKER_MODAL_CALLBACK}:`),
      async ({ ack, view, body }) => {
        const values = view.state.values as Record<
          string,
          Record<
            string,
            {
              value?: string;
              selected_option?: { value?: string };
              selected_date?: string;
              selected_user?: string;
            }
          >
        >;

        const title = values.blocker_title_block?.blocker_title?.value?.trim() ?? '';
        const description =
          values.blocker_description_block?.blocker_description?.value?.trim() ??
          '';
        const category =
          values.blocker_category_block?.blocker_category?.selected_option
            ?.value ?? '';
        const categoryOther =
          values.blocker_category_other_block?.blocker_category_other?.value?.trim() ??
          '';
        const severity =
          values.blocker_severity_block?.blocker_severity?.selected_option
            ?.value ?? '';

        const errors: Record<string, string> = {};
        if (!title) {
          errors.blocker_title_block = 'Blocker title is required.';
        }
        if (!description) {
          errors.blocker_description_block = 'Description is required.';
        }
        if (!severity) {
          errors.blocker_severity_block = 'Severity is required.';
        }
        if (!category) {
          errors.blocker_category_block = 'Category is required.';
        }
        if (category === 'Other' && !categoryOther) {
          errors.blocker_category_other_block =
            'Please specify a category when Other is selected.';
        }

        if (Object.keys(errors).length > 0) {
          await ack({
            response_action: 'errors',
            errors,
          });
          return;
        }

        // Close the modal immediately, then continue the standup flow.
        await ack();

        const slackUserId = (body as { user?: { id?: string } }).user?.id;
        if (!slackUserId) {
          this.logger.warn('Blocker modal submit missing Slack user id.');
          return;
        }

        try {
          const result = await this.slackGateway.handleBlockerDetailsSubmit({
            slackUserId,
            privateMetadata: view.private_metadata,
            values,
          });

          if (!result.ok) {
            this.logger.warn(
              `Blocker details submit did not complete: ${result.error ?? 'unknown'}`,
            );
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.error(`Blocker modal submit handler crashed: ${message}`);
        }
      },
    );

    app.action(/^checkin_additional_update:/, async ({ action, ack, body, client }) => {
      await ack();
      const actionId = (action as { action_id?: string }).action_id;
      const runId = actionId?.split(':')[1];
      const slackUserId = (body as { user?: { id?: string } }).user?.id;

      if (!runId || !slackUserId) return;

      try {
        await client.views.open({
          trigger_id: (body as { trigger_id?: string }).trigger_id!,
          view: buildAdditionalUpdateModal(runId) as never,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to open additional update modal: ${message}`);
      }
    });

    const followUpActionPattern = new RegExp(
      `^(${BLOCKER_FOLLOWUP_RESOLVED}|${BLOCKER_FOLLOWUP_WORKING}|${BLOCKER_FOLLOWUP_BLOCKED}):`,
    );

    app.action(followUpActionPattern, async ({ action, ack, body, client }) => {
      await ack();
      const actionId = (action as { action_id?: string }).action_id;
      const slackUserId = (body as { user?: { id?: string } }).user?.id;
      const channelId = (body as { channel?: { id?: string } }).channel?.id;
      const message = (
        body as { message?: { ts?: string; thread_ts?: string } }
      ).message;
      const threadTs = message?.thread_ts ?? message?.ts;
      const triggerId = (body as { trigger_id?: string }).trigger_id;

      if (!actionId || !slackUserId || !channelId || !threadTs || !triggerId) {
        this.logger.warn('Ignoring malformed blocker follow-up action.');
        return;
      }

      try {
        await this.slackGateway.openBlockerFollowUpModal({
          actionId,
          triggerId,
          channelId,
          threadTs,
          client: client as never,
        });
      } catch (error: unknown) {
        const messageText =
          error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to open blocker follow-up modal: ${messageText}`);
      }
    });

    const followUpViewPattern = new RegExp(
      `^(${BLOCKER_FOLLOWUP_RESOLVED_MODAL}|${BLOCKER_FOLLOWUP_WORKING_MODAL}|${BLOCKER_FOLLOWUP_BLOCKED_MODAL})$`,
    );

    app.view(followUpViewPattern, async ({ ack, view, body }) => {
      const metadata = parseFollowUpModalMetadata(view.private_metadata);
      const values = view.state.values as Record<
        string,
        Record<string, { value?: string; selected_option?: { value?: string } }>
      >;

      let notes = '';
      let resolutionType: string | null = null;
      let needsHelp: boolean | null = null;
      let needsEscalation: boolean | null = null;

      if (view.callback_id === BLOCKER_FOLLOWUP_RESOLVED_MODAL) {
        notes =
          values.resolution_notes_block?.resolution_notes?.value?.trim() ?? '';
        resolutionType =
          values.resolution_type_block?.resolution_type?.selected_option
            ?.value ?? null;
        if (!notes) {
          await ack({
            response_action: 'errors',
            errors: {
              resolution_notes_block: 'Resolution notes are required.',
            },
          });
          return;
        }
      } else if (view.callback_id === BLOCKER_FOLLOWUP_WORKING_MODAL) {
        notes =
          values.progress_notes_block?.progress_notes?.value?.trim() ?? '';
        if (!notes) {
          await ack({
            response_action: 'errors',
            errors: {
              progress_notes_block: 'Progress update is required.',
            },
          });
          return;
        }
      } else {
        notes = values.blocked_notes_block?.blocked_notes?.value?.trim() ?? '';
        needsHelp =
          values.needs_help_block?.needs_help?.selected_option?.value === 'Yes';
        needsEscalation =
          values.needs_escalation_block?.needs_escalation?.selected_option
            ?.value === 'Yes';
        if (!notes) {
          await ack({
            response_action: 'errors',
            errors: {
              blocked_notes_block: 'Please describe what is still blocking you.',
            },
          });
          return;
        }
      }

      await ack();

      const slackUserId = (body as { user?: { id?: string } }).user?.id;
      if (!slackUserId || !metadata) {
        this.logger.warn('Blocker follow-up submit missing metadata or user.');
        return;
      }

      try {
        const result = await this.slackGateway.handleBlockerFollowUpSubmit({
          slackUserId,
          metadata,
          notes,
          resolutionType,
          needsHelp,
          needsEscalation,
        });
        if (!result.ok) {
          this.logger.warn(
            `Blocker follow-up submit failed: ${result.error ?? 'unknown'}`,
          );
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);
        this.logger.error(`Blocker follow-up submit crashed: ${message}`);
      }
    });

    app.view(/^checkin_additional_update_submit:/, async ({ ack, view, body }) => {
      await ack();

      const callbackId = view.callback_id;
      const runId = callbackId.split(':')[1];
      const slackUserId = (body as { user?: { id?: string } }).user?.id;
      const text =
        view.state.values.additional_update_block?.additional_update_text
          ?.value || '';

      if (!runId || !slackUserId || !text.trim()) return;

      const posted = await this.threadService.postAdditionalUpdate({
        runId,
        slackUserId,
        text: text.trim(),
      });

      if (!posted) {
        this.logger.error(
          `Additional update failed for user ${slackUserId} on run ${runId}`,
        );
        return;
      }

      await this.threadService.postAdditionalUpdateButtonForUser({
        runId,
        slackUserId,
      });
    });

    this.logger.log('CheckIn thread Slack listeners registered.');
  }
}
