// backend/src/reports/reports.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AiDigestResult,
  ExtractedBlocker,
  ThemeSummary,
} from '../ai/dto/ai-result.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getLatestDigestForSlackUser(
    slackUserId: string,
    teamSearch?: string,
  ): Promise<AiDigestResult> {
    const user = await this.prisma.user.findUnique({
      where: { slackUserId },
      include: {
        teamMembers: {
          include: {
            team: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User is not registered.');
    }

    if (user.teamMembers.length === 0) {
      throw new NotFoundException(
        'You are not assigned to any team.',
      );
    }

    const selectedMembership = teamSearch
      ? user.teamMembers.find((membership) => {
          const search = teamSearch.trim().toLowerCase();

          return (
            membership.team.id.toLowerCase() === search ||
            membership.team.name.toLowerCase() === search
          );
        })
      : user.teamMembers[0];

    if (!selectedMembership) {
      throw new NotFoundException(
        `No team matching "${teamSearch}" was found.`,
      );
    }

    const digest = await this.prisma.aiDigest.findFirst({
      where: {
        teamId: selectedMembership.teamId,
      },
      orderBy: {
        generatedAt: 'desc',
      },
    });

    if (!digest) {
      throw new NotFoundException(
        `No reports exist yet for ${selectedMembership.team.name}.`,
      );
    }

    return this.mapDigest(digest);
  }

  async getDigestHistoryForSlackUser(
    slackUserId: string,
    limit = 5,
    teamSearch?: string,
  ): Promise<AiDigestResult[]> {
    const user = await this.prisma.user.findUnique({
      where: { slackUserId },
      include: {
        teamMembers: {
          include: {
            team: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User is not registered.');
    }

    if (user.teamMembers.length === 0) {
      throw new NotFoundException(
        'You are not assigned to any team.',
      );
    }

    const selectedMembership = teamSearch
      ? user.teamMembers.find((membership) => {
          const search = teamSearch.trim().toLowerCase();

          return (
            membership.team.id.toLowerCase() === search ||
            membership.team.name.toLowerCase() === search
          );
        })
      : user.teamMembers[0];

    if (!selectedMembership) {
      throw new NotFoundException(
        `No team matching "${teamSearch}" was found.`,
      );
    }

    const safeLimit = Math.min(Math.max(limit, 1), 10);

    const digests = await this.prisma.aiDigest.findMany({
      where: {
        teamId: selectedMembership.teamId,
      },
      orderBy: {
        generatedAt: 'desc',
      },
      take: safeLimit,
    });

    return digests.map((digest) => this.mapDigest(digest));
  }

  formatDigestForSlack(digest: AiDigestResult): string {
    const blockerText =
      digest.blockers.length > 0
        ? digest.blockers
            .map(
              (blocker) =>
                `• <@${blocker.userId}> — ${blocker.description}` +
                `\n  Severity: ${blocker.severity}` +
                (blocker.dependency
                  ? ` | Dependency: ${blocker.dependency}`
                  : ''),
            )
            .join('\n')
        : 'No blockers reported.';

    const themeText =
      digest.themes.length > 0
        ? digest.themes
            .map(
              (theme) =>
                `• *${theme.theme}* (${theme.mentionCount}) — ${theme.summary}`,
            )
            .join('\n')
        : 'No common themes reported.';

    return [
      '*📊 Pulse Standup Report*',
      `*Run:* ${digest.runId}`,
      `*Generated:* ${this.formatDate(digest.generatedAt)}`,
      `*Source:* ${digest.source}`,
      '',
      '*Summary*',
      digest.summary,
      '',
      '*Blockers*',
      blockerText,
      '',
      '*Themes*',
      themeText,
    ].join('\n');
  }

  formatHistoryForSlack(digests: AiDigestResult[]): string {
    if (digests.length === 0) {
      return '📭 No previous reports were found.';
    }

    const reportLines = digests.map((digest, index) => {
      const summary = this.truncate(digest.summary, 180);

      return [
        `*${index + 1}. ${this.formatDate(digest.generatedAt)}*`,
        `Run: \`${digest.runId}\` | Source: ${digest.source}`,
        summary,
      ].join('\n');
    });

    return [
      '*🕘 Pulse Report History*',
      '',
      ...reportLines.map((line) => `${line}\n`),
    ].join('\n');
  }

  generateCsvFromDigest(digest: AiDigestResult): string {
    const blockers = digest.blockers ?? [];
    const themes = digest.themes ?? [];
    const lines: string[] = [];

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
    lines.push('Blockers');
    lines.push(
      'User ID,Question ID,Description,Severity,Dependency,Confidence',
    );

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
            String(blocker.confidence ?? ''),
          ].join(','),
        );
      }
    }

    lines.push('');
    lines.push('Themes');
    lines.push('Theme,Mention Count,Summary');

    if (themes.length === 0) {
      lines.push('No themes reported');
    } else {
      for (const theme of themes) {
        lines.push(
          [
            this.escapeCsvField(theme.theme),
            String(theme.mentionCount ?? ''),
            this.escapeCsvField(theme.summary),
          ].join(','),
        );
      }
    }

    return lines.join('\r\n');
  }

  private mapDigest(digest: {
    teamId: string;
    runId: string;
    generatedAt: Date;
    source: string;
    summary: string;
    blockers: unknown;
    themes: unknown;
  }): AiDigestResult {
    const source: AiDigestResult['source'] =
      digest.source === 'ai' ? 'ai' : 'rules_fallback';

    return {
      teamId: digest.teamId,
      runId: digest.runId,
      generatedAt: digest.generatedAt.toISOString(),
      source,
      summary: digest.summary,
      blockers: Array.isArray(digest.blockers)
        ? (digest.blockers as ExtractedBlocker[])
        : [],
      themes: Array.isArray(digest.themes)
        ? (digest.themes as ThemeSummary[])
        : [],
    };
  }

  private formatDate(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return date.toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, maxLength - 3)}...`;
  }

  private escapeCsvField(value?: string | null): string {
    const text = value ?? '';

    if (
      text.includes(',') ||
      text.includes('"') ||
      text.includes('\n') ||
      text.includes('\r')
    ) {
      return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
  }
}