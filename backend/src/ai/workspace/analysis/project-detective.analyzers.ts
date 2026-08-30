import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { OpenAiChatProvider } from '../providers/openai-chat.provider';
import { extractUserNameCandidates } from '../retrieval/keyword.util';
import {
  AiChatConfidence,
  GeneratedWorkspaceReport,
  ReportSection,
  WorkspaceReportType,
} from '../types/workspace-ai.types';
import {
  AnalysisContext,
  AnalysisMode,
  DetectiveFocus,
  DetectiveBundle,
  WorkspaceAnalyzer,
} from './analysis.types';
import { EvidenceCollectorService } from './evidence-collector.service';
import { TimelineBuilderService } from './timeline-builder.service';
import { PatternDetectorService } from './pattern-detector.service';

const ISSUE_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/i;

/**
 * Project Detective — explains WHY outcomes happened from workspace evidence.
 */
@Injectable()
export class ProjectDetectiveAnalyzer implements WorkspaceAnalyzer {
  readonly id = 'project_detective';
  readonly reportType = WorkspaceReportType.PROJECT_DETECTIVE;
  private readonly logger = new Logger(ProjectDetectiveAnalyzer.name);

  constructor(
    private readonly evidence: EvidenceCollectorService,
    private readonly timeline: TimelineBuilderService,
    private readonly patterns: PatternDetectorService,
    private readonly openAi: OpenAiChatProvider,
  ) {}

  matches(question: string): boolean {
    const lower = question.toLowerCase();
    if (isDecisionReplayPhrase(lower)) return false;
    return isExplicitDetectiveRequest(lower);
  }

  resolveFocus(question: string): DetectiveFocus {
    return resolveDetectiveFocus(question, 'root_cause');
  }

  async analyze(ctx: AnalysisContext): Promise<GeneratedWorkspaceReport> {
    return buildDetectiveReport({
      ctx,
      analyzerId: this.id,
      reportType: WorkspaceReportType.PROJECT_DETECTIVE,
      titlePrefix: 'Root Cause Analysis',
      evidence: this.evidence,
      timeline: this.timeline,
      patterns: this.patterns,
      openAi: this.openAi,
      logger: this.logger,
      modeOverride: ctx.focus.mode === 'timeline' ? 'timeline' : 'root_cause',
    });
  }
}

/**
 * Decision Replay — reconstructs which events/decisions shaped an outcome.
 */
@Injectable()
export class DecisionReplayAnalyzer implements WorkspaceAnalyzer {
  readonly id = 'decision_replay';
  readonly reportType = WorkspaceReportType.DECISION_REPLAY;
  private readonly logger = new Logger(DecisionReplayAnalyzer.name);

  constructor(
    private readonly evidence: EvidenceCollectorService,
    private readonly timeline: TimelineBuilderService,
    private readonly patterns: PatternDetectorService,
    private readonly openAi: OpenAiChatProvider,
  ) {}

  matches(question: string): boolean {
    return isDecisionReplayPhrase(question.toLowerCase());
  }

  resolveFocus(question: string): DetectiveFocus {
    return resolveDetectiveFocus(question, 'decision_replay');
  }

  async analyze(ctx: AnalysisContext): Promise<GeneratedWorkspaceReport> {
    return buildDetectiveReport({
      ctx,
      analyzerId: this.id,
      reportType: WorkspaceReportType.DECISION_REPLAY,
      titlePrefix: 'Decision Replay',
      evidence: this.evidence,
      timeline: this.timeline,
      patterns: this.patterns,
      openAi: this.openAi,
      logger: this.logger,
      modeOverride: 'decision_replay',
    });
  }
}

function isDecisionReplayPhrase(lower: string): boolean {
  return (
    /\breplay\b/.test(lower) ||
    /\bdecision\s+replay\b/.test(lower) ||
    /\breplay\s+sprint\b/.test(lower)
  );
}

/**
 * Full Project Detective / investigation reports only when explicitly requested.
 * Simple "why was X delayed?" stays in normal concise chat.
 */
