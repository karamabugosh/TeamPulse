// backend/src/reports/reports.service.ts

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AiDigestResult,
  BlockerSeverity,
  ExtractedBlocker,
  ThemeSummary,
} from '../ai/dto/ai-result.dto';

import { Logger } from '@nestjs/common';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async getLatestDigestForSlackUser(
    slackUserId: string,
    teamSearch?: string,
  ): Promise<AiDigestResult> {
    const membership =
      await this.resolveTeamMembership(
        slackUserId,
        teamSearch,
      );

    const digest =
      await this.prisma.aiDigest.findFirst({
        where: {
          teamId: membership.teamId,
        },
        orderBy: {
          generatedAt: 'desc',
        },
      });

    if (!digest) {
      throw new NotFoundException(
        `No reports exist yet for ${membership.team.name}.`,
      );
    }

    this.logger.log(`[Report Available] Retrieved latest digest for team ${membership.team.name}`);
    return this.mapDigest(digest);
  }

  async getDigestHistoryForSlackUser(
    slackUserId: string,
    limit = 5,
    teamSearch?: string,
  ): Promise<AiDigestResult[]> {
    const membership =
      await this.resolveTeamMembership(
        slackUserId,
        teamSearch,
      );

    const safeLimit =
      this.normaliseHistoryLimit(limit);

    const digests =
      await this.prisma.aiDigest.findMany({
        where: {
          teamId: membership.teamId,
        },
        orderBy: {
          generatedAt: 'desc',
        },
        take: safeLimit,
      });

    this.logger.log(`[History Updated] Retrieved ${digests.length} digest history items for team ${membership.team.name}`);

    return digests.map((digest) =>
      this.mapDigest(digest),
    );
  }

    formatDigestForSlack(
    digest: AiDigestResult,
  ): string {
    const sections = digest.reportSections ?? {
      keyAccomplishments: [],
      risks: [],
      aiInsights: [],
      actionItems: [],
      participantUpdates: [],
      overallProgress: '',
    };

    const listSection = (
      title: string,
      items: string[],
      emptyText: string,
    ) => [
      `*${title}*`,
      items.length > 0
        ? items.map((item) => `• ${item}`).join('\n')
        : emptyText,
    ].join('\n');

    const parts = [
      '*Summary*',
      digest.summary,
      '',
      listSection(
        'Blockers',
        digest.blockers.length > 0
          ? digest.blockers.map(
              (blocker) =>
                `<@${blocker.userId}> — ${blocker.description} (${blocker.severity})`,
            )
          : [],
        'No blockers reported.',
      ),
      '',
      listSection('Insights', sections.aiInsights, 'No additional insights.'),
      '',
      listSection('Action Items', sections.actionItems, 'No action items suggested.'),
    ];

    if (sections.participantUpdates?.length) {
      parts.push(
        '',
        '*Participant Updates*',
        ...sections.participantUpdates.map(
          (participant) =>
            `• *${participant.displayName}*\n${participant.answers
              .map((a) => `  - ${a.question}: ${a.answer}`)
              .join('\n')}`,
        ),
      );
    }

    if (sections.overallProgress) {
      parts.push('', '*Overall Progress*', sections.overallProgress);
    }

    return parts.join('\n');
  }

  buildDigestBlocks(
    digest: AiDigestResult,
    nonResponderNames: string[] = [],
  ): unknown[] {
    const blocks: unknown[] = [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '📊 Pulse Standup Report',
          emoji: true,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text:
              `Generated: ${this.formatDate(
                digest.generatedAt,
              )}  •  Source: ${digest.source}`,
          },
        ],
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Executive Summary*\n${digest.summary}`,
        },
      },
      {
        type: 'divider',
      },
    ];

    this.appendListBlock(
      blocks,
      '✅ Key Accomplishments',
      digest.reportSections?.keyAccomplishments ?? [],
      'No accomplishments reported.',
    );

    if (digest.blockers.length > 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🚧 Blockers*',
        },
      });

      for (const blocker of digest.blockers) {
        const dependency =
          blocker.dependency
            ? `\n*Dependency:* ${blocker.dependency}`
            : '';

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              `<@${blocker.userId}> — ${blocker.description}` +
              `\n*Severity:* ${blocker.severity}` +
              dependency,
          },
        });
      }
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*🚧 Blockers*\n✅ No blockers reported.',
        },
      });
    }

    blocks.push({ type: 'divider' });

    this.appendListBlock(
      blocks,
      '⚠️ Risks',
      digest.reportSections?.risks ?? [],
      'No risks identified.',
    );
    this.appendListBlock(
      blocks,
      '💡 AI Insights',
      digest.reportSections?.aiInsights ?? [],
      'No additional insights.',
    );
    this.appendListBlock(
      blocks,
      '📝 Action Items',
      digest.reportSections?.actionItems ?? [],
      'No action items suggested.',
    );

    blocks.push({ type: 'divider' });

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          nonResponderNames.length > 0
            ? [
                '*⏳ No Response*',
                ...nonResponderNames.map((name) => `• ${name}`),
              ].join('\n')
            : '*⏳ No Response*\n✅ Everyone submitted.',
      },
    });

    return blocks;
  }

  private appendListBlock(
    blocks: unknown[],
    title: string,
    items: string[],
    emptyText: string,
  ): void {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          items.length > 0
            ? `*${title}*\n${items.map((item) => `• ${item}`).join('\n')}`
            : `*${title}*\n${emptyText}`,
      },
    });
    blocks.push({ type: 'divider' });
  }
 
  formatHistoryForSlack(
    digests: AiDigestResult[],
  ): string {
    if (digests.length === 0) {
      return '📭 No previous reports were found.';
    }

    const reportLines = digests.map(
      (digest, index) => {
        const summary = this.truncate(
          digest.summary,
          180,
        );

        return [
          `*${index + 1}. ${this.formatDate(
            digest.generatedAt,
          )}*`,
          `Run: \`${digest.runId}\` | Source: ${digest.source}`,
          summary,
        ].join('\n');
      },
    );

    return [
      '*🕘 Pulse Report History*',
      '',
      ...reportLines.map(
        (line) => `${line}\n`,
      ),
    ].join('\n');
  }

  generateCsvFromDigest(
    digest: AiDigestResult,
  ): string {
    const lines: string[] = [];

    /*
     * Report overview
     */
    lines.push(
      'Team ID,Run ID,Generated At,Source,Summary',
    );

    lines.push(
      [
        this.escapeCsvField(
          digest.teamId,
        ),
        this.escapeCsvField(
          digest.runId,
        ),
        this.escapeCsvField(
          digest.generatedAt,
        ),
        this.escapeCsvField(
          digest.source,
        ),
        this.escapeCsvField(
          digest.summary,
        ),
      ].join(','),
    );

    /*
     * Blockers
     */
    lines.push('');
    lines.push('Blockers');

    lines.push(
      'User ID,Question ID,Description,Severity,Dependency,Confidence',
    );

    if (digest.blockers.length === 0) {
      lines.push(
        this.escapeCsvField(
          'No blockers reported',
        ),
      );
    } else {
      for (const blocker of digest.blockers) {
        lines.push(
          [
            this.escapeCsvField(
              blocker.userId,
            ),
            this.escapeCsvField(
              blocker.questionId,
            ),
            this.escapeCsvField(
              blocker.description,
            ),
            this.escapeCsvField(
              blocker.severity,
            ),
            this.escapeCsvField(
              blocker.dependency ?? '',
            ),
            this.escapeCsvField(
              String(
                blocker.confidence,
              ),
            ),
          ].join(','),
        );
      }
    }

    /*
     * Themes
     */
    lines.push('');
    lines.push('Themes');

    lines.push(
      'Theme,Mention Count,Summary',
    );

    if (digest.themes.length === 0) {
      lines.push(
        this.escapeCsvField(
          'No themes reported',
        ),
      );
    } else {
      for (const theme of digest.themes) {
        lines.push(
          [
            this.escapeCsvField(
              theme.theme,
            ),
            this.escapeCsvField(
              String(
                theme.mentionCount,
              ),
            ),
            this.escapeCsvField(
              theme.summary,
            ),
          ].join(','),
        );
      }
    }

    return lines.join('\r\n');
  }

  private async resolveTeamMembership(
    slackUserId: string,
    teamSearch?: string,
  ) {
    const normalizedSlackUserId =
      slackUserId?.trim();

    if (!normalizedSlackUserId) {
      throw new BadRequestException(
        'slackUserId is required.',
      );
    }

    let user =
      await this.prisma.user.findUnique({
        where: {
          slackUserId:
            normalizedSlackUserId,
        },
        include: {
          teamMembers: {
            include: {
              team: true,
            },
          },
        },
      });

    if (!user) {
      throw new NotFoundException(
        'User is not registered.',
      );
    }

    if (user.teamMembers.length === 0) {
      let team = await this.prisma.team.findFirst({
        where: {
          workspaceId: user.workspaceId,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      if (!team) {
        team = await this.prisma.team.create({
          data: {
            workspaceId: user.workspaceId,
            name: 'General',
            scheduleCron: '0 0 9 * * 0-4',
            timezone: 'Asia/Riyadh',
            schedulerEnabled: true,
          },
        });
      }

      await this.prisma.teamMember.upsert({
        where: {
          teamId_userId: {
            teamId: team.id,
            userId: user.id,
          },
        },
        update: {
          optedOut: false,
        },
        create: {
          teamId: team.id,
          userId: user.id,
          role: 'member',
          optedOut: false,
        },
      });

      const updatedUser = await this.prisma.user.findUnique({
        where: { id: user.id },
        include: {
          teamMembers: {
            include: {
              team: true,
            },
          },
        },
      });

      if (updatedUser) {
        user = updatedUser;
      }
    }

    if (user.teamMembers.length === 0) {
      throw new NotFoundException(
        'You are not assigned to any team.',
      );
    }

    if (!teamSearch?.trim()) {
      return user.teamMembers[0];
    }

    const search =
      teamSearch.trim().toLowerCase();

    const membership =
      user.teamMembers.find(
        (item) =>
          item.team.id.toLowerCase() ===
            search ||
          item.team.name
            .trim()
            .toLowerCase() === search,
      );

    if (!membership) {
      throw new NotFoundException(
        `No team matching "${teamSearch}" was found.`,
      );
    }

    return membership;
  }

  private normaliseHistoryLimit(
    limit: number,
  ): number {
    if (
      !Number.isFinite(limit)
    ) {
      return 5;
    }

    const integerLimit =
      Math.floor(limit);

    return Math.min(
      Math.max(integerLimit, 1),
      10,
    );
  }

  private mapDigest(digest: {
    teamId: string;
    runId: string;
    generatedAt: Date;
    source: string;
    summary: string;
    blockers: unknown;
    themes: unknown;
    reportSections?: unknown;
  }): AiDigestResult {
    return {
      teamId: digest.teamId,
      runId: digest.runId,
      generatedAt:
        digest.generatedAt.toISOString(),
      source:
        digest.source === 'ai'
          ? 'ai'
          : 'rules_fallback',
      summary: digest.summary,
      blockers:
        this.parseStoredBlockers(
          digest.blockers,
        ),
      themes:
        this.parseStoredThemes(
          digest.themes,
        ),
      reportSections: this.parseStoredReportSections(
        digest.reportSections,
      ),
    };
  }

  private parseStoredReportSections(
    value: unknown,
  ): AiDigestResult['reportSections'] {
    if (!value || typeof value !== 'object') {
      return {
        keyAccomplishments: [],
        risks: [],
        aiInsights: [],
        actionItems: [],
        participantUpdates: [],
        overallProgress: '',
      };
    }

    const record = value as Record<string, unknown>;
    const toStringArray = (input: unknown) =>
      Array.isArray(input)
        ? input.filter((item): item is string => typeof item === 'string')
        : [];

    return {
      keyAccomplishments: toStringArray(record.keyAccomplishments),
      risks: toStringArray(record.risks),
      aiInsights: toStringArray(record.aiInsights),
      actionItems: toStringArray(record.actionItems),
      participantUpdates: Array.isArray(record.participantUpdates)
        ? (record.participantUpdates as AiDigestResult['reportSections']['participantUpdates'])
        : [],
      overallProgress:
        typeof record.overallProgress === 'string'
          ? record.overallProgress
          : '',
    };
  }

  private parseStoredBlockers(
    value: unknown,
  ): ExtractedBlocker[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (
        blocker,
      ): blocker is ExtractedBlocker => {
        if (
          typeof blocker !==
            'object' ||
          blocker === null
        ) {
          return false;
        }

        const item =
          blocker as Record<
            string,
            unknown
          >;

        return (
          typeof item.userId ===
            'string' &&
          typeof item.questionId ===
            'string' &&
          typeof item.description ===
            'string' &&
          Object.values(
            BlockerSeverity,
          ).includes(
            item.severity as BlockerSeverity,
          ) &&
          (item.dependency === null ||
            typeof item.dependency ===
              'string') &&
          typeof item.confidence ===
            'number' &&
          Number.isFinite(
            item.confidence,
          ) &&
          item.confidence >= 0 &&
          item.confidence <= 1
        );
      },
    );
  }

  private parseStoredThemes(
    value: unknown,
  ): ThemeSummary[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter(
      (
        theme,
      ): theme is ThemeSummary => {
        if (
          typeof theme !==
            'object' ||
          theme === null
        ) {
          return false;
        }

        const item =
          theme as Record<
            string,
            unknown
          >;

        return (
          typeof item.theme ===
            'string' &&
          item.theme.trim().length > 0 &&
          typeof item.mentionCount ===
            'number' &&
          Number.isInteger(
            item.mentionCount,
          ) &&
          item.mentionCount > 0 &&
          typeof item.summary ===
            'string' &&
          item.summary.trim().length > 0
        );
      },
    );
  }

  private formatDate(
    value: string,
  ): string {
    const date = new Date(value);

    if (
      Number.isNaN(date.getTime())
    ) {
      return value;
    }

    return date.toLocaleString(
      'en-GB',
      {
        dateStyle: 'medium',
        timeStyle: 'short',
      },
    );
  }

  private truncate(
    value: string,
    maxLength: number,
  ): string {
    if (
      value.length <= maxLength
    ) {
      return value;
    }

    return `${value.slice(
      0,
      maxLength - 3,
    )}...`;
  }

  private escapeCsvField(
    value?: string | null,
  ): string {
    let text = value ?? '';

    /*
     * Prevent spreadsheet formula injection.
     *
     * CSV files may be opened in Excel or similar tools.
     * User/AI-generated text beginning with =, +, -, or @
     * must be treated as text rather than a formula.
     */
    if (
      /^[=+\-@]/.test(text)
    ) {
      text = `'${text}`;
    }

    if (
      text.includes(',') ||
      text.includes('"') ||
      text.includes('\n') ||
      text.includes('\r')
    ) {
      return `"${text.replace(
        /"/g,
        '""',
      )}"`;
    }

    return text;
  }
}