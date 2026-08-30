/**
 * Pulse Demo Workspace seed
 *
 * Reads members from the connected (real) Jira workspace, then generates
 * isolated mock activity for Demo Workspace only — never writes to Jira.
 *
 * Usage: npm run seed:demo
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DemoWorkspaceGeneratorService } from '../src/demo/demo-workspace-generator.service';

async function seed() {
  console.log('\n=== Pulse Demo Workspace seed (from real Jira members) ===\n');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const generator = app.get(DemoWorkspaceGeneratorService);
    const members = await generator.listSourceJiraMembers();
    console.log(`Jira members (${members.length}):`);
    for (const m of members) {
      console.log(`  - ${m.displayName} (${m.accountId})`);
    }

    const result = await generator.seedDemoWorkspace();
    console.log('\n=== Demo Workspace ready ===');
    console.log(`  Regenerated: ${result.regenerated} (${result.reason})`);
    console.log(`  Workspace ID: ${result.workspaceId}`);
    console.log(`  Fingerprint:  ${result.fingerprint.slice(0, 16)}…`);
    console.log(`  Members:      ${result.members.map((m) => m.name).join(', ')}`);
    if (result.counts) {
      console.log(`  Counts:       ${JSON.stringify(result.counts)}`);
    }
    console.log('\nSelect "Demo Workspace" in the dashboard switcher to explore.\n');
  } finally {
    await app.close();
  }
}

seed().catch((error) => {
  console.error('Demo seed failed:', error);
  process.exitCode = 1;
});
