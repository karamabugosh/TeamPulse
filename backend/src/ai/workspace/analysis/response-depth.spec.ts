/**
 * Tests: full reports only on explicit investigation / report asks.
 * Run: npx ts-node src/ai/workspace/analysis/response-depth.spec.ts
 */
import * as assert from 'assert';
import { IntentDetectionService } from '../intent/intent-detection.service';
import { isExplicitDetectiveRequest } from './project-detective.analyzers';
import { WorkspaceAiIntent } from '../types/workspace-ai.types';

const intent = new IntentDetectionService();

console.log('response-depth.spec.ts');

// Normal chat — must NOT be explicit detective
assert.strictEqual(
  isExplicitDetectiveRequest('why was scrum-8 delayed?'),
  false,
);
assert.strictEqual(
  isExplicitDetectiveRequest('who is assigned to scrum-8?'),
  false,
);
assert.strictEqual(
  isExplicitDetectiveRequest('what is the status of scrum-8?'),
  false,
);
assert.strictEqual(
  isExplicitDetectiveRequest('who has the highest workload?'),
  false,
);

// Explicit detective
assert.strictEqual(
  isExplicitDetectiveRequest('investigate scrum-8'),
  true,
);
assert.strictEqual(
  isExplicitDetectiveRequest('root cause analysis for scrum-8'),
  true,
);
assert.strictEqual(
  isExplicitDetectiveRequest('analyze why scrum-8 was delayed'),
  true,
);
assert.strictEqual(
  isExplicitDetectiveRequest('full analysis of sprint 14'),
  true,
);
assert.strictEqual(isExplicitDetectiveRequest('detective mode'), true);

// Intent routing
assert.notStrictEqual(
  intent.detect('Why was SCRUM-8 delayed?').intent,
  WorkspaceAiIntent.PROJECT_DETECTIVE,
);
assert.strictEqual(
  intent.detect('Investigate SCRUM-8').intent,
  WorkspaceAiIntent.PROJECT_DETECTIVE,
);
assert.strictEqual(
  intent.detect('Replay Sprint 14').intent,
  WorkspaceAiIntent.SPRINT_REPLAY,
);
assert.strictEqual(
  intent.detect('Generate sprint report').intent,
  WorkspaceAiIntent.SPRINT_REPORT,
);

const status = intent.detect('What is the status of SCRUM-8?');
assert.ok(
  status.intent === WorkspaceAiIntent.ISSUE_STATUS ||
    status.intent === WorkspaceAiIntent.ISSUE_ANALYSIS ||
    status.intent === WorkspaceAiIntent.GENERAL_QA,
  `status intent was ${status.intent}`,
);

console.log('All response-depth tests passed.');