export function isExplicitDetectiveRequest(lower: string): boolean {
  return (
    /\b(investigate|investigation)\b/.test(lower) ||
    /\broot\s*cause(s)?\b/.test(lower) ||
    /\b(full|deep)\s+analysis\b/.test(lower) ||
    /\bdetective\s+mode\b/.test(lower) ||
    /\bproject\s+detective\b/.test(lower) ||
    /\banaly[sz]e\s+why\b/.test(lower) ||
    /\banaly[sz]e\b.*\b(delay|delayed|blocker|root)\b/.test(lower) ||
    /\bexplain\s+the\s+timeline\b/.test(lower) ||
    /\bfull\s+(investigation|root\s*cause)\b/.test(lower) ||
    /\bwhat\s+went\s+wrong\b/.test(lower) ||
    /\bblocked\s+repeatedly\b/.test(lower)
  );
}

export function resolveDetectiveFocus(
  question: string,
  defaultMode: AnalysisMode,
): DetectiveFocus {
  const issueMatch = question.match(ISSUE_KEY_RE);
  const sprintMatch = question.match(/\bsprint\s*(\d+)\b/i);
  const names = extractUserNameCandidates(question).filter(
    (n) => !/^scrum-\d+$/i.test(n) && n.length > 1,
  );

  let mode: AnalysisMode = defaultMode;
  const lower = question.toLowerCase();
  if (/\btimeline\b/.test(lower)) mode = 'timeline';
  if (isDecisionReplayPhrase(lower)) mode = 'decision_replay';
  if (/\bpattern|repeatedly|keeps getting blocked\b/.test(lower)) {
    mode = mode === 'decision_replay' ? mode : 'pattern';
  }

  return {
    issueKey: issueMatch ? issueMatch[1].toUpperCase() : null,
    userQuery: names[0] ?? null,
    sprintQuery: sprintMatch ? `sprint ${sprintMatch[1]}` : null,
    keyword: null,
    mode,
  };
}

async function buildDetectiveReport(params: {
  ctx: AnalysisContext;
  analyzerId: string;
  reportType: WorkspaceReportType;
  titlePrefix: string;
  evidence: EvidenceCollectorService;
  timeline: TimelineBuilderService;
  patterns: PatternDetectorService;
  openAi: OpenAiChatProvider;
  logger: Logger;
  modeOverride: AnalysisMode;
}): Promise<GeneratedWorkspaceReport> {
  const focus: DetectiveFocus = {
    ...params.ctx.focus,
    mode: params.modeOverride,
  };

  const collected = await params.evidence.collect({
    workspaceId: params.ctx.workspaceId,
    focus,
  });

  const patternList = params.patterns.detectPatterns(collected.events);
  const rootCauses = params.patterns.proposeRootCauses({
    events: collected.events,
    patterns: patternList,
    focus,
  });
  const decisionImpacts = params.patterns.proposeDecisionImpacts({
    events: collected.events,
    patterns: patternList,
    rootCauses,
  });

  const confidence = computeConfidence(collected.events.length, patternList.length);
  const insufficient = collected.events.length < 2;

  const bundle: DetectiveBundle = {
    workspaceId: params.ctx.workspaceId,
    workspaceName: collected.workspaceName,
    focus,
    question: params.ctx.question,
    events: collected.events,
    patterns: patternList,
    rootCauses: insufficient ? [] : rootCauses,
    decisionImpacts: insufficient ? [] : decisionImpacts,
    sourcesUsed: collected.sourcesUsed,
    dataPoints: collected.events.length,
    confidence: insufficient ? 'Low' : confidence,
    insufficient,
    insufficientReason: insufficient
      ? 'There is not enough data to determine the root cause. Pulse needs more standup, Jira, blocker, or report evidence for this focus.'
      : null,
  };

  const timelineEntries = params.timeline.build(bundle.events);
  const aiConclusion = insufficient
    ? null
    : await generateConclusion({
        bundle,
        timelineEntries,
        openAi: params.openAi,
        logger: params.logger,
      });

  const subject =
    focus.issueKey ||
    focus.sprintQuery ||
    focus.userQuery ||
    'Workspace outcome';

  const sections = buildSections({
    bundle,
    timelineEntries,
    aiConclusion,
    mode: focus.mode,
  });

  const title = `${params.titlePrefix}: ${subject}`;
  const markdown = renderMarkdown({
    title,
    bundle,
    sections,
  });

  return {
    id: randomUUID(),
    reportType: params.reportType,
    title,
    generatedAt: new Date().toISOString(),
    workspaceId: bundle.workspaceId,
    workspaceName: bundle.workspaceName,
    timeRange: {
      from: bundle.events[0]?.occurredAt ?? new Date().toISOString(),
      to:
        bundle.events[bundle.events.length - 1]?.occurredAt ??
        new Date().toISOString(),
      label: focus.issueKey
        ? `Evidence window for ${focus.issueKey}`
        : focus.sprintQuery
          ? `Evidence window for ${focus.sprintQuery}`
          : 'Recent evidence window (up to 60 days)',
    },
    sections,
    markdown,
    sourcesUsed: bundle.sourcesUsed,
    confidence: bundle.confidence,
    dataPoints: bundle.dataPoints,
    explanation: [
      `${params.titlePrefix} via modular analyzer “${params.analyzerId}”.`,
      'Services used: Postgres workspace data (standups, blockers, reports, team memory, Jira cache)',
      params.openAi.isAvailable() ? ', OpenAI for conclusion phrasing only' : '',
      focus.issueKey ? ', live Jira changelog when connected' : '',
      `. Sources: ${bundle.sourcesUsed.join(', ') || 'none'}.`,
      'Conclusions are restricted to retrieved evidence; nothing was fabricated.',
    ].join(''),
    metrics: {
      analyzerId: params.analyzerId,
      focus,
      patternCount: bundle.patterns.length,
      rootCauseCount: bundle.rootCauses.length,
      eventCount: bundle.events.length,
      insufficient: bundle.insufficient,
    },
  };
}

