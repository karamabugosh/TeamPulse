/**
 * Operator CLI — Pulse V2 Phase 3A MemoryChunk hybrid search (ACL-enforced).
 *
 * Usage:
 *   npm run memory:search -- --workspaceId=... --userId=... --query="Why was SCRUM-9 delayed?"
 *   npm run memory:search -- --workspaceId=... --userId=... --query="..." --debug --limit=8
 *
 * Does NOT generate Ask Pulse answers. Does NOT bypass ACL via --teamIds.
 */
import { PrismaClient } from '@prisma/client';
import { OpenAiEmbeddingProvider } from '../src/ai/workspace/retrieval/openai-embedding.provider';
import { MemoryEmbeddingService } from '../src/memory/memory-embedding.service';
import { MemoryAclService } from '../src/memory/memory-acl.service';
import { MemoryFullTextSearchService } from '../src/memory/memory-fulltext-search.service';
import { MemoryVectorSearchService } from '../src/memory/memory-vector-search.service';
import { MemoryHybridRankingService } from '../src/memory/memory-hybrid-ranking.service';
import { MemoryRetrievalService } from '../src/memory/memory-retrieval.service';

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  const opts: Record<string, string> = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) flags.add(body);
    else opts[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return { flags, opts };
}

function printHelp() {
  console.log(`Pulse V2 memory search (Phase 3A)

Required:
  --workspaceId=<uuid>
  --userId=<uuid>
  --query="..."

Optional:
  --limit=N
  --debug
  --linkedIssueKey=SCRUM-9
  --sourceTypes=BLOCKER,REPORT

ACL is resolved from TeamMember / User — client team lists are ignored.
`);
}

async function main() {
  const { flags, opts } = parseArgs(process.argv.slice(2));
  if (flags.has('help') || flags.has('h')) {
    printHelp();
    process.exit(0);
  }

  const workspaceId = opts.workspaceId?.trim();
  const userId = opts.userId?.trim();
  const query = opts.query?.trim();
  if (!workspaceId || !userId || !query) {
    console.error('Error: --workspaceId, --userId, and --query are required');
    printHelp();
    process.exit(1);
  }

  if (opts.teamIds) {
    console.error(
      'Error: --teamIds is not accepted (ACL is server-resolved from membership)',
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const embeddings = new MemoryEmbeddingService(
    new OpenAiEmbeddingProvider() as any,
  );
  const acl = new MemoryAclService(prisma as any);
  const fullText = new MemoryFullTextSearchService(prisma as any, acl);
  const vector = new MemoryVectorSearchService(prisma as any, acl, embeddings);
  await vector.detectBackend();
  const hybrid = new MemoryHybridRankingService();
  const retrieval = new MemoryRetrievalService(acl, fullText, vector, hybrid);

  try {
    const result = await retrieval.retrieve({
      workspaceId,
      userId,
      query,
      limit: opts.limit ? Number(opts.limit) : undefined,
      debug: flags.has('debug'),
      linkedIssueKey: opts.linkedIssueKey,
      sourceTypes: opts.sourceTypes
        ? (opts.sourceTypes.split(',').map((s) => s.trim()) as any)
        : undefined,
    });

    console.log(`Query: ${result.query}`);
    console.log(`Workspace: ${result.workspaceId}`);
    console.log(`Evidence: ${result.evidence.length}`);
    if (result.diagnostics) {
      console.log(`Diagnostics: ${JSON.stringify(result.diagnostics)}`);
    }
    for (const item of result.evidence) {
      console.log(
        `- ${item.sourceType}/${item.sourceId}#${item.chunkIndex} vis=${item.visibility} rrf=${item.retrieval.rrfScore.toFixed(4)} key=${item.linkedIssueKey ?? '-'}`,
      );
      console.log(
        `  preview: ${item.text.replace(/\n/g, ' ').slice(0, 180)}`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
