/**
 * Tests: AI Send-to-Slack formatting + attachment helpers.
 * Run: npx ts-node src/ai/workspace/slack/ai-slack-export.spec.ts
 */
import * as assert from 'assert';
import {
  buildAiSlackExportBlocks,
  buildExportCsv,
  buildExportMarkdown,
} from './ai-slack-blocks.builder';
import { buildSimplePdf } from './simple-pdf.util';
import { SlackExportSendRequest } from './ai-slack-export.types';
import { WorkspaceReportType } from '../types/workspace-ai.types';
import { isUsableSlackBotToken } from '../../../common/slack-member.util';

function sampleReportRequest(
  overrides: Partial<SlackExportSendRequest> = {},
): SlackExportSendRequest {
  return {
    destinationType: 'default',
    contentType: 'report',
    title: 'Executive Weekly Snapshot',
    body: 'Team shipped OAuth fixes and cleared two blockers.',
    confidence: 'High',
    reportType: WorkspaceReportType.EXECUTIVE,
    sources: [{ label: 'Standups' }, { label: 'Jira', title: 'SCRUM-8' }],
    recommendation: 'Keep ownership of refresh tokens on backend.',
    report: {
      id: 'rep-1',
      reportType: WorkspaceReportType.EXECUTIVE,
      title: 'Executive Weekly Snapshot',
      generatedAt: '2026-08-19T10:00:00.000Z',
      workspaceId: 'ws-1',
      workspaceName: 'Pulse Demo',
      timeRange: {
        from: '2026-08-12T00:00:00.000Z',
        to: '2026-08-19T00:00:00.000Z',
        label: 'Last 7 days',
      },
      sections: [
        {
          id: 'highlights',
          title: 'Highlights',
          markdown: '- OAuth callback stabilized\n- Blockers down',
        },
        {
          id: 'recommendations',
          title: 'Recommendations',
          markdown: '- Keep ownership of refresh tokens on backend.',
        },
      ],
      markdown: '# Executive Weekly Snapshot\n\nHighlights...',
      sourcesUsed: ['Standups', 'Jira'],
      confidence: 'High',
      dataPoints: 12,
      explanation: 'Grounded on Demo Workspace metrics.',
      metrics: {},
    },
    ...overrides,
  };
}

console.log('ai-slack-export.spec.ts');

const executive = buildAiSlackExportBlocks(sampleReportRequest(), {
  workspaceName: 'Pulse Demo',
  sentAtIso: '2026-08-19T12:00:00.000Z',
});
assert.ok(executive.text.includes('Executive Weekly Snapshot'));
assert.ok(executive.blocks.some((block) => block.type === 'header'));
{
  const mrkdwn = JSON.stringify(executive.blocks);
  assert.ok(mrkdwn.includes('Confidence'));
  assert.ok(mrkdwn.includes('Sources'));
  assert.ok(mrkdwn.includes('Recommendations'));
  assert.ok(mrkdwn.includes('Pulse Demo'));
}

const detective = buildAiSlackExportBlocks(
  {
    destinationType: 'channel',
    contentType: 'answer',
    title: 'Root cause: SCRUM-8 delay',
    body: 'Ownership churn on OAuth refresh caused the delay.',
    confidence: 'Medium',
    reportType: 'root_cause_analysis',
    sources: [{ label: 'Jira', title: 'SCRUM-8' }],
  },
  {
    workspaceName: 'Pulse Demo',
    sentAtIso: '2026-08-19T12:00:00.000Z',
  },
);
{
  const mrkdwn = JSON.stringify(detective.blocks);
  assert.ok(mrkdwn.includes('Root cause: SCRUM-8 delay'));
  assert.ok(mrkdwn.includes('Ownership churn'));
}

const sprint = buildAiSlackExportBlocks(
  sampleReportRequest({
    title: 'Sprint 14 Replay',
    reportType: WorkspaceReportType.SPRINT,
  }),
  { workspaceName: 'Pulse Demo', sentAtIso: '2026-08-19T12:00:00.000Z' },
);
assert.ok(JSON.stringify(sprint.blocks).includes('Sprint 14 Replay'));

const md = buildExportMarkdown(sampleReportRequest());
assert.ok(md.includes('Executive Weekly Snapshot'));
const csv = buildExportCsv(sampleReportRequest());
assert.ok(csv.includes('Confidence'));

const pdf = buildSimplePdf('Title', 'Body line one\nBody line two');
assert.strictEqual(pdf.subarray(0, 5).toString('utf8'), '%PDF-');
assert.ok(pdf.length > 100);

// Failed Slack connection heuristics (token validation)
assert.strictEqual(isUsableSlackBotToken(null), false);
assert.strictEqual(isUsableSlackBotToken(''), false);
assert.strictEqual(isUsableSlackBotToken('xoxb-demo-placeholder'), false);
assert.strictEqual(isUsableSlackBotToken('not-a-token'), false);

console.log('All AI Send-to-Slack formatting tests passed.');
