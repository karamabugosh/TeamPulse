/**
 * Export completed check-in (standup) runs with every participant answer as CSV.
 *
 * Usage (from backend/):
 *   npm run export:checkin-runs
 *   npx ts-node scripts/export-checkin-runs.ts
 *
 * Writes: backend/exports/checkin-runs.csv
 *
 * Queries PostgreSQL via Prisma only — no mocks, no HTTP APIs.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { config as loadEnv } from 'dotenv';
import { PrismaClient, QuestionType } from '@prisma/client';
import { resolveBackendEnvPath } from '../src/config/env.config';
import {
  enrichAnswerForAnalysis,
  parseYesNoChoice,
} from '../src/common/question-semantics';
import {
  formatAnswerForDisplay,
  readSnapshotFromStructuredValue,
} from '../src/jira/jira-issue-ref.types';
import { memberDisplayLabel } from '../src/common/slack-member.util';

// ---------------------------------------------------------------------------
// Bootstrap: load DATABASE_URL from the backend .env, then open Prisma.
// ---------------------------------------------------------------------------
loadEnv({ path: resolveBackendEnvPath() });

const prisma = new PrismaClient();
const OUTPUT_PATH = join(__dirname, '..', 'exports', 'checkin-runs.csv');

/** Human-readable CSV column order (matches product export requirements). */
const HEADERS = [
  'Workspace Name',
  'Team Name',
  'CheckIn Name',
  'Run ID',
  'Run Date',
  'Run Status',
  'Participant Name',
  'Participant Email',
  'Slack User ID',
  'Slack Display Name',
  'Question',
  'Answer',
  'Jira Issue Key',
  'Jira Issue Summary',
  'Is Blocked',
  'Blocker Description',
  'Blocker Severity',
  'Reported At',
  'Submitted At',
] as const;

type CsvRow = Record<(typeof HEADERS)[number], string>;

type PulseBlockerRow = {
  id: string;
  runId: string | null;
  submissionId: string | null;
  answerId: string | null;
  description: string;
  severity: string;
  status: string;
  createdAt: Date;
};

// ---------------------------------------------------------------------------
// CSV helpers — never throw on null/undefined; always return strings.
// ---------------------------------------------------------------------------

function safe(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function escapeCsv(value: string): string {
  const text = value ?? '';
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '';
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  } catch {
    return '';
  }
}

function rowToLine(row: CsvRow): string {
  return HEADERS.map((header) => escapeCsv(row[header] ?? '')).join(',');
}

// ---------------------------------------------------------------------------
// Answer / Jira / blocker resolution (FK-resolved, human-readable).
// ---------------------------------------------------------------------------

function displayAnswerText(answer: {
  text?: string | null;
  structuredValue?: unknown;
  question?: { question?: string | null; type?: QuestionType | null } | null;
}): string {
  const text = safe(answer?.text);
  const display = formatAnswerForDisplay({
    text,
    structuredValue: answer?.structuredValue,
  });
  try {
    const enriched = enrichAnswerForAnalysis({
      questionText: answer?.question?.question ?? '',
      questionType: answer?.question?.type ?? QuestionType.FREE_TEXT,
      text: display,
      structuredValue: answer?.structuredValue,
    });
    return (enriched?.formattedAnswer?.trim() || display || text)
      .replace(/\r?\n/g, ' ')
      .trim();
  } catch {
    return (display || text).replace(/\r?\n/g, ' ').trim();
  }
}

function resolveJiraFromAnswer(answer: {
  text?: string | null;
  structuredValue?: unknown;
  jiraIssueLinks?: Array<{
    issueKey?: string | null;
    summary?: string | null;
  }> | null;
}): { key: string; summary: string } {
  const links = answer?.jiraIssueLinks ?? [];
  const firstLink = links.find((link) => link?.issueKey?.trim());
  if (firstLink?.issueKey?.trim()) {
    return {
      key: firstLink.issueKey.trim().toUpperCase(),
      summary: safe(firstLink.summary).trim(),
    };
  }

  const snapshot = readSnapshotFromStructuredValue(answer?.structuredValue);
  if (snapshot?.issueKey) {
    return {
      key: snapshot.issueKey.trim().toUpperCase(),
      summary: safe(snapshot.summary).trim(),
    };
  }

  return { key: '', summary: '' };
}

