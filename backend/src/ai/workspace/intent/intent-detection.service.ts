import { Injectable } from '@nestjs/common';
import {
  DetectedIntent,
  WorkspaceAiIntent,
  WorkspaceReportType,
  WorkspaceSearchFilters,
} from '../types/workspace-ai.types';
import { extractUserNameCandidates } from '../retrieval/keyword.util';
import {
  extractAssigneeFromQuestion,
  isAssigneeListQuestion,
} from '../retrieval/assignee-match.util';
import { detectTemporalRetrievalScope } from '../retrieval/temporal-retrieval.util';
import { isExplicitDetectiveRequest } from '../analysis/project-detective.analyzers';

/**
 * Improved rule-based intent classification for RAG routing.
 * Distinguishes status lookups, detective / root-cause, replays,
 * executive reports, vacation, and member questions before retrieval.
 */
@Injectable()
export class IntentDetectionService {
  detect(
    question: string,
    _priorIntent?: WorkspaceAiIntent | null,
  ): DetectedIntent {
    void _priorIntent;
    const text = question.trim();
    const lower = text.toLowerCase();
    const filters = this.extractFilters(text);

    // Hard overrides — highest priority, evaluated before soft scoring.
    if (isExplicitDetectiveRequest(lower) || /\broot\s*cause\b/.test(lower)) {
      const rootCauseOnly =
        /\broot\s*cause\b/.test(lower) && !/\bproject\s+detective\b/.test(lower);
      return {
        intent: rootCauseOnly
          ? WorkspaceAiIntent.ROOT_CAUSE_ANALYSIS
          : WorkspaceAiIntent.PROJECT_DETECTIVE,
        confidence: 0.92,
        filters,
        rationale: rootCauseOnly
          ? 'Explicit root-cause analysis request'
          : 'Explicit investigation / Project Detective request',
      };
    }

    if (isCatchUpIntent(lower)) {
      const sinceDate = extractSinceDateFromText(text);
      if (sinceDate) {
        filters.dateFrom = startOfDay(sinceDate);
        filters.dateTo = endOfDay(new Date());
      }
      return {
        intent: WorkspaceAiIntent.VACATION_CATCHUP,
        confidence: 0.94,
        filters,
        rationale: 'Explicit workspace catch-up / vacation / since-date summary request',
      };
    }

    if (/\bsprint\s+replay\b|\breplay\s+sprint\b/.test(lower)) {
      return {
        intent: WorkspaceAiIntent.SPRINT_REPLAY,
        confidence: 0.92,
        filters,
        rationale: 'Explicit sprint replay request',
      };
    }

    if (/\breplay\b|\bdecision\s+replay\b/.test(lower)) {
      return {
        intent: WorkspaceAiIntent.DECISION_REPLAY,
        confidence: 0.9,
        filters,
        rationale: 'Explicit decision replay request',
      };
    }

    if (/\bexecutive\s+report\b|\bgenerate\s+executive\b/.test(lower)) {
      filters.reportType = WorkspaceReportType.EXECUTIVE;
      return {
        intent: WorkspaceAiIntent.EXECUTIVE_REPORT,
        confidence: 0.9,
        filters,
        rationale: 'Explicit executive report request',
      };
    }

    // Jira member directory — hard override before Slack member scoring
    if (isJiraMembersQuestion(lower)) {
      filters.jiraMembersOnly = true;
      filters.slackMembersOnly = false;
      return {
        intent: WorkspaceAiIntent.JIRA_MEMBERS,
        confidence: 0.95,
        filters,
        rationale: 'Asks for Jira / Atlassian workspace members',
      };
    }

    // Slack member directory — explicit Slack / generic team roster
    if (isSlackMembersQuestion(lower)) {
      filters.slackMembersOnly = true;
      return {
        intent: WorkspaceAiIntent.SLACK_MEMBERS,
        confidence: 0.93,
        filters,
        rationale: 'Asks for Slack / workspace members',
      };
    }

    const scored: Array<{
      intent: WorkspaceAiIntent;
      score: number;
      rationale: string;
    }> = [
      {
        intent: WorkspaceAiIntent.GET_BLOCKERS,
        score: scoreMatch(lower, [
          'blocker',
          'blockers',
          'blocked',
          'blocking',
          'who is blocked',
          'open blockers',
          'what blockers',
          'blockers affected',
          'waiting on',
          'dependency',
          'stuck',
          'impediment',
          'how was the blocker',
          'blocker resolved',
          'blocker resolution',
        ]) + (filters.issueKey && /\b(blocker|blockers|blocked|blocking|impediment)\b/i.test(lower) ? 4 : 0),
        rationale: 'Mentions blockers / blocked status',
      },
      {
        intent: WorkspaceAiIntent.JIRA_MEMBERS,
        score: scoreMatch(lower, [
          'jira members',
          'jira users',
          'jira workspace members',
          'atlassian members',
          'atlassian users',
          'project members',
          'who has access to jira',
          'list jira',
          'members in jira',
          'users in jira',
        ]),
        rationale: 'Asks for Jira members',
      },
      {
        intent: WorkspaceAiIntent.SLACK_MEMBERS,
        score: scoreMatch(lower, [
          'members',
          'member list',
          'who are the members',
          'who are the slack members',
          'slack members',
          'slack users',
          'list slack users',
          'list slack members',
          'show workspace members',
          'team members',
          'who is on the team',
          'who is in slack',
          'who is in the slack',
          'who is in this slack',
          'list users',
          'list members',
          'workspace members',
        ]),
        rationale: 'Asks for Slack / workspace members',
      },
      {
        intent: WorkspaceAiIntent.GET_USER_ACTIVITY,
        score:
          scoreMatch(lower, [
            'who worked',
            'who did',
            'user activity',
            'what did',
            'activity of',
            'worked on',
            "didn't submit",
            'did not submit',
            'who submitted',
            'highest workload',
            'most workload',
            'busiest',
            'most tickets',
            'most issues',
            'assigned the most',
          ]) + (filters.userQuery ? 4 : 0),
        rationale: filters.userQuery
          ? `Team member question for ${filters.userQuery}`
          : 'Mentions user / member activity',
      },
      {
        intent: WorkspaceAiIntent.SUMMARIZE_STANDUP,
        score: scoreMatch(lower, [
          'standup',
          'stand-up',
          'check-in',
          'checkin',
          'summarize today',
          'summarize yesterday',
          "today's standup",
          "yesterday's standup",
        ]),
        rationale: 'Mentions standup / check-in summary',
      },
      {
        intent: WorkspaceAiIntent.VACATION_CATCHUP,
        score: scoreMatch(lower, [
          'vacation',
          'pto',
          'on leave',
          'catch me up',
          'catch-up',
          'catch up',
          'what did i miss',
          'while i was away',
          'while i was on vacation',
          'what happened while',
          'what changed since',
          'summarize what happened while',
          'summarize everything since',
          'summarize since',
          'give me an update',
          'bring me up to speed',
          'welcome back',
          'absent',
          'absence',
          'vacation summary',
        ]),
        rationale: 'Asks for a vacation / absence catch-up report',
      },
      {
        intent: WorkspaceAiIntent.EXECUTIVE_REPORT,
        score: scoreMatch(lower, [
          'executive report',
          'generate executive',
          'exec summary',
          'leadership report',
          'management summary',
        ]),
        rationale: 'Asks for an executive report',
      },
      {
        intent: WorkspaceAiIntent.GENERATE_REPORT,
        score: scoreMatch(lower, [
          'generate report',
          'generate today',
          "generate today's report",
          'generate daily',
          'generate weekly',
          'generate sprint',
          'generate blocker',
          'generate jira',
          'generate my report',
          'daily report',
          'weekly report',
          'blocker report',
          'jira report',
          'my report',
          "today's report",
        ]),
        rationale: 'Asks to generate a workspace report',
      },
      {
        intent: WorkspaceAiIntent.SPRINT_REPORT,
        score: scoreMatch(lower, [
          'sprint report',
          'sprint summary',
          'generate sprint',
        ]),
        rationale: 'Explicitly asks for a sprint report',
      },
      {
        intent: WorkspaceAiIntent.ISSUE_STATUS,
        score:
          scoreMatch(lower, [
            'status of',
            'status for',
            'current status',
            'what is the status',
            'jira status',
            'who owns',
            'who is assigned',
            'who is working on',
            'assigned to',
            'assignee',
            'priority of',
            'what is the priority',
            'priority for',
            'summary of',
            'what is the summary',
            'reporter of',
            'who reported',
            'sprint of',
            'which sprint',
            'jira ticket',
          ]) +
          // Issue key alone must not outrank blocker/narrative questions.
          (filters.issueKey && !hasHistoricalNarrativeSignal(lower) ? 6 : 0),
        rationale: filters.issueKey
          ? `Issue field lookup for ${filters.issueKey}`
          : 'Asks for issue status / assignee / priority',
      },
      {
        intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
        score:
          scoreMatch(lower, [
            'why was',
            'why is',
            'why did',
            'delayed',
            'what happened to',
            'resolved',
            'resolution',
            'affected',
          ]) +
          (filters.issueKey ? 4 : 0) +
          (filters.issueKey && hasHistoricalNarrativeSignal(lower) ? 3 : 0),
        rationale: filters.issueKey
          ? `Short issue analysis for ${filters.issueKey}`
          : 'Short issue / delay question',
      },
      {
        intent: WorkspaceAiIntent.TEAM_MEMORY_SEARCH,
        score: scoreMatch(lower, [
          'team memory',
          'search memory',
          'remember',
          'from memory',
          'indexed',
          'discussed about',
          'conversations about',
          'find conversations',
          'architectural decision',
          'architecture decision',
          'architecture decisions',
          'architectural decisions',
          'what decisions',
          'design decision',
        ]),
        rationale: 'Mentions team memory search',
      },
    ];

    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];

