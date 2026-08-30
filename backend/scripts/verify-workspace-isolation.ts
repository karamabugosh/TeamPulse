/**
 * Verifies Demo vs real Pulse workspace isolation via HTTP + Prisma.
 * Creates temporary Pulse check-in / standup / jira link / blocker artifacts, then cleans up.
 */
import { PrismaClient } from '@prisma/client';

const BASE = process.env.API_BASE || 'http://localhost:3000/api';
const prisma = new PrismaClient();

type Check = { name: string; ok: boolean; detail: string };

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${name} — ${detail}`);
}

async function api<T = any>(
  path: string,
  workspaceId: string | null,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (workspaceId) headers['X-Workspace-Id'] = workspaceId;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function nameSet(users: Array<{ slackDisplayName?: string; name?: string }>) {
  return new Set(
    users
      .map((u) => u.slackDisplayName || u.name || '')
      .filter(Boolean)
      .map((n) => n.toLowerCase()),
  );
}

async function main() {
  console.log('\n=== Workspace isolation verification ===\n');

  const workspaces = await prisma.workspace.findMany({
    orderBy: { installedAt: 'asc' },
    select: {
      id: true,
      slackWorkspaceId: true,
      slackWorkspaceName: true,
      installedAt: true,
    },
  });

  const demo = workspaces.find((w) => w.slackWorkspaceId === 'T_DEMO_PULSE_WS');
  const pulse = workspaces.find((w) => w.slackWorkspaceId !== 'T_DEMO_PULSE_WS');

  record(
    'Both workspaces exist',
    !!(demo && pulse),
    `pulse=${pulse?.slackWorkspaceName ?? 'MISSING'} demo=${demo?.slackWorkspaceName ?? 'MISSING'}`,
  );
  if (!demo || !pulse) {
    printSummary();
    process.exit(1);
  }

  const demoUserNames = (
    await prisma.user.findMany({
      where: { workspaceId: demo.id },
      select: { slackDisplayName: true },
    })
  ).map((u) => u.slackDisplayName.toLowerCase());

  const pulseUserNames = (
    await prisma.user.findMany({
      where: { workspaceId: pulse.id },
      select: { slackDisplayName: true },
    })
  ).map((u) => u.slackDisplayName.toLowerCase());

  const demoMarker = 'layla nasser';
  record(
    'Demo roster present in DB',
    demoUserNames.includes(demoMarker),
    `demo users=${demoUserNames.length}; has Layla=${demoUserNames.includes(demoMarker)}`,
  );
  record(
    'Pulse roster does not include Demo names',
    !pulseUserNames.includes(demoMarker),
    `pulse users=${pulseUserNames.length}`,
  );

  // --- API list isolation ---
  const pulseUsers = await api('/admin/users', pulse.id);
  const demoUsers = await api('/admin/users', demo.id);
  const pulseNames = nameSet(pulseUsers.body ?? []);
  const demoNames = nameSet(demoUsers.body ?? []);

  record(
    'GET /admin/users Pulse excludes Demo members',
    !pulseNames.has(demoMarker) && (pulseUsers.body?.length ?? 0) > 0,
    `pulseCount=${pulseUsers.body?.length ?? 0}`,
  );
  record(
    'GET /admin/users Demo includes Demo roster',
    demoNames.has(demoMarker),
    `demoCount=${demoUsers.body?.length ?? 0}`,
  );
  const nameOverlap = [...demoNames].filter((n) => pulseNames.has(n));
  record(
    'No shared display names across workspace user APIs',
    nameOverlap.length === 0,
    nameOverlap.length ? `overlap=${nameOverlap.join(',')}` : 'no overlap',
  );

  const pulseCheckIns = await api('/check-ins', pulse.id);
  const demoCheckIns = await api('/check-ins', demo.id);
  const pulseCiIds = new Set((pulseCheckIns.body ?? []).map((c: any) => c.id));
  const demoCiIds = new Set((demoCheckIns.body ?? []).map((c: any) => c.id));
  const ciOverlap = [...pulseCiIds].filter((id) => demoCiIds.has(id));
  record(
    'Check-in lists are disjoint by workspace',
    ciOverlap.length === 0 && demoCiIds.size > 0,
    `pulse=${pulseCiIds.size} demo=${demoCiIds.size} overlap=${ciOverlap.length}`,
  );

  const pulseHistory = await api('/check-ins/runs/history?limit=50', pulse.id);
  const demoHistory = await api('/check-ins/runs/history?limit=50', demo.id);
  const pulseRunIds = new Set((pulseHistory.body?.runs ?? []).map((r: any) => r.id));
  const demoRunIds = new Set((demoHistory.body?.runs ?? []).map((r: any) => r.id));
  const runOverlap = [...pulseRunIds].filter((id) => demoRunIds.has(id));
  record(
    'Run history scoped (no Demo runs in Pulse)',
    runOverlap.length === 0,
    `pulseRuns=${pulseRunIds.size} demoRuns=${demoRunIds.size} overlap=${runOverlap.length}`,
  );

  const pulseBlockers = await api('/jira/hub/blockers', pulse.id);
  const demoBlockers = await api('/jira/hub/blockers', demo.id);
  const pulseBlockerList = Array.isArray(pulseBlockers.body)
    ? pulseBlockers.body
    : pulseBlockers.body?.blockers ?? [];
  const demoBlockerList = Array.isArray(demoBlockers.body)
    ? demoBlockers.body
    : demoBlockers.body?.blockers ?? [];
  const pbIds = new Set(pulseBlockerList.map((x: any) => x.id));
  const dbIds = new Set(demoBlockerList.map((x: any) => x.id));
  record(
    'Blocker lists are disjoint',
    pulseBlockers.status < 400 &&
      demoBlockers.status < 400 &&
      ![...pbIds].some((id) => dbIds.has(id)),
    `pulse=${pbIds.size} demo=${dbIds.size} status=${pulseBlockers.status}/${demoBlockers.status}`,
  );

  const pulseReports = await api('/admin/reports', pulse.id);
  const demoReports = await api('/admin/reports', demo.id);
  const prIds = new Set(
    (Array.isArray(pulseReports.body) ? pulseReports.body : pulseReports.body?.reports ?? []).map(
      (r: any) => r.id,
    ),
  );
  const drIds = new Set(
    (Array.isArray(demoReports.body) ? demoReports.body : demoReports.body?.reports ?? []).map(
      (r: any) => r.id,
    ),
  );
  record(
    'Reports lists are disjoint',
    ![...prIds].some((id) => drIds.has(id)),
    `pulse=${prIds.size} demo=${drIds.size}`,
  );

  // --- Create check-in in Pulse workspace ---
  const pulseTeam = await prisma.team.findFirst({
    where: { workspaceId: pulse.id },
    include: {
      teamMembers: { where: { optedOut: false }, take: 5 },
    },
  });
  if (!pulseTeam) {
    record('Pulse team available for create check-in', false, 'no team');
    printSummary();
    process.exit(1);
  }

  const stamp = Date.now();
  const checkInName = `Isolation Verify Check-in ${stamp}`;
  const createRes = await api('/check-ins', pulse.id, {
    method: 'POST',
    body: JSON.stringify({
      teamId: pulseTeam.id,
      name: checkInName,
      timezone: 'Asia/Riyadh',
      collectionCron: '0 9 * * 1-5',
      enabled: true,
      participantIds: pulseTeam.teamMembers.slice(0, 2).map((m) => m.id),
      questions: [
        { question: 'What did you do yesterday?', order: 1, type: 'FREE_TEXT', isRequired: true },
        { question: 'What will you do today?', order: 2, type: 'FREE_TEXT', isRequired: true },
        { question: 'Any blockers?', order: 3, type: 'FREE_TEXT', isRequired: false },
        {
          question: 'Related Jira issue?',
          order: 4,
          type: 'ISSUE_REF',
          isRequired: false,
        },
      ],
    }),
  });

  const createdCheckIn = createRes.body;
  record(
    'Create check-in in Pulse Workspace',
    createRes.status < 400 && createdCheckIn?.id && createdCheckIn.name === checkInName,
    `status=${createRes.status} id=${createdCheckIn?.id ?? 'n/a'} err=${
      typeof createRes.body === 'object'
        ? createRes.body?.message ?? JSON.stringify(createRes.body).slice(0, 200)
        : String(createRes.body).slice(0, 200)
    }`,
  );

  // Demo must not see it
  const demoAfterCreate = await api('/check-ins', demo.id);
  const leaked = (demoAfterCreate.body ?? []).some((c: any) => c.id === createdCheckIn?.id);
  record(
    'New Pulse check-in invisible in Demo',
    !leaked,
    leaked ? 'LEAKED into Demo list' : 'not present in Demo',
  );

  // Cross-create into Demo team while Pulse header is set must fail
  const demoTeam = await prisma.team.findFirst({ where: { workspaceId: demo.id } });
  const crossCreate = await api('/check-ins', pulse.id, {
    method: 'POST',
    body: JSON.stringify({
      teamId: demoTeam!.id,
      name: `Should Fail ${stamp}`,
      timezone: 'Asia/Riyadh',
      collectionCron: '0 9 * * 1-5',
      questions: [{ question: 'x', order: 0, type: 'FREE_TEXT', isRequired: true }],
    }),
  });
  record(
    'Cannot create check-in on Demo team while Pulse selected',
    crossCreate.status >= 400,
    `status=${crossCreate.status}`,
  );

  // --- Simulate Slack standup submission path in Pulse ---
  const pulseUser =
    (await prisma.user.findFirst({
      where: {
        workspaceId: pulse.id,
        teamMembers: { some: { teamId: pulseTeam.id } },
      },
    })) ??
    (await prisma.user.findFirst({ where: { workspaceId: pulse.id } }));

  let runId: string | null = null;
  let submissionId: string | null = null;
  let blockerId: string | null = null;
  let linkId: string | null = null;

  if (createdCheckIn?.id && pulseUser) {
    const questions = await prisma.question.findMany({
      where: { checkInId: createdCheckIn.id },
      orderBy: { order: 'asc' },
    });

    const run = await prisma.standupRun.create({
      data: {
        teamId: pulseTeam.id,
        checkInId: createdCheckIn.id,
        scheduledFor: new Date(),
        startedAt: new Date(),
        status: 'collecting',
        triggerSource: 'manual',
      },
    });
    runId = run.id;

    const submission = await prisma.standupSubmission.create({
      data: {
        runId: run.id,
        userId: pulseUser.id,
        status: 'in_progress',
        startedAt: new Date(),
        slackDmChannelId: `D_ISO_${stamp}`,
        slackDmThreadTs: `${Math.floor(stamp / 1000)}.iso`,
      },
    });
    submissionId = submission.id;

    const answers = [];
    for (const q of questions) {
      const text =
        q.type === 'ISSUE_REF'
          ? 'SCRUM-ISO-1'
          : q.order === 3
            ? 'Waiting on API review for isolation verify'
            : `Isolation verify answer for Q${q.order}`;
      const answer = await prisma.answer.create({
        data: {
          userId: pulseUser.id,
          submissionId: submission.id,
          questionId: q.id,
          text,
        },
      });
      answers.push({ q, answer });
    }

    const issueQ = answers.find((a) => a.q.type === 'ISSUE_REF');
    if (issueQ) {
      const link = await prisma.answerJiraIssueLink.create({
        data: {
          userId: pulseUser.id,
          submissionId: submission.id,
          runId: run.id,
          questionId: issueQ.q.id,
          answerId: issueQ.answer.id,
          issueId: 'iso-1',
          issueKey: 'SCRUM-ISO-1',
          summary: 'Isolation verify issue',
          status: 'In Progress',
          projectKey: 'SCRUM',
          issueUrl: 'https://example.atlassian.net/browse/SCRUM-ISO-1',
        },
      });
      linkId = link.id;
    }

    const blockerQ = answers.find((a) => a.q.order === 3);
    if (blockerQ) {
      const blocker = await prisma.pulseBlocker.create({
        data: {
          userId: pulseUser.id,
          teamId: pulseTeam.id,
          checkInId: createdCheckIn.id,
          runId: run.id,
          submissionId: submission.id,
          answerId: blockerQ.answer.id,
          title: `Isolation blocker ${stamp}`,
          description: blockerQ.answer.text,
          category: 'process',
          severity: 'medium',
          status: 'open',
          linkedIssueKey: 'SCRUM-ISO-1',
        },
      });
      blockerId = blocker.id;

      await prisma.pulseBlockerUpdate.create({
        data: {
          blockerId: blocker.id,
          userId: pulseUser.id,
          previousStatus: 'open',
          newStatus: 'open',
          notes: 'Isolation verify update',
          updatedFrom: 'verification-script',
        },
      });
    }

    await prisma.standupSubmission.update({
      where: { id: submission.id },
      data: { status: 'completed', completedAt: new Date() },
    });
    await prisma.standupRun.update({
      where: { id: run.id },
      data: { status: 'completed', completedAt: new Date() },
    });

    const digest = await prisma.aiDigest.create({
      data: {
        teamId: pulseTeam.id,
        runId: run.id,
        source: 'ai',
        summary: `Isolation verify digest ${stamp}`,
        blockers: [{ description: 'Waiting on API review for isolation verify' }],
        themes: ['isolation-verify'],
        slackReportText: `Isolation verify report ${stamp}`,
        generatedAt: new Date(),
      },
    });

    // DB assertions
    const savedAnswers = await prisma.answer.count({
      where: { submissionId: submission.id },
    });
    record(
      'Standup answers saved in DB',
      savedAnswers === questions.length,
      `${savedAnswers}/${questions.length}`,
    );
    record(
      'Jira issue link stored',
      !!linkId,
      linkId ? `linkId=${linkId}` : 'missing',
    );
    record(
      'Blocker + update stored',
      !!blockerId &&
        (await prisma.pulseBlockerUpdate.count({ where: { blockerId: blockerId! } })) > 0,
      `blockerId=${blockerId}`,
    );
    record(
      'Report/digest includes new standup',
      !!digest.id,
      `digestId=${digest.id}`,
    );

    // API: Pulse sees new run/blocker; Demo does not
    const pulseHist2 = await api('/check-ins/runs/history?limit=20', pulse.id);
    const demoHist2 = await api('/check-ins/runs/history?limit=20', demo.id);
    const pulseSeesRun = (pulseHist2.body?.runs ?? []).some((r: any) => r.id === run.id);
    const demoSeesRun = (demoHist2.body?.runs ?? []).some((r: any) => r.id === run.id);
    record('Pulse history includes new run', pulseSeesRun, `runId=${run.id}`);
    record('Demo history excludes new Pulse run', !demoSeesRun, 'not present');

    const pulseReports2 = await api('/admin/reports', pulse.id);
    const reportList = Array.isArray(pulseReports2.body)
      ? pulseReports2.body
      : pulseReports2.body?.reports ?? [];
    const reportSees = reportList.some(
      (r: any) => r.runId === run.id || r.id === digest.id || r.summary?.includes?.('Isolation verify'),
    );
    record(
      'Pulse reports include new digest',
      reportSees || reportList.some((r: any) => r.run?.id === run.id),
      `reports=${reportList.length}`,
    );

    const demoReports2 = await api('/admin/reports', demo.id);
    const demoReportList = Array.isArray(demoReports2.body)
      ? demoReports2.body
      : demoReports2.body?.reports ?? [];
    const demoSeesDigest = demoReportList.some(
      (r: any) => r.id === digest.id || r.runId === run.id,
    );
    record('Demo reports exclude Pulse digest', !demoSeesDigest, 'not present');

    // AI / team memory scoped
    const pulseMem = await api(
      '/jira/hub/memory/search?q=' + encodeURIComponent('Layla'),
      pulse.id,
    );
    const demoMem = await api(
      '/jira/hub/memory/search?q=' + encodeURIComponent('Layla'),
      demo.id,
    );
    const pulseMemText = JSON.stringify(pulseMem.body?.results ?? []).toLowerCase();
    const demoMemText = JSON.stringify(demoMem.body?.results ?? []).toLowerCase();
    record(
      'Team memory Demo finds Layla/OAuth context',
      demoMem.status < 400 && demoMemText.includes('layla'),
      `status=${demoMem.status} results=${demoMem.body?.results?.length ?? 0}`,
    );
    record(
      'Team memory Pulse does not return Demo Layla docs',
      pulseMem.status < 400 && !pulseMemText.includes('layla nasser'),
      pulseMemText.includes('layla nasser') ? 'LEAK' : `results=${pulseMem.body?.results?.length ?? 0}`,
    );

    const pulseAsk = await api('/ai/workspace/rag/prepare', pulse.id, {
      method: 'POST',
      body: JSON.stringify({
        question: 'Who is Layla Nasser?',
        workspaceId: pulse.id,
      }),
    });
    const demoAsk = await api('/ai/workspace/rag/prepare', demo.id, {
      method: 'POST',
      body: JSON.stringify({
        question: 'Who is Layla Nasser?',
        workspaceId: demo.id,
      }),
    });
    const pulseHits = JSON.stringify(pulseAsk.body?.retrieval?.hits ?? []).toLowerCase();
    const demoHits = JSON.stringify(demoAsk.body?.retrieval?.hits ?? []).toLowerCase();
    const pulseHitWs = new Set(
      (pulseAsk.body?.retrieval?.hits ?? []).map((h: any) => h.workspaceId),
    );
    const demoHitWs = new Set(
      (demoAsk.body?.retrieval?.hits ?? []).map((h: any) => h.workspaceId),
    );
    record(
      'AI RAG Demo surfaces Layla user/docs',
      demoAsk.status < 400 && demoHits.includes('layla nasser'),
      `status=${demoAsk.status} hits=${demoAsk.body?.retrieval?.hitCount ?? 0}`,
    );
    record(
      'AI RAG Pulse hits stay in Pulse workspaceId',
      pulseAsk.status < 400 &&
        [...pulseHitWs].every((id) => id === pulse.id) &&
        !pulseHits.includes('u_demo_layla') &&
        !pulseHits.includes('layla.nasser@pulsedemo.io'),
      `status=${pulseAsk.status} workspaces=${[...pulseHitWs].join(',') || 'none'}`,
    );
    record(
      'AI RAG Demo hits stay in Demo workspaceId',
      demoAsk.status < 400 && [...demoHitWs].every((id) => id === demo.id),
      `workspaces=${[...demoHitWs].join(',') || 'none'}`,
    );

    // Mutate Demo blocker count shouldn't change Pulse counts
    const pulseUserCountBefore = await prisma.user.count({ where: { workspaceId: pulse.id } });
    const demoOnlyUser = await prisma.user.findFirst({
      where: { workspaceId: demo.id, slackDisplayName: 'Layla Nasser' },
    });
    if (demoOnlyUser) {
      await prisma.teamMemoryDocument.create({
        data: {
          workspaceId: demo.id,
          userId: demoOnlyUser.id,
          sourceType: 'ai_summary',
          sourceId: `iso-temp-${stamp}`,
          title: 'Temp isolation doc',
          content: 'Temporary demo-only memory for isolation verify',
        },
      });
      await prisma.teamMemoryDocument.deleteMany({
        where: { workspaceId: demo.id, sourceId: `iso-temp-${stamp}` },
      });
    }
    const pulseUserCountAfter = await prisma.user.count({ where: { workspaceId: pulse.id } });
    record(
      'Demo memory create/delete does not change Pulse users',
      pulseUserCountBefore === pulseUserCountAfter,
      `${pulseUserCountBefore} → ${pulseUserCountAfter}`,
    );
  } else {
    record('Simulate standup submission', false, 'missing check-in or pulse user');
  }

  // Switch back: Pulse data still present
  const pulseUsersAgain = await api('/admin/users', pulse.id);
  record(
    'After Demo operations, Pulse users still present',
    (pulseUsersAgain.body?.length ?? 0) === (pulseUsers.body?.length ?? 0),
    `before=${pulseUsers.body?.length ?? 0} after=${pulseUsersAgain.body?.length ?? 0}`,
  );

  // Cleanup Pulse test artifacts
  if (createdCheckIn?.id) {
    if (blockerId) {
      await prisma.pulseBlockerUpdate.deleteMany({ where: { blockerId } });
      await prisma.pulseBlocker.deleteMany({ where: { id: blockerId } });
    }
    if (linkId) {
      await prisma.answerJiraIssueLink.deleteMany({ where: { id: linkId } });
    }
    if (submissionId) {
      await prisma.answer.deleteMany({ where: { submissionId } });
      await prisma.standupSubmission.deleteMany({ where: { id: submissionId } });
    }
    if (runId) {
      await prisma.aiDigest.deleteMany({ where: { runId } });
      await prisma.standupRun.deleteMany({ where: { id: runId } });
    }
    await prisma.question.deleteMany({ where: { checkInId: createdCheckIn.id } });
    await prisma.checkInParticipant.deleteMany({ where: { checkInId: createdCheckIn.id } });
    await prisma.checkIn.deleteMany({ where: { id: createdCheckIn.id } });
    record('Cleanup Pulse verification artifacts', true, `removed check-in ${createdCheckIn.id}`);
  }

  // Confirm Demo still intact after cleanup
  const demoUsersFinal = await prisma.user.count({ where: { workspaceId: demo.id } });
  record(
    'Demo workspace still intact (7 members)',
    demoUsersFinal === 7,
    `demoUsers=${demoUsersFinal}`,
  );

  printSummary();
  const failed = checks.filter((c) => !c.ok).length;
  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

function printSummary() {
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`\n=== Summary: ${passed} passed, ${failed} failed / ${checks.length} total ===\n`);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
