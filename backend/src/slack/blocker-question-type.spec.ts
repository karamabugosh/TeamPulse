/**
 * Type-driven BLOCKER question flow — preserves existing modal + PulseBlocker path.
 *
 * Run: npx ts-node src/slack/blocker-question-type.spec.ts
 */
import { PrismaClient, QuestionType } from '@prisma/client';
import {
  isBlockerCapableQuestion,
  isBlockerQuestionText,
  buildBlockerSavedSuccessBlocks,
  formatBlockerAnswerText,
} from './slack-checkin.views';
import { extractBlockerDetailsFromAnswer } from '../jira/jira-issue-payload.util';
import { parseYesNoChoice, getSemanticSentiment } from '../common/question-semantics';
import { JiraBlockerService } from '../jira/jira-blocker.service';
import { PrismaService } from '../prisma/prisma.service';
import { MemoryOutboxService } from '../memory/memory-outbox.service';
import { MEMORY_SOURCE } from '../memory/memory-source.constants';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JiraActionService } from '../jira/jira-action.service';
import { WorkspaceMembersService } from '../common/workspace-members.service';
import {
  buildParticipantProfiles,
} from '../check-in/report-participant.utils';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function main() {
  console.log('blocker-question-type.spec.ts');

  // --- Pure: type gate ---
  assert(
    isBlockerCapableQuestion({
      type: QuestionType.BLOCKER,
      text: 'Is anything blocking your progress?',
    }),
    'BLOCKER type must open modal regardless of wording',
  );
  assert(
    isBlockerCapableQuestion({
      type: QuestionType.BLOCKER,
      text: 'Totally custom blocker wording with no keywords',
    }),
    'BLOCKER type must not depend on text heuristics',
  );
  assert(
    !isBlockerCapableQuestion({
      type: QuestionType.FREE_TEXT,
      text: 'Are you blocked?',
    }),
    'FREE_TEXT must not open blocker modal even with classic phrase',
  );
  assert(
    isBlockerCapableQuestion({
      type: QuestionType.YES_NO,
      text: 'Are you blocked?',
    }),
    'Legacy YES_NO + classic phrase still opens modal',
  );
  assert(
    !isBlockerCapableQuestion({
      type: QuestionType.YES_NO,
      text: 'Is anything preventing you from progressing?',
    }),
    'Legacy YES_NO without classic phrase must NOT open modal (use BLOCKER type)',
  );
  assert(
    !isBlockerQuestionText('Is anything preventing you from progressing?'),
    'Custom wording is not phrase-matched — type must drive it',
  );
  console.log('✓ Type-driven blocker gate (custom wording)');

  // --- Pure: YES/NO semantics for BLOCKER ---
  assert(
    parseYesNoChoice({
      type: QuestionType.BLOCKER,
      text: 'Yes',
      structuredValue: { value: true },
    }) === 'yes',
    'BLOCKER Yes parses',
  );
  assert(
    parseYesNoChoice({
      type: QuestionType.BLOCKER,
      text: 'No',
      structuredValue: { value: false },
    }) === 'no',
    'BLOCKER No parses',
  );
  assert(
    getSemanticSentiment({
      type: QuestionType.BLOCKER,
      question: 'Custom wording without block keyword',
      text: 'Yes',
      structuredValue: { value: true },
    }) === 'negative',
    'BLOCKER Yes is always negative sentiment',
  );
  assert(
    getSemanticSentiment({
      type: QuestionType.BLOCKER,
      question: 'Custom wording without block keyword',
      text: 'No',
      structuredValue: { value: false },
    }) === 'positive',
    'BLOCKER No is positive (not blocked)',
  );
  console.log('✓ BLOCKER yes/no semantics');

  // --- Confirmation blocks omit empty fields ---
  const blocks = buildBlockerSavedSuccessBlocks({
    title: 'Slack connection',
    description: 'Waiting for Slack OAuth configuration',
    severity: 'Medium',
    category: 'Infrastructure',
    expectedResolution: '2026-08-23',
    issueKey: 'SCRUM-12',
  });
  const text = String((blocks[0] as { text?: { text?: string } }).text?.text ?? '');
  assert(text.includes('Slack connection'), 'confirmation includes title');
  assert(text.includes('Waiting for Slack OAuth'), 'confirmation includes reason');
  assert(text.includes('Medium'), 'confirmation includes severity');
  assert(text.includes('SCRUM-12'), 'confirmation includes Jira');
  assert(text.includes('Expected resolution'), 'confirmation includes expected resolution');
  assert(!text.includes('Needs help'), 'needsHelp not invented when unsupported at create');
  const sparse = buildBlockerSavedSuccessBlocks({
    title: 'Only title',
    severity: 'Low',
  });
  const sparseText = String((sparse[0] as { text?: { text?: string } }).text?.text ?? '');
  assert(!sparseText.includes('Linked Jira'), 'omit empty Jira');
  assert(!sparseText.includes('Reason:'), 'omit empty reason');
  console.log('✓ Confirmation uses real fields only');

  // --- Extract structured blocker payload ---
  const details = extractBlockerDetailsFromAnswer({
    text: formatBlockerAnswerText({
      title: 'Slack connection',
      description: 'Waiting for Slack OAuth configuration',
      severity: 'Medium',
      category: 'Infrastructure',
      expectedResolution: '2026-08-23',
      issueKey: 'SCRUM-12',
    }),
    structuredValue: {
      value: true,
      blocked: true,
      blocker: {
        title: 'Slack connection',
        description: 'Waiting for Slack OAuth configuration',
        severity: 'Medium',
        category: 'Infrastructure',
        expectedResolution: '2026-08-23',
        jiraIssue: 'SCRUM-12',
        preventingAllWork: false,
      },
    },
  });
  assert(details.title === 'Slack connection', 'title extracted');
  assert(details.description.includes('OAuth'), 'description extracted');
  assert(details.severity.toLowerCase() === 'medium', 'severity extracted');
  assert(details.jiraIssue === 'SCRUM-12', 'jira extracted');
  assert(details.expectedResolution === '2026-08-23', 'expected resolution extracted');
  console.log('✓ Structured blocker details extraction');

  // --- Report profiles: BLOCKER type + No vs Yes ---
  const profiles = buildParticipantProfiles([
    {
      status: 'completed',
      user: { slackUserId: 'U1', slackDisplayName: 'Karam' },
      answers: [
        {
          text: 'No',
          structuredValue: { value: false },
          question: {
            question: 'Is anything blocking your progress?',
            type: QuestionType.BLOCKER,
            order: 3,
          },
        },
      ],
    },
    {
      status: 'completed',
      user: { slackUserId: 'U2', slackDisplayName: 'Rami' },
      answers: [
        {
          text: 'Yes\n\nSlack connection',
          structuredValue: {
            value: true,
            blocked: true,
            blocker: { title: 'Slack connection', description: 'OAuth', severity: 'Medium' },
          },
          question: {
            question: 'Is anything blocking your progress?',
            type: QuestionType.BLOCKER,
            order: 3,
          },
        },
      ],
    },
  ]);
  const karam = profiles.find((p) => p.displayName === 'Karam');
  const rami = profiles.find((p) => p.displayName === 'Rami');
  assert(karam && karam.blocked === false, 'NO on BLOCKER type → not blocked in report profile');
  assert(rami && rami.blocked === true, 'YES on BLOCKER type → blocked in report profile');
  console.log('✓ Report distinguishes no-blocker Answer from blocked');

  // --- DB: idempotent createFromAnswer + NO does not create ---
  const prisma = new PrismaClient();
  const pules = await prisma.workspace.findFirst({
    where: { slackWorkspaceName: 'Pules project' },
  });
  assert(pules, 'need Pules workspace');
  const user = await prisma.user.findFirst({
    where: { workspaceId: pules!.id },
  });
  assert(user, 'need Pules user');
  const team = await prisma.team.findFirst({
    where: { workspaceId: pules!.id },
  });
  assert(team, 'need Pules team');

  const marker = `blocker-type-spec-${Date.now()}`;
  const checkIn = await prisma.checkIn.create({
    data: {
      teamId: team!.id,
      name: `${marker} Dynamic Blocker Check-in`,
      enabled: false,
      scheduleEnabled: false,
      timezone: 'UTC',
      collectionCron: '0 9 * * 1-5',
      questions: {
        create: [
          {
            question: 'What did you complete?',
            order: 1,
            type: QuestionType.FREE_TEXT,
            isRequired: true,
            isActive: true,
          },
          {
            question: 'What are you working on?',
            order: 2,
            type: QuestionType.FREE_TEXT,
            isRequired: true,
            isActive: true,
          },
          {
            question: 'Is anything blocking your progress?',
            order: 3,
            type: QuestionType.BLOCKER,
            isRequired: true,
            isActive: true,
          },
          {
            question: 'What will you work on next?',
            order: 4,
            type: QuestionType.FREE_TEXT,
            isRequired: true,
            isActive: true,
          },
        ],
      },
    },
    include: { questions: { orderBy: { order: 'asc' } } },
  });

  const blockerQ = checkIn.questions.find((q) => q.type === QuestionType.BLOCKER)!;
  assert(
    blockerQ.question === 'Is anything blocking your progress?',
    'persisted custom BLOCKER wording',
  );
  assert(blockerQ.type === QuestionType.BLOCKER, 'persisted BLOCKER type');

  // Simulate YES answer with structured blocker (modal path)
  const runYes = await prisma.standupRun.create({
    data: {
      teamId: team!.id,
      checkInId: checkIn.id,
      scheduledFor: new Date(),
      status: 'completed',
      triggerSource: 'test',
    },
  });
  const subYes = await prisma.standupSubmission.create({
    data: {
      runId: runYes.id,
      userId: user!.id,
      status: 'completed',
      completedAt: new Date(),
    },
  });
  const answerYes = await prisma.answer.create({
    data: {
      userId: user!.id,
      questionId: blockerQ.id,
      submissionId: subYes.id,
      text: 'Yes\n\nSlack connection\n\nWaiting for OAuth',
      structuredValue: {
        value: true,
        blocked: true,
        blocker: {
          title: 'Slack connection',
          description: 'Waiting for Slack OAuth configuration',
          severity: 'Medium',
          category: 'Infrastructure',
          expectedResolution: '2026-08-23',
          jiraIssue: 'SCRUM-12',
          preventingAllWork: false,
        },
      },
    },
  });

  const prismaService = prisma as unknown as PrismaService;
  const memoryOutbox = {
    enqueueUpsert: async (args: {
      workspaceId: string;
      sourceType: string;
      sourceId: string;
    }) => {
      await prisma.memoryOutboxEvent.create({
        data: {
          workspaceId: args.workspaceId,
          sourceType: args.sourceType,
          sourceId: args.sourceId,
          operation: 'UPSERT',
          status: 'PENDING',
        },
      });
    },
  } as unknown as MemoryOutboxService;

  const blockerService = new JiraBlockerService(
    prismaService,
    {} as JiraActionService,
    new EventEmitter2(),
    {} as WorkspaceMembersService,
    memoryOutbox,
  );

  const created1 = await blockerService.createFromAnswer({
    userId: user!.id,
    teamId: team!.id,
    checkInId: checkIn.id,
    runId: runYes.id,
    submissionId: subYes.id,
    answerId: answerYes.id,
    title: 'Slack connection',
    description: 'Waiting for Slack OAuth configuration',
    category: 'Infrastructure',
    severity: 'Medium',
    expectedResolution: '2026-08-23',
    linkedIssueKey: 'SCRUM-12',
  });
  const created2 = await blockerService.createFromAnswer({
    userId: user!.id,
    teamId: team!.id,
    checkInId: checkIn.id,
    runId: runYes.id,
    submissionId: subYes.id,
    answerId: answerYes.id,
    title: 'Slack connection DUPLICATE CLICK',
    description: 'Should not create second row',
    severity: 'Critical',
  });
  assert(created1.id === created2.id, 'double createFromAnswer is idempotent per answerId');
  const blockerCount = await prisma.pulseBlocker.count({
    where: { answerId: answerYes.id },
  });
  assert(blockerCount === 1, 'exactly one PulseBlocker for YES answer');
  const outboxCount = await prisma.memoryOutboxEvent.count({
    where: {
      workspaceId: pules!.id,
      sourceType: MEMORY_SOURCE.BLOCKER,
      sourceId: created1.id,
    },
  });
  assert(outboxCount === 1, 'exactly one BLOCKER outbox UPSERT (no duplicate on retry)');
  assert(created1.linkedIssueKey === 'SCRUM-12', 'Jira link preserved');
  assert(created1.expectedResolution === '2026-08-23', 'expected resolution persisted');
  assert(created1.severity === 'medium', 'severity persisted');
  console.log('✓ YES creates PulseBlocker once + outbox once (idempotent)');

  // Simulate NO answer — no PulseBlocker
  const runNo = await prisma.standupRun.create({
    data: {
      teamId: team!.id,
      checkInId: checkIn.id,
      scheduledFor: new Date(Date.now() + 60_000),
      status: 'completed',
      triggerSource: 'test',
    },
  });
  const subNo = await prisma.standupSubmission.create({
    data: {
      runId: runNo.id,
      userId: user!.id,
      status: 'completed',
      completedAt: new Date(),
    },
  });
  const answerNo = await prisma.answer.create({
    data: {
      userId: user!.id,
      questionId: blockerQ.id,
      submissionId: subNo.id,
      text: 'No',
      structuredValue: { value: false },
    },
  });
  const structuredNo = answerNo.structuredValue as {
    blocked?: boolean;
    blocker?: unknown;
  } | null;
  assert(
    !(structuredNo?.blocked === true && structuredNo?.blocker),
    'NO answer has no modal blocker payload',
  );
  const blockersForNo = await prisma.pulseBlocker.count({
    where: { answerId: answerNo.id },
  });
  assert(blockersForNo === 0, 'NO creates no PulseBlocker');
  const fakeChunks = await prisma.memoryChunk.count({
    where: {
      workspaceId: pules!.id,
      sourceType: MEMORY_SOURCE.BLOCKER,
      // no blocker id for NO path
      text: { contains: marker },
    },
  });
  assert(fakeChunks === 0, 'NO creates no fake BLOCKER MemoryChunk');
  console.log('✓ NO creates no PulseBlocker / no fake BLOCKER chunk');

  // Cleanup test check-in graph (keep Pules production data)
  await prisma.pulseBlockerUpdate.deleteMany({
    where: { blockerId: created1.id },
  });
  await prisma.memoryOutboxEvent.deleteMany({
    where: { sourceId: created1.id, sourceType: MEMORY_SOURCE.BLOCKER },
  });
  await prisma.pulseBlocker.delete({ where: { id: created1.id } });
  await prisma.answer.deleteMany({
    where: { submissionId: { in: [subYes.id, subNo.id] } },
  });
  await prisma.standupSubmission.deleteMany({
    where: { id: { in: [subYes.id, subNo.id] } },
  });
  await prisma.standupRun.deleteMany({
    where: { id: { in: [runYes.id, runNo.id] } },
  });
  await prisma.question.deleteMany({ where: { checkInId: checkIn.id } });
  await prisma.checkIn.delete({ where: { id: checkIn.id } });

  await prisma.$disconnect();
  console.log('\nAll blocker question-type tests passed.');
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
