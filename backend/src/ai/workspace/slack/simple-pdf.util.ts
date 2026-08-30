/**
 * Minimal single-page PDF generator (Helvetica) for Slack file attachments.
 * Avoids adding a PDF dependency for plain-text AI exports.
 */
export function buildSimplePdf(title: string, body: string): Buffer {
  const lines = wrapLines(`${title}\n\n${body}`, 90).slice(0, 60);
  const contentLines: string[] = ['BT', '/F1 11 Tf', '50 750 Td', '14 TL'];

  for (let i = 0; i < lines.length; i += 1) {
    const safe = escapePdfText(lines[i] ?? '');
    if (i === 0) {
      contentLines.push(`(${safe}) Tj`);
    } else {
      contentLines.push('T*');
      contentLines.push(`(${safe}) Tj`);
    }
  }
  contentLines.push('ET');
  const stream = contentLines.join('\n');

  const objects: string[] = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push(
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
  );
  objects.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
  );
  objects.push(
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`,
  );
  objects.push(
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  );

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xrefStart = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

function escapePdfText(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
}

function wrapLines(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.replace(/\r\n/g, '\n').split('\n')) {
    if (!paragraph.trim()) {
      out.push('');
      continue;
    }
    let remaining = paragraph;
    while (remaining.length > width) {
      let splitAt = remaining.lastIndexOf(' ', width);
      if (splitAt < width / 2) splitAt = width;
      out.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }
    if (remaining) out.push(remaining);
  }
  return out;
}