function isBlockerQuestion(question: {
  type?: QuestionType | null;
  question?: string | null;
} | null | undefined): boolean {
  if (!question) return false;
  if (question.type === QuestionType.BLOCKER) return true;
  return /\bblock(ed|ers?|ing)?\b/i.test(question.question ?? '');
}

/**
 * Prefer PulseBlocker rows linked to the answer/submission; fall back to
 * yes/no semantics on BLOCKER-type questions.
 */
function resolveBlockerFields(params: {
  answer: {
    id?: string | null;
    text?: string | null;
    structuredValue?: unknown;
    question?: { question?: string | null; type?: QuestionType | null } | null;
  };
  submissionId: string;
  blockersByAnswerId: Map<string, PulseBlockerRow>;
  blockersBySubmissionId: Map<string, PulseBlockerRow[]>;
}): {
  isBlocked: string;
  description: string;
  severity: string;
} {
  const answerId = params.answer?.id?.trim() ?? '';
  const linked =
    (answerId ? params.blockersByAnswerId.get(answerId) : undefined) ??
    (params.blockersBySubmissionId.get(params.submissionId) ?? []).find(
      (b) => b.answerId === answerId || !b.answerId,
    );

  if (linked) {
    const open = (linked.status ?? '').toLowerCase() !== 'resolved';
    return {
      isBlocked: open ? 'Yes' : 'No',
      description: safe(linked.description).replace(/\r?\n/g, ' ').trim(),
      severity: safe(linked.severity).trim(),
    };
  }

  if (!isBlockerQuestion(params.answer?.question)) {
    return { isBlocked: '', description: '', severity: '' };
  }

  const choice = parseYesNoChoice({
    type: params.answer?.question?.type ?? QuestionType.FREE_TEXT,
    text: params.answer?.text ?? '',
    structuredValue: params.answer?.structuredValue,
  });

  if (choice === 'no') {
    return { isBlocked: 'No', description: '', severity: '' };
  }
  if (choice === 'yes') {
    const text = displayAnswerText(params.answer);
    return {
      isBlocked: 'Yes',
      description:
        text && !/^(yes|y|🔴\s*yes)$/i.test(text) ? text : 'Reported a blocker',
      severity: '',
    };
  }

  const text = displayAnswerText(params.answer);
  if (!text) return { isBlocked: '', description: '', severity: '' };
  return { isBlocked: 'Yes', description: text, severity: '' };
}

// ---------------------------------------------------------------------------
// Index PulseBlocker rows (no Prisma relation on submission/answer FKs).
// ---------------------------------------------------------------------------

