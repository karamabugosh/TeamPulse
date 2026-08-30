import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AiChatConfidence,
  GeneratedWorkspaceReport,
  ReportSection,
  WorkspaceAskRequest,
  WorkspaceReportType,
} from '../types/workspace-ai.types';
import { OpenAiChatProvider } from '../providers/openai-chat.provider';
import {
  ReportMetricsBundle,
  ReportMetricsService,
} from './report-metrics.service';
import { extractUserNameCandidates } from '../retrieval/keyword.util';
import { WorkspaceKnowledgeService } from '../knowledge/workspace-knowledge.service';
import { WorkspaceMembersService } from '../../../common/workspace-members.service';
import { resolveAllSlackIdsInText } from '../../../common/slack-member.util';

/**
 * Dynamic workspace report generation from real Pulse data.
 * Metrics are deterministic. AI only summarizes / recommends from those metrics.
 */
@Injectable()
export class ReportGenerationService {
  private readonly logger = new Logger(ReportGenerationService.name);

  constructor(
    private readonly metricsService: ReportMetricsService,
    private readonly knowledge: WorkspaceKnowledgeService,
    private readonly openAi: OpenAiChatProvider,
    private readonly workspaceMembers: WorkspaceMembersService,
  ) {}

  detectReportType(question: string): WorkspaceReportType | null {
    const lower = question.toLowerCase();

    if (
      /\b(executive report|generate executive|exec summary|leadership report)\b/.test(
        lower,
      )
    ) {
      return WorkspaceReportType.EXECUTIVE;
    }
    if (
      /\b(my report|personal report|generate my report|report for me)\b/.test(
        lower,
      )
    ) {
      return WorkspaceReportType.PERSONAL;
    }
    if (/\b(blocker report|blockers report|generate blocker)\b/.test(lower)) {
      return WorkspaceReportType.BLOCKER;
    }
    if (/\b(jira report|issues report|generate jira)\b/.test(lower)) {
      return WorkspaceReportType.JIRA;
    }
    if (/\b(sprint report|sprint summary|generate sprint)\b/.test(lower)) {
      return WorkspaceReportType.SPRINT;
    }
    if (
      /\b(weekly report|week report|generate weekly|last 7 days report)\b/.test(
        lower,
      )
    ) {
      return WorkspaceReportType.WEEKLY;
    }
    if (
      /\b(daily report|today'?s report|generate today|generate daily|daily summary)\b/.test(
        lower,
      )
    ) {
      return WorkspaceReportType.DAILY;
    }
    if (/\bgenerate\b.*\breport\b|\breport\b.*\bgenerate\b/.test(lower)) {
      return WorkspaceReportType.DAILY;
    }
    return null;
  }

  isReportRequest(question: string): boolean {
    return this.detectReportType(question) != null;
  }

