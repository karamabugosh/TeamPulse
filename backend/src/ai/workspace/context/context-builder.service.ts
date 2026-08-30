import { Injectable, Logger } from '@nestjs/common';
import {
  BuiltContext,
  BuiltContextChunk,
  BuiltContextSection,
  ContextSectionId,
  KnowledgeDocument,
  KnowledgeEntityType,
  SourceReference,
  WorkspaceAiIntent,
  WorkspaceSearchResult,
  WorkspaceSourceType,
} from '../types/workspace-ai.types';
import {
  CONVERSATIONAL_CONTEXT_BANNER,
  sanitizeConversationalJiraFields,
} from '../retrieval/jira-authority.util';

const MAX_CONTEXT_CHARS = 14_000;
const MAX_CHUNKS = 22;
const MAX_PER_SECTION = 6;

const SECTION_ORDER: ContextSectionId[] = [
  'jira',
  'slack',
  'standups',
  'blockers',
  'reports',
  'team_memory',
  'ai_history',
  'users',
  'other',
];

const SECTION_TITLES: Record<ContextSectionId, string> = {
  jira: 'JIRA',
  slack: 'SLACK',
  standups: 'STANDUPS',
  blockers: 'BLOCKERS',
  reports: 'REPORTS',
  team_memory: 'TEAM MEMORY',
  ai_history: 'AI HISTORY',
  users: 'USERS',
  other: 'OTHER',
};

/**
 * Builds structured multi-source context for the LLM.
 * Sections: JIRA → SLACK → STANDUPS → BLOCKERS → REPORTS → TEAM MEMORY → AI HISTORY
 */
@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);

  build(params: {
    intent: WorkspaceAiIntent;
    search: WorkspaceSearchResult;
  }): BuiltContext {
    const fullBlockers = Boolean(params.search.filters.blockersFullList);
    const maxChunks = fullBlockers ? 120 : MAX_CHUNKS;
    const maxChars = fullBlockers ? 48_000 : MAX_CONTEXT_CHARS;

    const selected: KnowledgeDocument[] = [];
    for (const hit of params.search.hits) {
      if (selected.length >= maxChunks) break;
      selected.push(hit);
    }

    // Soft fill from diverse sources if ranking returned a narrow set
    if (selected.length < 4) {
      this.fillFromSources(selected, params.search);
    }

    const buckets = new Map<ContextSectionId, BuiltContextChunk[]>();
    const references: SourceReference[] = [];
    let used = 0;
    const maxPerSection = fullBlockers ? 100 : MAX_PER_SECTION;

    for (const hit of selected) {
      const sectionId = sectionForDocument(hit);
      const existing = buckets.get(sectionId) ?? [];
      if (existing.length >= maxPerSection) continue;

      const rawBody = truncate(hit.content, fullBlockers ? 2_400 : 1_800);
      const body =
        sectionId === 'jira'
          ? rawBody
          : sanitizeConversationalJiraFields(rawBody);
      const block = `[${hit.source.toUpperCase()} / ${hit.entity}] ${hit.title}\n${body}`;
      if (used + block.length > maxChars) break;

      const chunk: BuiltContextChunk = {
        id: hit.id,
        sourceType: hit.source,
        entity: hit.entity,
        title: hit.title,
        content: body,
        url: hit.url,
        reference: hit.reference,
        metadata: hit.metadata,
      };
      existing.push(chunk);
      buckets.set(sectionId, existing);
      references.push(hit.reference);
      used += block.length + 8;
    }

    const sections: BuiltContextSection[] = [];
    for (const id of SECTION_ORDER) {
      const chunks = buckets.get(id);
      if (!chunks || chunks.length === 0) continue;
      const text = formatSectionText(id, chunks);
      sections.push({
        id,
        title: SECTION_TITLES[id],
        chunks,
        text,
      });
    }

    const chunks = sections.flatMap((s) => s.chunks);
    const contextText =
      sections.length > 0
        ? sections.map((s) => s.text).join('\n\n')
        : '';

    const finalSourcesUsed = [
      ...new Set(chunks.map((c) => c.sourceType)),
    ] as WorkspaceSourceType[];

    this.logger.log(
      `Context built intent=${params.intent} sections=${sections.map((s) => s.id).join(',')} chunks=${chunks.length} sources=${finalSourcesUsed.join(',')}`,
    );

    return {
      intent: params.intent,
      chunks,
      sections,
      contextText,
      tokenEstimate: Math.ceil(contextText.length / 4),
      insufficientData: chunks.length === 0,
      references,
      finalSourcesUsed,
    };
  }

  private fillFromSources(
    selected: KnowledgeDocument[],
    search: WorkspaceSearchResult,
  ): void {
    const preferredSources: WorkspaceSourceType[] = [
      'jira',
      'slack',
      'standup_runs',
      'blockers',
      'reports',
      'team_memory',
      'ai_history',
    ];
    for (const source of preferredSources) {
      const fromSource = search.bySource[source] ?? [];
      for (const hit of fromSource) {
        if (selected.length >= MAX_CHUNKS) return;
        if (selected.some((s) => s.id === hit.id)) continue;
        selected.push(hit);
      }
    }
  }
}

