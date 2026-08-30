/**
 * Pulse V2 Phase 3A — ACL-safe hybrid MemoryChunk retrieval tests + eval.
 * Run: npm run test:memory-phase3a
 */
import {
  MemoryVisibility,
  PrismaClient,
} from '@prisma/client';
import { MemoryAclService } from './memory-acl.service';
import { MemoryFullTextSearchService } from './memory-fulltext-search.service';
import { MemoryVectorSearchService } from './memory-vector-search.service';
import { MemoryHybridRankingService } from './memory-hybrid-ranking.service';
import { MemoryRetrievalService } from './memory-retrieval.service';
import { MemoryEmbeddingService } from './memory-embedding.service';
import { MEMORY_SOURCE } from './memory-source.constants';
import { reciprocalRankFusion } from '../ai/workspace/retrieval/embedding.util';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function unit(dims: number, hot: number): number[] {
  const v = Array.from({ length: dims }, () => 0);
  v[hot % dims] = 1;
  return v;
}

async function main() {
  console.log('memory-phase3a.spec.ts');

  // RRF unit check
  const rrf = reciprocalRankFusion(
    [
      ['A', 'B', 'C'],
      ['B', 'C', 'D'],
    ],
    60,
  );
  assert((rrf.get('B') ?? 0) > (rrf.get('A') ?? 0), 'B should beat A in RRF');
  console.log('✓ RRF formula');

  const prisma = new PrismaClient();
  const acl = new MemoryAclService(prisma as any);
  const embeddings = new MemoryEmbeddingService({
    isAvailable: () => false,
    model: () => 'test-embed',
    embedTexts: async () => [],
  } as any);
  const fullText = new MemoryFullTextSearchService(prisma as any, acl);
  const vector = new MemoryVectorSearchService(prisma as any, acl, embeddings);
  await vector.detectBackend();
  const hybrid = new MemoryHybridRankingService();
  const retrieval = new MemoryRetrievalService(acl, fullText, vector, hybrid);

  const workspaces = await prisma.workspace.findMany({
    orderBy: { installedAt: 'asc' },
    take: 2,
  });
  assert(workspaces.length >= 1, 'need workspace');
  const wsA = workspaces[0];
  const wsB = workspaces[1] ?? null;

  const userA = await prisma.user.findFirst({ where: { workspaceId: wsA.id } });
  assert(userA, 'need user A');

  // Ensure at least one team membership for userA
  let teamAlpha = await prisma.team.findFirst({
    where: { workspaceId: wsA.id },
  });
  assert(teamAlpha, 'need team');
  let membership = await prisma.teamMember.findFirst({
    where: { userId: userA.id, teamId: teamAlpha.id },
  });
  if (!membership) {
    membership = await prisma.teamMember.create({
      data: { userId: userA.id, teamId: teamAlpha.id, role: 'member' },
    });
  }

  // Create Team Beta without userA
  const teamBeta = await prisma.team.create({
    data: {
      workspaceId: wsA.id,
      name: `Mem3A Beta ${Date.now()}`,
    },
  });

  let userB =
    (await prisma.user.findFirst({
      where: { workspaceId: wsA.id, id: { not: userA.id } },
    })) || null;

  const suffix = Date.now();
  const chunkIds: string[] = [];
  const createdTeamIds = [teamBeta.id];
  const createdUserIds: string[] = [];

  try {
    if (!userB) {
      userB = await prisma.user.create({
        data: {
          workspaceId: wsA.id,
          slackUserId: `U_MEM3A_${suffix}`,
          slackDisplayName: `Mem3A UserB ${suffix}`,
        },
      });
      createdUserIds.push(userB.id);
    }

    const dims =
      vector.getBackend() === 'pgvector' ? 1536 : 8;
    const model = 'test-embed';

    const mk = async (data: {
      workspaceId: string;
      sourceId: string;
      text: string;
      visibility: MemoryVisibility;
      teamId?: string | null;
      ownerUserId?: string | null;
      linkedIssueKey?: string | null;
      embedding?: number[] | null;
      embeddingModel?: string | null;
      embeddingDimensions?: number | null;
      sourceType?: string;
    }) => {
      const row = await prisma.memoryChunk.create({
        data: {
          workspaceId: data.workspaceId,
          sourceType: data.sourceType ?? MEMORY_SOURCE.BLOCKER,
          sourceId: data.sourceId,
          chunkIndex: 0,
          text: data.text,
          contentHash: `h-${data.sourceId}-${suffix}`,
          visibility: data.visibility,
          teamId: data.teamId ?? null,
          ownerUserId: data.ownerUserId ?? null,
          linkedIssueKey: data.linkedIssueKey ?? null,
          embedding: data.embedding === null ? undefined : data.embedding ?? undefined,
          embeddingModel: data.embeddingModel ?? (data.embedding ? model : null),
          embeddingDimensions:
            data.embeddingDimensions ?? (data.embedding ? dims : null),
          indexedAt: data.embedding ? new Date() : null,
        },
      });
      chunkIds.push(row.id);
      // Phase 3C.1: pgvector path reads embedding_vec — keep fixtures in sync.
      if (data.embedding && data.embedding.length > 0) {
        await vector.syncNativeVector({
          chunkId: row.id,
          vector: data.embedding,
        });
      }
      return row;
    };

    // Workspace isolation
    const aChunk = await mk({
      workspaceId: wsA.id,
      sourceId: `iso-a-${suffix}`,
      text: `Workspace A unique token ALPHAISO${suffix} backend API contract`,
      visibility: MemoryVisibility.WORKSPACE,
      embedding: unit(dims, 0),
    });
    if (wsB) {
      await mk({
        workspaceId: wsB.id,
        sourceId: `iso-b-${suffix}`,
        text: `Workspace B unique token ALPHAISO${suffix} backend API contract`,
        visibility: MemoryVisibility.WORKSPACE,
        embedding: unit(dims, 0),
      });
    }

    // TEAM isolation
    const alphaTeam = await mk({
      workspaceId: wsA.id,
      sourceId: `team-alpha-${suffix}`,
      text: `Alpha team dashboard blocked waiting backend API contract SCRUM-MEM3A`,
      visibility: MemoryVisibility.TEAM,
      teamId: teamAlpha.id,
      linkedIssueKey: 'SCRUM-MEM3A',
      embedding: unit(dims, 1),
      sourceType: MEMORY_SOURCE.BLOCKER,
    });
    const betaTeam = await mk({
      workspaceId: wsA.id,
      sourceId: `team-beta-${suffix}`,
      text: `Beta team dashboard blocked waiting backend API contract SCRUM-MEM3A PERFECT MATCH`,
      visibility: MemoryVisibility.TEAM,
      teamId: teamBeta.id,
      linkedIssueKey: 'SCRUM-MEM3A',
      embedding: unit(dims, 1),
      sourceType: MEMORY_SOURCE.BLOCKER,
    });

    // PRIVATE
    const privateA = await mk({
      workspaceId: wsA.id,
      sourceId: `priv-a-${suffix}`,
      text: `Private note about SECRETPRIV${suffix}`,
      visibility: MemoryVisibility.PRIVATE,
      ownerUserId: userA.id,
      embedding: unit(dims, 2),
    });
    await mk({
      workspaceId: wsA.id,
      sourceId: `priv-b-${suffix}`,
      text: `Private note about SECRETPRIV${suffix}`,
      visibility: MemoryVisibility.PRIVATE,
      ownerUserId: userB.id,
      embedding: unit(dims, 2),
    });

    // Malformed
    await mk({
      workspaceId: wsA.id,
      sourceId: `bad-team-${suffix}`,
      text: `Malformed TEAM chunk BADTEAM${suffix}`,
      visibility: MemoryVisibility.TEAM,
      teamId: null,
      embedding: unit(dims, 3),
    });
    await mk({
      workspaceId: wsA.id,
      sourceId: `bad-priv-${suffix}`,
      text: `Malformed PRIVATE chunk BADPRIV${suffix}`,
      visibility: MemoryVisibility.PRIVATE,
      ownerUserId: null,
      embedding: unit(dims, 3),
    });

    // Text-only (no embedding)
    const textOnly = await mk({
      workspaceId: wsA.id,
      sourceId: `textonly-${suffix}`,
      text: `Exact phrase backend API contract TEXTONLY${suffix}`,
      visibility: MemoryVisibility.WORKSPACE,
      embedding: null,
      embeddingModel: null,
      embeddingDimensions: null,
    });

    // Model mismatch
    await mk({
      workspaceId: wsA.id,
      sourceId: `mismatch-${suffix}`,
      text: `Model mismatch vector chunk MISMATCH${suffix}`,
      visibility: MemoryVisibility.WORKSPACE,
      embedding: unit(dims, 0),
      embeddingModel: 'other-model',
      embeddingDimensions: dims,
    });

    // Resolution + report for eval
    const resolution = await mk({
      workspaceId: wsA.id,
      sourceId: `res-${suffix}`,
      text: `Blocker resolution: The SCRUM-MEM3A dashboard blocker was resolved after the backend team delivered the API contract.`,
      visibility: MemoryVisibility.TEAM,
      teamId: teamAlpha.id,
      linkedIssueKey: 'SCRUM-MEM3A',
      embedding: unit(dims, 4),
      sourceType: MEMORY_SOURCE.BLOCKER_RESOLUTION,
    });
    const report = await mk({
      workspaceId: wsA.id,
      sourceId: `rep-${suffix}`,
      text: `Weekly report blockers section: dashboard delayed; API dependency; SCRUM-MEM3A mentioned in narrative.`,
      visibility: MemoryVisibility.TEAM,
      teamId: teamAlpha.id,
      embedding: unit(dims, 5),
      sourceType: MEMORY_SOURCE.REPORT,
    });
    const standup = await mk({
      workspaceId: wsA.id,
      sourceId: `ans-${suffix}`,
      text: `Standup: Waited on SCRUM-MEM3A backend API contract before continuing dashboard work.`,
      visibility: MemoryVisibility.TEAM,
      teamId: teamAlpha.id,
      linkedIssueKey: 'SCRUM-MEM3A',
      embedding: unit(dims, 1),
      sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
    });

    const qEmbed = unit(dims, 1); // aligns with blocker/standup semantic cluster

    // --- Workspace isolation ---
    const iso = await retrieval.retrieve({
      workspaceId: wsA.id,
      userId: userA.id,
      query: `ALPHAISO${suffix}`,
      debug: true,
      queryEmbeddingOverride: unit(dims, 0),
      queryEmbeddingModelOverride: model,
    });
    assert(
      iso.evidence.every((e) => e.chunkId !== undefined),
      'citations have ids',
    );
    assert(
      !iso.evidence.some((e) => e.text.includes('Workspace B')),
      'no workspace B leakage',
    );
    assert(
      iso.evidence.some((e) => e.chunkId === aChunk.id),
      'workspace A hit',
    );
    console.log('✓ Workspace isolation');

    // --- TEAM isolation ---
    const teamQ = await retrieval.retrieve({
      workspaceId: wsA.id,
      userId: userA.id,
      query: 'dashboard blocked waiting backend API contract SCRUM-MEM3A',
      debug: true,
      queryEmbeddingOverride: qEmbed,
      queryEmbeddingModelOverride: model,
    });
    assert(
      teamQ.evidence.some((e) => e.chunkId === alphaTeam.id),
      'alpha team visible',
    );
    assert(
      !teamQ.evidence.some((e) => e.chunkId === betaTeam.id),
      'beta team invisible despite relevance',
    );
    console.log('✓ TEAM isolation');

    // --- PRIVATE ---
    const privA = await retrieval.retrieve({
      workspaceId: wsA.id,
      userId: userA.id,
      query: `SECRETPRIV${suffix}`,
      queryEmbeddingOverride: unit(dims, 2),
      queryEmbeddingModelOverride: model,
    });
    assert(
      privA.evidence.some((e) => e.chunkId === privateA.id),
      'owner sees private',
    );
    const privB = await retrieval.retrieve({
      workspaceId: wsA.id,
      userId: userB.id,
      query: `SECRETPRIV${suffix}`,
      queryEmbeddingOverride: unit(dims, 2),
      queryEmbeddingModelOverride: model,
    });
    assert(
      !privB.evidence.some((e) => e.chunkId === privateA.id),
      'non-owner never sees private A',
    );
    console.log('✓ PRIVATE isolation');

    // --- Malformed fail-closed ---
    const bad = await retrieval.retrieve({
      workspaceId: wsA.id,
      userId: userA.id,
      query: `BADTEAM${suffix} BADPRIV${suffix}`,
      queryEmbeddingOverride: unit(dims, 3),
      queryEmbeddingModelOverride: model,
      debug: true,
    });
    assert(
      !bad.evidence.some((e) => e.text.includes(`BADTEAM${suffix}`)),
      'malformed TEAM excluded',
    );
    assert(
      !bad.evidence.some((e) => e.text.includes(`BADPRIV${suffix}`)),
      'malformed PRIVATE excluded',
    );
    console.log('✓ Malformed ACL fail-closed');

    // --- Full-text exact ---
    const fts = await retrieval.retrieve({
      workspaceId: wsA.id,
      userId: userA.id,
      query: `backend API contract TEXTONLY${suffix}`,
      queryEmbeddingOverride: unit(dims, 7),
      queryEmbeddingModelOverride: model,
    });
    assert(
      fts.evidence.some((e) => e.chunkId === textOnly.id),
      'text-only via FTS',
    );
    console.log('✓ Full-text + text-only');

    // --- Vector semantic (JSON ACL-bounded) ---
    const vec = await vector.search({
      acl: await acl.resolveContext({
        workspaceId: wsA.id,
        userId: userA.id,
      }),
      query: 'what prevented dashboard progress',
      queryEmbeddingOverride: qEmbed,
      queryEmbeddingModelOverride: model,
      limit: 10,
    });
    assert(vec.backend === 'json_acl_bounded' || vec.backend === 'pgvector', 'vector backend');
    assert(
      vec.candidates.some((c) => c.chunkId === alphaTeam.id),
      'semantic hit on alpha blocker',
    );
    assert(
      !vec.candidates.some((c) => c.chunkId === betaTeam.id),
      'vector ACL blocks beta',
    );
    assert(
      !vec.candidates.some((c) => c.chunkId === textOnly.id),
      'text-only skipped by vector',
    );
    console.log('✓ Vector retrieval + ACL');

    // --- Model mismatch ---
    const mm = await vector.search({
      acl: await acl.resolveContext({
        workspaceId: wsA.id,
        userId: userA.id,
      }),
      query: 'mismatch',
      queryEmbeddingOverride: unit(dims, 0),
      queryEmbeddingModelOverride: model,
      limit: 20,
    });
    assert(mm.incompatibleEmbeddingCount >= 1, 'mismatch counted');
    assert(
      !mm.candidates.some((c) => c.text.includes(`MISMATCH${suffix}`)),
      'incompatible not scored',
    );
    console.log('✓ Model mismatch guarded');

    // --- Hybrid / RRF / citations ---
    const hybridRes = await retrieval.retrieve({
      workspaceId: wsA.id,
      userId: userA.id,
      query: 'Why was SCRUM-MEM3A delayed?',
      linkedIssueKey: 'SCRUM-MEM3A',
      debug: true,
      queryEmbeddingOverride: qEmbed,
      queryEmbeddingModelOverride: model,
      limit: 8,
    });
    assert(hybridRes.evidence.length > 0, 'hybrid returns evidence');
    for (const e of hybridRes.evidence) {
      assert(e.chunkId && e.citation.sourceType && e.citation.sourceId != null, 'citation fields');
      assert(typeof e.citation.chunkIndex === 'number', 'chunkIndex');
      assert(typeof e.retrieval.rrfScore === 'number', 'rrfScore');
    }
    assert(
      hybridRes.evidence.some((e) => e.linkedIssueKey === 'SCRUM-MEM3A'),
      'linked issue evidence',
    );
    assert(
      !hybridRes.evidence.some((e) => e.chunkId === betaTeam.id),
      'hybrid still ACL safe',
    );
    console.log('✓ Hybrid/RRF + citations');

    // --- Eval dataset Hit@K / MRR ---
    type Case = {
      name: string;
      query: string;
      expectedSourceIds: string[];
    };
    const cases: Case[] = [
      {
        name: 'Why delayed',
        query: 'Why was SCRUM-MEM3A delayed?',
        expectedSourceIds: [alphaTeam.sourceId, standup.sourceId, resolution.sourceId],
      },
      {
        name: 'Dashboard problems',
        query: 'What problems did the team face with the dashboard?',
        expectedSourceIds: [alphaTeam.sourceId, standup.sourceId],
      },
      {
        name: 'API resolved',
        query: 'How was the API dependency resolved?',
        expectedSourceIds: [resolution.sourceId],
      },
      {
        name: 'Weekly blockers',
        query: 'What did the weekly report say about blockers?',
        expectedSourceIds: [report.sourceId],
      },
      {
        name: 'Exact key',
        query: 'SCRUM-MEM3A',
        expectedSourceIds: [alphaTeam.sourceId, standup.sourceId],
      },
    ];

    let hits = 0;
    let mrrSum = 0;
    for (const c of cases) {
      const res = await retrieval.retrieve({
        workspaceId: wsA.id,
        userId: userA.id,
        query: c.query,
        linkedIssueKey: 'SCRUM-MEM3A',
        queryEmbeddingOverride: qEmbed,
        queryEmbeddingModelOverride: model,
        limit: 5,
      });
      const ranks = res.evidence.map((e) => e.sourceId);
      let best = Infinity;
      for (const id of c.expectedSourceIds) {
        const idx = ranks.indexOf(id);
        if (idx >= 0) best = Math.min(best, idx + 1);
      }
      if (best !== Infinity) {
        hits += 1;
        mrrSum += 1 / best;
      } else {
        console.log(`  miss: ${c.name} ranks=${ranks.join(',')}`);
      }
    }
    const hitAt5 = hits / cases.length;
    const mrr = mrrSum / cases.length;
    console.log(`✓ Evaluation Hit@5=${hitAt5.toFixed(2)} MRR=${mrr.toFixed(2)}`);
    assert(hitAt5 >= 0.6, `Hit@5 too low: ${hitAt5}`);

    // Diversity unit
    const diversed = hybrid.applySourceDiversity(
      [
        { chunkId: '1', sourceType: 'REPORT', sourceId: 'R1', chunkIndex: 0, text: 'a', visibility: MemoryVisibility.TEAM, teamId: null, ownerUserId: null, linkedIssueKey: null, rrfScore: 3 },
        { chunkId: '2', sourceType: 'REPORT', sourceId: 'R1', chunkIndex: 1, text: 'b', visibility: MemoryVisibility.TEAM, teamId: null, ownerUserId: null, linkedIssueKey: null, rrfScore: 2.9 },
        { chunkId: '3', sourceType: 'REPORT', sourceId: 'R1', chunkIndex: 2, text: 'c', visibility: MemoryVisibility.TEAM, teamId: null, ownerUserId: null, linkedIssueKey: null, rrfScore: 2.8 },
        { chunkId: '4', sourceType: 'REPORT', sourceId: 'R1', chunkIndex: 3, text: 'd', visibility: MemoryVisibility.TEAM, teamId: null, ownerUserId: null, linkedIssueKey: null, rrfScore: 2.7 },
        { chunkId: '5', sourceType: 'BLOCKER', sourceId: 'B1', chunkIndex: 0, text: 'e', visibility: MemoryVisibility.TEAM, teamId: null, ownerUserId: null, linkedIssueKey: null, rrfScore: 2.6 },
      ] as any,
      4,
      2,
    );
    assert(
      diversed.filter((d) => d.sourceId === 'R1').length <= 3,
      'diversity soft cap applied before fill',
    );
    assert(diversed.some((d) => d.sourceId === 'B1'), 'other sources included');
    console.log('✓ Source diversity');

    console.log('All Phase 3A memory retrieval tests passed.');
  } finally {
    if (chunkIds.length) {
      await prisma.memoryChunk.deleteMany({ where: { id: { in: chunkIds } } });
    }
    await prisma.teamMember.deleteMany({
      where: { teamId: { in: createdTeamIds } },
    });
    await prisma.team.deleteMany({ where: { id: { in: createdTeamIds } } });
    if (createdUserIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
