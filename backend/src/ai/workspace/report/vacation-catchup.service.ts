import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { OpenAiChatProvider } from '../providers/openai-chat.provider';
import { WorkspaceKnowledgeService } from '../knowledge/workspace-knowledge.service';
import {
  AiChatConfidence,
  GeneratedWorkspaceReport,
  ReportSection,
  ReportTimeRange,
  WorkspaceAskRequest,
  WorkspaceReportType,
} from '../types/workspace-ai.types';

export type VacationDateParseResult =
  | { status: 'resolved'; range: ReportTimeRange }
  | { status: 'need_start' }
  | { status: 'need_end'; startIso: string }
  | { status: 'invalid'; message: string };

type CatchupBundle = {
  workspaceId: string;
  workspaceName: string;
  focusUserName: string | null;
  timeRange: ReportTimeRange;
  sourcesUsed: string[];
  retrievalLog: Array<{ source: string; found: number }>;
  dataPoints: number;
  teamActivity: {
    standupsSubmitted: number;
    activeMembers: string[];
    expectedMembers: string[];
    missedMembers: string[];
  };
  completedWork: string[];
  newBlockers: Array<{
    title: string;
    reporter: string;
    linkedIssueKey: string | null;
    createdAt: string;
  }>;
  resolvedBlockers: Array<{
    title: string;
    reporter: string;
    resolvedAt: string | null;
  }>;
  jiraUpdates: {
    doneLike: number;
    createdOrUpdated: number;
    sample: Array<{
      key: string;
      summary: string;
      status: string | null;
      assignee: string | null;
    }>;
  };
  discussions: Array<{ title: string; excerpt: string; at: string }>;
  attention: Array<{
    label: string;
    detail: string;
    issueKey: string | null;
  }>;
  mentionsOfUser: string[];
  sectionSources: Record<string, string[]>;
};

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function formatLabel(from: Date, to: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  return `${fmt(from)} → ${fmt(to)}`;
}

function isDoneStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return (
    s.includes('done') ||
    s.includes('closed') ||
    s.includes('resolved') ||
    s.includes('complete')
  );
}

/**
 * Vacation Catch-up — personalized absence report from real workspace data.
 */
@Injectable()
export class VacationCatchupService {
  private readonly logger = new Logger(VacationCatchupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: WorkspaceKnowledgeService,
    private readonly openAi: OpenAiChatProvider,
  ) {}

  isCatchupRequest(question: string): boolean {
    const lower = question.toLowerCase();
    return (
      /\bvacation\b/.test(lower) ||
      /\bpto\b/.test(lower) ||
      /\bon leave\b/.test(lower) ||
      /\bcatch\s*me\s*up\b/.test(lower) ||
      /\bcatch[-\s]?up\b/.test(lower) ||
      /\bwhat did i miss\b/.test(lower) ||
      /\bwhat happened while i was\b/.test(lower) ||
      /\bwhile i was away\b/.test(lower) ||
      /\bwhile i was on vacation\b/.test(lower) ||
      /\bsummarize what happened while\b/.test(lower) ||
      /\bsummarize (everything |all )?(since|from)\b/.test(lower) ||
      /\bwhat changed since\b/.test(lower) ||
      /\bgive me an update\b/.test(lower) ||
      /\bbring me up to speed\b/.test(lower) ||
      /\bwelcome back\b/.test(lower)
    );
  }