function computeConfidence(
  eventCount: number,
  patternCount: number,
): AiChatConfidence {
  if (eventCount >= 8 && patternCount >= 2) return 'High';
  if (eventCount >= 3) return 'Medium';
  return 'Low';
}

async function generateConclusion(params: {
  bundle: DetectiveBundle;
  timelineEntries: Array<{ date: string; text: string }>;
  openAi: OpenAiChatProvider;
  logger: Logger;
}): Promise<string | null> {
  const { bundle, timelineEntries, openAi, logger } = params;
  const fallback = buildDeterministicConclusion(bundle);
  if (!openAi.isAvailable()) return fallback;

  const evidenceBlock = [
    `Question: ${bundle.question}`,
    `Focus: ${JSON.stringify(bundle.focus)}`,
    '',
    'Timeline:',
    ...timelineEntries.slice(0, 25).map((t) => `- ${t.date}: ${t.text}`),
    '',
    'Patterns:',
    ...bundle.patterns.map((p) => `- ${p.label}`),
    '',
    'Root cause candidates:',
    ...bundle.rootCauses.map(
      (c) => `- ${c.label} (${c.contribution}): ${c.rationale}`,
    ),
  ].join('\n');

  try {
    const completion = await openAi.complete({
      messages: [
        {
          role: 'system',
          content: [
            'You are Pulse Project Detective.',
            'Write 2-4 sentences concluding WHY the outcome happened.',
            'Use ONLY the provided evidence. Never invent people, dates, issues, or causes.',
            'If evidence is thin, say confidence is limited.',
            'Do not use markdown headings.',
          ].join(' '),
        },
        { role: 'user', content: evidenceBlock },
      ],
      temperature: 0.1,
      maxTokens: 280,
    });
    const text = completion.content?.trim();
    return text || fallback;
  } catch (error) {
    logger.warn(
      `Detective conclusion LLM failed: ${
        error instanceof Error ? error.message : 'unknown'
      }`,
    );
    return fallback;
  }
}

