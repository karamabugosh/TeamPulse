import { Inject, Injectable, Logger, OnApplicationBootstrap, forwardRef } from '@nestjs/common';
import { AnswerJiraLinkService } from '../jira/answer-jira-link.service';
import { JiraActionService } from '../jira/jira-action.service';
import { JiraIssuePickerService } from '../jira/jira-issue-picker.service';
import { JiraService } from '../jira/jira.service';
import { SlackGateway } from './slack.gateway';
import { SlackService } from './slack.service';
import {
  CHECKIN_ISSUE_REF_ACTION,
  CHECKIN_JIRA_REFRESH_ACTION,
  CHECKIN_LINK_JIRA_ACTION,
  JIRA_ACTION_APPROVE,
  JIRA_ACTION_CANCEL,
  JIRA_ACTION_DISMISS,
  JIRA_ACTION_RETRY,
  buildJiraActionProposalBlocks,
  buildJiraActionResultBlocks,
  buildJiraLinkConfirmationBlocks,
  parseCheckinIssueRefActionId,
  parseCheckinJiraRefreshActionId,
  parseCheckinLinkJiraActionId,
  parseJiraActionId,
} from './slack-checkin.views';

@Injectable()
export class JiraSlackListener implements OnApplicationBootstrap {
  private readonly logger = new Logger(JiraSlackListener.name);

  constructor(
    private readonly slackService: SlackService,
    @Inject(forwardRef(() => SlackGateway))
    private readonly slackGateway: SlackGateway,
    private readonly jiraService: JiraService,
    private readonly jiraIssuePickerService: JiraIssuePickerService,
    private readonly jiraActionService: JiraActionService,
    private readonly answerJiraLinkService: AnswerJiraLinkService,
  ) {}

  onApplicationBootstrap(): void {
    this.registerListeners();
  }