    if (!top || top.score < 2) {
      // Issue key alone → status lookup, not detective.
      // Narrative / blocker wording with an issue key → analysis, not field-only.
      if (filters.issueKey) {
        if (hasHistoricalNarrativeSignal(lower)) {
          return {
            intent: WorkspaceAiIntent.ISSUE_ANALYSIS,
            confidence: 0.62,
            filters,
            rationale: `Issue key ${filters.issueKey} with historical / blocker narrative language`,
          };
        }
        return {
          intent: WorkspaceAiIntent.ISSUE_STATUS,
          confidence: 0.55,
          filters,
          rationale: `Issue key ${filters.issueKey} without investigation language — status lookup`,
        };
      }
      if (filters.userQuery) {
        return {
          intent: WorkspaceAiIntent.GET_USER_ACTIVITY,
          confidence: 0.5,
          filters,
          rationale: `Team member question for ${filters.userQuery}`,
        };
      }
      return {
        intent: WorkspaceAiIntent.GENERAL_QA,
        confidence: 0.35,
        filters,
        rationale: 'No strong intent match — general workspace QA',
      };
    }

    return {
      intent: top.intent,
      confidence: Math.min(0.95, 0.4 + top.score * 0.07),
      filters,
      rationale: top.rationale,
    };
  }

  private extractFilters(question: string): WorkspaceSearchFilters {
    const filters: WorkspaceSearchFilters = {
      keyword: null,
    };

    const issueMatch = question.match(/\b([A-Z][A-Z0-9]+-\d+)\b/i);
    if (issueMatch) {
      filters.issueKey = issueMatch[1].toUpperCase();
    }

    const sprintMatch = question.match(/\bsprint\s*(\d+)\b/i);
    if (sprintMatch) {
      filters.sprintQuery = `sprint ${sprintMatch[1]}`;
    }

    const nameCandidates = extractUserNameCandidates(question);
    if (nameCandidates.length > 0) {
      filters.userQuery = nameCandidates[0];
    }

    if (isAssigneeListQuestion(question)) {
      filters.jiraAssigneeList = true;
      filters.assigneeQuery =
        extractAssigneeFromQuestion(question) ?? filters.userQuery ?? null;
      if (filters.assigneeQuery) {
        filters.userQuery = filters.assigneeQuery;
      }
    }

    const temporalScope = detectTemporalRetrievalScope(question);
    if (temporalScope) {
      filters.temporalScope = temporalScope;
    }

    const lower = question.toLowerCase();
    if (/\b(blocker report|generate blocker)\b/.test(lower)) {
      filters.reportType = WorkspaceReportType.BLOCKER;
    } else if (/\b(jira report|generate jira)\b/.test(lower)) {
      filters.reportType = WorkspaceReportType.JIRA;
    } else if (
      /\b(my report|personal report|generate my report)\b/.test(lower)
    ) {
      filters.reportType = WorkspaceReportType.PERSONAL;
    } else if (/\b(executive report|generate executive)\b/.test(lower)) {
      filters.reportType = WorkspaceReportType.EXECUTIVE;
    } else if (
      /\b(sprint report|sprint summary|generate sprint)\b/.test(lower)
    ) {
      filters.reportType = WorkspaceReportType.SPRINT;
    } else if (/\b(weekly report|generate weekly)\b/.test(lower)) {
      filters.reportType = WorkspaceReportType.WEEKLY;
    } else if (
      /\b(daily report|today'?s report|generate today|generate daily|daily summary)\b/.test(
        lower,
      )
    ) {
      filters.reportType = WorkspaceReportType.DAILY;
    }

    const now = new Date();
    if (/\btoday\b/.test(lower)) {
      filters.dateFrom = startOfDay(now);
      filters.dateTo = endOfDay(now);
    } else if (/\byesterday\b/.test(lower)) {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      filters.dateFrom = startOfDay(y);
      filters.dateTo = endOfDay(y);
    } else if (
      /\blast\s+7\s+days\b|\bpast\s+week\b|\bthis\s+week\b/.test(lower)
    ) {
      const from = new Date(now);
      from.setDate(from.getDate() - 7);
      filters.dateFrom = startOfDay(from);
      filters.dateTo = endOfDay(now);
    } else {
      const sinceDate = extractSinceDateFromText(question);
      if (sinceDate) {
        filters.dateFrom = startOfDay(sinceDate);
        filters.dateTo = endOfDay(now);
      }
    }

    return filters;
  }
}

