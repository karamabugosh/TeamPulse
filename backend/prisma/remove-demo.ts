/**
 * Removes only the Demo Workspace (T_DEMO_PULSE_WS) and all of its data.
 * Does NOT touch development / production workspaces or real Jira.
 *
 * Usage: npm run seed:demo:remove
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DemoWorkspaceGeneratorService } from '../src/demo/demo-workspace-generator.service';

async function removeDemoWorkspace() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const generator = app.get(DemoWorkspaceGeneratorService);
    const result = await generator.clearDemoWorkspace();
    if (!result.removed) {
      console.log('No Demo Workspace found — nothing to remove.');
      return;
    }
    console.log('Demo Workspace removed. Development/production data was not modified.');
  } finally {
    await app.close();
  }
}

removeDemoWorkspace().catch((error) => {
  console.error('Failed to remove Demo Workspace:', error);
  process.exitCode = 1;
});