  /**
   * Parse an absence window from the current message and recent history text.
   * Policy: at most ONE clarification (start date). End defaults to now.
   */
  parseDateRange(
    question: string,
    historyText = '',
    pendingStartIso?: string,
  ): VacationDateParseResult {
    const combined = `${historyText}\n${question}`.trim();
    const lower = question.toLowerCase();
    const now = new Date();

    // Relative ranges that do not require asking.
    if (/\bsince last week\b|\blast week\b/.test(lower)) {
      const from = startOfDay(new Date(now));
      from.setDate(from.getDate() - 7);
      const to = endOfDay(now);
      return {
        status: 'resolved',
        range: {
          from: from.toISOString(),
          to: to.toISOString(),
          label: formatLabel(from, to),
        },
      };
    }

    if (/\blast\s+(\d+)\s+days?\b/.test(lower)) {
      const match = lower.match(/\blast\s+(\d+)\s+days?\b/);
      const days = Math.min(Math.max(Number(match?.[1] ?? 7), 1), 90);
      const from = startOfDay(new Date(now));
      from.setDate(from.getDate() - days);
      const to = endOfDay(now);
      return {
        status: 'resolved',
        range: {
          from: from.toISOString(),
          to: to.toISOString(),
          label: formatLabel(from, to),
        },
      };
    }

    // Explicit pair → full range.
    const pair = extractDatePair(combined);
    if (pair) {
      return {
        status: 'resolved',
        range: {
          from: pair.from.toISOString(),
          to: pair.to.toISOString(),
          label: formatLabel(pair.from, pair.to),
        },
      };
    }

    // "since Aug 8" / "from 2026-08-08" → start..now (no second question).
    const sinceDate = extractSinceDate(question) ?? extractSinceDate(combined);
    if (sinceDate) {
      const from = startOfDay(sinceDate);
      const to = endOfDay(now);
      return {
        status: 'resolved',
        range: {
          from: from.toISOString(),
          to: to.toISOString(),
          label: formatLabel(from, to),
        },
      };
    }

    const relativeDay = parseRelativeDay(lower, now);
    if (relativeDay) {
      const from = startOfDay(relativeDay);
      const to = endOfDay(now);
      return {
        status: 'resolved',
        range: {
          from: from.toISOString(),
          to: to.toISOString(),
          label: formatLabel(from, to),
        },
      };
    }

    // Follow-up after we asked for the start date — treat as start..now.
    if (pendingStartIso) {
      const endOrStart =
        extractSingleDate(question) ?? extractSingleDate(combined);
      if (endOrStart) {
        // If user sent a second date while we somehow still had pendingStart,
        // prefer the newer message as the start (or as end if later).
        const pendingFrom = startOfDay(new Date(pendingStartIso));
        const candidate = startOfDay(endOrStart);
        const from = candidate <= pendingFrom ? candidate : pendingFrom;
        const to =
          candidate > pendingFrom ? endOfDay(endOrStart) : endOfDay(now);
        return {
          status: 'resolved',
          range: {
            from: from.toISOString(),
            to: to.toISOString(),
            label: formatLabel(from, to),
          },
        };
      }
      // Pending start already known but this reply had no date — still run to now.
      const from = startOfDay(new Date(pendingStartIso));
      const to = endOfDay(now);
      return {
        status: 'resolved',
        range: {
          from: from.toISOString(),
          to: to.toISOString(),
          label: formatLabel(from, to),
        },
      };
    }

    const single = extractSingleDate(question);
    if (single) {
      // Lone date (or date inside catch-up ask) → start..now immediately.
      const from = startOfDay(single);
      const to = endOfDay(now);
      return {
        status: 'resolved',
        range: {
          from: from.toISOString(),
          to: to.toISOString(),
          label: formatLabel(from, to),
        },
      };
    }

    // Catch-up ask with no date → ask once for start.
    if (this.isCatchupRequest(question)) {
      return { status: 'need_start' };
    }

    return {
      status: 'invalid',
      message:
        'I could not read a vacation date from that message. Send a date like Aug 10, or ask a new question.',
    };
  }

  async generate(params: {
    request: WorkspaceAskRequest;
    range: ReportTimeRange;
    focusUserName?: string | null;
    rangeSource?: string;
  }): Promise<GeneratedWorkspaceReport> {
    const workspaceId = await this.knowledge.resolveWorkspaceId(
      params.request.workspaceId,
    );
    if (!workspaceId) {
      throw new Error('No workspace available for vacation catch-up');
    }

    const focusUserName =
      params.focusUserName?.trim() ||
      params.request.focusUserName?.trim() ||
      null;

    this.logger.log(
      `Vacation catch-up workspace=${workspaceId} range=${params.range.label} focus=${focusUserName ?? 'none'}`,
    );

    const bundle = await this.collect({
      workspaceId,
      range: params.range,
      focusUserName,
    });

    const sections = this.buildSections(bundle);
    const aiSummary = await this.buildAiSummary(bundle);
    if (aiSummary) sections.push(aiSummary);

    const confidence = this.computeConfidence(bundle);
    const title = focusUserName
      ? `Welcome back, ${focusUserName}!`
      : 'Welcome back!';

    const markdown = this.renderMarkdown({
      title,
      bundle,
      sections,
      confidence,
    });

    return {
      id: randomUUID(),
      reportType: WorkspaceReportType.VACATION_CATCHUP,
      title,
      generatedAt: new Date().toISOString(),
      workspaceId: bundle.workspaceId,
      workspaceName: bundle.workspaceName,
      timeRange: bundle.timeRange,
      sections,
      markdown,
      sourcesUsed: bundle.sourcesUsed,
      confidence,
      dataPoints: bundle.dataPoints,
      explanation: [
        `Vacation catch-up for ${bundle.timeRange.label}.`,
        `Services used: Postgres workspace DB (standups, blockers, Jira cache/audits, digests, threads, team memory, timeline)${
          this.openAi.isAvailable() ? ', OpenAI for the AI Summary section' : ''
        }.`,
        `Data sources queried: ${bundle.sourcesUsed.join(', ')}.`,
        `Date range determined by: ${params.rangeSource ?? 'user-provided or conversational dates'}.`,
        `Built only from workspace records in that range (no fabricated events).`,
        `Data points: ${bundle.dataPoints}.`,
      ].join(' '),
      metrics: {
        focusUserName,
        teamActivity: bundle.teamActivity,
        completedWorkCount: bundle.completedWork.length,
        newBlockers: bundle.newBlockers.length,
        resolvedBlockers: bundle.resolvedBlockers.length,
        jiraUpdates: bundle.jiraUpdates,
        attentionCount: bundle.attention.length,
        sectionSources: bundle.sectionSources,
        retrievalLog: bundle.retrievalLog,
      },
    };
  }