/** Jira / Atlassian member directory questions. */
export function isJiraMembersQuestion(lower: string): boolean {
  const hasJira =
    /\bjira\b/.test(lower) ||
    /\batlassian\b/.test(lower) ||
    /\bproject\s+members?\b/.test(lower);
  const hasMemberPhrase =
    /\bmembers?\b/.test(lower) ||
    /\busers?\b/.test(lower) ||
    /\bwho\s+has\s+access\b/.test(lower) ||
    /\broster\b/.test(lower) ||
    /\bdirectory\b/.test(lower) ||
    /\blist\b/.test(lower) ||
    /\bshow\b/.test(lower) ||
    /\bgive\s+me\b/.test(lower) ||
    /\bwho\s+are\b/.test(lower);
  if (hasJira && hasMemberPhrase) return true;
  return (
    /\b(jira|atlassian)\s+(members?|users?)\b/.test(lower) ||
    /\b(members?|users?)\s+(in|on|from|of)\s+(jira|atlassian)\b/.test(lower) ||
    /\bwho\s+has\s+access\s+to\s+jira\b/.test(lower) ||
    /\blist\s+(jira|atlassian|project)\s+(members?|users?)\b/.test(lower) ||
    /\bshow\s+(jira|atlassian)?\s*(workspace\s+)?members?\b/.test(lower) &&
      /\bjira\b/.test(lower)
  );
}