  async generate(
    request: WorkspaceAskRequest & { reportType?: WorkspaceReportType | null },
  ): Promise<GeneratedWorkspaceReport> {
    const question = request.question?.trim() ?? '';
    const workspaceId = await this.knowledge.resolveWorkspaceId(
      request.workspaceId,
    );
    if (!workspaceId) {
      throw new Error('No workspace available for report generation');
    }

    const reportType =
      request.reportType ??
      this.detectReportType(question) ??
      WorkspaceReportType.DAILY;

    const timeRange = this.metricsService.resolveTimeRange(reportType);
    const nameCandidates = extractUserNameCandidates(question);
    let userQuery =
      reportType === WorkspaceReportType.PERSONAL
        ? nameCandidates[0] ?? null
        : nameCandidates[0] ?? null;

    if (reportType === WorkspaceReportType.PERSONAL && !userQuery) {
      // Personal without a name still generates team-scoped daily metrics,
      // labeled as personal request with note in explanation.
      userQuery = null;
    } else if (userQuery) {
      userQuery =
        (await this.knowledge.resolveUserQuery(workspaceId, [userQuery])) ??
        userQuery;
    }

    this.logger.log(
      `Generating ${reportType} report workspace=${workspaceId} range=${timeRange.label}`,
    );

    const metrics = await this.metricsService.collect({
      workspaceId,
      reportType,
      timeRange,
      userQuery,
    });

    const sections = this.buildSections(metrics);
    const aiParts = await this.generateAiNarrative(metrics, sections);
    if (aiParts.summarySection) {
      sections.push(aiParts.summarySection);
    }
    if (aiParts.recommendationsSection) {
      sections.push(aiParts.recommendationsSection);
    }

    const confidence = this.computeConfidence(metrics);
    const title = this.titleFor(reportType, metrics);
    const markdown = this.renderMarkdown({
      title,
      metrics,
      sections,
      confidence,
      explanation: this.buildExplanation(metrics),
    });

    const nameMap = await this.workspaceMembers.buildReportNameMap(workspaceId);
    const resolvedSections = sections.map((section) => ({
      ...section,
      markdown: resolveAllSlackIdsInText(section.markdown, nameMap),
    }));
    const resolvedMarkdown = resolveAllSlackIdsInText(markdown, nameMap);

    return {
      id: randomUUID(),
      reportType,
      title,
      generatedAt: new Date().toISOString(),
      workspaceId: metrics.workspaceId,
      workspaceName: metrics.workspaceName,
      timeRange: metrics.timeRange,
      sections: resolvedSections,
      markdown: resolvedMarkdown,
      sourcesUsed: metrics.sourcesUsed,
      confidence,
      dataPoints: metrics.dataPoints,
      explanation: this.buildExplanation(metrics),
      metrics: {
        participation: metrics.participation,
        standups: {
          runsInRange: metrics.standups.runsInRange,
          completedAnswers: metrics.standups.completedAnswers,
          highlightCount: metrics.standups.highlights.length,
        },
        jira: {
          totalCachedIssues: metrics.jira.totalCachedIssues,
          issuesUpdatedInRange: metrics.jira.issuesUpdatedInRange,
          doneLikeCount: metrics.jira.doneLikeCount,
          inProgressCount: metrics.jira.inProgressCount,
          todoLikeCount: metrics.jira.todoLikeCount,
        },
        blockers: {
          openCount: metrics.blockers.openCount,
          createdInRange: metrics.blockers.createdInRange,
          resolvedInRange: metrics.blockers.resolvedInRange,
          updatesInRange: metrics.blockers.updatesInRange,
        },
        digests: { count: metrics.digests.count },
        risks: metrics.risks,
        userFocus: metrics.userFocus,
      },
    };
  }

  private titleFor(
    reportType: WorkspaceReportType,
    metrics: ReportMetricsBundle,
  ): string {
    const focus = metrics.userFocus ? ` — ${metrics.userFocus}` : '';
    switch (reportType) {
      case WorkspaceReportType.WEEKLY:
        return `Weekly Workspace Report${focus}`;
      case WorkspaceReportType.SPRINT:
        return `Sprint Progress Report${focus}`;
      case WorkspaceReportType.EXECUTIVE:
        return `Executive Workspace Report${focus}`;
      case WorkspaceReportType.BLOCKER:
        return `Blocker Report${focus}`;
      case WorkspaceReportType.JIRA:
        return `Jira Progress Report${focus}`;
      case WorkspaceReportType.PERSONAL:
        return `Personal Activity Report${focus}`;
      default:
        return `Daily Workspace Report${focus}`;
    }
  }

