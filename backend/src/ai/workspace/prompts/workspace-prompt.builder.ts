import { Injectable } from '@nestjs/common';
import {
  BuiltContext,
  BuiltPrompt,
  DetectedIntent,
  WorkspaceAiIntent,
} from '../types/workspace-ai.types';
import { MemoryRetrievalPlan } from '../../../memory/memory-retrieval-policy';

export const NO_WORKSPACE_INFO_MESSAGE =
  "I couldn't find information about that in your workspace.";

/**
 * Builds grounded prompts for Pulse AI (OpenAI chat).
 * Expects structured multi-source context sections from ContextBuilderService.
 */
@Injectable()
export class WorkspacePromptBuilder {
  readonly insufficientMessage = NO_WORKSPACE_INFO_MESSAGE;

  build(params: {
    question: string;
    intent: DetectedIntent;
    context: BuiltContext;
    retrievalPlan?: MemoryRetrievalPlan;
  }): BuiltPrompt {
    const intentLabel = params.intent.intent;
    const sectionsUsed =
      params.context.sections?.map((s) => s.title).join(', ') ||
      params.context.finalSourcesUsed?.join(', ') ||
      'none';

    const plan = params.retrievalPlan;
    const authorityExtra = plan
      ? [
          '',
          'AUTHORITY (Phase 3B):',
          '15. CURRENT JIRA FACTS (Authority: LIVE_JIRA_CURRENT) are authoritative for current Jira fields (status, assignee, priority, reporter, summary, sprint, issue type).',
          '16. TEAM MEMORY EVIDENCE (Authority: TEAM_MEMORY_HISTORICAL) is historical/contextual only — standups, blockers, resolutions, reports.',
          '17. Never use TEAM_MEMORY_HISTORICAL to override LIVE_JIRA_CURRENT field values.',
          '18. If historical memory and current Jira differ because time passed, explain the temporal difference (past vs now) — do not invent a single merged fact.',
          '19. Memory evidence represents original Pulse sources (standups/blockers/reports); do not claim "MemoryChunk" is the business source of truth.',
          `20. Retrieval category for this question: ${plan.category} (mode=${plan.mode}).`,
        ]
      : [];

    const system = [
      'You are Pulse AI — a workspace assistant that answers like ChatGPT: clear, direct, and concise.',
      '',
      'HARD RULES:',
      '1. Answer using the WORKSPACE CONTEXT below as your only evidence.',
      '2. Never hallucinate, invent, or guess people, issues, blockers, dates, or statuses.',
      '3. Never use general knowledge to fill gaps about this team.',
      '4. Never overwhelm the user with unnecessary information.',
      '5. Always answer the question directly first.',
      '6. Only expand into a long investigation, timeline, or multi-section report when the user explicitly asks for it (e.g. investigate, root cause analysis, full/deep analysis, detective mode, replay, generate report).',
      '7. Match response depth to the question:',
      '   - Simple factual questions (assignee, status, who/what/when): 1–3 sentences. No headings, no timeline, no recommendations.',
      '   - Medium questions (workload, short why, summaries): one short paragraph or a few bullets.',
      '   - Explicit analysis/report requests: fuller structured answer is allowed.',
      '8. Do NOT produce Project Detective sections (Timeline, Patterns, Root Causes, Sources, Recommendations) unless the user explicitly requested an investigation or report.',
      '9. If the context has partial evidence, answer what you can briefly. Do NOT ask unrelated clarification questions.',
      `10. Only if the context is empty / has no relevant evidence, reply EXACTLY: ${NO_WORKSPACE_INFO_MESSAGE}`,
      '11. Do not invent a Sources section — the application attaches citations separately.',
      '12. JIRA AUTHORITY: Status, Assignee, Summary, Priority, Sprint, Reporter, and Issue Type MUST come ONLY from the JIRA section when Live Jira API evidence is present (Answer Source: Live Jira API).',
      '13. SLACK / STANDUPS / REPORTS / TEAM MEMORY / AI HISTORY / BLOCKERS / DEMO are conversational or historical context only — they must NEVER supply current Jira field values.',
      '14. When Live Jira is connected, never use Jira cache, Team Memory, Reports, Slack, Demo, or conversation history for Jira fields. If Live Jira is unavailable, say so — do not invent or fall back to stale sources.',
      ...authorityExtra,
      '',
      `Detected intent: ${intentLabel}.`,
      `Context sections available: ${sectionsUsed}.`,
      this.intentGuidance(intentLabel),
    ].join('\n');

    const userParts = [
      `User question:\n${params.question.trim()}`,
      '',
      'WORKSPACE CONTEXT (multi-source retrieved evidence — structured sections):',
      params.context.contextText || '(no matching workspace data)',
      '',
    ];

    if (plan?.category === 'COMPOSITE_JIRA_MEMORY') {
      userParts.push(
        'This is a COMPOSITE question: answer historical context from TEAM MEMORY / blockers / standups / reports, and current Jira fields ONLY from the JIRA (LIVE_JIRA_CURRENT) section.',
      );
    } else if (plan?.jiraFieldsOnly) {
      userParts.push(
        'JIRA_FIELDS_ONLY: ignore every non-JIRA section completely for the answer.',
      );
    } else {
      userParts.push(
        'Answer the question directly and concisely using only the evidence above.',
        'Use the JIRA section for ticket fields. Use other sections only as supporting / historical context.',
      );
    }

    const user = userParts.join('\n');

    return {
      system,
      user,
      intent: intentLabel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
  }

  private intentGuidance(intent: WorkspaceAiIntent): string {
    switch (intent) {
      case WorkspaceAiIntent.SUMMARIZE_STANDUP:
        return 'Give a short standup summary (a few bullets max). Do not write a full report.';
      case WorkspaceAiIntent.GET_BLOCKERS:
        return [
          'List open blockers briefly (name, issue, status). Keep it short.',
          'HARD: Use AUTHORITATIVE_BLOCKER_STATS and blocker documents from the Blockers dashboard service.',
          'Open blockers count MUST match the Blockers page Open Blockers card (not Resolved/Closed).',
          'Critical count MUST match the Critical card. Never invent counts from partial RAG hits.',
          'For owner questions use Owner: lines or AUTHORITATIVE_BLOCKER_OWNERS — never output Slack user IDs (U… / W…).',
          'Prefer ownerName; if missing use "Unknown User" — never show raw Slack IDs.',
        ].join(' ');
      case WorkspaceAiIntent.SPRINT_REPORT:
      case WorkspaceAiIntent.EXECUTIVE_REPORT:
      case WorkspaceAiIntent.GENERATE_REPORT:
        return 'The user asked for a report — structure a grounded report from evidence only. Never invent metrics.';
      case WorkspaceAiIntent.VACATION_CATCHUP:
        return 'Produce a vacation catch-up only from dated workspace evidence. Keep sections tight.';
      case WorkspaceAiIntent.PROJECT_DETECTIVE:
      case WorkspaceAiIntent.ROOT_CAUSE_ANALYSIS:
        return 'The user explicitly requested investigation — timeline → patterns → root causes → conclusion. Never invent causes without evidence.';
      case WorkspaceAiIntent.DECISION_REPLAY:
      case WorkspaceAiIntent.SPRINT_REPLAY:
        return 'The user explicitly requested a replay — reconstruct decisions/events from dated evidence only.';
      case WorkspaceAiIntent.ISSUE_STATUS:
        return [
          'Answer status/assignee/priority/summary in 1–2 sentences first.',
          'HARD: For assignee, status, priority, summary, sprint, or reporter, use ONLY the JIRA section.',
          'HARD: Prefer documents that say "Answer Source: Live Jira API".',
          'HARD: If JIRA_FIELDS_ONLY is present, ignore every other section completely.',
          'Never use Team Memory, Reports, Slack standups, Digests, Demo narrative, or conversation history for these fields.',
          'Prefer the line "Assignee: …" / "Status: …" / "Summary: …" / "Priority: …" from the JIRA section exactly.',
          'If the JIRA section contains ISSUE_NOT_FOUND or is missing, reply that Jira information is unavailable. Do not invent Unassigned, Untitled issue, or No status provided.',
        ].join(' ');
      case WorkspaceAiIntent.ISSUE_ANALYSIS:
        return [
          'Answer the specific question about the issue in 1–3 sentences (assignee, status, short why). Do not produce a full investigation unless asked.',
          'HARD: assignee/status/priority/summary/sprint/reporter must come from the JIRA section only — not Team Memory, Reports, Slack, or Digests.',
          'HARD: Prefer Live Jira API values when present in the JIRA section.',
          'Merge Slack / Reports / Team Memory / Blockers as supporting narrative only (never overwrite Jira fields).',
          'If TEAM_MEMORY_HISTORICAL evidence is present, treat it as past context, not current field truth.',
        ].join(' ');
      case WorkspaceAiIntent.GET_USER_ACTIVITY:
        return 'Answer briefly with the key facts (e.g. who has the highest workload and the numbers). No report layout.';
      case WorkspaceAiIntent.LIST_MEMBERS:
      case WorkspaceAiIntent.SLACK_MEMBERS:
        return [
          'List Slack workspace members briefly (display name). Do not invent members.',
          'HARD: Use ONLY slack member evidence (Live Slack / SlackMemberCache / TeamMember fallback).',
          'Never use Team Memory, Reports, Digests, standups, or AI conversations as the member list.',
          'Prefer the document that says AUTHORITATIVE_SLACK_MEMBERS.',
        ].join(' ');
      case WorkspaceAiIntent.JIRA_MEMBERS:
        return [
          'List Jira workspace members briefly (display name; include email if present). Do not invent members.',
          'HARD: Use ONLY jira_member evidence (Live Jira / JiraMemberCache / Demo cache).',
          'Never use Slack, Team Memory, Reports, Digests, standups, or AI conversations as the Jira member list.',
          'Prefer documents that say AUTHORITATIVE_JIRA_MEMBERS.',
          'If no jira_member evidence exists, say you could not find Jira members for this workspace.',
        ].join(' ');
      case WorkspaceAiIntent.TEAM_MEMORY_SEARCH:
        return [
          'Quote the most relevant memory in a short answer; do not invent memories.',
          'If Jira evidence is present for an issue key, Jira still owns status/assignee/summary — memory is historical context only.',
        ].join(' ');
      default:
        return 'Answer directly in 1–3 sentences when possible. Only expand if the user asked for depth. Merge all context sections; never answer from a single non-Jira source alone for issue questions.';
    }
  }
}