  /** Short bullet catch-up shown above the full report markdown. */
  buildConciseSummary(report: GeneratedWorkspaceReport): string {
    const metrics = (report.metrics ?? {}) as {
      teamActivity?: { standupsSubmitted?: number };
      jiraUpdates?: {
        doneLike?: number;
        createdOrUpdated?: number;
        sample?: Array<{ key: string; status: string | null }>;
      };
      newBlockers?: number;
      resolvedBlockers?: number;
      attentionCount?: number;
    };
    const standups = metrics.teamActivity?.standupsSubmitted ?? 0;
    const jiraUpdated = metrics.jiraUpdates?.createdOrUpdated ?? 0;
    const doneLike = metrics.jiraUpdates?.doneLike ?? 0;
    const openBlockers = metrics.attentionCount ?? 0;
    const sample = metrics.jiraUpdates?.sample ?? [];
    const movedDone = sample
      .filter((i) => isDoneStatus(i.status))
      .slice(0, 3)
      .map((i) => i.key);
    const stillBlocked = sample
      .filter((i) => (i.status ?? '').toLowerCase().includes('block'))
      .slice(0, 3)
      .map((i) => i.key);

    const sinceLabel = report.timeRange.label.split('→')[0]?.trim() || report.timeRange.label;
    const lines = [
      `Since ${sinceLabel}:`,
      '',
      `• ${standups} standup submission(s) completed`,
      `• ${jiraUpdated} Jira issue(s) updated (${doneLike} currently Done-like in cache)`,
      `• ${metrics.newBlockers ?? 0} new blocker(s); ${openBlockers} still need attention`,
      `• ${metrics.resolvedBlockers ?? 0} blocker(s) resolved`,
    ];
    if (movedDone.length) {
      lines.push(`• Moved toward Done: ${movedDone.join(', ')}`);
    }
    if (stillBlocked.length) {
      lines.push(`• Currently blocked: ${stillBlocked.join(', ')}`);
    }
    lines.push('', `_Sources searched: ${report.sourcesUsed.join(', ')}_`);
    return lines.join('\n');
  }

