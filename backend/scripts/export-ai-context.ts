/**
 * Export the latest Pulse workspace context for RAG / ChatGPT comparison.
 *
 * Usage:
 *   npm run export:context -- --workspace="TeamPulse Workspace" --limit=20
 *   npx ts-node scripts/export-ai-context.ts --workspace=<id-or-name> --limit=20
 *
 * Writes: backend/exports/ai-context.json
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { config as loadEnv } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { resolveBackendEnvPath } from '../src/config/env.config';
import { formatAnswerForDisplay } from '../src/jira/jira-issue-ref.types';
import {
  memberDisplayLabel,
  resolveAllSlackIdsInText,
  SLACK_MEMBER_ID_RE,
} from '../src/common/slack-member.util';

loadEnv({ path: resolveBackendEnvPath() });

const DEFAULT_LIMIT = 20;
const OUTPUT_PATH = join(__dirname, '..', 'exports', 'ai-context.json');

type CliOpts = {
  workspace?: string;
  limit: number;
  help: boolean;
};

type NameMap = Map<string, string>;

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = { limit: DEFAULT_LIMIT, help: false };
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
      opts.limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_LIMIT;
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`Pulse AI Workspace context export

Required:
  --workspace=<workspaceId or workspaceName>

Optional:
  --limit=N     Latest standup runs to include (default ${DEFAULT_LIMIT})

Output:
  ${OUTPUT_PATH}

Examples:
  npm run export:context -- --workspace="TeamPulse Workspace" --limit=20
  npx ts-node scripts/export-ai-context.ts --workspace=<uuid> --limit=10
`);
}

function personName(user: {
  slackDisplayName?: string | null;
  slackRealName?: string | null;
  slackUserId?: string | null;
  email?: string | null;
} | null | undefined): string {
  if (!user) return 'Unknown User';
  const label = memberDisplayLabel({
    slackDisplayName: user.slackDisplayName,
    slackRealName: user.slackRealName,
    slackUserId: user.slackUserId ?? '',
  });
  if (label && !SLACK_MEMBER_ID_RE.test(label)) return label;
  return user.email?.trim() || 'Unknown User';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function resolveText(text: string | null | undefined, nameMap: NameMap): string {
  if (!text) return '';
  return resolveAllSlackIdsInText(text, nameMap);
}

function tagsFromMetadata(metadata: unknown): string[] {
  const record = asRecord(metadata);
  if (!record) return [];
  const raw = record.tags ?? record.tag ?? record.labels;
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === 'string' ? item : String(item)))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(/[,;]/).map((item) => item.trim()).filter(Boolean);
  }
  const extras = [record.sourceType, record.issueKey, record.category]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return extras;
}

function extractDigestSections(digest: {
  summary: string;
  reportSections: unknown;
  slackReportText: string | null;
}): {
  executiveSummary: string;
  recommendations: string[];
  highlights: string[];
} {
  const sections = asRecord(digest.reportSections) ?? {};
  const namedAccomplishments = Array.isArray(sections.namedAccomplishments)
    ? sections.namedAccomplishments.flatMap((entry) => {
        const rec = asRecord(entry);
        if (!rec) return [];
        const name = String(rec.displayName ?? 'Unknown User');
        const items = asStringArray(rec.items);
        return items.map((item) => `${name}: ${item}`);
      })
    : [];

  const highlights =
    namedAccomplishments.length > 0
      ? namedAccomplishments
      : asStringArray(sections.keyAccomplishments);

  const recommendations = asStringArray(sections.actionItems);

  return {
    executiveSummary: digest.summary?.trim() || digest.slackReportText?.trim() || '',
    recommendations,
    highlights,
  };
}

async function resolveWorkspace(prisma: PrismaClient, query: string) {
  const byId = await prisma.workspace.findUnique({
    where: { id: query },
    select: { id: true, slackWorkspaceName: true, slackWorkspaceId: true },
  });
  if (byId) return byId;

  const matches = await prisma.workspace.findMany({
    where: {
      OR: [
        { slackWorkspaceName: { equals: query, mode: 'insensitive' } },
        { slackWorkspaceName: { contains: query, mode: 'insensitive' } },
        { slackWorkspaceId: { equals: query, mode: 'insensitive' } },
      ],
    },
    select: { id: true, slackWorkspaceName: true, slackWorkspaceId: true },
    take: 10,
  });

  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new Error(`No workspace found for "${query}".`);
  }

  const listed = matches
    .map((row) => `  - ${row.slackWorkspaceName} (${row.id})`)
    .join('\n');
  throw new Error(`Multiple workspaces match "${query}":\n${listed}\nPass a unique name or UUID.`);
}

function buildNameMap(
  users: Array<{
    slackUserId: string;
    slackDisplayName: string;
    slackRealName: string | null;
  }>,
): NameMap {
  const map = new Map<string, string>();
  for (const user of users) {
    const label = personName(user);
    map.set(user.slackUserId, label);
    map.set(user.slackUserId.toUpperCase(), label);
    map.set(user.slackUserId.toLowerCase(), label);
  }
  return map;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }
  if (!opts.workspace) {
    printHelp();
    throw new Error('Missing required --workspace=<id or name>');
  }

  const prisma = new PrismaClient();
  try {
    const workspace = await resolveWorkspace(prisma, opts.workspace);
    console.log(
      `Exporting AI context for "${workspace.slackWorkspaceName}" (${workspace.id}), latest ${opts.limit} standup run(s)…`,
    );

    const users = await prisma.user.findMany({
      where: { workspaceId: workspace.id },
      select: {
        id: true,
        email: true,
        slackUserId: true,
        slackDisplayName: true,
        slackRealName: true,
      },
      orderBy: { slackDisplayName: 'asc' },
    });
    const nameMap = buildNameMap(users);

    const standupRuns = await prisma.standupRun.findMany({
      where: { team: { workspaceId: workspace.id } },
      orderBy: [{ scheduledFor: 'desc' }, { startedAt: 'desc' }],
      take: opts.limit,
      include: {
        team: { select: { name: true } },
        checkIn: { select: { name: true } },
        submissions: {
          orderBy: { completedAt: 'desc' },
          include: {
            user: {
              select: {
                slackDisplayName: true,
                slackRealName: true,
                slackUserId: true,
                email: true,
              },
            },
            answers: {
              include: {
                question: { select: { question: true, order: true, type: true } },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    const submissions = standupRuns.flatMap((run) =>
      run.submissions.map((submission) => {
        const answers = [...submission.answers]
          .sort((a, b) => (a.question.order ?? 0) - (b.question.order ?? 0))
          .map((answer) => ({
            question: answer.question.question,
            answer: resolveText(
              formatAnswerForDisplay({
                text: answer.text,
                structuredValue: answer.structuredValue,
              }),
              nameMap,
            ),
          }));

        return {
          member: personName(submission.user),
          submittedAt: submission.completedAt?.toISOString() ?? null,
          status: submission.status,
          standup: run.checkIn?.name ?? 'Standup',
          team: run.team.name,
          runScheduledFor: run.scheduledFor.toISOString(),
          answers,
        };
      }),
    );

    const blockers = await prisma.pulseBlocker.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            slackDisplayName: true,
            slackRealName: true,
            slackUserId: true,
            email: true,
          },
        },
      },
    });

    const jiraIssues = await prisma.jiraIssueCacheEntry.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { refreshedAt: 'desc' },
    });

    const teamMemoryDocuments = await prisma.teamMemoryDocument.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'desc' },
    });

    const memoryChunks = await prisma.memoryChunk.findMany({
      where: { workspaceId: workspace.id },
      orderBy: [{ sourceType: 'asc' }, { sourceId: 'asc' }, { chunkIndex: 'asc' }],
      include: {
        ownerUser: {
          select: {
            slackDisplayName: true,
            slackRealName: true,
            slackUserId: true,
          },
        },
        team: { select: { name: true } },
      },
    });

    const runIds = standupRuns.map((run) => run.id);
    const digests = await prisma.aiDigest.findMany({
      where: {
        team: { workspaceId: workspace.id },
        ...(runIds.length ? { runId: { in: runIds } } : {}),
      },
      orderBy: { generatedAt: 'desc' },
      include: {
        team: { select: { name: true } },
        run: {
          include: {
            checkIn: { select: { name: true } },
          },
        },
      },
    });

    const payload = {
      exportedAt: new Date().toISOString(),
      limit: opts.limit,
      workspace: {
        id: workspace.id,
        name: workspace.slackWorkspaceName,
      },
      users: users.map((user) => ({
        id: user.id,
        name: personName(user),
        email: user.email,
        slackUserId: user.slackUserId,
      })),
      standupRuns: standupRuns.map((run) => ({
        standup: run.checkIn?.name ?? 'Standup',
        team: run.team.name,
        scheduledFor: run.scheduledFor.toISOString(),
        startedAt: run.startedAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
        status: run.status,
        reportStatus: run.reportStatus,
        submissionCount: run.submissions.length,
        completedSubmissions: run.submissions.filter((row) => row.status === 'completed').length,
      })),
      standupSubmissions: submissions,
      blockers: blockers.map((blocker) => ({
        title: resolveText(blocker.title, nameMap) || blocker.title,
        description: resolveText(blocker.description, nameMap),
        owner: resolveText(blocker.ownerLabel, nameMap) || personName(blocker.user),
        reporter: personName(blocker.user),
        severity: blocker.severity,
        status: blocker.status,
        category: blocker.category,
        linkedJiraIssue: blocker.linkedIssueKey
          ? {
              key: blocker.linkedIssueKey,
              url: blocker.linkedIssueUrl,
            }
          : null,
        createdAt: blocker.createdAt.toISOString(),
        resolvedAt: blocker.resolvedAt?.toISOString() ?? null,
      })),
      jiraIssues: jiraIssues.map((issue) => ({
        issueKey: issue.issueKey,
        summary: issue.summary,
        status: issue.status,
        assignee: issue.assigneeName,
        priority: issue.priority,
        reporter: null as string | null,
        sprint: null as string | null,
        project: issue.projectName ?? issue.projectKey,
        issueType: issue.issueType,
        url: issue.issueUrl,
        refreshedAt: issue.refreshedAt.toISOString(),
      })),
      teamMemory: teamMemoryDocuments.map((doc) => ({
        title: resolveText(doc.title, nameMap),
        content: resolveText(doc.content, nameMap),
        tags: tagsFromMetadata(doc.metadata),
        sourceType: doc.sourceType,
        issueKey: doc.issueKey,
        createdAt: doc.createdAt.toISOString(),
      })),
      teamMemoryChunks: memoryChunks.map((chunk) => ({
        sourceType: chunk.sourceType,
        title: `${chunk.sourceType}${chunk.linkedIssueKey ? ` · ${chunk.linkedIssueKey}` : ''}`,
        content: resolveText(chunk.text, nameMap),
        tags: [
          chunk.sourceType,
          chunk.visibility,
          ...(chunk.linkedIssueKey ? [chunk.linkedIssueKey] : []),
          ...tagsFromMetadata(chunk.metadata),
        ],
        owner: chunk.ownerUser ? personName(chunk.ownerUser) : null,
        team: chunk.team?.name ?? null,
        linkedIssueKey: chunk.linkedIssueKey,
      })),
      aiDigests: digests.map((digest) => {
        const sections = extractDigestSections(digest);
        return {
          standup: digest.run.checkIn?.name ?? 'Standup',
          team: digest.team.name,
          generatedAt: digest.generatedAt.toISOString(),
          source: digest.source,
          executiveSummary: resolveText(sections.executiveSummary, nameMap),
          recommendations: sections.recommendations.map((item) => resolveText(item, nameMap)),
          highlights: sections.highlights.map((item) => resolveText(item, nameMap)),
        };
      }),
    };

    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

    console.log(`Wrote ${OUTPUT_PATH}`);
    console.log(
      [
        `users=${payload.users.length}`,
        `standupRuns=${payload.standupRuns.length}`,
        `standupSubmissions=${payload.standupSubmissions.length}`,
        `blockers=${payload.blockers.length}`,
        `jiraIssues=${payload.jiraIssues.length}`,
        `teamMemory=${payload.teamMemory.length}`,
        `teamMemoryChunks=${payload.teamMemoryChunks.length}`,
        `aiDigests=${payload.aiDigests.length}`,
      ].join(' | '),
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`export-ai-context failed: ${message}`);
  process.exit(1);
});
