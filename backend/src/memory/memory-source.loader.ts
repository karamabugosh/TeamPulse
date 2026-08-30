import { Injectable } from '@nestjs/common';
import { MemoryVisibility, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MEMORY_SOURCE, MemorySourceType } from './memory-source.constants';
import {
  MemorySourceMissingError,
  MemoryUnsupportedSourceError,
  MemoryWorkspaceMismatchError,
  NormalizedMemorySource,
  NormalizedMemorySection,
} from './memory-normalized.types';

type LoadedAnswer = {
  kind: typeof MEMORY_SOURCE.STANDUP_ANSWER;
  workspaceId: string;
  answer: {
    id: string;
    text: string;
    structuredValue: Prisma.JsonValue | null;
    userId: string;
    userName: string;
    questionText: string;
    questionType: string;
    questionId: string;
    teamId: string | null;
    checkInId: string | null;
    checkInName: string | null;
    runId: string | null;
    submissionId: string | null;
    completedAt: Date | null;
    runStartedAt: Date | null;
    runCompletedAt: Date | null;
    sourceCreatedAt: Date;
    linkedIssueKeys: string[];
  };
};

type LoadedBlocker = {
  kind: typeof MEMORY_SOURCE.BLOCKER;
  workspaceId: string;
  blocker: {
    id: string;
    userId: string;
    teamId: string | null;
    title: string | null;
    description: string;
    category: string | null;
    severity: string;
    dependency: string | null;
    expectedResolution: string | null;
    preventingAllWork: boolean;
    ownerLabel: string | null;
    status: string;
    needsHelp: boolean | null;
    needsEscalation: boolean | null;
    linkedIssueKey: string | null;
    createdAt: Date;
    runId: string | null;
    submissionId: string | null;
    checkInId: string | null;
    answerId: string | null;
  };
};

type LoadedResolution = {
  kind: typeof MEMORY_SOURCE.BLOCKER_RESOLUTION;
  workspaceId: string;
  update: {
    id: string;
    notes: string | null;
    resolutionType: string | null;
    newStatus: string;
    previousStatus: string;
    createdAt: Date;
    userId: string;
  };
  blocker: LoadedBlocker['blocker'];
};

type LoadedReport = {
  kind: typeof MEMORY_SOURCE.REPORT;
  workspaceId: string;
  digest: {
    id: string;
    teamId: string;
    teamName: string;
    runId: string;
    source: string;
    summary: string;
    blockers: Prisma.JsonValue;
    themes: Prisma.JsonValue;
    reportSections: Prisma.JsonValue | null;
    slackReportText: string | null;
    generatedAt: Date;
    checkInName: string | null;
  };
};

export type LoadedMemorySource =
  | LoadedAnswer
  | LoadedBlocker
  | LoadedResolution
  | LoadedReport;

@Injectable()
export class MemorySourceLoader {
  constructor(private readonly prisma: PrismaService) {}

  async load(params: {
    workspaceId: string;
    sourceType: string;
    sourceId: string;
  }): Promise<LoadedMemorySource> {
    switch (params.sourceType) {
      case MEMORY_SOURCE.STANDUP_ANSWER:
        return this.loadAnswer(params.workspaceId, params.sourceId);
      case MEMORY_SOURCE.BLOCKER:
        return this.loadBlocker(params.workspaceId, params.sourceId);
      case MEMORY_SOURCE.BLOCKER_RESOLUTION:
        return this.loadResolution(params.workspaceId, params.sourceId);
      case MEMORY_SOURCE.REPORT:
        return this.loadReport(params.workspaceId, params.sourceId);
      default:
        throw new MemoryUnsupportedSourceError(params.sourceType);
    }
  }