function indexBlockers(blockers: PulseBlockerRow[]): {
  byAnswerId: Map<string, PulseBlockerRow>;
  bySubmissionId: Map<string, PulseBlockerRow[]>;
} {
  const byAnswerId = new Map<string, PulseBlockerRow>();
  const bySubmissionId = new Map<string, PulseBlockerRow[]>();

  for (const blocker of blockers ?? []) {
    const answerId = blocker?.answerId?.trim();
    if (answerId && !byAnswerId.has(answerId)) {
      byAnswerId.set(answerId, blocker);
    }
    const submissionId = blocker?.submissionId?.trim();
    if (submissionId) {
      const list = bySubmissionId.get(submissionId) ?? [];
      list.push(blocker);
      bySubmissionId.set(submissionId, list);
    }
  }

  return { byAnswerId, bySubmissionId };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // 1) Load all completed standup runs with related workspace/team/check-in,
  //    submissions, users, answers, questions, and Jira issue links in one query.
  const runs = await prisma.standupRun.findMany({
    where: { status: 'completed' },
    orderBy: [{ scheduledFor: 'desc' }, { startedAt: 'desc' }],
    include: {
      team: {
        select: {
          name: true,
          workspace: {
            select: { slackWorkspaceName: true },
          },
        },
      },
      checkIn: {
        select: { name: true },
      },
      submissions: {
        orderBy: [{ completedAt: 'asc' }, { createdAt: 'asc' }],
        include: {
          user: {
            select: {
              email: true,
              slackUserId: true,
              slackDisplayName: true,
              slackRealName: true,
            },
          },
          answers: {
            orderBy: { createdAt: 'asc' },
            include: {
              question: {
                select: {
                  question: true,
                  type: true,
                  order: true,
                },
              },
              jiraIssueLinks: {
                select: {
                  issueKey: true,
                  summary: true,
                },
                orderBy: { createdAt: 'asc' },
              },
            },
          },
        },
      },
    },
  });

  // 2) Batch-load PulseBlocker rows for these runs (plain FK fields, no relation).
  const runIds = runs.map((run) => run.id).filter(Boolean);
  const blockers =
    runIds.length === 0
      ? []
      : await prisma.pulseBlocker.findMany({
          where: { runId: { in: runIds } },
          select: {
            id: true,
            runId: true,
            submissionId: true,
            answerId: true,
            description: true,
            severity: true,
            status: true,
            createdAt: true,
          },
        });
  const { byAnswerId, bySubmissionId } = indexBlockers(blockers);

  // 3) Flatten runs → submissions → answers into CSV rows (one row per question).
  const rows: CsvRow[] = [];
  let submissionCount = 0;

  for (const run of runs ?? []) {
    const workspaceName = safe(run?.team?.workspace?.slackWorkspaceName).trim();
    const teamName = safe(run?.team?.name).trim();
    const checkInName = safe(run?.checkIn?.name).trim() || 'Check-in';
    const runId = safe(run?.id);
    const runDate = formatDate(run?.scheduledFor ?? run?.startedAt);
    const runStatus = safe(run?.status);

    for (const submission of run?.submissions ?? []) {
      submissionCount += 1;

      const user = submission?.user;
      const participantName = memberDisplayLabel({
        slackDisplayName: user?.slackDisplayName,
        slackRealName: user?.slackRealName,
        slackUserId: user?.slackUserId ?? 'unknown',
      });
      const email = safe(user?.email).trim();
      const slackUserId = safe(user?.slackUserId).trim();
      const slackDisplayName = safe(user?.slackDisplayName).trim();
      const submittedAt = formatDateTime(
        submission?.completedAt ?? submission?.startedAt ?? submission?.createdAt,
      );

      const answers = [...(submission?.answers ?? [])].sort(
        (a, b) => (a?.question?.order ?? 0) - (b?.question?.order ?? 0),
      );

      // Submissions with no answers still produce one empty Q/A row.
      const answerList =
        answers.length > 0
          ? answers
          : [
              {
                id: null,
                text: null,
                structuredValue: null,
                createdAt: submission?.createdAt ?? null,
                question: null,
                jiraIssueLinks: [],
              },
            ];

      for (const answer of answerList) {
        const jira = resolveJiraFromAnswer(answer);
        const blocker = resolveBlockerFields({
          answer,
          submissionId: submission?.id ?? '',
          blockersByAnswerId: byAnswerId,
          blockersBySubmissionId: bySubmissionId,
        });

        rows.push({
          'Workspace Name': workspaceName,
          'Team Name': teamName,
          'CheckIn Name': checkInName,
          'Run ID': runId,
          'Run Date': runDate,
          'Run Status': runStatus,
          'Participant Name': participantName,
          'Participant Email': email,
          'Slack User ID': slackUserId,
          'Slack Display Name': slackDisplayName,
          Question: safe(answer?.question?.question).trim(),
          Answer: displayAnswerText(answer),
          'Jira Issue Key': jira.key,
          'Jira Issue Summary': jira.summary,
          'Is Blocked': blocker.isBlocked,
          'Blocker Description': blocker.description,
          'Blocker Severity': blocker.severity,
          'Reported At': formatDateTime(answer?.createdAt),
          'Submitted At': submittedAt,
        });
      }
    }
  }

  // 4) Write UTF-8 CSV (BOM) under backend/exports/, creating the folder if needed.
  const lines = [HEADERS.map(escapeCsv).join(','), ...rows.map(rowToLine)];
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `\uFEFF${lines.join('\n')}`, 'utf8');

  // 5) Summary logs for operators.
  console.log(`runs exported: ${runs.length}`);
  console.log(`submissions exported: ${submissionCount}`);
  console.log(`csv rows written: ${rows.length}`);
  console.log(`output: ${OUTPUT_PATH}`);
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`export-checkin-runs failed: ${message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
