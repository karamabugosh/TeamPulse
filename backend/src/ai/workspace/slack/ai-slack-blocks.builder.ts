import { KnownBlock } from '@slack/types';
import {
  SlackExportSendRequest,
  SlackExportSourceItem,
} from './ai-slack-export.types';

const SECTION_TEXT_LIMIT = 2900;

function truncate(text: string, max = SECTION_TEXT_LIMIT): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function escapeMrkdwn(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatSources(sources: SlackExportSourceItem[] | undefined): string {
  if (!sources?.length) return '_No sources cited._';
  return sources
    .slice(0, 12)
    .map((source) => {
      const title = source.title?.trim();
      const label = source.label?.trim() || 'Source';
      if (source.url) {
        return title
          ? `• <${source.url}|${escapeMrkdwn(label)}> — ${escapeMrkdwn(title)}`
          : `• <${source.url}|${escapeMrkdwn(label)}>`;
      }
      return title
        ? `• *${escapeMrkdwn(label)}* — ${escapeMrkdwn(title)}`
        : `• ${escapeMrkdwn(label)}`;
    })
    .join('\n');
}

function recommendationFromRequest(request: SlackExportSendRequest): string | null {
  if (request.recommendation?.trim()) {
    return request.recommendation.trim();
  }
  const section = request.report?.sections.find(
    (item) =>
      item.id === 'recommendations' ||
      item.id === 'ai_conclusion' ||
      /recommend/i.test(item.title),
  );
  if (!section?.markdown?.trim()) return null;
  return section.markdown
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*/g, '')
    .trim();
}

/**
 * Builds Slack Block Kit blocks for an AI Workspace export.
 * Falls back-friendly: chat.postMessage still gets a plain `text` field.
 */
export function buildAiSlackExportBlocks(
  request: SlackExportSendRequest,
  meta: { workspaceName: string; sentAtIso: string },
): { text: string; blocks: KnownBlock[] } {
  const report = request.report;
  const title = escapeMrkdwn(request.title.trim() || 'Pulse AI export');
  const reportType =
    request.reportType ||
    report?.reportType ||
    (request.contentType === 'report' ? 'report' : 'answer');
  const confidence =
    request.confidence || report?.confidence || 'Medium';
  const body = truncate(
    report
      ? [
          report.explanation?.trim(),
          ...report.sections.slice(0, 6).map((section) => {
            const plain = section.markdown
              .replace(/^#{1,6}\s+/gm, '')
              .replace(/\*\*/g, '')
              .trim();
            return `*${escapeMrkdwn(section.title)}*\n${escapeMrkdwn(truncate(plain, 500))}`;
          }),
        ]
          .filter(Boolean)
          .join('\n\n')
      : request.body,
  );

  const sources = request.sources?.length
    ? request.sources
    : (report?.sourcesUsed ?? []).map((label) => ({ label }));

  const recommendation = recommendationFromRequest(request);
  const timeLabel = new Date(meta.sentAtIso).toLocaleString();

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: title.slice(0, 150),
        emoji: true,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*${escapeMrkdwn(String(reportType))}* · Confidence *${escapeMrkdwn(String(confidence))}* · ${escapeMrkdwn(meta.workspaceName)}`,
        },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*AI Response*\n${escapeMrkdwn(body)}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Sources*\n${formatSources(sources)}`,
      },
    },
  ];

  if (recommendation) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Recommendations*\n${escapeMrkdwn(truncate(recommendation, 1200))}`,
      },
    });
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Sent from Pulse AI Workspace · ${escapeMrkdwn(timeLabel)}`,
        },
      ],
    },
  );

  const text = [
    request.title,
    `Confidence: ${confidence}`,
    `Workspace: ${meta.workspaceName}`,
    '',
    truncate(request.body || report?.markdown || '', 500),
  ].join('\n');

  return { text, blocks };
}

/** Plain markdown attachment body. */
export function buildExportMarkdown(request: SlackExportSendRequest): string {
  if (request.report?.markdown?.trim()) {
    return request.report.markdown;
  }
  const lines = [
    `# ${request.title}`,
    '',
    `Confidence: ${request.confidence ?? 'n/a'}`,
    `Type: ${request.reportType ?? request.contentType}`,
    '',
    request.body,
    '',
  ];
  if (request.sources?.length) {
    lines.push('## Sources');
    for (const source of request.sources) {
      lines.push(
        `- ${source.label}${source.title ? ` — ${source.title}` : ''}`,
      );
    }
  }
  const recommendation = recommendationFromRequest(request);
  if (recommendation) {
    lines.push('', '## Recommendations', recommendation);
  }
  return lines.join('\n').trim();
}

/** Flat CSV for report / answer export. */
export function buildExportCsv(request: SlackExportSendRequest): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows: string[][] = [
    ['Field', 'Value'],
    ['Title', request.title],
    ['Type', request.reportType ?? request.contentType],
    ['Confidence', String(request.confidence ?? '')],
  ];

  if (request.report) {
    rows.push(
      ['Workspace', request.report.workspaceName],
      ['Generated', request.report.generatedAt],
      ['Time Range', request.report.timeRange.label],
      ['Sources', request.report.sourcesUsed.join('; ')],
    );
    for (const section of request.report.sections) {
      rows.push([section.title, section.markdown.replace(/\n/g, ' ')]);
    }
  } else {
    rows.push(['Body', request.body]);
    if (request.sources?.length) {
      rows.push([
        'Sources',
        request.sources
          .map((s) => (s.title ? `${s.label}: ${s.title}` : s.label))
          .join('; '),
      ]);
    }
  }

  return rows.map((row) => row.map((cell) => escape(String(cell))).join(',')).join('\n');
}