  private buildSections(metrics: ReportMetricsBundle): ReportSection[] {
    const type = metrics.reportType;
    const sections: ReportSection[] = [];

    if (
      type === WorkspaceReportType.DAILY ||
      type === WorkspaceReportType.WEEKLY ||
      type === WorkspaceReportType.SPRINT ||
      type === WorkspaceReportType.EXECUTIVE ||
      type === WorkspaceReportType.PERSONAL
    ) {
      sections.push(this.participationSection(metrics));
    }

    if (
      type === WorkspaceReportType.DAILY ||
      type === WorkspaceReportType.WEEKLY ||
      type === WorkspaceReportType.PERSONAL ||
      type === WorkspaceReportType.SPRINT ||
      type === WorkspaceReportType.EXECUTIVE
    ) {
      sections.push(this.completedWorkSection(metrics));
    }

    if (
      type === WorkspaceReportType.DAILY ||
      type === WorkspaceReportType.WEEKLY ||
      type === WorkspaceReportType.SPRINT ||
      type === WorkspaceReportType.EXECUTIVE ||
      type === WorkspaceReportType.JIRA
    ) {
      sections.push(this.jiraSection(metrics));
    }

    if (
      type === WorkspaceReportType.DAILY ||
      type === WorkspaceReportType.WEEKLY ||
      type === WorkspaceReportType.SPRINT ||
      type === WorkspaceReportType.EXECUTIVE ||
      type === WorkspaceReportType.BLOCKER
    ) {
      sections.push(this.blockersSection(metrics));
    }

    if (type === WorkspaceReportType.WEEKLY) {
      sections.push(this.weeklyTrendsSection(metrics));
      sections.push(this.highlightsSection(metrics));
    }

    if (type === WorkspaceReportType.SPRINT) {
      sections.push(this.sprintProgressSection(metrics));
    }

    if (type === WorkspaceReportType.EXECUTIVE) {
      sections.push(this.executiveSummarySection(metrics));
      sections.push(this.sprintProgressSection(metrics));
      sections.push(this.highlightsSection(metrics));
    }

    sections.push(this.risksSection(metrics));

    return sections;
  }

  private executiveSummarySection(metrics: ReportMetricsBundle): ReportSection {
    const p = metrics.participation;
    const lines = [
      `- Delivery window: **${metrics.timeRange.label}**`,
      `- Participation: **${p.participationRate == null ? 'n/a' : `${p.participationRate}%`}** (${p.completedSubmissions} completed / ${p.expectedParticipants} expected)`,
      `- Open blockers: **${metrics.blockers.openCount}** (created in range: ${metrics.blockers.createdInRange}, resolved: ${metrics.blockers.resolvedInRange})`,
      `- Jira movement: **${metrics.jira.issuesUpdatedInRange}** issues touched · done-like **${metrics.jira.doneLikeCount}** · in-progress **${metrics.jira.inProgressCount}**`,
      `- Digests available: **${metrics.digests.count}**`,
      `- Top risks: ${
        metrics.risks.length
          ? metrics.risks.slice(0, 3).join('; ')
          : '_none flagged_'
      }`,
    ];
    return {
      id: 'executive-summary',
      title: 'Executive snapshot',
      markdown: lines.join('\n'),
    };
  }

  private participationSection(metrics: ReportMetricsBundle): ReportSection {
    const p = metrics.participation;
    const lines = [
      `- Expected participants: **${p.expectedParticipants}**`,
      `- Completed submissions in range: **${p.completedSubmissions}**`,
      `- Pending submissions: **${p.pendingSubmissions}**`,
      `- Participation rate: **${p.participationRate == null ? 'n/a (no expected roster)' : `${p.participationRate}%`}**`,
      `- Responders (${p.responders.length}): ${p.responders.length ? p.responders.join(', ') : '_none_'}`,
      `- Non-responders (${p.nonResponders.length}): ${p.nonResponders.length ? p.nonResponders.join(', ') : '_none_'}`,
      `- Standup runs in range: **${metrics.standups.runsInRange}**`,
    ];
    return {
      id: 'participation',
      title:
        metrics.reportType === WorkspaceReportType.WEEKLY
          ? 'Participation trends'
          : 'Team participation',
      markdown: lines.join('\n'),
    };
  }