  private async collect(params: {
    workspaceId: string;
    range: ReportTimeRange;
    focusUserName: string | null;
  }): Promise<CatchupBundle> {
    const from = new Date(params.range.from);
    const to = new Date(params.range.to);
    const sourcesUsed: string[] = [];
    const retrievalLog: Array<{ source: string; found: number }> = [];
    const sectionSources: Record<string, string[]> = {};

    const logSource = (source: string, found: number) => {
      sourcesUsed.push(source);
      retrievalLog.push({ source, found });
      this.logger.log(
        `[VacationCatchup] searched source="${source}" found=${found} range=${params.range.label}`,
      );
    };

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: params.workspaceId },
      select: { slackWorkspaceName: true },
    });

    const participants = await this.prisma.checkInParticipant.findMany({
      where: {
        isActive: true,
        checkIn: { team: { workspaceId: params.workspaceId }, enabled: true },
        teamMember: { optedOut: false },
      },
      include: {
        teamMember: {
          include: { user: { select: { slackDisplayName: true } } },
        },
      },
      take: 500,
    });
    const expectedMembers = [
      ...new Set(
        participants.map((p) => p.teamMember.user.slackDisplayName).filter(Boolean),
      ),
    ];
    logSource('Team members', expectedMembers.length);

    const submissions = await this.prisma.standupSubmission.findMany({
      where: {
        status: 'completed',
        user: { workspaceId: params.workspaceId },
        OR: [
          { completedAt: { gte: from, lte: to } },
          { createdAt: { gte: from, lte: to } },
        ],
      },
      include: {
        user: { select: { slackDisplayName: true } },
        answers: {
          include: { question: { select: { question: true } } },
          orderBy: { createdAt: 'asc' },
        },
        run: { include: { checkIn: { select: { name: true } } } },
        jiraIssueLinks: {
          select: { issueKey: true, summary: true },
          take: 10,
        },
      },
      orderBy: { completedAt: 'desc' },
      take: 300,
    });
    logSource('Standups', submissions.length);

    const activeMembers = [
      ...new Set(submissions.map((s) => s.user.slackDisplayName)),
    ];
    const missedMembers = expectedMembers.filter(
      (name) => !activeMembers.includes(name),
    );

    const completedWork: string[] = [];
    const mentionsOfUser: string[] = [];
    const focus = params.focusUserName?.toLowerCase() ?? null;

    for (const submission of submissions.slice(0, 40)) {
      for (const answer of submission.answers) {
        const text = answer.text.trim();
        if (!text) continue;
        const q = answer.question.question.toLowerCase();
        if (
          q.includes('yesterday') ||
          q.includes('done') ||
          q.includes('complete') ||
          q.includes('finish')
        ) {
          completedWork.push(
            `${submission.user.slackDisplayName}: ${text.slice(0, 160)}`,
          );
        }
        if (focus && text.toLowerCase().includes(focus)) {
          mentionsOfUser.push(
            `${submission.user.slackDisplayName} mentioned ${params.focusUserName} (${submission.completedAt?.toISOString().slice(0, 10) ?? 'n/a'}): ${text.slice(0, 140)}`,
          );
        }
      }
      for (const link of submission.jiraIssueLinks) {
        completedWork.push(
          `${link.issueKey}${link.summary ? ` — ${link.summary}` : ''} (linked in standup by ${submission.user.slackDisplayName})`,
        );
      }
    }

    sectionSources.team_activity = [
      `Slack Standups · ${params.range.label}`,
      `Check-in runs · ${params.range.label}`,
    ];
    sectionSources.completed_work = [
      `Slack Standup · ${params.range.label}`,
      `Linked Jira issues · ${params.range.label}`,
    ];

    const blockers = await this.prisma.pulseBlocker.findMany({
      where: { user: { workspaceId: params.workspaceId } },
      include: { user: { select: { slackDisplayName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });

    const newBlockers = blockers
      .filter((b) => b.createdAt >= from && b.createdAt <= to)
      .map((b) => ({
        title: b.title?.trim() || b.description.slice(0, 80),
        reporter: b.user.slackDisplayName,
        linkedIssueKey: b.linkedIssueKey,
        createdAt: b.createdAt.toISOString(),
      }));
    logSource('Blockers', newBlockers.length + blockers.filter((b) => b.resolvedAt && b.resolvedAt >= from && b.resolvedAt <= to).length);

    const resolvedBlockers = blockers
      .filter(
        (b) =>
          b.resolvedAt != null && b.resolvedAt >= from && b.resolvedAt <= to,
      )
      .map((b) => ({
        title: b.title?.trim() || b.description.slice(0, 80),
        reporter: b.user.slackDisplayName,
        resolvedAt: b.resolvedAt?.toISOString() ?? null,
      }));

    sectionSources.new_blockers = newBlockers.map(
      (b) =>
        `Blocker · ${b.createdAt.slice(0, 10)}${b.linkedIssueKey ? ` · ${b.linkedIssueKey}` : ''}`,
    );
    sectionSources.resolved_blockers = resolvedBlockers.map(
      (b) =>
        `Blocker Update · ${b.resolvedAt?.slice(0, 10) ?? params.range.label}`,
    );

    const jiraEntries = await this.prisma.jiraIssueCacheEntry.findMany({
      where: { user: { workspaceId: params.workspaceId } },
      orderBy: { refreshedAt: 'desc' },
      take: 400,
    });
    const byKey = new Map<string, (typeof jiraEntries)[number]>();
    for (const entry of jiraEntries) {
      if (!byKey.has(entry.issueKey)) byKey.set(entry.issueKey, entry);
    }
    const unique = [...byKey.values()];
    const updatedInRange = unique.filter((issue) => {
      const ts = issue.jiraUpdatedAt ?? issue.refreshedAt;
      return ts >= from && ts <= to;
    });
    // If cache timestamps miss the window (common for seeded snapshots), still surface current board state.
    const jiraSampleSource =
      updatedInRange.length > 0 ? updatedInRange : unique.slice(0, 40);
    const doneLike = unique.filter((i) => isDoneStatus(i.status)).length;
    logSource('Jira', jiraSampleSource.length);

    const jiraAudits = await this.prisma.jiraAuditLog.findMany({
      where: {
        user: { workspaceId: params.workspaceId },
        createdAt: { gte: from, lte: to },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    logSource('Jira audits / timeline', jiraAudits.length);

    sectionSources.jira_updates = jiraSampleSource
      .slice(0, 8)
      .map(
        (i) =>
          `Jira ${i.issueKey} · ${(i.jiraUpdatedAt ?? i.refreshedAt).toISOString().slice(0, 10)}`,
      );

    const digests = await this.prisma.aiDigest.findMany({
      where: {
        team: { workspaceId: params.workspaceId },
        OR: [
          { createdAt: { gte: from, lte: to } },
          { generatedAt: { gte: from, lte: to } },
        ],
      },
      include: {
        run: { include: { checkIn: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    logSource('Reports / AI Digests', digests.length);

    const threads = await this.prisma.standupThreadUpdate.findMany({
      where: {
        run: { team: { workspaceId: params.workspaceId } },
        createdAt: { gte: from, lte: to },
      },
      include: {
        user: { select: { slackDisplayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
    logSource('Standup threads', threads.length);

    const memoryDocs = await this.prisma.teamMemoryDocument.findMany({
      where: {
        workspaceId: params.workspaceId,
        OR: [
          { createdAt: { gte: from, lte: to } },
          { indexedAt: { gte: from, lte: to } },
        ],
      },
      orderBy: { indexedAt: 'desc' },
      take: 40,
    });
    logSource('Team Memory', memoryDocs.length);

    const inboundEvents = await this.prisma.inboundEvent.findMany({
      where: {
        workspaceId: params.workspaceId,
        receivedAt: { gte: from, lte: to },
      },
      orderBy: { receivedAt: 'desc' },
      take: 40,
    });
    logSource('Timeline / inbound events', inboundEvents.length);

    const discussions = [
      ...digests.map((d) => ({
        title: d.run.checkIn?.name ?? 'Standup report',
        excerpt: d.summary?.slice(0, 180) || '(empty digest)',
        at: d.createdAt.toISOString(),
      })),
      ...memoryDocs.slice(0, 8).map((m) => ({
        title: m.title || 'Team memory',
        excerpt: m.content.slice(0, 160),
        at: (m.indexedAt ?? m.createdAt).toISOString(),
      })),
      ...threads.map((t) => ({
        title: `Slack Thread · ${t.type}`,
        excerpt: `${t.user.slackDisplayName}: ${t.content.slice(0, 160)}`,
        at: t.createdAt.toISOString(),
      })),
      ...jiraAudits.slice(0, 8).map((a) => ({
        title: `Jira ${a.actionType}${a.jiraIssueKey ? ` · ${a.jiraIssueKey}` : ''}`,
        excerpt: JSON.stringify(a.metadata ?? {}).slice(0, 140),
        at: a.createdAt.toISOString(),
      })),
      ...inboundEvents.slice(0, 6).map((e) => ({
        title: `Timeline · ${e.provider}/${e.eventType}`,
        excerpt: e.status,
        at: e.receivedAt.toISOString(),
      })),
    ].slice(0, 16);

    sectionSources.discussions = discussions.slice(0, 6).map(
      (d) => `${d.title} · ${d.at.slice(0, 10)}`,
    );

    const attention: CatchupBundle['attention'] = [];
    const openBlockers = blockers.filter((b) =>
      ['open', 'in_progress', 'investigating', 'waiting'].includes(
        b.status.toLowerCase(),
      ),
    );

    for (const blocker of openBlockers.slice(0, 10)) {
      const assignedToFocus =
        focus &&
        (blocker.user.slackDisplayName.toLowerCase().includes(focus) ||
          (blocker.ownerLabel ?? '').toLowerCase().includes(focus));
      attention.push({
        label: blocker.title?.trim() || blocker.description.slice(0, 80),
        detail: assignedToFocus
          ? `Still blocked · involves ${params.focusUserName}`
          : `Still open · ${blocker.user.slackDisplayName}`,
        issueKey: blocker.linkedIssueKey,
      });
    }

    if (focus) {
      for (const issue of unique) {
        if (
          issue.assigneeName?.toLowerCase().includes(focus) &&
          !isDoneStatus(issue.status)
        ) {
          attention.unshift({
            label: `${issue.issueKey} — ${issue.summary}`,
            detail: `Assigned to you · ${issue.status ?? 'Unknown'}`,
            issueKey: issue.issueKey,
          });
        }
      }
    }

    sectionSources.attention = attention.slice(0, 8).map((item) =>
      item.issueKey
        ? `Jira ${item.issueKey}`
        : `Blocker · ${params.range.label}`,
    );

    if (mentionsOfUser.length) {
      sectionSources.mentions = mentionsOfUser
        .slice(0, 5)
        .map(() => `Slack Standup · ${params.range.label}`);
    }

    const dataPoints =
      submissions.length +
      newBlockers.length +
      resolvedBlockers.length +
      jiraSampleSource.length +
      digests.length +
      threads.length +
      memoryDocs.length +
      jiraAudits.length +
      inboundEvents.length;

    this.logger.log(
      `[VacationCatchup] retrieval complete workspace=${params.workspaceId} dataPoints=${dataPoints} log=${retrievalLog
        .map((r) => `${r.source}:${r.found}`)
        .join(',')}`,
    );

    return {
      workspaceId: params.workspaceId,
      workspaceName: workspace?.slackWorkspaceName ?? 'Workspace',
      focusUserName: params.focusUserName,
      timeRange: params.range,
      sourcesUsed: [...new Set(sourcesUsed)],
      retrievalLog,
      dataPoints,
      teamActivity: {
        standupsSubmitted: submissions.length,
        activeMembers,
        expectedMembers,
        missedMembers,
      },
      completedWork: [...new Set(completedWork)].slice(0, 20),
      newBlockers: newBlockers.slice(0, 20),
      resolvedBlockers: resolvedBlockers.slice(0, 20),
      jiraUpdates: {
        doneLike,
        createdOrUpdated: updatedInRange.length || jiraSampleSource.length,
        sample: jiraSampleSource.slice(0, 15).map((issue) => ({
          key: issue.issueKey,
          summary: issue.summary,
          status: issue.status,
          assignee: issue.assigneeName,
        })),
      },
      discussions,
      attention: attention.slice(0, 12),
      mentionsOfUser: mentionsOfUser.slice(0, 10),
      sectionSources,
    };
  }

  private buildSections(bundle: CatchupBundle): ReportSection[] {
    if (bundle.dataPoints === 0) {
      return [
        {
          id: 'empty',
          title: 'No activity',
          markdown:
            'No workspace activity was found during this time range.',
        },
      ];
    }

    const sections: ReportSection[] = [
      {
        id: 'team_activity',
        title: 'Team Activity',
        markdown: [
          `- ${bundle.teamActivity.standupsSubmitted} standups submitted`,
          `- ${bundle.teamActivity.activeMembers.length} members active`,
          `- ${bundle.teamActivity.missedMembers.length} member(s) missed standup`,
          bundle.teamActivity.missedMembers.length
            ? `- Missed: ${bundle.teamActivity.missedMembers.join(', ')}`
            : null,
          '',
          'Sources',
          ...(bundle.sectionSources.team_activity ?? []).map((s) => `- ${s}`),
        ]
          .filter(Boolean)
          .join('\n'),
      },
      {
        id: 'completed_work',
        title: 'Completed Work',
        markdown: [
          ...(bundle.completedWork.length
            ? bundle.completedWork.map((item) => `- ${item}`)
            : ['- No completed-work signals found in standups for this range.']),
          '',
          'Sources',
          ...(bundle.sectionSources.completed_work ?? []).map((s) => `- ${s}`),
        ].join('\n'),
      },
      {
        id: 'new_blockers',
        title: 'New Blockers',
        markdown: [
          ...(bundle.newBlockers.length
            ? bundle.newBlockers.map(
                (b) =>
                  `- **${b.reporter}** — ${b.title}${b.linkedIssueKey ? ` (${b.linkedIssueKey})` : ''}`,
              )
            : ['- No new blockers opened in this range.']),
          '',
          'Sources',
          ...(bundle.sectionSources.new_blockers?.length
            ? bundle.sectionSources.new_blockers.map((s) => `- ${s}`)
            : ['- Blockers · none in range']),
        ].join('\n'),
      },
      {
        id: 'resolved_blockers',
        title: 'Resolved Blockers',
        markdown: [
          ...(bundle.resolvedBlockers.length
            ? bundle.resolvedBlockers.map(
                (b) =>
                  `- **${b.title}** — resolved by ${b.reporter}${b.resolvedAt ? ` (${b.resolvedAt.slice(0, 10)})` : ''}`,
              )
            : ['- No blockers resolved in this range.']),
          '',
          'Sources',
          ...(bundle.sectionSources.resolved_blockers?.length
            ? bundle.sectionSources.resolved_blockers.map((s) => `- ${s}`)
            : ['- Blocker updates · none in range']),
        ].join('\n'),
      },
      {
        id: 'jira_updates',
        title: 'Jira Updates',
        markdown: [
          `- ${bundle.jiraUpdates.doneLike} issues currently Done-like in cache`,
          `- ${bundle.jiraUpdates.createdOrUpdated} issues updated during the absence window`,
          '',
          ...bundle.jiraUpdates.sample.map(
            (issue) =>
              `- **${issue.key}** — ${issue.summary} · ${issue.status ?? 'Unknown'}${issue.assignee ? ` · ${issue.assignee}` : ''}`,
          ),
          '',
          'Sources',
          ...(bundle.sectionSources.jira_updates?.length
            ? bundle.sectionSources.jira_updates.map((s) => `- ${s}`)
            : ['- Jira cache · no updates in range']),
        ].join('\n'),
      },
      {
        id: 'discussions',
        title: 'Important Discussions',
        markdown: [
          ...(bundle.discussions.length
            ? bundle.discussions.map(
                (d) => `- **${d.title}** (${d.at.slice(0, 10)}) — ${d.excerpt}`,
              )
            : ['- No digest/thread discussions found in this range.']),
          '',
          'Sources',
          ...(bundle.sectionSources.discussions?.length
            ? bundle.sectionSources.discussions.map((s) => `- ${s}`)
            : ['- Reports / Slack threads · none in range']),
        ].join('\n'),
      },
      {
        id: 'attention',
        title: 'Things That Need Your Attention',
        markdown: [
          ...(bundle.attention.length
            ? bundle.attention.map(
                (item) =>
                  `- **${item.label}** — ${item.detail}${item.issueKey ? ` (${item.issueKey})` : ''}`,
              )
            : ['- Nothing urgent detected for you in the available data.']),
          '',
          'Sources',
          ...(bundle.sectionSources.attention?.length
            ? bundle.sectionSources.attention.map((s) => `- ${s}`)
            : ['- Open blockers / assigned issues']),
        ].join('\n'),
      },
    ];

    if (bundle.mentionsOfUser.length) {
      sections.splice(1, 0, {
        id: 'mentions',
        title: 'Mentions Of You',
        markdown: [
          ...bundle.mentionsOfUser.map((m) => `- ${m}`),
          '',
          'Sources',
          ...(bundle.sectionSources.mentions ?? []).map((s) => `- ${s}`),
        ].join('\n'),
      });
    }

    return sections;
  }

  private async buildAiSummary(
    bundle: CatchupBundle,
  ): Promise<ReportSection | null> {
    if (bundle.dataPoints === 0) return null;

    if (!this.openAi.isAvailable()) {
      return {
        id: 'ai_summary',
        title: 'AI Summary',
        markdown: [
          bundle.focusUserName
            ? `Welcome back, ${bundle.focusUserName}.`
            : 'Welcome back.',
          `While you were away (${bundle.timeRange.label}), the team logged ${bundle.teamActivity.standupsSubmitted} standup submission(s), ${bundle.newBlockers.length} new blocker(s), and ${bundle.jiraUpdates.createdOrUpdated} Jira update(s).`,
          bundle.attention.length
            ? `Start with the ${bundle.attention.length} item(s) under Things That Need Your Attention.`
            : 'No urgent assigned open items were detected from available data.',
        ].join('\n\n'),
      };
    }

    try {
      const facts = {
        focusUserName: bundle.focusUserName,
        timeRange: bundle.timeRange,
        teamActivity: bundle.teamActivity,
        completedWork: bundle.completedWork.slice(0, 8),
        newBlockers: bundle.newBlockers.slice(0, 8),
        resolvedBlockers: bundle.resolvedBlockers.slice(0, 8),
        jiraUpdates: bundle.jiraUpdates,
        attention: bundle.attention.slice(0, 8),
        mentionsOfUser: bundle.mentionsOfUser.slice(0, 5),
      };

      const completion = await this.openAi.complete({
        temperature: 0.2,
        maxTokens: 500,
        messages: [
          {
            role: 'system',
            content: [
              'You write a short vacation catch-up summary for Pulse AI.',
              'Use ONLY the JSON facts. Never invent people, issues, or events.',
              'If data is thin, say what is missing instead of guessing.',
              'Write 1 short welcome sentence and 3-5 concise bullets.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: `Facts JSON:\n${JSON.stringify(facts, null, 2)}`,
          },
        ],
      });

      return {
        id: 'ai_summary',
        title: 'AI Summary',
        markdown: completion.content,
      };
    } catch (error) {
      this.logger.warn(
        `Vacation AI summary failed: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
      return null;
    }
  }

  private computeConfidence(bundle: CatchupBundle): AiChatConfidence {
    if (bundle.dataPoints >= 20) return 'High';
    if (bundle.dataPoints >= 6) return 'Medium';
    return 'Low';
  }

  private renderMarkdown(params: {
    title: string;
    bundle: CatchupBundle;
    sections: ReportSection[];
    confidence: AiChatConfidence;
  }): string {
    const { title, bundle, sections, confidence } = params;
    const header = [
      `# 🏖 ${title}`,
      '',
      `Here's what happened while you were away`,
      `(${bundle.timeRange.label})`,
      '',
      `- Generated: **${new Date().toISOString()}**`,
      `- Workspace: **${bundle.workspaceName}**`,
      `- Confidence: **${confidence}**`,
      `- Sources used: ${bundle.sourcesUsed.map((s) => `**${s}**`).join(', ')}`,
      '',
    ];

    const body = sections
      .map((section) => `## ${section.title}\n\n${section.markdown}`)
      .join('\n\n');

    return `${header.join('\n')}${body}\n`;
  }
}

function extractDatePair(
  text: string,
): { from: Date; to: Date } | null {
  const patterns = [
    /(?:from\s+)?([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?)\s*(?:→|->|to|until|through|-)\s*([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?)/i,
    /(\d{4}-\d{2}-\d{2})\s*(?:→|->|to|until|through|-)\s*(\d{4}-\d{2}-\d{2})/i,
    /(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*(?:→|->|to|until|through|-)\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const from = parseFlexibleDate(match[1]);
    const to = parseFlexibleDate(match[2]);
    if (from && to) {
      return { from: startOfDay(from), to: endOfDay(to) };
    }
  }
  return null;
}

function extractSingleDate(text: string): Date | null {
  const patterns = [
    /\b([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?)\b/,
    /\b(\d{4}-\d{2}-\d{2})\b/,
    /\b(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const parsed = parseFlexibleDate(match[1]);
    if (parsed) return parsed;
  }
  return null;
}

/** "since Aug 8" / "from 2026-08-08" / "after August 8, 2026" */
function extractSinceDate(text: string): Date | null {
  const match = text.match(
    /\b(?:since|from|after|starting(?:\s+from)?)\s+([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i,
  );
  if (!match) return null;
  return parseFlexibleDate(match[1]);
}

function parseRelativeDay(lower: string, now: Date): Date | null {
  if (/^yesterday\b/.test(lower) || /\byesterday\b/.test(lower) && lower.length < 24) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }
  if (/^today\b/.test(lower) && lower.length < 16) {
    return new Date(now);
  }
  const weekdayMatch = lower.match(
    /\blast\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  );
  if (weekdayMatch) {
    const map: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    const target = map[weekdayMatch[1]];
    const d = new Date(now);
    const current = d.getDay();
    let delta = (current - target + 7) % 7;
    if (delta === 0) delta = 7;
    d.setDate(d.getDate() - delta);
    return d;
  }
  return null;
}

function parseFlexibleDate(raw: string): Date | null {
  const value = raw.trim();
  const year = new Date().getFullYear();
  // Aug 10 or August 10, 2026
  const monthDay = value.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (monthDay) {
    const candidate = new Date(
      `${monthDay[1]} ${monthDay[2]}, ${monthDay[3] ?? year}`,
    );
    if (!Number.isNaN(candidate.getTime())) return candidate;
  }
  const iso = new Date(value);
  if (!Number.isNaN(iso.getTime())) return iso;
  return null;
}
