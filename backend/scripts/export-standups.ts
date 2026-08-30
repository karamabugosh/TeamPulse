/**
 * Export standup / check-in runs from PostgreSQL into a human-readable CSV.
 *
 * Usage:
 *   npm run export:checkins
 *   npx ts-node scripts/export-standups.ts
 *   npx ts-node scripts/export-standups.ts --workspace="Pules project" --limit=50
 *
 * Writes: backend/exports/checkins.csv
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { config as loadEnv } from 'dotenv';
import { PrismaClient, QuestionType } from '@prisma/client';
import { resolveBackendEnvPath } from '../src/config/env.config';
import { enrichAnswerForAnalysis } from '../src/common/question-semantics';
import {
  extractJiraIssueKeys,
  formatAnswerForDisplay,
  readSnapshotFromStructuredValue,
} from '../src/jira/jira-issue-ref.types';
import { memberDisplayLabel } from '../src/common/slack-member.util';

loadEnv({ path: resolveBackendEnvPath() });

const OUTPUT_PATH = join(__dirname, '..', 'exports', 'checkins.csv');

const YESTERDAY_PATTERN =
  /\b(yesterday|previous day|last standup|since last|what did you|accomplish|completed|finished|done|shipped|delivered)\b/i;
const TODAY_PATTERN =
  /\b(today|plan(ned)?|working on|focus|will you|going to|priorit)\b/i;
const BLOCKED_PATTERN = /\bblock(ed|er|ing|s)?\b/i;
const JIRA_QUESTION_PATTERN = /\b(jira|issue key|ticket|linked issue)\b/i;

type QuestionRole = 'yesterday' | 'today' | 'blockers' | 'jira' | 'other';

type CliOpts = {
  workspace?: string;
  limit?: number;
  help: boolean;
};

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = { help: false };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const value = eq === -1 ? '' : body.slice(eq + 1).replace(/^["']|["']$/g, '');
    if (key === 'workspace' || key === 'workspaceId' || key === 'workspaceName') {
      opts.workspace = value.trim();
    } else if (key === 'limit') {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) opts.limit = Math.floor(parsed);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`Pulse check-in (standup) CSV export

Optional:
  --workspace=<id or name>   Filter to one workspace
  --limit=N                  Latest N standup runs (default: all)

Output:
  ${OUTPUT_PATH}

Examples:
  npm run export:checkins
  npx ts-node scripts/export-standups.ts --workspace="Pules project" --limit=20
`);
}

function personName(user: {
  slackDisplayName?: string | null;
  slackRealName?: string | null;
  slackUserId?: string | null;
} | null | undefined): string {
  if (!user) return 'Unknown User';
  return memberDisplayLabel({
    slackDisplayName: user.slackDisplayName,
    slackRealName: user.slackRealName,
    slackUserId: user.slackUserId ?? '',
  });
}

function formatRunDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatSubmissionTime(date: Date): string {
  const iso = date.toISOString().replace('T', ' ');
  return `${iso.slice(0, 19)} UTC`;
}

function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function classifyQuestionRole(
  questionText: string,
  questionType: QuestionType,
): QuestionRole {
  if (questionType === QuestionType.BLOCKER) return 'blockers';
  if (questionType === QuestionType.ISSUE_REF) return 'jira';
  const text = questionText.trim();
  if (BLOCKED_PATTERN.test(text)) return 'blockers';
  if (JIRA_QUESTION_PATTERN.test(text)) return 'jira';
  if (YESTERDAY_PATTERN.test(text)) return 'yesterday';
  if (TODAY_PATTERN.test(text)) return 'today';
  return 'other';
}

function displayAnswer(params: {
  questionText: string;
  questionType: QuestionType;
  text: string;
  structuredValue: unknown;
}): string {
  const displayText = formatAnswerForDisplay({
    text: params.text,
    structuredValue: params.structuredValue,
  });
  const enriched = enrichAnswerForAnalysis({
    questionText: params.questionText,
    questionType: params.questionType,
    text: displayText,
    structuredValue: params.structuredValue,
  });
  return (enriched.formattedAnswer?.trim() || displayText.trim()).replace(/\s+/g, ' ');
}

function collectJiraKeys(params: {
  questionType: QuestionType;
  text: string;
  structuredValue: unknown;
  linkedKeys: string[];
}): string[] {
  const keys = new Set<string>(
    params.linkedKeys.map((key) => key.trim().toUpperCase()).filter(Boolean),
  );
  const snapshot = readSnapshotFromStructuredValue(params.structuredValue);
  if (snapshot?.issueKey) keys.add(snapshot.issueKey.toUpperCase());
  for (const key of extractJiraIssueKeys(params.text)) {
    keys.add(key);
  }
  return [...keys];
}

async function resolveWorkspaceId(
  prisma: PrismaClient,
  query: string,
): Promise<string> {
  const byId = await prisma.workspace.findUnique({
    where: { id: query },
    select: { id: true },
  });
  if (byId) return byId.id;

  const matches = await prisma.workspace.findMany({
    where: {
      OR: [
        { slackWorkspaceName: { equals: query, mode: 'insensitive' } },
        { slackWorkspaceName: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: { id: true, slackWorkspaceName: true },
    take: 10,
  });
  if (matches.length === 1) return matches[0].id;
  if (matches.length === 0) {
    throw new Error(`No workspace found for "${query}".`);
  }
  const listed = matches
    .map((row) => `  - ${row.slackWorkspaceName} (${row.id})`)
    .join('\n');
  throw new Error(
    `Multiple workspaces match "${query}":\n${listed}\nPass a unique name or UUID.`,
  );
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const prisma = new PrismaClient();
  try {
    const workspaceId = opts.workspace
      ? await resolveWorkspaceId(prisma, opts.workspace)
      : undefined;

    const runs = await prisma.standupRun.findMany({
      where: workspaceId ? { team: { workspaceId } } : undefined,
      orderBy: [{ scheduledFor: 'desc' }, { startedAt: 'desc' }],
      take: opts.limit,
      include: {
        team: {
          include: {
            workspace: { select: { slackWorkspaceName: true } },
          },
        },
        checkIn: {
          include: {
            questions: {
              orderBy: { order: 'asc' },
            },
          },
        },
        submissions: {
          orderBy: [{ completedAt: 'asc' }, { createdAt: 'asc' }],
          include: {
            user: {
              select: {
                slackDisplayName: true,
                slackRealName: true,
                slackUserId: true,
              },
            },
            answers: {
              include: {
                question: {
                  select: { question: true, type: true, order: true },
                },
              },
              orderBy: { createdAt: 'asc' },
            },
            jiraIssueLinks: {
              select: { issueKey: true, questionId: true },
            },
          },
        },
      },
    });

    const extraHeaders: string[] = [];
    const extraIndex = new Map<string, number>();

    const rememberExtra = (questionText: string) => {
      const title = questionText.trim();
      if (!title || extraIndex.has(title)) return;
      extraIndex.set(title, extraHeaders.length);
      extraHeaders.push(title);
    };

    for (const run of runs) {
      for (const question of run.checkIn?.questions ?? []) {
        if (classifyQuestionRole(question.question, question.type) === 'other') {
          rememberExtra(question.question);
        }
      }
      for (const submission of run.submissions) {
        for (const answer of submission.answers) {
          if (
            classifyQuestionRole(answer.question.question, answer.question.type) ===
            'other'
          ) {
            rememberExtra(answer.question.question);
          }
        }
      }
    }

    const headers = [
      'Run Date',
      'Workspace',
      'Member',
      'Submission Time',
      'Yesterday',
      'Today',
      'Blockers',
      'Jira Issue',
      ...extraHeaders,
    ];

    const rows: string[][] = [];

    for (const run of runs) {
      const workspaceName =
        run.team.workspace.slackWorkspaceName?.trim() || run.team.name;
      const runDate = formatRunDate(run.scheduledFor ?? run.startedAt);

      for (const submission of run.submissions) {
        if (submission.answers.length === 0) continue;

        const yesterday: string[] = [];
        const today: string[] = [];
        const blockers: string[] = [];
        const jiraKeys: string[] = [];
        const extras = extraHeaders.map(() => '');

        const answers = [...submission.answers].sort(
          (a, b) => (a.question.order ?? 0) - (b.question.order ?? 0),
        );

        for (const answer of answers) {
          const role = classifyQuestionRole(
            answer.question.question,
            answer.question.type,
          );
          const text = displayAnswer({
            questionText: answer.question.question,
            questionType: answer.question.type,
            text: answer.text,
            structuredValue: answer.structuredValue,
          });
          const linkedKeys = submission.jiraIssueLinks
            .filter((link) => link.questionId === answer.questionId)
            .map((link) => link.issueKey);
          const keys = collectJiraKeys({
            questionType: answer.question.type,
            text: answer.text,
            structuredValue: answer.structuredValue,
            linkedKeys,
          });
          jiraKeys.push(...keys);

          if (role === 'yesterday') yesterday.push(text);
          else if (role === 'today') today.push(text);
          else if (role === 'blockers') blockers.push(text);
          else if (role === 'jira') {
            if (!keys.length && text) jiraKeys.push(text);
          } else {
            const idx = extraIndex.get(answer.question.question.trim());
            if (idx !== undefined) extras[idx] = text;
          }
        }

        const submissionAt =
          submission.completedAt ?? submission.startedAt ?? submission.createdAt;

        rows.push([
          runDate,
          workspaceName,
          personName(submission.user),
          formatSubmissionTime(submissionAt),
          yesterday.join('; '),
          today.join('; '),
          blockers.join('; '),
          [...new Set(jiraKeys)].join('; '),
          ...extras,
        ]);
      }
    }

    const csv = [
      headers.map(escapeCsv).join(','),
      ...rows.map((row) => row.map(escapeCsv).join(',')),
    ].join('\n');

    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, `\uFEFF${csv}\n`, 'utf8');

    console.log(`Wrote ${OUTPUT_PATH}`);
    console.log(
      `runs=${runs.length} | submissions=${rows.length} | extraQuestionColumns=${extraHeaders.length}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`export-standups failed: ${message}`);
  process.exit(1);
});
