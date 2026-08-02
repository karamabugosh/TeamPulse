export function buildManageQuestionsModal(questions: any[]) {
  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Manage Standup Questions',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '➕ Add New Question',
          },
          style: 'primary',
          action_id: 'add_question',
        },
      ],
    },
    {
      type: 'divider',
    },
  ];

  if (questions.length === 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '_No questions found. Add one above!_',
      },
    });
  }

  questions.forEach((q, index) => {
    const isFirst = index === 0;
    const isLast = index === questions.length - 1;

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Order:* ${q.order}\n*Question:* ${q.question}\n*Status:* ${q.isActive ? '✅ Active' : '❌ Disabled'}`,
      },
    });

    const actionElements: any[] = [
      {
        type: 'button',
        text: { type: 'plain_text', text: '✏️ Edit' },
        action_id: `edit_question_${q.id}`,
        value: q.id,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: q.isActive ? '⏸️ Disable' : '▶️ Enable' },
        action_id: `toggle_question_${q.id}`,
        value: q.id,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '🗑️ Delete' },
        style: 'danger',
        action_id: `delete_question_${q.id}`,
        value: q.id,
        confirm: {
          title: { type: 'plain_text', text: 'Confirm Delete' },
          text: { type: 'mrkdwn', text: `Are you sure you want to delete the question:\n_"${q.question}"_?` },
          confirm: { type: 'plain_text', text: 'Delete' },
          deny: { type: 'plain_text', text: 'Cancel' },
        },
      },
    ];

    if (!isFirst) {
      actionElements.push({
        type: 'button',
        text: { type: 'plain_text', text: '⬆️ Move Up' },
        action_id: `move_up_${q.id}`,
        value: q.id,
      });
    }

    if (!isLast) {
      actionElements.push({
        type: 'button',
        text: { type: 'plain_text', text: '⬇️ Move Down' },
        action_id: `move_down_${q.id}`,
        value: q.id,
      });
    }

    blocks.push({
      type: 'actions',
      elements: actionElements,
    });

    blocks.push({ type: 'divider' });
  });

  return {
    type: 'modal',
    callback_id: 'manage_questions_modal_main',
    title: {
      type: 'plain_text',
      text: 'Standup Questions',
    },
    close: {
      type: 'plain_text',
      text: 'Close',
    },
    blocks,
  };
}

export function buildAddQuestionModal() {
  return {
    type: 'modal',
    callback_id: 'view_add_question_submit',
    title: {
      type: 'plain_text',
      text: 'Add Question',
    },
    submit: {
      type: 'plain_text',
      text: 'Save',
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
    },
    blocks: [
      {
        type: 'input',
        block_id: 'question_text_block',
        element: {
          type: 'plain_text_input',
          action_id: 'question_text',
          multiline: true,
        },
        label: {
          type: 'plain_text',
          text: 'Question Text',
        },
      },
      {
        type: 'input',
        block_id: 'question_order_block',
        element: {
          type: 'plain_text_input',
          action_id: 'question_order',
          initial_value: '10',
        },
        label: {
          type: 'plain_text',
          text: 'Order (Number)',
        },
      },
      {
        type: 'input',
        block_id: 'question_active_block',
        optional: true,
        element: {
          type: 'checkboxes',
          action_id: 'question_active',
          options: [
            {
              text: { type: 'plain_text', text: 'Active' },
              value: 'true',
            },
          ],
          initial_options: [
            {
              text: { type: 'plain_text', text: 'Active' },
              value: 'true',
            },
          ],
        },
        label: {
          type: 'plain_text',
          text: 'Status',
        },
      },
    ],
  };
}

export function buildEditQuestionModal(question: any) {
  return {
    type: 'modal',
    callback_id: 'view_edit_question_submit',
    private_metadata: question.id,
    title: {
      type: 'plain_text',
      text: 'Edit Question',
    },
    submit: {
      type: 'plain_text',
      text: 'Save',
    },
    close: {
      type: 'plain_text',
      text: 'Cancel',
    },
    blocks: [
      {
        type: 'input',
        block_id: 'question_text_block',
        element: {
          type: 'plain_text_input',
          action_id: 'question_text',
          multiline: true,
          initial_value: question.question,
        },
        label: {
          type: 'plain_text',
          text: 'Question Text',
        },
      },
      {
        type: 'input',
        block_id: 'question_order_block',
        element: {
          type: 'plain_text_input',
          action_id: 'question_order',
          initial_value: String(question.order),
        },
        label: {
          type: 'plain_text',
          text: 'Order (Number)',
        },
      },
      {
        type: 'input',
        block_id: 'question_active_block',
        optional: true,
        element: {
          type: 'checkboxes',
          action_id: 'question_active',
          options: [
            {
              text: { type: 'plain_text', text: 'Active' },
              value: 'true',
            },
          ],
          initial_options: question.isActive
            ? [
                {
                  text: { type: 'plain_text', text: 'Active' },
                  value: 'true',
                },
              ]
            : [],
        },
        label: {
          type: 'plain_text',
          text: 'Status',
        },
      },
    ],
  };
}