/** Slack / generic team roster questions (not Jira). */
export function isSlackMembersQuestion(lower: string): boolean {
  if (isJiraMembersQuestion(lower)) return false;
  return (
    /\bslack\s+(members?|users?)\b/.test(lower) ||
    /\b(members?|users?)\s+(in|on|from|of)\s+slack\b/.test(lower) ||
    /\bwho\s+(is|are)\s+(in|on)\s+(the\s+)?(slack|team)\b/.test(lower) ||
    /\bwho\s+are\s+the\s+(slack\s+)?members?\b/.test(lower) ||
    /\blist\s+(slack\s+)?(members?|users?)\b/.test(lower) ||
    /\bshow\s+(workspace\s+)?members?\b/.test(lower) ||
    /\bteam\s+members?\b/.test(lower) ||
    /\bgive\s+me\s+the\s+members?\b/.test(lower) ||
    /\bmember\s+list\b/.test(lower) ||
    /\bworkspace\s+members?\b/.test(lower)
  );
}

/** Catch-up / vacation / “what did I miss” phrasing — hard-routed to VACATION_CATCHUP. */
export function isCatchUpIntent(lower: string): boolean {
  return (
    /\bcatch\s*me\s*up\b/.test(lower) ||
    /\bcatch[-\s]?up\b/.test(lower) ||
    /\bwhat did i miss\b/.test(lower) ||
    /\bwhile i was away\b/.test(lower) ||
    /\bwhile i was on (vacation|pto|leave)\b/.test(lower) ||
    /\bwhat happened while\b/.test(lower) ||
    /\bwhat changed since\b/.test(lower) ||
    /\bsummarize (everything |all )?(since|from)\b/.test(lower) ||
    /\bsummarize what happened\b/.test(lower) ||
    /\bgive me an update\b/.test(lower) ||
    /\bbring me up to speed\b/.test(lower) ||
    /\bwelcome back\b/.test(lower) ||
    /\bvacation (catch[-\s]?up|summary|report)\b/.test(lower) ||
    (/\bon (vacation|pto|leave)\b/.test(lower) &&
      /\b(catch|miss|away|happened|update|summarize)\b/.test(lower))
  );
}

function extractSinceDateFromText(text: string): Date | null {
  const sinceMatch = text.match(
    /\b(?:since|from|after|starting(?:\s+from)?)\s+([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i,
  );
  if (!sinceMatch) return null;
  return parseIntentFlexibleDate(sinceMatch[1]);
}

function parseIntentFlexibleDate(raw: string): Date | null {
  const value = raw.trim();
  const year = new Date().getFullYear();
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

function scoreMatch(text: string, phrases: string[]): number {
  let score = 0;
  for (const phrase of phrases) {
    if (text.includes(phrase)) {
      score += phrase.includes(' ') ? 4 : 3;
    }
  }
  return score;
}

/** Shared with jira-field / memory policy — historical Team Memory questions. */
function hasHistoricalNarrativeSignal(lower: string): boolean {
  return /\b(why|what\s+happened|root\s+cause|delayed|delay|blocked|blocker|blockers|blocking|timeline|history|previous|before|after|discuss|conversation|standup|report|memory|investigate|detective|resolved|resolution|affected|prevented|dependency|impediment)\b/i.test(
    lower,
  );
}

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
