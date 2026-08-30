/**
 * Client-side helpers to turn report section markdown into clean UI data.
 * Does not change backend payloads — only display transforms.
 */

export type ReportContentBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'subheading'; text: string };

/** Strip common markdown markers for display. */
export function stripMarkdownSyntax(input: string): string {
  return input
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

/**
 * Parse a report section's markdown field into typed UI blocks.
 * Headings / horizontal rules / raw markers are removed.
 */
export function parseReportSectionMarkdown(markdown: string): ReportContentBlock[] {
  const blocks: ReportContentBlock[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (/^---+$/.test(trimmed)) continue;
    if (/^#{1,6}\s/.test(trimmed)) {
      const text = stripMarkdownSyntax(trimmed.replace(/^#{1,6}\s+/, ''));
      if (text) blocks.push({ type: 'subheading', text });
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      const text = stripMarkdownSyntax(bulletMatch[1] ?? '');
      if (text) blocks.push({ type: 'bullet', text });
      continue;
    }

    const text = stripMarkdownSyntax(trimmed);
    if (text) blocks.push({ type: 'paragraph', text });
  }

  return blocks;
}

/** Plain-text copy of a report without markdown symbols. */
export function reportToPlainText(report: {
  title: string;
  generatedAt: string;
  workspaceName: string;
  timeRange: { label: string; from: string; to: string };
  confidence: string;
  sourcesUsed: string[];
  sections: Array<{ title: string; markdown: string }>;
  explanation: string;
}): string {
  const lines: string[] = [
    report.title,
    '',
    `Generated: ${new Date(report.generatedAt).toLocaleString()}`,
    `Workspace: ${report.workspaceName}`,
    `Time Range: ${report.timeRange.label} (${report.timeRange.from.slice(0, 10)} → ${report.timeRange.to.slice(0, 10)})`,
    `Confidence: ${report.confidence}`,
    `Sources: ${report.sourcesUsed.join(', ')}`,
    '',
  ];

  for (const section of report.sections) {
    lines.push(section.title);
    for (const block of parseReportSectionMarkdown(section.markdown)) {
      if (block.type === 'bullet') lines.push(`• ${block.text}`);
      else if (block.type === 'subheading') lines.push(block.text);
      else lines.push(block.text);
    }
    lines.push('');
  }

  lines.push(report.explanation);
  return lines.join('\n').trim();
}

/** CSV export built on the client from structured report fields. */
export function reportToCsv(report: {
  title: string;
  reportType: string;
  generatedAt: string;
  workspaceName: string;
  timeRange: { label: string; from: string; to: string };
  confidence: string;
  sourcesUsed: string[];
  sections: Array<{ id: string; title: string; markdown: string }>;
  dataPoints: number;
}): string {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const rows: string[][] = [
    ['Field', 'Value'],
    ['Title', report.title],
    ['Type', report.reportType],
    ['Generated', report.generatedAt],
    ['Workspace', report.workspaceName],
    ['Time Range', report.timeRange.label],
    ['From', report.timeRange.from],
    ['To', report.timeRange.to],
    ['Confidence', report.confidence],
    ['Sources', report.sourcesUsed.join('; ')],
    ['Data Points', String(report.dataPoints)],
    [],
    ['Section', 'Line'],
  ];

  for (const section of report.sections) {
    const blocks = parseReportSectionMarkdown(section.markdown);
    if (blocks.length === 0) {
      rows.push([section.title, '']);
      continue;
    }
    for (const block of blocks) {
      const prefix =
        block.type === 'bullet' ? '• ' : block.type === 'subheading' ? '' : '';
      rows.push([section.title, `${prefix}${block.text}`]);
    }
  }

  return rows
    .map((row) =>
      row.length === 0 ? '' : row.map((cell) => escape(String(cell))).join(','),
    )
    .join('\n');
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadReportMarkdown(
  report: { reportType: string; generatedAt: string; markdown: string },
) {
  downloadBlob(
    `${report.reportType}-report-${report.generatedAt.slice(0, 10)}.md`,
    report.markdown,
    'text/markdown;charset=utf-8',
  );
}

export function downloadReportCsv(
  report: Parameters<typeof reportToCsv>[0],
) {
  downloadBlob(
    `${report.reportType}-report-${report.generatedAt.slice(0, 10)}.csv`,
    reportToCsv(report),
    'text/csv;charset=utf-8',
  );
}

/** Opens a print-ready window so the user can Save as PDF. */
export function downloadReportPdf(
  report: Parameters<typeof reportToPlainText>[0] & {
    reportType: string;
  },
) {
  const text = reportToPlainText(report)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const title = `${report.reportType}-report-${report.generatedAt.slice(0, 10)}`;
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: "Segoe UI", Georgia, serif; margin: 36px; color: #111; line-height: 1.55; max-width: 820px; }
    h1 { font-size: 24px; margin: 0 0 8px; letter-spacing: -0.02em; }
    .meta { color: #555; font-size: 12px; margin-bottom: 20px; }
    pre { white-space: pre-wrap; font-family: inherit; font-size: 13px; }
  </style>
</head>
<body>
  <h1>${report.title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h1>
  <pre>${text}</pre>
  <script>window.onload = () => { window.print(); };</script>
</body>
</html>`;
  const popup = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700');
  if (!popup) {
    downloadBlob(`${title}.txt`, reportToPlainText(report), 'text/plain;charset=utf-8');
    return;
  }
  popup.document.open();
  popup.document.write(html);
  popup.document.close();
}
