// backend/src/reports/reports.service.ts

import { Injectable } from '@nestjs/common';
import { AiDigestResult } from '../ai/dto/ai-result.dto';

@Injectable()
export class ReportsService {
  /**
   * Converts an AI digest result into a CSV string.
   * Includes: run metadata, summary, blockers, and themes.
   */
  generateCsvFromDigest(digest: AiDigestResult): string {
    const blockers = digest.blockers ?? [];
    const themes = digest.themes ?? [];
    const lines: string[] = [];

    // --- Meta section ---
    lines.push('Team ID,Run ID,Generated At,Source,Summary');
    lines.push(
      [
        this.escapeCsvField(digest.teamId),
        this.escapeCsvField(digest.runId),
        this.escapeCsvField(digest.generatedAt),
        this.escapeCsvField(digest.source),
        this.escapeCsvField(digest.summary),
      ].join(','),
    );

    lines.push('');

    // --- Blockers section ---
    lines.push('Blockers');
    lines.push('User ID,Question ID,Description,Severity,Dependency,Confidence');
    if (blockers.length === 0) {
      lines.push('No blockers reported');
    } else {
      for (const blocker of blockers) {
        lines.push(
          [
            this.escapeCsvField(blocker.userId),
            this.escapeCsvField(blocker.questionId),
            this.escapeCsvField(blocker.description),
            this.escapeCsvField(blocker.severity),
            this.escapeCsvField(blocker.dependency ?? ''),
            (blocker.confidence ?? '').toString(),
          ].join(','),
        );
      }
    }

    lines.push('');

    // --- Themes section ---
    lines.push('Themes');
    lines.push('Theme,Mention Count,Summary');
    if (themes.length === 0) {
      lines.push('No themes reported');
    } else {
      for (const theme of themes) {
        lines.push(
          [
            this.escapeCsvField(theme.theme),
            (theme.mentionCount ?? '').toString(),
            this.escapeCsvField(theme.summary),
          ].join(','),
        );
      }
    }

    return lines.join('\r\n');
  }

  /**
   * Escapes a field for safe CSV output:
   * wraps in quotes if it contains commas, quotes, or newlines,
   * and doubles any internal quotes.
   */
  private escapeCsvField(value?: string | null): string {
    const text = value ?? '';
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }
}