  private completedWorkSection(metrics: ReportMetricsBundle): ReportSection {
    const lines: string[] = [
      `- Completed standup answers: **${metrics.standups.completedAnswers}**`,
      `- Highlighted submissions: **${metrics.standups.highlights.length}**`,
    ];
    for (const item of metrics.standups.highlights.slice(0, 12)) {
      lines.push(
        `\n**${item.user}** · ${item.standup}${item.completedAt ? ` · ${item.completedAt.slice(0, 10)}` : ''}`,
      );
      for (const answer of item.answers.slice(0, 4)) {
        lines.push(`- ${answer}`);
      }
    }
    if (metrics.standups.highlights.length === 0) {
      lines.push('_No completed standup answers found in this time range._');
    }
    return {
      id: 'completed_work',
      title: 'Completed work',
      markdown: lines.join('\n'),
    };
  }

  private jiraSection(metrics: ReportMetricsBundle): ReportSection {
    const j = metrics.jira;
    const statusLines = Object.entries(j.byStatus)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([status, count]) => `- ${status}: **${count}**`);

    const issueLines = j.sampleIssues.map(
      (issue) =>
        `- **${issue.key}** — ${issue.summary} · ${issue.status ?? 'Unknown'}${issue.assignee ? ` · ${issue.assignee}` : ''}`,
    );

    const lines = [
      `- Cached Jira issues: **${j.totalCachedIssues}**`,
      `- Issues updated in range: **${j.issuesUpdatedInRange}**`,
      `- Done-like: **${j.doneLikeCount}** · In progress: **${j.inProgressCount}** · Other/Todo-like: **${j.todoLikeCount}**`,
      '',
      'Status breakdown:',
      ...(statusLines.length ? statusLines : ['_No Jira status data_']),
      '',
      'Sample issues:',
      ...(issueLines.length ? issueLines : ['_No Jira issues in cache_']),
      '',
      `_${j.note}_`,
    ];