  private async loadAnswer(
    eventWorkspaceId: string,
    sourceId: string,
  ): Promise<LoadedAnswer> {
    const answer = await this.prisma.answer.findUnique({
      where: { id: sourceId },
      include: {
        user: { select: { id: true, workspaceId: true, slackDisplayName: true } },
        question: { select: { question: true, type: true } },
        submission: {
          select: {
            id: true,
            completedAt: true,
            run: {
              select: {
                id: true,
                teamId: true,
                checkInId: true,
                startedAt: true,
                completedAt: true,
                checkIn: { select: { name: true } },
              },
            },
          },
        },
        jiraIssueLinks: { select: { issueKey: true } },
      },
    });
    if (!answer) {
      throw new MemorySourceMissingError(MEMORY_SOURCE.STANDUP_ANSWER, sourceId);
    }

    const workspaceId = answer.user.workspaceId;
    this.assertWorkspace(eventWorkspaceId, workspaceId, MEMORY_SOURCE.STANDUP_ANSWER, sourceId);

    const linkKeys = [
      ...new Set(
        answer.jiraIssueLinks
          .map((l) => l.issueKey?.trim().toUpperCase())
          .filter(Boolean) as string[],
      ),
    ];

    return {
      kind: MEMORY_SOURCE.STANDUP_ANSWER,
      workspaceId,
      answer: {
        id: answer.id,
        text: answer.text,
        structuredValue: answer.structuredValue,
        userId: answer.userId,
        userName: answer.user.slackDisplayName,
        questionText: answer.question.question,
        questionType: answer.question.type,
        questionId: answer.questionId,
        teamId: answer.submission?.run.teamId ?? null,
        checkInId: answer.submission?.run.checkInId ?? null,
        checkInName: answer.submission?.run.checkIn?.name ?? null,
        runId: answer.submission?.run.id ?? null,
        submissionId: answer.submission?.id ?? null,
        completedAt: answer.submission?.completedAt ?? null,
        runStartedAt: answer.submission?.run.startedAt ?? null,
        runCompletedAt: answer.submission?.run.completedAt ?? null,
        sourceCreatedAt: answer.createdAt,
        linkedIssueKeys: linkKeys,
      },
    };
  }

  private async loadBlocker(
    eventWorkspaceId: string,
    sourceId: string,
  ): Promise<LoadedBlocker> {
    const blocker = await this.prisma.pulseBlocker.findUnique({
      where: { id: sourceId },
    });
    if (!blocker) {
      throw new MemorySourceMissingError(MEMORY_SOURCE.BLOCKER, sourceId);
    }
    this.assertWorkspace(
      eventWorkspaceId,
      blocker.workspaceId,
      MEMORY_SOURCE.BLOCKER,
      sourceId,
    );
    return {
      kind: MEMORY_SOURCE.BLOCKER,
      workspaceId: blocker.workspaceId,
      blocker: {
        id: blocker.id,
        userId: blocker.userId,
        teamId: blocker.teamId,
        title: blocker.title,
        description: blocker.description,
        category: blocker.category,
        severity: blocker.severity,
        dependency: blocker.dependency,
        expectedResolution: blocker.expectedResolution,
        preventingAllWork: blocker.preventingAllWork,
        ownerLabel: blocker.ownerLabel,
        status: blocker.status,
        needsHelp: blocker.needsHelp,
        needsEscalation: blocker.needsEscalation,
        linkedIssueKey: blocker.linkedIssueKey,
        createdAt: blocker.createdAt,
        runId: blocker.runId,
        submissionId: blocker.submissionId,
        checkInId: blocker.checkInId,
        answerId: blocker.answerId,
      },
    };
  }