function buildDeterministicConclusion(bundle: DetectiveBundle): string {
  if (bundle.insufficient || bundle.rootCauses.length === 0) {
    return (
      bundle.insufficientReason ??
      'There is not enough data to determine the root cause.'
    );
  }
  const top = bundle.rootCauses[0];
  const subject =
    bundle.focus.issueKey ||
    bundle.focus.sprintQuery ||
    bundle.focus.userQuery ||
    'This outcome';
  return `${subject} appears driven mainly by ${top.label.toLowerCase()}. ${top.rationale} Earlier attention to the supporting evidence events could have reduced impact.`;
}

function buildSections(params: {
  bundle: DetectiveBundle;
  timelineEntries: Array<{ date: string; text: string; eventId: string }>;
  aiConclusion: string | null;
  mode: AnalysisMode;
}): ReportSection[] {
  const { bundle, timelineEntries, aiConclusion, mode } = params;

  if (bundle.insufficient) {
    return [
      {
        id: 'insufficient',
        title: 'Insufficient Evidence',
        markdown:
          bundle.insufficientReason ??
          'There is not enough data to determine the root cause.',
      },
      {
        id: 'sources',
        title: 'Sources',
        markdown: bundle.sourcesUsed.length
          ? bundle.sourcesUsed.map((s) => `- ${s}`).join('\n')
          : '- No matching sources found',
      },
    ];
  }

  const focusLines = [
    bundle.focus.issueKey ? `- Issue: **${bundle.focus.issueKey}**` : null,
    bundle.focus.userQuery ? `- Person: **${bundle.focus.userQuery}**` : null,
    bundle.focus.sprintQuery ? `- Sprint: **${bundle.focus.sprintQuery}**` : null,
    `- Mode: **${mode}**`,
  ].filter(Boolean);

  const sections: ReportSection[] = [
    {
      id: 'focus',
      title: 'Focus',
      markdown: focusLines.join('\n'),
    },
    {
      id: 'timeline',
      title: 'Timeline',
      markdown: timelineEntries.length
        ? timelineEntries.map((t) => `- ${t.date} — ${t.text}`).join('\n')
        : '- No dated events found',
    },
    {
      id: 'patterns',
      title: 'Detected Patterns',
      markdown: bundle.patterns.length
        ? bundle.patterns.map((p) => `- ${p.label}`).join('\n')
        : '- No repeated patterns detected from the available evidence',
    },
  ];

  if (mode === 'decision_replay') {
    sections.push({
      id: 'decisions',
      title: 'Decisions That Affected The Outcome',
      markdown: bundle.decisionImpacts.length
        ? bundle.decisionImpacts
            .map((d) => `- **${d.label}** — ${d.rationale}`)
            .join('\n')
        : '- No decision impacts could be isolated from evidence',
    });
  } else {
    sections.push({
      id: 'root_causes',
      title: 'Root Causes',
      markdown: bundle.rootCauses.length
        ? bundle.rootCauses
            .map(
              (c) =>
                `- **${c.label}** (${c.contribution}) — ${c.rationale}`,
            )
            .join('\n')
        : '- No root causes could be isolated from evidence',
    });
  }

  sections.push({
    id: 'ai_conclusion',
    title: 'AI Conclusion',
    markdown:
      aiConclusion ??
      'There is not enough data to determine the root cause.',
  });

  sections.push({
    id: 'confidence',
    title: 'Confidence',
    markdown: `- **${bundle.confidence}**\n- Evidence events: ${bundle.dataPoints}`,
  });

  sections.push({
    id: 'sources',
    title: 'Sources',
    markdown: bundle.sourcesUsed.map((s) => `- ${s}`).join('\n'),
  });

  return sections;
}

function renderMarkdown(params: {
  title: string;
  bundle: DetectiveBundle;
  sections: ReportSection[];
}): string {
  const header = [
    `# ${params.title}`,
    '',
    `- Workspace: **${params.bundle.workspaceName}**`,
    `- Confidence: **${params.bundle.confidence}**`,
    `- Sources: ${params.bundle.sourcesUsed.map((s) => `**${s}**`).join(', ') || '_none_'}`,
    '',
  ];
  const body = params.sections
    .map((section) => `## ${section.title}\n\n${section.markdown}`)
    .join('\n\n');
  return `${header.join('\n')}${body}\n`;
}