    return {
      id: 'jira_progress',
      title:
        metrics.reportType === WorkspaceReportType.SPRINT
          ? 'Completed vs remaining issues'
          : 'Jira progress',
      markdown: lines.join('\n'),
    };
  }

  private blockersSection(metrics: ReportMetricsBundle): ReportSection {
    const b = metrics.blockers;
    const active = b.active.map(
      (item) =>
        `- **${item.title}** · ${item.status} · ${item.severity} · ${item.reporter}${item.linkedIssueKey ? ` · ${item.linkedIssueKey}` : ''}`,
    );
    const resolved = b.recentlyResolved.map(
      (item) =>
        `- **${item.title}** · resolved ${item.resolvedAt?.slice(0, 10) ?? 'n/a'} · ${item.reporter}`,
    );

    return {
      id: 'blockers',
      title: 'Blockers',
      markdown: [
        `- Active/open blockers: **${b.openCount}**`,
        `- Opened in range: **${b.createdInRange}**`,
        `- Resolved in range: **${b.resolvedInRange}**`,
        `- Blocker updates in range: **${b.updatesInRange}**`,
        '',
        'Active blockers:',
        ...(active.length ? active : ['_No active blockers_']),
        '',
        'Resolved in range:',
        ...(resolved.length ? resolved : ['_None resolved in this range_']),
      ].join('\n'),
    };
  }

  private weeklyTrendsSection(metrics: ReportMetricsBundle): ReportSection {
    return {
      id: 'weekly_trends',
      title: 'Weekly totals',
      markdown: [
        `- Issues completed (done-like in cache): **${metrics.jira.doneLikeCount}**`,
        `- Issues updated/created signal in range: **${metrics.jira.issuesUpdatedInRange}**`,
        `- Blockers opened: **${metrics.blockers.createdInRange}**`,
        `- Blockers resolved: **${metrics.blockers.resolvedInRange}**`,
        `- Prior AI digests in range: **${metrics.digests.count}**`,
      ].join('\n'),
    };
  }

  private highlightsSection(metrics: ReportMetricsBundle): ReportSection {
    const digestLines = metrics.digests.summaries.slice(0, 5).map(
      (d) =>
        `- **${d.title}** (${d.createdAt.slice(0, 10)}): ${d.summary}`,
    );
    const people = metrics.standups.highlights
      .slice(0, 8)
      .map((h) => `- **${h.user}** completed ${h.standup}`);

    return {
      id: 'highlights',
      title: 'Team highlights',
      markdown: [
        'Standup highlights:',
        ...(people.length ? people : ['_No standup highlights_']),
        '',
        'Existing digest summaries:',
        ...(digestLines.length ? digestLines : ['_No digests in range_']),
      ].join('\n'),
    };
  }

  private sprintProgressSection(metrics: ReportMetricsBundle): ReportSection {
    const total = metrics.jira.totalCachedIssues;
    const done = metrics.jira.doneLikeCount;
    const remaining = Math.max(0, total - done);
    const velocityNote =
      total > 0
        ? `Done-like share of cached issues: **${Math.round((done / total) * 100)}%**`
        : 'No cached Jira issues available for velocity estimate';

    return {
      id: 'sprint_progress',
      title: 'Sprint progress & velocity summary',
      markdown: [
        `- Cached issues: **${total}**`,
        `- Completed (done-like): **${done}**`,
        `- Remaining (not done-like): **${remaining}**`,
        `- In progress: **${metrics.jira.inProgressCount}**`,
        `- ${velocityNote}`,
        `- Standup runs in sprint window: **${metrics.standups.runsInRange}**`,
        `- Active blockers: **${metrics.blockers.openCount}**`,
        '',
        '_Velocity is derived from local Jira cache statuses, not live Jira sprint APIs._',
      ].join('\n'),
    };
  }

  private risksSection(metrics: ReportMetricsBundle): ReportSection {
    return {
      id: 'risks',
      title: 'Risks',
      markdown: metrics.risks.length
        ? metrics.risks.map((r) => `- ${r}`).join('\n')
        : '_No major risks detected from available workspace data._',
    };
  }

  private async generateAiNarrative(
    metrics: ReportMetricsBundle,
    sections: ReportSection[],
  ): Promise<{
    summarySection: ReportSection | null;
    recommendationsSection: ReportSection | null;
  }> {
    if (!this.openAi.isAvailable()) {
      return {
        summarySection: {
          id: 'ai_summary',
          title: 'AI summary',
          markdown:
            '_AI narrative skipped (Pulse AI disabled). Sections above are built only from workspace metrics._',
        },
        recommendationsSection:
          metrics.reportType === WorkspaceReportType.WEEKLY ||
          metrics.reportType === WorkspaceReportType.SPRINT
            ? {
                id: 'recommendations',
                title: 'Recommendations',
                markdown: this.fallbackRecommendations(metrics),
              }
            : null,
      };
    }

    const facts = {
      reportType: metrics.reportType,
      timeRange: metrics.timeRange,
      participation: metrics.participation,
      standupRuns: metrics.standups.runsInRange,
      completedAnswers: metrics.standups.completedAnswers,
      jira: {
        totalCachedIssues: metrics.jira.totalCachedIssues,
        issuesUpdatedInRange: metrics.jira.issuesUpdatedInRange,
        doneLikeCount: metrics.jira.doneLikeCount,
        inProgressCount: metrics.jira.inProgressCount,
        todoLikeCount: metrics.jira.todoLikeCount,
      },
      blockers: {
        openCount: metrics.blockers.openCount,
        createdInRange: metrics.blockers.createdInRange,
        resolvedInRange: metrics.blockers.resolvedInRange,
        activeTitles: metrics.blockers.active.map((b) => b.title).slice(0, 10),
      },
      risks: metrics.risks,
      sectionTitles: sections.map((s) => s.title),
    };

    try {
      const completion = await this.openAi.complete({
        temperature: 0.2,
        maxTokens: 700,
        messages: [
          {
            role: 'system',
            content: [
              'You are Pulse AI writing a workspace report narrative.',
              'Use ONLY the JSON facts provided. Never invent people, issues, blockers, or numbers.',
              'If a fact is missing, say it is not available.',
              'Return Markdown with exactly two sections:',
              '## AI summary',
              '## Recommendations',
              'Keep each section concise (3-6 bullets or short paragraphs).',
            ].join('\n'),
          },
          {
            role: 'user',
            content: `Workspace facts JSON:\n${JSON.stringify(facts, null, 2)}`,
          },
        ],
      });

      const text = completion.content;
      const summary = this.extractMarkdownSection(text, 'AI summary');
      const recommendations = this.extractMarkdownSection(
        text,
        'Recommendations',
      );

      return {
        summarySection: {
          id: 'ai_summary',
          title: 'AI summary',
          markdown: summary || text,
        },
        recommendationsSection:
          metrics.reportType === WorkspaceReportType.DAILY && !recommendations
            ? null
            : {
                id: 'recommendations',
                title: 'Recommendations',
                markdown:
                  recommendations || this.fallbackRecommendations(metrics),
              },
      };
    } catch (error) {
      this.logger.warn(
        `AI narrative failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return {
        summarySection: {
          id: 'ai_summary',
          title: 'AI summary',
          markdown:
            '_AI narrative unavailable. Metric sections above remain grounded in workspace data._',
        },
        recommendationsSection: {
          id: 'recommendations',
          title: 'Recommendations',
          markdown: this.fallbackRecommendations(metrics),
        },
      };
    }
  }

  private extractMarkdownSection(text: string, heading: string): string {
    const pattern = new RegExp(
      `##\\s*${heading}\\s*([\\s\\S]*?)(?=\\n##\\s+|$)`,
      'i',
    );
    const match = text.match(pattern);
    return match?.[1]?.trim() ?? '';
  }

  private fallbackRecommendations(metrics: ReportMetricsBundle): string {
    const lines: string[] = [];
    if (metrics.blockers.openCount > 0) {
      lines.push(
        `- Review and unblock the ${metrics.blockers.openCount} active blocker(s).`,
      );
    }
    if (
      metrics.participation.participationRate != null &&
      metrics.participation.participationRate < 80
    ) {
      lines.push(
        '- Follow up with non-responders to improve standup coverage.',
      );
    }
    if (metrics.jira.inProgressCount > metrics.jira.doneLikeCount) {
      lines.push(
        '- Focus on finishing in-progress Jira work before starting new issues.',
      );
    }
    if (lines.length === 0) {
      lines.push(
        '- Continue current cadence; no critical gaps detected in available data.',
      );
    }
    return lines.join('\n');
  }

  private computeConfidence(metrics: ReportMetricsBundle): AiChatConfidence {
    if (metrics.dataPoints >= 25) return 'High';
    if (metrics.dataPoints >= 8) return 'Medium';
    return 'Low';
  }

  private buildExplanation(metrics: ReportMetricsBundle): string {
    return [
      `Generated from live workspace data for ${metrics.workspaceName}.`,
      `Time range: ${metrics.timeRange.label} (${metrics.timeRange.from.slice(0, 10)} → ${metrics.timeRange.to.slice(0, 10)}).`,
      `Sources used: ${metrics.sourcesUsed.join(', ')}.`,
      `Data points counted: ${metrics.dataPoints}.`,
      'Numeric sections are computed from the database; AI narrative (if present) is constrained to those facts only.',
      metrics.jira.note,
    ].join(' ');
  }

  private renderMarkdown(params: {
    title: string;
    metrics: ReportMetricsBundle;
    sections: ReportSection[];
    confidence: AiChatConfidence;
    explanation: string;
  }): string {
    const { title, metrics, sections, confidence, explanation } = params;
    const header = [
      `# ${title}`,
      '',
      `- Generated: **${new Date().toISOString()}**`,
      `- Workspace: **${metrics.workspaceName}**`,
      `- Time range: **${metrics.timeRange.label}** (${metrics.timeRange.from.slice(0, 10)} → ${metrics.timeRange.to.slice(0, 10)})`,
      `- Sources used: ${metrics.sourcesUsed.map((s) => `**${s}**`).join(', ')}`,
      `- Confidence: **${confidence}**`,
      '',
      `_${explanation}_`,
      '',
    ];

    const body = sections
      .map((section) => `## ${section.title}\n\n${section.markdown}`)
      .join('\n\n');

    return `${header.join('\n')}${body}\n`;
  }
}