  private async loadResolution(
    eventWorkspaceId: string,
    sourceId: string,
  ): Promise<LoadedResolution> {
    const update = await this.prisma.pulseBlockerUpdate.findUnique({
      where: { id: sourceId },
      include: { blocker: true },
    });
    if (!update) {
      throw new MemorySourceMissingError(
        MEMORY_SOURCE.BLOCKER_RESOLUTION,
        sourceId,
      );
    }
    this.assertWorkspace(
      eventWorkspaceId,
      update.blocker.workspaceId,
      MEMORY_SOURCE.BLOCKER_RESOLUTION,
      sourceId,
    );
    const b = update.blocker;
    return {
      kind: MEMORY_SOURCE.BLOCKER_RESOLUTION,
      workspaceId: b.workspaceId,
      update: {
        id: update.id,
        notes: update.notes,
        resolutionType: update.resolutionType,
        newStatus: update.newStatus,
        previousStatus: update.previousStatus,
        createdAt: update.createdAt,
        userId: update.userId,
      },
      blocker: {
        id: b.id,
        userId: b.userId,
        teamId: b.teamId,
        title: b.title,
        description: b.description,
        category: b.category,
        severity: b.severity,
        dependency: b.dependency,
        expectedResolution: b.expectedResolution,
        preventingAllWork: b.preventingAllWork,
        ownerLabel: b.ownerLabel,
        status: b.status,
        needsHelp: b.needsHelp,
        needsEscalation: b.needsEscalation,
        linkedIssueKey: b.linkedIssueKey,
        createdAt: b.createdAt,
        runId: b.runId,
        submissionId: b.submissionId,
        checkInId: b.checkInId,
        answerId: b.answerId,
      },
    };
  }

  private async loadReport(
    eventWorkspaceId: string,
    sourceId: string,
  ): Promise<LoadedReport> {
    const digest = await this.prisma.aiDigest.findUnique({
      where: { id: sourceId },
      include: {
        team: { select: { id: true, name: true, workspaceId: true } },
        run: { include: { checkIn: { select: { name: true } } } },
      },
    });
    if (!digest) {
      throw new MemorySourceMissingError(MEMORY_SOURCE.REPORT, sourceId);
    }
    this.assertWorkspace(
      eventWorkspaceId,
      digest.team.workspaceId,
      MEMORY_SOURCE.REPORT,
      sourceId,
    );
    return {
      kind: MEMORY_SOURCE.REPORT,
      workspaceId: digest.team.workspaceId,
      digest: {
        id: digest.id,
        teamId: digest.teamId,
        teamName: digest.team.name,
        runId: digest.runId,
        source: digest.source,
        summary: digest.summary,
        blockers: digest.blockers,
        themes: digest.themes,
        reportSections: digest.reportSections,
        slackReportText: digest.slackReportText,
        generatedAt: digest.generatedAt,
        checkInName: digest.run.checkIn?.name ?? null,
      },
    };
  }

  private assertWorkspace(
    eventWorkspaceId: string,
    sourceWorkspaceId: string,
    sourceType: MemorySourceType,
    sourceId: string,
  ): void {
    if (eventWorkspaceId !== sourceWorkspaceId) {
      throw new MemoryWorkspaceMismatchError(
        eventWorkspaceId,
        sourceWorkspaceId,
        sourceType,
        sourceId,
      );
    }
  }
}

@Injectable()
export class MemoryNormalizerService {
  normalize(loaded: LoadedMemorySource): NormalizedMemorySource {
    switch (loaded.kind) {
      case MEMORY_SOURCE.STANDUP_ANSWER:
        return this.normalizeAnswer(loaded);
      case MEMORY_SOURCE.BLOCKER:
        return this.normalizeBlocker(loaded);
      case MEMORY_SOURCE.BLOCKER_RESOLUTION:
        return this.normalizeResolution(loaded);
      case MEMORY_SOURCE.REPORT:
        return this.normalizeReport(loaded);
      default:
        throw new MemoryUnsupportedSourceError((loaded as { kind: string }).kind);
    }
  }

