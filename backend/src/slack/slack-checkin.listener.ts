import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CheckInThreadService } from './check-in-thread.service';
import { SlackService } from './slack.service';
import { buildAdditionalUpdateModal } from './slack-checkin.views';

@Injectable()
export class SlackCheckInListener implements OnModuleInit {
  private readonly logger = new Logger(SlackCheckInListener.name);

  constructor(
    private readonly slackService: SlackService,
    private readonly threadService: CheckInThreadService,
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

    app.action(/^checkin_additional_update:/, async ({ action, ack, body, client }) => {
      await ack();
      const actionId = (action as any).action_id as string;
      const runId = actionId.split(':')[1];
      const slackUserId = (body as any).user?.id;

      if (!runId || !slackUserId) return;

      try {
        await client.views.open({
          trigger_id: (body as any).trigger_id,
          view: buildAdditionalUpdateModal(runId) as any,
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
      const slackUserId = (body as any).user?.id;
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
