import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SlackService } from './slack.service';
import { AuthService } from '../auth/auth.service';
import { QuestionsService } from '../questions/questions.service';
import { 
  buildManageQuestionsModal, 
  buildAddQuestionModal, 
  buildEditQuestionModal 
} from './slack-questions.views';

@Injectable()
export class SlackQuestionsListener implements OnModuleInit {
  private readonly logger = new Logger(SlackQuestionsListener.name);

  constructor(
    private readonly slackService: SlackService,
    private readonly authService: AuthService,
    private readonly questionsService: QuestionsService
  ) {}

  onModuleInit() {
    this.logger.log('SlackQuestionsListener onModuleInit() is executing...');
    this.registerListeners();
  }

  private registerListeners() {
    this.logger.log('Registering Slack Questions listeners...');
    const app = this.slackService.getSlackApp();

    if (!app) {
      this.logger.error('Slack app is NOT initialized. Listeners CANNOT be registered.');
      return;
    }

    // --- SLASH COMMAND: /manage-questions ---
    app.command('/manage-questions', async ({ command, ack, client }) => {
      await ack();
      try {
        const userInfo = await client.users.info({ user: command.user_id });
        const teamId = userInfo.user?.team_id || command.team_id || 'unknown_team';
        await this.authService.syncSlackUser(command.user_id, teamId, command.team_domain || 'TeamPulse Workspace');

        if (!userInfo.user?.is_admin && !userInfo.user?.is_owner) {
          await client.chat.postEphemeral({
            channel: command.channel_id,
            user: command.user_id,
            text: 'You do not have permission to manage standup questions.'
          });
          return;
        }

        const questions = await this.questionsService.findAll();
        await client.views.open({
          trigger_id: command.trigger_id,
          view: buildManageQuestionsModal(questions) as any
        });
      } catch (error) {
        this.logger.error(`Error in /manage-questions: ${error}`);
      }
    });

    // --- ADD QUESTION BUTTON ---
    app.action('add_question', async ({ ack, body, client }) => {
      await ack();
      try {
        await client.views.push({
          trigger_id: (body as any).trigger_id,
          view: buildAddQuestionModal() as any
        });
      } catch (err) {
        this.logger.error(`Failed to push add question modal: ${err}`);
      }
    });

    // --- DYNAMIC ACTIONS ---
    app.action(/^(edit|delete|toggle|move_up|move_down)_question_(.*)$/, async ({ ack, body, client, action }) => {
      await ack();
      const actionId = (action as any).action_id;
      const questionId = (action as any).value;
      const viewId = (body as any).view.id;

      try {
        if (actionId.startsWith('edit_question_')) {
          const question = await this.questionsService.findOne(questionId);
          await client.views.push({
            trigger_id: (body as any).trigger_id,
            view: buildEditQuestionModal(question) as any
          });
          return;
        }

        if (actionId.startsWith('delete_question_')) {
          await this.questionsService.remove(questionId);
        } else if (actionId.startsWith('toggle_question_')) {
          await this.questionsService.toggleActive(questionId);
        } else if (actionId.startsWith('move_up_')) {
          await this.questionsService.swapOrder(questionId, 'up');
        } else if (actionId.startsWith('move_down_')) {
          await this.questionsService.swapOrder(questionId, 'down');
        }

        // Refresh view
        const questions = await this.questionsService.findAll();
        await client.views.update({
          view_id: viewId,
          view: buildManageQuestionsModal(questions) as any
        });

      } catch (err) {
        this.logger.error(`Failed to handle action ${actionId}: ${err}`);
      }
    });

    // --- VIEW SUBMISSIONS ---
    app.view('view_add_question_submit', async ({ ack, body, view, client }) => {
      try {
        const stateValues = view.state.values;
        const text = stateValues.question_text_block.question_text.value;
        const orderValue = stateValues.question_order_block.question_order.value;
        const order = parseInt(orderValue, 10);

        if (isNaN(order)) {
          await ack({
            response_action: 'errors',
            errors: { question_order_block: 'Order must be a number' }
          });
          return;
        }

        const selectedActive = stateValues.question_active_block?.question_active?.selected_options || [];
        const isActive = selectedActive.some((opt: any) => opt.value === 'true');

        await ack();

        await this.questionsService.create({ question: text, order, isActive });

        // Update root view
        const rootViewId = body.view.root_view_id;
        if (rootViewId) {
          const questions = await this.questionsService.findAll();
          await client.views.update({
            view_id: rootViewId,
            view: buildManageQuestionsModal(questions) as any
          });
        }
      } catch (err) {
        this.logger.error(`Failed to submit add question: ${err}`);
      }
    });

    app.view('view_edit_question_submit', async ({ ack, body, view, client }) => {
      try {
        const questionId = view.private_metadata;
        const stateValues = view.state.values;
        const text = stateValues.question_text_block.question_text.value;
        const orderValue = stateValues.question_order_block.question_order.value;
        const order = parseInt(orderValue, 10);

        if (isNaN(order)) {
          await ack({
            response_action: 'errors',
            errors: { question_order_block: 'Order must be a number' }
          });
          return;
        }

        const selectedActive = stateValues.question_active_block?.question_active?.selected_options || [];
        const isActive = selectedActive.some((opt: any) => opt.value === 'true');

        await ack();

        await this.questionsService.update(questionId, { question: text, order, isActive });

        // Update root view
        const rootViewId = body.view.root_view_id;
        if (rootViewId) {
          const questions = await this.questionsService.findAll();
          await client.views.update({
            view_id: rootViewId,
            view: buildManageQuestionsModal(questions) as any
          });
        }
      } catch (err) {
        this.logger.error(`Failed to submit edit question: ${err}`);
      }
    });

    this.logger.log('Slack Questions listeners registered.');
  }
}