function sectionForDocument(doc: KnowledgeDocument): ContextSectionId {
  if (doc.entity === 'jira_issue' || doc.entity === 'jira_audit') return 'jira';
  if (doc.entity === 'blocker' || doc.entity === 'blocker_update') {
    return 'blockers';
  }
  if (doc.entity === 'report' || doc.source === 'reports') return 'reports';
  if (doc.entity === 'team_memory' || doc.source === 'team_memory') {
    return 'team_memory';
  }
  if (doc.entity === 'ai_chat' || doc.source === 'ai_history') {
    return 'ai_history';
  }
  if (doc.entity === 'user' || doc.source === 'users') return 'users';
  if (doc.entity === 'jira_member') return 'users';
  if (
    doc.entity === 'standup_submission' ||
    doc.entity === 'standup_run' ||
    doc.entity === 'standup_thread' ||
    doc.entity === 'check_in' ||
    doc.source === 'standup_runs' ||
    doc.source === 'check_ins'
  ) {
    return 'standups';
  }
  if (doc.source === 'slack' || doc.entity === 'slack_channel') return 'slack';
  return 'other';
}

function formatSectionText(
  id: ContextSectionId,
  chunks: BuiltContextChunk[],
): string {
  const title = SECTION_TITLES[id];
  const lines: string[] = [
    '====================',
    title,
    '====================',
  ];

  if (id === 'jira') {
    for (const chunk of chunks) {
      lines.push(formatJiraChunk(chunk));
      lines.push('');
    }
  } else if (id === 'slack' || id === 'standups') {
    lines.push(CONVERSATIONAL_CONTEXT_BANNER);
    lines.push(id === 'slack' ? 'Recent Discussion' : 'Standup Evidence');
    lines.push('Relevant Messages');
    for (const chunk of chunks) {
      lines.push(`- ${chunk.title}`);
      lines.push(chunk.content);
      lines.push('');
    }
  } else if (id === 'team_memory') {
    lines.push(CONVERSATIONAL_CONTEXT_BANNER);
    lines.push('Past Blockers / Historical Context (TEAM_MEMORY_HISTORICAL)');
    lines.push(
      'These are historical/contextual claims — they must NOT override LIVE_JIRA_CURRENT fields.',
    );
    for (const chunk of chunks) {
      lines.push(`- ${chunk.title}`);
      lines.push(chunk.content);
      lines.push('');
    }
  } else if (id === 'reports') {
    lines.push(CONVERSATIONAL_CONTEXT_BANNER);
    lines.push('Weekly / Monthly Summary (may include TEAM_MEMORY_HISTORICAL report evidence)');
    for (const chunk of chunks) {
      lines.push(`- ${chunk.title}`);
      lines.push(chunk.content);
      lines.push('');
    }
  } else if (id === 'blockers') {
    lines.push(CONVERSATIONAL_CONTEXT_BANNER);
    lines.push('Current Blockers');
    lines.push('Dependencies');
    for (const chunk of chunks) {
      lines.push(`- ${chunk.title}`);
      lines.push(chunk.content);
      lines.push('');
    }
  } else if (id === 'ai_history') {
    lines.push(CONVERSATIONAL_CONTEXT_BANNER);
    lines.push('Previous Related Questions');
    for (const chunk of chunks) {
      lines.push(`- ${chunk.title}`);
      lines.push(chunk.content);
      lines.push('');
    }
  } else {
    for (const chunk of chunks) {
      lines.push(`- ${chunk.title}`);
      lines.push(chunk.content);
      lines.push('');
    }
  }

  return lines.join('\n').trim();
}

function formatJiraChunk(chunk: BuiltContextChunk): string {
  const meta = chunk.metadata ?? {};
  const authoritative =
    meta.authoritativeJiraFields === true &&
    (meta.liveRefreshed === true || meta.hasLiveJiraConnection === false);
  const status = (meta.status as string | undefined) ?? null;
  const assignee = (meta.assigneeName as string | undefined) ?? null;
  const summary = (meta.summary as string | undefined) ?? null;
  const priority = (meta.priority as string | undefined) ?? null;
  const sprint = (meta.sprint as string | undefined) ?? null;
  const reporter = (meta.reporterName as string | undefined) ?? null;
  const issueType = (meta.issueType as string | undefined) ?? null;
  const resolution = (meta.resolution as string | undefined) ?? null;
  const dueDate = (meta.dueDate as string | undefined) ?? null;
  const labels = Array.isArray(meta.labels) ? (meta.labels as string[]) : [];
  const components = Array.isArray(meta.components)
    ? (meta.components as string[])
    : [];

  if (authoritative || status || assignee || summary || priority) {
    return [
      chunk.title,
      `Summary: ${summary ?? '(not set in Jira)'}`,
      `Status: ${status ?? '(not set in Jira)'}`,
      `Assignee: ${assignee ?? '(unassigned in Jira)'}`,
      `Priority: ${priority ?? '(not set in Jira)'}`,
      reporter ? `Reporter: ${reporter}` : null,
      issueType ? `Issue Type: ${issueType}` : null,
      resolution ? `Resolution: ${resolution}` : null,
      sprint ? `Sprint/Fix Version: ${sprint}` : null,
      dueDate ? `Due Date: ${dueDate}` : null,
      labels.length ? `Labels: ${labels.join(', ')}` : null,
      components.length ? `Components: ${components.join(', ')}` : null,
      meta.liveRefreshed ? 'Source: Live Jira API' : 'Source: Jira cache (offline only)',
      chunk.content,
    ]
      .filter(Boolean)
      .join('\n');
  }

  return `${chunk.title}\n${chunk.content}`;
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/** Exported for tests — maps entity/source → prompt section. */
export function mapDocumentToSection(
  entity: KnowledgeEntityType,
  source: WorkspaceSourceType,
): ContextSectionId {
  return sectionForDocument({
    id: 't',
    workspaceId: 'w',
    source,
    entity,
    title: '',
    content: '',
    timestamp: null,
    url: null,
    reference: {
      source,
      entity,
      entityId: 't',
      timestamp: null,
      workspaceId: 'w',
      url: null,
      label: 't',
    },
  });
}
