"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAppHomeBlocks = buildAppHomeBlocks;
function formatStatus(summary) {
    switch (summary.status) {
        case 'in_progress':
            return 'In progress — finish your standup in the app DM.';
        case 'completed':
            return 'Completed for this session.';
        default:
            return 'Not started yet.';
    }
}
function formatLastCompleted(completedAt) {
    if (!completedAt) {
        return 'No completed standup on record yet.';
    }
    return completedAt.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
}
function buildAppHomeBlocks(summary) {
    return [
        {
            type: 'header',
            text: { type: 'plain_text', text: 'Pulse Daily Standup', emoji: true },
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: 'Welcome! Answer a short set of questions so your team stays in sync.',
            },
        },
        {
            type: 'section',
            fields: [
                {
                    type: 'mrkdwn',
                    text: `*Today's status*\n${formatStatus(summary)}`,
                },
                {
                    type: 'mrkdwn',
                    text: `*Active questions*\n${summary.activeQuestionCount}`,
                },
            ],
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*Last completion*\n${formatLastCompleted(summary.lastCompletedAt)}`,
            },
        },
        { type: 'divider' },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: 'Start or continue your standup in a direct message with Pulse.',
            },
            accessory: {
                type: 'button',
                text: { type: 'plain_text', text: 'Start standup', emoji: true },
                action_id: 'start_standup',
                style: 'primary',
            },
        },
        {
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: 'You can also send `hello` in a DM to begin.',
                },
            ],
        },
    ];
}
//# sourceMappingURL=slack-app-home.view.js.map