  private normalizeAnswer(loaded: LoadedAnswer): NormalizedMemorySource {
    const a = loaded.answer;
    const linked = a.linkedIssueKeys[0] ?? null;
    const lines = [
      a.checkInName ? `Standup: ${a.checkInName}` : null,
      `Question: ${a.questionText}`,
      `Answer (${a.userName}): ${a.text.trim()}`,
      linked ? `Related Jira issue key: ${linked}` : null,
      a.linkedIssueKeys.length > 1
        ? `Related Jira issue keys: ${a.linkedIssueKeys.join(', ')}`
        : null,
    ].filter(Boolean) as string[];

    const visibility = a.teamId
      ? MemoryVisibility.TEAM
      : MemoryVisibility.WORKSPACE;

    return {
      workspaceId: loaded.workspaceId,
      sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
      sourceId: a.id,
      title: a.checkInName
        ? `${a.checkInName} — ${a.userName}`
        : `Standup answer — ${a.userName}`,
      text: lines.join('\n'),
      ownerUserId: a.userId,
      teamId: a.teamId,
      linkedIssueKey: linked,
      visibility,
      metadata: {
        questionType: a.questionType,
        questionId: a.questionId,
        answerId: a.id,
        checkInId: a.checkInId,
        submissionId: a.submissionId,
        runId: a.runId,
        linkedIssueKeys: a.linkedIssueKeys,
        completedAt: a.completedAt?.toISOString() ?? null,
        sourceCreatedAt: a.sourceCreatedAt?.toISOString() ?? null,
        runStartedAt: a.runStartedAt?.toISOString() ?? null,
        runCompletedAt: a.runCompletedAt?.toISOString() ?? null,
      },
    };
  }

  private normalizeBlocker(loaded: LoadedBlocker): NormalizedMemorySource {
    const b = loaded.blocker;
    const title = b.title?.trim() || b.description.slice(0, 80);
    const lines = [
      `Blocker: ${title}`,
      `Description: ${b.description.trim()}`,
      `Status: ${b.status}`,
      `Severity: ${b.severity}`,
      b.category ? `Category: ${b.category}` : null,
      b.dependency ? `Dependency: ${b.dependency}` : null,
      b.expectedResolution
        ? `Expected resolution: ${b.expectedResolution}`
        : null,
      b.ownerLabel ? `Owner: ${b.ownerLabel}` : null,
      b.preventingAllWork ? 'Preventing all work: yes' : null,
      b.needsHelp ? 'Needs help: yes' : null,
      b.needsEscalation ? 'Needs escalation: yes' : null,
      b.linkedIssueKey
        ? `Related Jira issue key: ${b.linkedIssueKey.toUpperCase()}`
        : null,
    ].filter(Boolean) as string[];

    return {
      workspaceId: loaded.workspaceId,
      sourceType: MEMORY_SOURCE.BLOCKER,
      sourceId: b.id,
      title,
      text: lines.join('\n'),
      ownerUserId: b.userId,
      teamId: b.teamId,
      linkedIssueKey: b.linkedIssueKey?.toUpperCase() ?? null,
      visibility: b.teamId ? MemoryVisibility.TEAM : MemoryVisibility.WORKSPACE,
      metadata: {
        status: b.status,
        severity: b.severity,
        createdAt: b.createdAt.toISOString(),
        runId: b.runId,
        submissionId: b.submissionId,
        checkInId: b.checkInId,
        answerId: b.answerId,
        sourceCreatedAt: b.createdAt.toISOString(),
      },
    };
  }

  private normalizeResolution(
    loaded: LoadedResolution,
  ): NormalizedMemorySource {
    const b = loaded.blocker;
    const u = loaded.update;
    const title = b.title?.trim() || b.description.slice(0, 80);
    const lines = [
      `Blocker resolution: ${title}`,
      `Problem: ${b.description.trim()}`,
      u.notes?.trim() ? `Resolution: ${u.notes.trim()}` : null,
      u.resolutionType ? `Resolution type: ${u.resolutionType}` : null,
      `Status change: ${u.previousStatus} → ${u.newStatus}`,
      b.linkedIssueKey
        ? `Related Jira issue key: ${b.linkedIssueKey.toUpperCase()}`
        : null,
    ].filter(Boolean) as string[];

    return {
      workspaceId: loaded.workspaceId,
      sourceType: MEMORY_SOURCE.BLOCKER_RESOLUTION,
      sourceId: u.id,
      title: `Resolved: ${title}`,
      text: lines.join('\n'),
      ownerUserId: u.userId,
      teamId: b.teamId,
      linkedIssueKey: b.linkedIssueKey?.toUpperCase() ?? null,
      visibility: b.teamId ? MemoryVisibility.TEAM : MemoryVisibility.WORKSPACE,
      metadata: {
        blockerId: b.id,
        resolvedAt: u.createdAt.toISOString(),
        resolutionType: u.resolutionType,
      },
    };
  }