  private registerListeners(): void {
    const app = this.slackService.getSlackApp();
    if (!app) {
      this.logger.warn('Slack app not initialized — Jira Slack listeners skipped.');
      return;
    }

    app.options(new RegExp(`^${CHECKIN_ISSUE_REF_ACTION}:`), async (payload) => {
      await this.handleIssuePickerOptions(payload, CHECKIN_ISSUE_REF_ACTION);
    });

    app.options(new RegExp(`^${CHECKIN_LINK_JIRA_ACTION}:`), async (payload) => {
      await this.handleIssuePickerOptions(payload, CHECKIN_LINK_JIRA_ACTION);
    });

    app.action(new RegExp(`^${CHECKIN_JIRA_REFRESH_ACTION}:`), async ({ action, ack, body }) => {
      await ack();
      const actionId = (action as { action_id?: string }).action_id;
      const parsed = actionId ? parseCheckinJiraRefreshActionId(actionId) : null;
      const slackUserId = (body as { user?: { id?: string } }).user?.id;
      const channelId = (body as { channel?: { id?: string } }).channel?.id;
      const message = (body as { message?: { ts?: string; thread_ts?: string } }).message;
      const threadTs = message?.thread_ts ?? message?.ts;

      if (!parsed || !slackUserId || !channelId || !threadTs) {
        return;
      }

      const userId = await this.jiraService.resolveJiraActingUserId(slackUserId);
      if (!userId) {
        return;
      }

      this.jiraIssuePickerService.invalidate(userId);
      const refreshed = await this.jiraIssuePickerService.getPickerIssues(userId, {
        forceRefresh: true,
        limit: 50,
      });

      await this.slackService.postMessage({
        channelId,
        threadTs,
        text: refreshed.error
          ? '⚠ Unable to load Jira issues. Open the dropdown and try again, or tap Refresh.'
          : `🔄 Jira issues refreshed (${refreshed.issues.length}). Open the dropdown to see the latest list.`,
      });
    });

    app.action(new RegExp(`^${CHECKIN_LINK_JIRA_ACTION}:`), async ({ action, ack, body }) => {
      await ack();
      const actionId = (action as { action_id?: string }).action_id;
      const selected = (action as { selected_option?: { value?: string } })
        .selected_option?.value;
      const parsed = actionId ? parseCheckinLinkJiraActionId(actionId) : null;
      const slackUserId = (body as { user?: { id?: string } }).user?.id;
      const channelId = (body as { channel?: { id?: string } }).channel?.id;
      const message = (body as { message?: { ts?: string; thread_ts?: string } }).message;
      const threadTs = message?.thread_ts ?? message?.ts;

      if (!parsed || !selected || !slackUserId || !channelId || !threadTs) {
        return;
      }

      if (selected === '__jira_error__' || selected === '__jira_empty__') {
        return;
      }

      const actingUserId =
        await this.jiraService.resolveJiraActingUserId(slackUserId);
      const pulseUserId =
        await this.jiraService.resolveUserIdFromSlack(slackUserId);
      if (!actingUserId || !pulseUserId) {
        return;
      }

      const snapshot = await this.jiraIssuePickerService.resolveSelectedIssue(
        actingUserId,
        selected,
      );
      if (!snapshot) {
        this.logger.warn(
          `[JiraPicker] could not resolve selected issue value="${selected}" for userId=${actingUserId}`,
        );
        await this.slackService.postMessage({
          channelId,
          threadTs,
          text: '⚠ Unable to load Jira issues. Tap Refresh and try again.',
        });
        return;
      }

      const saved = await this.answerJiraLinkService.linkIssueToQuestion({
        userId: pulseUserId,
        submissionId: parsed.submissionId,
        questionId: parsed.questionId,
        issue: snapshot,
      });

      await this.slackService.postMessage({
        channelId,
        threadTs,
        text: `Linked ${saved.issueKey}`,
        blocks: buildJiraLinkConfirmationBlocks([saved]),
      });

      await this.slackGateway.scheduleJiraLinkStandupCompletion({
        slackUserId,
        submissionId: parsed.submissionId,
        questionId: parsed.questionId,
        channelId,
        threadTs,
      });
    });

    app.action(new RegExp(`^${CHECKIN_ISSUE_REF_ACTION}:`), async ({ action, ack, body }) => {
      await ack();
      const actionId = (action as { action_id?: string }).action_id;
      const selected = (action as { selected_option?: { value?: string } }).selected_option?.value;
      const parsed = actionId ? parseCheckinIssueRefActionId(actionId) : null;
      const slackUserId = (body as { user?: { id?: string } }).user?.id;
      const channelId = (body as { channel?: { id?: string } }).channel?.id;
      const message = (body as { message?: { ts?: string; thread_ts?: string } }).message;
      const threadTs = message?.thread_ts ?? message?.ts;

      if (!parsed || !selected || !slackUserId || !channelId || !threadTs) {
        return;
      }

      await this.slackGateway.handleInteractiveAnswer({
        submissionId: parsed.submissionId,
        questionId: parsed.questionId,
        slackUserId,
        channelId,
        threadTs,
        answer: selected,
      });
    });

    app.action(new RegExp(`^${JIRA_ACTION_APPROVE}:`), async ({ action, ack, body, client }) => {
      await ack();
      const actionId = (action as { action_id?: string }).action_id;
      const parsed = actionId ? parseJiraActionId(actionId, JIRA_ACTION_APPROVE) : null;
      const slackUserId = (body as { user?: { id?: string } }).user?.id;
      const channelId = (body as { channel?: { id?: string } }).channel?.id;
      const messageTs = (body as { message?: { ts?: string } }).message?.ts;
      const interactionTs = (body as { trigger_id?: string }).trigger_id;

      if (!parsed || !slackUserId || !channelId || !messageTs) {
        return;
      }

      const userId = await this.jiraService.resolveUserIdFromSlack(slackUserId);
      if (!userId) {
        return;
      }

      const executed = await this.jiraActionService.approveAction({
        actionId: parsed.actionId,
        userId,
        slackInteractionTs: interactionTs,
      });

      const blocks = buildJiraActionResultBlocks(executed);
      const text =
        executed.status === 'executed'
          ? executed.actionType === 'create_issue'
            ? '✅ Jira issue created successfully'
            : '✅ Jira updated successfully'
          : '⚠ Could not create Jira issue.';

      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text,
          blocks: blocks as never,
        });
      } catch {
        await this.slackService.postMessage({
          channelId,
          threadTs: messageTs,
          text,
          blocks,
        });
      }
    });

    app.action(new RegExp(`^${JIRA_ACTION_RETRY}:`), async ({ action, ack, body, client }) => {
      await ack();
      const actionId = (action as { action_id?: string }).action_id;
      const parsed = actionId ? parseJiraActionId(actionId, JIRA_ACTION_RETRY) : null;
      const slackUserId = (body as { user?: { id?: string } }).user?.id;
      const channelId = (body as { channel?: { id?: string } }).channel?.id;
      const messageTs = (body as { message?: { ts?: string } }).message?.ts;
      const interactionTs = (body as { trigger_id?: string }).trigger_id;

      if (!parsed || !slackUserId || !channelId || !messageTs) {
        return;
      }

      const userId = await this.jiraService.resolveUserIdFromSlack(slackUserId);
      if (!userId) {
        return;
      }

      const executed = await this.jiraActionService.retryAction({
        actionId: parsed.actionId,
        userId,
        slackInteractionTs: interactionTs,
      });

      const blocks = buildJiraActionResultBlocks(executed);
      const text =
        executed.status === 'executed'
          ? executed.actionType === 'create_issue'
            ? '✅ Jira issue created successfully'
            : '✅ Jira updated successfully'
          : '⚠ Could not create Jira issue.';

      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text,
          blocks: blocks as never,
        });
      } catch {
        await this.slackService.postMessage({
          channelId,
          threadTs: messageTs,
          text,
          blocks,
        });
      }
    });

    app.action(new RegExp(`^${JIRA_ACTION_CANCEL}:`), async ({ action, ack, body, client }) => {
      await ack();
      const actionId = (action as { action_id?: string }).action_id;
      const parsed = actionId ? parseJiraActionId(actionId, JIRA_ACTION_CANCEL) : null;
      const slackUserId = (body as { user?: { id?: string } }).user?.id;
      const channelId = (body as { channel?: { id?: string } }).channel?.id;
      const messageTs = (body as { message?: { ts?: string } }).message?.ts;

      if (!parsed || !slackUserId) {
        return;
      }

      const userId = await this.jiraService.resolveUserIdFromSlack(slackUserId);
      if (!userId) {
        return;
      }

      const cancelled = await this.jiraActionService.cancelAction({
        actionId: parsed.actionId,
        userId,
      });

      if (channelId && messageTs) {
        const blocks = buildJiraActionResultBlocks(cancelled);
        try {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: 'Jira action dismissed',
            blocks: blocks as never,
          });
        } catch {
          // ignore update failures on cancel
        }
      }
    });

    app.action(new RegExp(`^${JIRA_ACTION_DISMISS}:`), async ({ action, ack, body, client }) => {
      await ack();
      const actionId = (action as { action_id?: string }).action_id;
      const parsed = actionId ? parseJiraActionId(actionId, JIRA_ACTION_DISMISS) : null;
      const slackUserId = (body as { user?: { id?: string } }).user?.id;
      const channelId = (body as { channel?: { id?: string } }).channel?.id;
      const messageTs = (body as { message?: { ts?: string } }).message?.ts;

      if (!parsed || !slackUserId) {
        return;
      }

      const userId = await this.jiraService.resolveUserIdFromSlack(slackUserId);
      if (!userId) {
        return;
      }

      const cancelled = await this.jiraActionService.cancelAction({
        actionId: parsed.actionId,
        userId,
      });

      if (channelId && messageTs) {
        const blocks = buildJiraActionResultBlocks(cancelled);
        try {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: 'Jira action dismissed',
            blocks: blocks as never,
          });
        } catch {
          // ignore update failures on dismiss
        }
      }
    });
  }

  private async handleIssuePickerOptions(
    payload: {
      options: unknown;
      ack: (response: unknown) => Promise<void>;
      body: unknown;
    },
    actionPrefix: string,
  ): Promise<void> {
    const { options, ack, body } = payload;
    const action = (body as { action_id?: string }).action_id;
    const slackUserId = (body as { user?: { id?: string } }).user?.id;
    const value = (options as { value?: string }).value ?? '';

    this.logger.log(
      `[JiraPicker] options request actionPrefix=${actionPrefix} action=${action ?? '—'} slackUserId=${slackUserId ?? '—'} query="${value}"`,
    );

    if (!action || !action.startsWith(`${actionPrefix}:`) || !slackUserId) {
      this.logger.warn('[JiraPicker] invalid options payload — returning empty');
      await ack({ options: [] });
      return;
    }

    try {
      const userId = await this.jiraService.resolveJiraActingUserId(slackUserId);
      if (!userId) {
        this.logger.warn(
          `[JiraPicker] no Jira acting user for slackUserId=${slackUserId}`,
        );
        await ack({
          options: [
            {
              text: {
                type: 'plain_text' as const,
                text: 'Unable to load Jira issues.',
              },
              value: '__jira_error__',
            },
          ],
        });
        return;
      }

      await this.jiraService.logOAuthDiagnostics(userId);
      const result = await this.jiraIssuePickerService.getPickerIssues(userId, {
        query: value,
        limit: 20,
      });

      if (result.error) {
        await ack({
          options: [
            {
              text: {
                type: 'plain_text' as const,
                text: 'Unable to load Jira issues.',
              },
              description: {
                type: 'plain_text' as const,
                text: 'Tap Refresh and try again.',
              },
              value: '__jira_error__',
            },
          ],
        });
        return;
      }

      if (result.issues.length === 0) {
        await ack({
          options: [
            {
              text: {
                type: 'plain_text' as const,
                text: 'No Jira issues found.',
              },
              value: '__jira_empty__',
            },
          ],
        });
        return;
      }

      const slackOptions = result.issues.slice(0, 20).map((issue) => ({
        text: {
          type: 'plain_text' as const,
          text: this.jiraIssuePickerService.formatSlackOptionText(issue),
        },
        description: {
          type: 'plain_text' as const,
          text: this.jiraIssuePickerService.formatSlackOptionDescription(issue),
        },
        value: issue.issueKey.slice(0, 75),
      }));

      this.logger.log(
        `[JiraPicker] returning ${slackOptions.length} live option(s) for actingUserId=${userId} fromCache=${result.fromCache}`,
      );

      await ack({ options: slackOptions });
    } catch (error: unknown) {
      this.logger.warn(
        `Jira picker options failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      await ack({
        options: [
          {
            text: {
              type: 'plain_text' as const,
              text: 'Unable to load Jira issues.',
            },
            value: '__jira_error__',
          },
        ],
      });
    }
  }

  async sendProposalMessage(params: {
    channelId: string;
    threadTs?: string;
    actionId: string;
    actionType: string;
    issueKey?: string | null;
    summaryText: string;
  }) {
    await this.slackService.postMessage({
      channelId: params.channelId,
      threadTs: params.threadTs,
      text: 'Pulse proposed a Jira action',
      blocks: buildJiraActionProposalBlocks(params),
    });
  }
}
