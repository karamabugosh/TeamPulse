/**
 * End-to-end latest-standup retrieval via RagPipeline (Pules workspace).
 * Run: npx ts-node src/memory/memory-latest-standup-queries.spec.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RagPipelineService } from '../ai/workspace/rag/rag-pipeline.service';
import { runWithWorkspaceId } from '../common/workspace-context';
import { documentMatchesLatestStandupFilters } from '../ai/workspace/retrieval/temporal-retrieval.util';

const PULES = '0e4985cc-3955-4af5-8cba-d72f25f1a8ee';
const KARAM = 'bae237ed-e53d-4c5f-88e5-6e69945103f3';
const LATEST_RUN = 'f272e32d-e0a0-4fcc-aa64-325a880aa5bf';

type Case = {
  name: string;
  question: string;
  mustInclude?: string[];
  mustExclude?: string[];
  expectTemporal?: boolean;
  expectRunId?: string;
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function contentOf(hits: { content?: string; title?: string }[]): string {
  return hits.map((h) => `${h.title ?? ''}\n${h.content ?? ''}`).join('\n').toLowerCase();
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  const cases: Case[] = [
    {
      name: 'latest standup summary',
      question: 'What did Karam say in the latest standup?',
      mustExclude: ['everything is on schedule'],
      expectTemporal: true,
      expectRunId: LATEST_RUN,
    },
    {
      name: 'latest blocker',
      question: 'What blocker did Karam report in the latest standup?',
      mustInclude: ['slack and jira', 'emdings'],
      mustExclude: ['everything is on schedule', 'no blockers'],
      expectTemporal: true,
      expectRunId: LATEST_RUN,
    },
    {
      name: 'latest blocker yes/no',
      question: 'Did Karam report any blockers in the latest standup?',
      mustInclude: ['slack and jira'],
      mustExclude: ['everything is on schedule'],
      expectTemporal: true,
    },
    {
      name: 'latest Q2 working on',
      question: 'What is Karam working on now according to the latest standup?',
      mustInclude: ['scrum-4'],
      mustExclude: ['everything is on schedule'],
      expectTemporal: true,
    },
    {
      name: 'latest Q4 planning',
      question:
        'What is Karam planning to work on next according to the latest standup?',
      expectTemporal: true,
    },
    {
      name: 'latest Q5 team help',
      question:
        'What did Karam say the team should know or help with in the latest standup?',
      expectTemporal: true,
    },
    {
      name: 'historical blockers (no latest)',
      question: 'What blockers has Karam reported?',
      expectTemporal: false,
    },
    {
      name: 'composite SCRUM-11 latest + jira',
      question:
        'What did Karam report about SCRUM-11 in the latest standup, and what is SCRUM-11\'s current Jira status now?',
      mustInclude: ['scrum-11'],
      expectTemporal: true,
    },
  ];

  try {
    await runWithWorkspaceId(PULES, async () => {
      const rag = app.get(RagPipelineService);
      let passed = 0;

      for (const c of cases) {
        const prep = await rag.prepare({
          workspaceId: PULES,
          userId: KARAM,
          question: c.question,
        });

        const hits = prep.retrieval?.hits ?? [];
        const text = contentOf(hits);
        const diag = prep.retrieval?.diagnostics?.temporalScope;

        if (c.expectTemporal) {
          assert(diag?.temporalIntent === 'LATEST_STANDUP', `${c.name}: temporal intent`);
          assert(diag?.resolvedRunId, `${c.name}: run resolved`);
          if (c.expectRunId) {
            assert(diag?.resolvedRunId === c.expectRunId, `${c.name}: correct run`);
          }
          assert(
            hits.every((h) => documentMatchesLatestStandupFilters(h, prep.retrieval!.filters)),
            `${c.name}: all merged hits in latest scope`,
          );
        } else {
          assert(!diag?.temporalIntent, `${c.name}: no temporal scope for historical`);
        }

        for (const needle of c.mustInclude ?? []) {
          assert(text.includes(needle.toLowerCase()), `${c.name}: includes "${needle}"`);
        }
        for (const bad of c.mustExclude ?? []) {
          assert(!text.includes(bad.toLowerCase()), `${c.name}: excludes "${bad}"`);
        }

        console.log(
          `✓ ${c.name} | hits=${hits.length} run=${diag?.resolvedRunId ?? 'n/a'} legacyFiltered=${diag?.legacyFilteredOut ?? 0}`,
        );
        passed += 1;
      }

      console.log(`\n✓ memory-latest-standup-queries.spec.ts passed (${passed}/${cases.length})`);
    });
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