  private normalizeReport(loaded: LoadedReport): NormalizedMemorySource {
    const d = loaded.digest;
    const sections: NormalizedMemorySection[] = [];

    if (d.summary?.trim()) {
      sections.push({
        key: 'summary',
        title: `${d.checkInName ?? 'Standup'} report — ${d.teamName}`,
        text: `Summary:\n${d.summary.trim()}`,
      });
    }

    const themesText = jsonListText(d.themes, 'Themes');
    if (themesText) {
      sections.push({ key: 'themes', title: 'Themes', text: themesText });
    }

    const blockersText = jsonListText(d.blockers, 'Blockers');
    if (blockersText) {
      sections.push({
        key: 'blockers',
        title: 'Report blockers',
        text: blockersText,
      });
    }

    const sectionObj =
      d.reportSections &&
      typeof d.reportSections === 'object' &&
      !Array.isArray(d.reportSections)
        ? (d.reportSections as Record<string, unknown>)
        : null;

    if (sectionObj) {
      for (const [key, value] of Object.entries(sectionObj)) {
        if (
          key === 'generationError' ||
          key === 'runStats' ||
          key === 'participantProfiles' ||
          key === 'statistics'
        ) {
          continue;
        }
        const text = sectionValueToText(key, value);
        if (text) {
          sections.push({
            key: `section:${key}`,
            title: humanizeKey(key),
            text,
          });
        }
      }
    }

    // Prefer structured sections; fall back to slackReportText only if thin.
    if (sections.length === 0 && d.slackReportText?.trim()) {
      sections.push({
        key: 'slack_report',
        title: `${d.checkInName ?? 'Standup'} Slack report`,
        text: d.slackReportText.trim(),
      });
    }

    const title = `${d.checkInName ?? 'Standup'} report — ${d.teamName}`;
    return {
      workspaceId: loaded.workspaceId,
      sourceType: MEMORY_SOURCE.REPORT,
      sourceId: d.id,
      title,
      text: sections.map((s) => s.text).join('\n\n'),
      ownerUserId: null,
      teamId: d.teamId,
      linkedIssueKey: null,
      visibility: MemoryVisibility.TEAM,
      metadata: {
        runId: d.runId,
        digestSource: d.source,
        generatedAt: d.generatedAt.toISOString(),
        teamName: d.teamName,
      },
      sections,
    };
  }
}

function humanizeKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]+/g, ' ')
    .replace(/^\s+/, '')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function jsonListText(value: Prisma.JsonValue, label: string): string | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const lines = value.map((item, i) => {
      if (typeof item === 'string') return `- ${item}`;
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const summary =
          (typeof obj.text === 'string' && obj.text) ||
          (typeof obj.summary === 'string' && obj.summary) ||
          (typeof obj.title === 'string' && obj.title) ||
          (typeof obj.name === 'string' && obj.name) ||
          JSON.stringify(item);
        return `- ${summary}`;
      }
      return `- ${String(item)}`;
    });
    return `${label}:\n${lines.join('\n')}`;
  }
  if (typeof value === 'string' && value.trim()) {
    return `${label}:\n${value.trim()}`;
  }
  return null;
}

function sectionValueToText(key: string, value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const t = value.trim();
    return t ? `${humanizeKey(key)}:\n${t}` : null;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const lines = value.map((item) => {
      if (typeof item === 'string') return `- ${item}`;
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const label =
          (typeof obj.text === 'string' && obj.text) ||
          (typeof obj.summary === 'string' && obj.summary) ||
          (typeof obj.title === 'string' && obj.title) ||
          JSON.stringify(item);
        return `- ${label}`;
      }
      return `- ${String(item)}`;
    });
    return `${humanizeKey(key)}:\n${lines.join('\n')}`;
  }
  if (typeof value === 'object') {
    return `${humanizeKey(key)}:\n${JSON.stringify(value)}`;
  }
  return `${humanizeKey(key)}: ${String(value)}`;
}
