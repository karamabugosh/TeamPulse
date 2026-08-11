import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { CheckInThreadService } from './check-in-thread.service';

import { SlackGateway } from './slack.gateway';

import { SlackService } from './slack.service';

import {

  buildAdditionalUpdateModal,

  CHECKIN_ANSWER_ACTION,

  CHECKIN_ANSWER_SELECT_ACTION,

  parseCheckinAnswerActionId,

  parseCheckinAnswerSelectActionId,

} from './slack-checkin.views';



@Injectable()

export class SlackCheckInListener implements OnModuleInit {

  private readonly logger = new Logger(SlackCheckInListener.name);



  constructor(

    private readonly slackService: SlackService,

    private readonly threadService: CheckInThreadService,

    private readonly slackGateway: SlackGateway,

  ) {}



  onModuleInit(): void {

    this.registerListeners();

  }



  private registerListeners(): void {

    const app = this.slackService.getSlackApp();

    if (!app) {

      this.logger.warn('Slack app not initialized — CheckIn thread listeners skipped.');

      return;

    }



    app.action(new RegExp(`^${CHECKIN_ANSWER_ACTION}:`), async ({ action, ack, body }) => {

      await ack();



      const actionId = (action as { action_id?: string }).action_id;

      const value = (action as { value?: string }).value;

      const parsed = actionId ? parseCheckinAnswerActionId(actionId) : null;

      const slackUserId = (body as { user?: { id?: string } }).user?.id;

      const channelId = (body as { channel?: { id?: string } }).channel?.id;

      const message = (body as { message?: { ts?: string; thread_ts?: string } }).message;

      const threadTs = message?.thread_ts ?? message?.ts;



      if (!parsed || !value?.trim() || !slackUserId || !channelId || !threadTs) {

        this.logger.warn('Ignoring malformed check-in answer button action.');

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

    });



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

        const message = (body as { message?: { ts?: string; thread_ts?: string } }).message;

        const threadTs = message?.thread_ts ?? message?.ts;

        const value = selectedOption?.value;



        if (!parsed || !value?.trim() || !slackUserId || !channelId || !threadTs) {

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



    app.action(/^checkin_additional_update:/, async ({ action, ack, body, client }) => {

      await ack();

      const actionId = (action as { action_id?: string }).action_id;

      const runId = actionId?.split(':')[1];

      const slackUserId = (body as { user?: { id?: string } }).user?.id;



      if (!runId || !slackUserId) return;



      try {

        await client.views.open({

          trigger_id: (body as { trigger_id?: string }).trigger_id,

          view: buildAdditionalUpdateModal(runId) as never,

        });

      } catch (error: unknown) {

        const message = error instanceof Error ? error.message : String(error);

        this.logger.error(`Failed to open additional update modal: ${message}`);

      }

    });



    app.view(/^checkin_additional_update_submit:/, async ({ ack, view, body }) => {

      await ack();



      const callbackId = view.callback_id;

      const runId = callbackId.split(':')[1];

      const slackUserId = (body as { user?: { id?: string } }).user?.id;

      const text =

        view.state.values.additional_update_block?.additional_update_text?.value || '';



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

      }

    });



    this.logger.log('CheckIn thread Slack listeners registered.');

  }

}

