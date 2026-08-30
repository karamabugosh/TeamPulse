/**
 * Untangle Pules project business-source graph from TeamPulse Workspace.
 *
 * Default: DRY RUN (no writes).
 * Apply:   node scripts/untangle-pules-from-teampulse.js --apply
 *
 * Does NOT delete TeamPulse Workspace.
 * Does NOT move User.workspaceId.
 * Does NOT fabricate MemoryChunk embeddings (source Answer IDs preserved).
 */
const crypto = require('crypto');
const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;

const FOCUS = {
  PULES: 'Pules project',
  TP: 'TeamPulse Workspace',
  DEMO: 'Demo Workspace',
};

/** Deterministic UUID namespace for this one-time untangle migration. */
const UNTANGLE_NS = '7f3c9e2a-4b1d-5e68-9c0f-a1b2c3d4e5f6';

const CHECKIN_MARKER_NAME = 'Daily Standup (Pules untangle)';

function deterministicUuid(seed) {
  const h = crypto.createHash('sha256').update(`${UNTANGLE_NS}:${seed}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = Buffer.from(h.subarray(0, 16)).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function emptySafe(ids) {
  return ids.length ? ids : ['__none__'];
}

async function resolveWorkspaces(db) {
  const all = await db.workspace.findMany({
    select: {
      id: true,
      slackWorkspaceName: true,
      slackWorkspaceId: true,
    },
  });
  const byName = (name) => all.filter((w) => w.slackWorkspaceName === name);
  for (const [label, name] of Object.entries(FOCUS)) {
    const hits = byName(name);
    if (hits.length !== 1) {
      throw new Error(
        `Expected exactly 1 workspace named "${name}", found ${hits.length}`,
      );
    }
  }
  return {
    PULES: byName(FOCUS.PULES)[0].id,
    TP: byName(FOCUS.TP)[0].id,
    DEMO: byName(FOCUS.DEMO)[0].id,
    all,
  };
}

async function demoSnapshot(db, demoId) {
  return {
    users: await db.user.count({ where: { workspaceId: demoId } }),
    teams: await db.team.count({ where: { workspaceId: demoId } }),
    chunks: await db.memoryChunk.count({ where: { workspaceId: demoId } }),
    blockers: await db.pulseBlocker.count({ where: { workspaceId: demoId } }),
    digests: await db.aiDigest.count({
      where: { team: { workspaceId: demoId } },
    }),
    answers: await db.answer.count({
      where: { user: { workspaceId: demoId } },
    }),
    checkIns: await db.checkIn.count({
      where: { team: { workspaceId: demoId } },
    }),
    runs: await db.standupRun.count({
      where: { team: { workspaceId: demoId } },
    }),
  };
}

async function loadEntangledAnswers(db, pulesId, tpId) {
  const chunks = await db.memoryChunk.findMany({
    where: { workspaceId: pulesId, sourceType: 'STANDUP_ANSWER' },
    select: { sourceId: true, ownerUserId: true },
  });
  const answerIds = chunks.map((c) => c.sourceId);
  const answers = await db.answer.findMany({
    where: { id: { in: emptySafe(answerIds) } },
    select: {
      id: true,
      userId: true,
      questionId: true,
      submissionId: true,
      text: true,
      structuredValue: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          workspaceId: true,
          slackDisplayName: true,
          slackUserId: true,
        },
      },
      question: {
        select: {
          id: true,
          checkInId: true,
          question: true,
          order: true,
          type: true,
          options: true,
          isRequired: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
          checkIn: {
            select: {
              id: true,
              teamId: true,
              team: { select: { id: true, workspaceId: true, name: true } },
            },
          },
        },
      },
      submission: {
        select: {
          id: true,
          runId: true,
          userId: true,
          status: true,
          startedAt: true,
          completedAt: true,
          slackDmChannelId: true,
          slackDmThreadTs: true,
          createdAt: true,
          updatedAt: true,
          run: {
            select: {
              id: true,
              teamId: true,
              checkInId: true,
              scheduledFor: true,
              status: true,
              triggerSource: true,
              startedAt: true,
              completedAt: true,
              reminderDueAt: true,
              reminderSentAt: true,
              reminderCount: true,
              lastReminderAt: true,
              slackChannelId: true,
              slackThreadTs: true,
              slackRootMessageTs: true,
              slackThreadUrl: true,
              threadReplyCount: true,
              reportDueAt: true,
              reportGeneratedAt: true,
              reportStatus: true,
              createdAt: true,
              updatedAt: true,
              team: { select: { id: true, workspaceId: true, name: true } },
            },
          },
        },
      },
    },
  });

  const entangled = [];
  const alreadyOk = [];
  const ambiguous = [];

  for (const a of answers) {
    if (a.user.workspaceId !== pulesId) {
      ambiguous.push({
        kind: 'ANSWER_AUTHOR_NOT_PULES',
        answerId: a.id,
        authorWs: a.user.workspaceId,
      });
      continue;
    }
    const subWs = a.submission?.run?.team?.workspaceId;
    const qWs = a.question?.checkIn?.team?.workspaceId;
    if (!a.submissionId || !a.submission?.run) {
      ambiguous.push({ kind: 'ANSWER_MISSING_SUBMISSION_GRAPH', answerId: a.id });
      continue;
    }
    // Submission ancestry is the business-source authority for workspace ownership.
    // Legacy Pules answers may have question.checkInId = null — still OK if run is Pules.
    if (subWs === pulesId) {
      if (!qWs || qWs === pulesId) {
        alreadyOk.push(a);
        continue;
      }
      // Pules run + foreign question (unexpected)
      ambiguous.push({
        kind: 'ANSWER_PULES_RUN_FOREIGN_QUESTION',
        answerId: a.id,
        subWs,
        qWs,
      });
      continue;
    }
    if (subWs === tpId) {
      entangled.push(a);
      continue;
    }
    ambiguous.push({
      kind: 'ANSWER_UNEXPECTED_WORKSPACE',
      answerId: a.id,
      subWs,
      qWs,
    });
  }

  return { chunks, answers, entangled, alreadyOk, ambiguous };
}

async function plan(db) {
  const ids = await resolveWorkspaces(db);
  const { PULES, TP, DEMO } = ids;

  const pulesTeams = await db.team.findMany({
    where: { workspaceId: PULES },
    select: { id: true, name: true },
  });
  if (pulesTeams.length !== 1) {
    throw new Error(
      `Expected exactly 1 Pules team, found ${pulesTeams.length}`,
    );
  }
  const pulesTeam = pulesTeams[0];

  const tpCheckIns = await db.checkIn.findMany({
    where: { team: { workspaceId: TP } },
    select: { id: true, name: true, teamId: true },
  });

  const loaded = await loadEntangledAnswers(db, PULES, TP);
  const { entangled, alreadyOk, ambiguous, chunks } = loaded;

  // Critical ambiguity stop conditions
  const criticalAmbiguous = ambiguous.filter((a) =>
    [
      'ANSWER_AUTHOR_NOT_PULES',
      'ANSWER_MISSING_SUBMISSION_GRAPH',
      'ANSWER_UNEXPECTED_WORKSPACE',
      'ANSWER_PULES_RUN_FOREIGN_QUESTION',
      'MULTIPLE_SOURCE_CHECKINS',
      'MULTIPLE_SOURCE_TEAMS',
    ].includes(a.kind),
  );

  const sourceCheckInIds = [
    ...new Set(
      entangled
        .map((a) => a.submission?.run?.checkInId || a.question?.checkInId)
        .filter(Boolean),
    ),
  ];
  if (sourceCheckInIds.length > 1) {
    criticalAmbiguous.push({
      kind: 'MULTIPLE_SOURCE_CHECKINS',
      checkInIds: sourceCheckInIds,
    });
  }

  const sourceTeamIds = [
    ...new Set(entangled.map((a) => a.submission.run.teamId)),
  ];
  if (sourceTeamIds.length > 1) {
    criticalAmbiguous.push({
      kind: 'MULTIPLE_SOURCE_TEAMS',
      teamIds: sourceTeamIds,
    });
  }

  const tpCheckInId = sourceCheckInIds[0] || null;
  const tpTeamId = sourceTeamIds[0] || null;

  let tpCheckIn = null;
  let tpQuestions = [];
  if (tpCheckInId) {
    tpCheckIn = await db.checkIn.findUnique({ where: { id: tpCheckInId } });
    tpQuestions = await db.question.findMany({
      where: { checkInId: tpCheckInId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
  }

  const questionIdsNeeded = [
    ...new Set(entangled.map((a) => a.questionId)),
  ];
  const runIdsNeeded = [
    ...new Set(entangled.map((a) => a.submission.runId)),
  ];
  const submissionIdsNeeded = [
    ...new Set(entangled.map((a) => a.submissionId)),
  ];

  // Classify sharedness of runs
  const runShare = [];
  for (const runId of runIdsNeeded) {
    const subs = await db.standupSubmission.findMany({
      where: { runId },
      select: {
        id: true,
        user: { select: { workspaceId: true } },
      },
    });
    const pulesN = subs.filter((s) => s.user.workspaceId === PULES).length;
    const tpN = subs.filter((s) => s.user.workspaceId === TP).length;
    runShare.push({
      runId,
      pulesSubs: pulesN,
      tpSubs: tpN,
      shared: pulesN > 0 && tpN > 0,
      exclusivelyPules: pulesN > 0 && tpN === 0,
    });
  }

  // Blockers needing FK repair
  const blockers = await db.pulseBlocker.findMany({
    where: { workspaceId: PULES },
  });
  const tpRunIdSet = new Set(
    (
      await db.standupRun.findMany({
        where: { team: { workspaceId: TP } },
        select: { id: true },
      })
    ).map((r) => r.id),
  );
  const blockersNeedingRepair = blockers.filter(
    (b) =>
      (b.teamId && b.teamId !== pulesTeam.id) ||
      (b.runId && tpRunIdSet.has(b.runId)) ||
      (b.checkInId && tpCheckInId && b.checkInId === tpCheckInId),
  );

  // Jira links on entangled submissions
  const jiraLinks = await db.answerJiraIssueLink.findMany({
    where: {
      workspaceId: PULES,
      submissionId: { in: emptySafe(submissionIdsNeeded) },
    },
  });

  // Resolution updates (source IDs for BLOCKER_RESOLUTION chunks)
  const resChunks = await db.memoryChunk.findMany({
    where: { workspaceId: PULES, sourceType: 'BLOCKER_RESOLUTION' },
    select: { sourceId: true },
  });
  const resolutionUpdates = await db.pulseBlockerUpdate.findMany({
    where: { id: { in: emptySafe(resChunks.map((c) => c.sourceId)) } },
  });

  // Reports already on Pules?
  const reportChunks = await db.memoryChunk.findMany({
    where: { workspaceId: PULES, sourceType: 'REPORT' },
    select: { sourceId: true, teamId: true },
  });
  const reportDigests = await db.aiDigest.findMany({
    where: { id: { in: emptySafe([...new Set(reportChunks.map((c) => c.sourceId))]) } },
    select: {
      id: true,
      teamId: true,
      runId: true,
      team: { select: { workspaceId: true } },
    },
  });
  const reportOk = reportDigests.every((d) => d.team.workspaceId === PULES);

  // Existing cloned check-in?
  const existingClone = await db.checkIn.findFirst({
    where: { teamId: pulesTeam.id, name: CHECKIN_MARKER_NAME },
    include: { questions: true },
  });

  const targetCheckInId =
    existingClone?.id ||
    (tpCheckInId ? deterministicUuid(`checkin:${tpCheckInId}`) : null);

  const questionMap = new Map(); // oldQ -> newQ
  for (const qid of questionIdsNeeded) {
    questionMap.set(qid, deterministicUuid(`question:${qid}`));
  }

  const runMap = new Map(); // oldRun -> newRun
  for (const rid of runIdsNeeded) {
    runMap.set(rid, deterministicUuid(`run:${rid}`));
  }

  // Authors / membership
  const authorIds = [...new Set(entangled.map((a) => a.userId))];
  const existingMembers = await db.teamMember.findMany({
    where: { teamId: pulesTeam.id, userId: { in: emptySafe(authorIds) } },
  });
  const memberUserIds = new Set(existingMembers.map((m) => m.userId));
  const authorsMissingMembership = authorIds.filter((id) => !memberUserIds.has(id));

  // ConversationState currentQuestionId needing remap
  const convStates = await db.conversationState.findMany({
    where: { submissionId: { in: emptySafe(submissionIdsNeeded) } },
    select: { id: true, submissionId: true, currentQuestionId: true },
  });
  const convNeedingQRemap = convStates.filter(
    (c) => c.currentQuestionId && questionMap.has(c.currentQuestionId),
  );

  // Thread updates
  const threadUpdates = await db.standupThreadUpdate.findMany({
    where: {
      OR: [
        { submissionId: { in: emptySafe(submissionIdsNeeded) } },
        { runId: { in: emptySafe(runIdsNeeded) } },
      ],
    },
    select: { id: true, runId: true, submissionId: true },
  });

  // TeamMemoryDocument with TP run refs
  const tmds = await db.teamMemoryDocument.findMany({
    where: {
      workspaceId: PULES,
      runId: { in: emptySafe(runIdsNeeded) },
    },
    select: { id: true, runId: true, submissionId: true, sourceType: true },
  });

  // Jira connection / SCRUM-9 baseline
  const jiraConnections = await db.jiraConnection.findMany({
    where: { workspaceId: PULES },
    select: { id: true, userId: true, siteUrl: true, cloudId: true },
  });
  const scrum9Cache = await db.jiraIssueCacheEntry.findMany({
    where: { workspaceId: PULES, issueKey: 'SCRUM-9' },
  });
  const scrum9Links = await db.answerJiraIssueLink.findMany({
    where: { workspaceId: PULES, issueKey: 'SCRUM-9' },
    select: { id: true, answerId: true, submissionId: true, userId: true },
  });

  const demoBefore = await demoSnapshot(db, DEMO);

  const chunkCounts = await db.memoryChunk.groupBy({
    by: ['sourceType'],
    where: { workspaceId: PULES },
    _count: true,
  });

  // Users: do not move — report only
  const usersAffected = authorIds.map((id) => {
    const a = entangled.find((x) => x.userId === id);
    return {
      userId: id,
      name: a?.user.slackDisplayName,
      action: 'PRESERVE_USER_WORKSPACE_ID',
      ensureTeamMember: !memberUserIds.has(id),
    };
  });

  // Classify ownership categories for report
  const classification = {
    A_reassign_or_reconstruct: {
      answers: entangled.length,
      submissions: submissionIdsNeeded.length,
      runs_to_clone: runIdsNeeded.length,
      questions_to_clone: questionIdsNeeded.length,
      checkIns_to_clone: tpCheckInId ? 1 : 0,
      blockers: blockersNeedingRepair.length,
      jiraLinks: jiraLinks.length,
    },
    B_remain_teampulse: {
      tpCheckIn: tpCheckIn
        ? { id: tpCheckIn.id, name: tpCheckIn.name }
        : null,
      tpTeamId,
      sharedRuns: runShare.filter((r) => r.shared).length,
      exclusivelyPulesRuns: runShare.filter((r) => r.exclusivelyPules).length,
      note: 'TP parents left intact; Pules graph reconstructed beside them',
    },
    C_shared_global_no_blind_move: {
      users: usersAffected.length,
      jiraConnections: jiraConnections.length,
      note: 'User.workspaceId and live Jira untouched',
    },
    D_ambiguous_critical: criticalAmbiguous,
  };

  return {
    ids,
    pulesTeam,
    tpCheckIn,
    tpQuestions,
    tpCheckInId,
    tpTeamId,
    targetCheckInId,
    existingClone,
    questionMap,
    runMap,
    questionIdsNeeded,
    runIdsNeeded,
    submissionIdsNeeded,
    entangled,
    alreadyOk,
    ambiguous,
    criticalAmbiguous,
    runShare,
    blockers,
    blockersNeedingRepair,
    jiraLinks,
    resolutionUpdates,
    reportChunks,
    reportDigests,
    reportOk,
    convStates,
    convNeedingQRemap,
    threadUpdates,
    tmds,
    jiraConnections,
    scrum9Cache,
    scrum9Links,
    demoBefore,
    chunkCounts,
    usersAffected,
    authorsMissingMembership,
    authorIds,
    chunks,
    classification,
  };
}

function printDryRunReport(planData) {
  const p = planData;
  console.log('\n========== DRY-RUN REPORT ==========');
  console.log('Mode:', DRY_RUN ? 'DRY-RUN (no writes)' : 'APPLY');
  console.log('Workspaces:', {
    PULES: p.ids.PULES,
    TP: p.ids.TP,
    DEMO: p.ids.DEMO,
  });
  console.log('Pules team:', p.pulesTeam);
  console.log('\nPules answers requiring repair:', p.entangled.length);
  console.log('Pules answers already OK:', p.alreadyOk.length);
  console.log('Pules submissions requiring repair:', p.submissionIdsNeeded.length);
  console.log('CheckIns to clone/ensure:', p.tpCheckInId ? 1 : 0, {
    source: p.tpCheckIn
      ? { id: p.tpCheckIn.id, name: p.tpCheckIn.name }
      : null,
    targetId: p.targetCheckInId,
    targetName: CHECKIN_MARKER_NAME,
    existingClone: !!p.existingClone,
  });
  console.log('Runs to clone/ensure:', p.runIdsNeeded.length, {
    shared: p.runShare.filter((r) => r.shared).length,
    exclusivelyPules: p.runShare.filter((r) => r.exclusivelyPules).length,
  });
  console.log('Teams affected:', 1, p.pulesTeam.name, '(reconstruct onto; no team reparent)');
  console.log('Questions to clone/ensure:', p.questionIdsNeeded.length, '/', 'source check-in questions:', p.tpQuestions.length);
  console.log('Reports repaired:', 0, p.reportOk ? '(already Pules-owned)' : '(NEEDS ATTENTION)');
  console.log('Blockers repaired:', p.blockersNeedingRepair.length);
  console.log('Resolutions (updates preserved, blocker FKs repaired):', p.resolutionUpdates.length);
  console.log('Jira links to retarget runId:', p.jiraLinks.length);
  console.log('Users/members affected:', p.usersAffected);
  console.log('Authors missing Pules membership (will ensure):', p.authorsMissingMembership);
  console.log('ConversationStates question remap:', p.convNeedingQRemap.length);
  console.log('ThreadUpdates run retarget:', p.threadUpdates.length);
  console.log('TeamMemoryDocuments run retarget:', p.tmds.length);
  console.log('Ambiguous records:', p.criticalAmbiguous.length);
  if (p.criticalAmbiguous.length) {
    console.log(JSON.stringify(p.criticalAmbiguous, null, 2));
  }
  console.log('\nOwnership classification:', JSON.stringify(p.classification, null, 2));
  console.log('\nDemo baseline:', p.demoBefore);
  console.log('Pules chunk counts:', p.chunkCounts);
  console.log('Jira connections preserved:', p.jiraConnections.length);
  console.log('SCRUM-9 cache rows:', p.scrum9Cache.length);
  console.log('SCRUM-9 links:', p.scrum9Links.length);
  console.log('====================================\n');
}

async function applyRepair(db, planData) {
  const {
    ids,
    pulesTeam,
    tpCheckIn,
    tpQuestions,
    tpCheckInId,
    targetCheckInId,
    questionMap,
    runMap,
    entangled,
    submissionIdsNeeded,
    runIdsNeeded,
    blockersNeedingRepair,
    authorIds,
    authorsMissingMembership,
  } = planData;
  const { PULES } = ids;

  if (!tpCheckIn || !targetCheckInId) {
    throw new Error('Nothing to apply: no TeamPulse source check-in for entangled answers');
  }

  const stats = {
    checkInsCreated: 0,
    questionsCreated: 0,
    runsCreated: 0,
    submissionsMoved: 0,
    answersQuestionRemapped: 0,
    blockersUpdated: 0,
    jiraLinksUpdated: 0,
    threadUpdatesUpdated: 0,
    convStatesUpdated: 0,
    tmdsUpdated: 0,
    membersEnsured: 0,
    participantsEnsured: 0,
  };

  await db.$transaction(
    async (tx) => {
      // 1) Ensure CheckIn
      let checkIn = await tx.checkIn.findUnique({ where: { id: targetCheckInId } });
      if (!checkIn) {
        checkIn = await tx.checkIn.create({
          data: {
            id: targetCheckInId,
            teamId: pulesTeam.id,
            name: CHECKIN_MARKER_NAME,
            description:
              'Reconstructed Pules-owned Daily Standup graph (untangled from TeamPulse). Historical content preserved.',
            introMessage: tpCheckIn.introMessage,
            outroMessage: tpCheckIn.outroMessage,
            enabled: false, // archival/historical — do not schedule
            timezone: tpCheckIn.timezone,
            collectionCron: tpCheckIn.collectionCron,
            updatesChannelId: tpCheckIn.updatesChannelId,
            reminderEnabled: false,
            reminderMinutesAfter: tpCheckIn.reminderMinutesAfter,
            reminderRecurringEnabled: false,
            reminderIntervalMinutes: tpCheckIn.reminderIntervalMinutes,
            reminderOnlyNonResponders: tpCheckIn.reminderOnlyNonResponders,
            reminderOnSlackActive: false,
            reportCron: null,
            reportTriggerMode: tpCheckIn.reportTriggerMode,
            reportTimeoutMinutes: tpCheckIn.reportTimeoutMinutes,
            publishStatus: 'published',
            scheduleEnabled: false,
            createdAt: tpCheckIn.createdAt,
          },
        });
        stats.checkInsCreated++;
      }

      // 2) Clone questions (all from source check-in for completeness; remap used ones)
      for (const q of tpQuestions) {
        const newId = deterministicUuid(`question:${q.id}`);
        const existing = await tx.question.findUnique({ where: { id: newId } });
        if (!existing) {
          await tx.question.create({
            data: {
              id: newId,
              checkInId: checkIn.id,
              question: q.question,
              order: q.order,
              type: q.type,
              options: q.options ?? Prisma.JsonNull,
              isRequired: q.isRequired,
              isActive: q.isActive,
              createdAt: q.createdAt,
              updatedAt: q.updatedAt,
            },
          });
          stats.questionsCreated++;
        }
        questionMap.set(q.id, newId);
      }

      // 3) Ensure team membership for authors
      for (const userId of authorIds) {
        const existing = await tx.teamMember.findUnique({
          where: { teamId_userId: { teamId: pulesTeam.id, userId } },
        });
        if (!existing) {
          await tx.teamMember.create({
            data: { teamId: pulesTeam.id, userId, role: 'member' },
          });
          stats.membersEnsured++;
        }
      }

      // 4) Ensure CheckInParticipants
      const members = await tx.teamMember.findMany({
        where: { teamId: pulesTeam.id, userId: { in: authorIds } },
      });
      for (const m of members) {
        const existing = await tx.checkInParticipant.findUnique({
          where: {
            checkInId_teamMemberId: {
              checkInId: checkIn.id,
              teamMemberId: m.id,
            },
          },
        });
        if (!existing) {
          await tx.checkInParticipant.create({
            data: {
              checkInId: checkIn.id,
              teamMemberId: m.id,
              isActive: true,
            },
          });
          stats.participantsEnsured++;
        }
      }

      // 5) Clone runs + move Pules submissions
      const oldRuns = await tx.standupRun.findMany({
        where: { id: { in: runIdsNeeded } },
      });
      const oldRunById = new Map(oldRuns.map((r) => [r.id, r]));

      for (const oldRunId of runIdsNeeded) {
        const old = oldRunById.get(oldRunId);
        if (!old) throw new Error(`Missing source run ${oldRunId}`);
        const newRunId = runMap.get(oldRunId);
        let run = await tx.standupRun.findUnique({ where: { id: newRunId } });
        if (!run) {
          // Avoid unique(checkInId, scheduledFor) collision: nudge ms if needed
          let scheduledFor = old.scheduledFor;
          const clash = await tx.standupRun.findFirst({
            where: { checkInId: checkIn.id, scheduledFor },
          });
          if (clash && clash.id !== newRunId) {
            scheduledFor = new Date(scheduledFor.getTime() + 1);
          }
          run = await tx.standupRun.create({
            data: {
              id: newRunId,
              teamId: pulesTeam.id,
              checkInId: checkIn.id,
              scheduledFor,
              status: old.status,
              triggerSource: old.triggerSource,
              startedAt: old.startedAt,
              completedAt: old.completedAt,
              reminderDueAt: old.reminderDueAt,
              reminderSentAt: old.reminderSentAt,
              reminderCount: old.reminderCount,
              lastReminderAt: old.lastReminderAt,
              slackChannelId: old.slackChannelId,
              slackThreadTs: old.slackThreadTs,
              slackRootMessageTs: old.slackRootMessageTs,
              slackThreadUrl: old.slackThreadUrl,
              threadReplyCount: old.threadReplyCount,
              reportDueAt: old.reportDueAt,
              reportGeneratedAt: old.reportGeneratedAt,
              reportStatus: old.reportStatus,
              createdAt: old.createdAt,
              updatedAt: old.updatedAt,
            },
          });
          stats.runsCreated++;
        }
      }

      // Move only Pules-authored submissions still on TP runs
      const subs = await tx.standupSubmission.findMany({
        where: {
          id: { in: submissionIdsNeeded },
          runId: { in: runIdsNeeded },
          user: { workspaceId: PULES },
        },
      });
      for (const sub of subs) {
        const newRunId = runMap.get(sub.runId);
        if (!newRunId) throw new Error(`No run map for ${sub.runId}`);
        if (sub.runId === newRunId) continue;
        await tx.standupSubmission.update({
          where: { id: sub.id },
          data: { runId: newRunId },
        });
        stats.submissionsMoved++;
      }

      // 6) Remap Answer.questionId
      for (const a of entangled) {
        const newQ = questionMap.get(a.questionId);
        if (!newQ) throw new Error(`No question map for ${a.questionId}`);
        if (a.questionId === newQ) continue;
        // Only update if still pointing at old question
        const current = await tx.answer.findUnique({
          where: { id: a.id },
          select: { questionId: true },
        });
        if (current && current.questionId !== newQ) {
          await tx.answer.update({
            where: { id: a.id },
            data: { questionId: newQ },
          });
          stats.answersQuestionRemapped++;
        }
      }

      // 7) Remap ConversationState.currentQuestionId
      const convs = await tx.conversationState.findMany({
        where: { submissionId: { in: submissionIdsNeeded } },
      });
      for (const c of convs) {
        if (c.currentQuestionId && questionMap.has(c.currentQuestionId)) {
          await tx.conversationState.update({
            where: { id: c.id },
            data: { currentQuestionId: questionMap.get(c.currentQuestionId) },
          });
          stats.convStatesUpdated++;
        }
      }

      // 8) Retarget thread updates runId for moved submissions / old runs
      const threads = await tx.standupThreadUpdate.findMany({
        where: {
          OR: [
            { submissionId: { in: submissionIdsNeeded } },
            { runId: { in: runIdsNeeded } },
          ],
        },
      });
      for (const t of threads) {
        // Only retarget if this thread belongs to a Pules submission we moved
        if (t.submissionId && submissionIdsNeeded.includes(t.submissionId)) {
          const sub = await tx.standupSubmission.findUnique({
            where: { id: t.submissionId },
            select: { runId: true },
          });
          if (sub && t.runId !== sub.runId) {
            await tx.standupThreadUpdate.update({
              where: { id: t.id },
              data: { runId: sub.runId },
            });
            stats.threadUpdatesUpdated++;
          }
        } else if (t.runId && runMap.has(t.runId)) {
          // Thread on old run without submission — only move if no TP-only meaning.
          // Safer: leave orphan thread on TP run if no submission link.
          // Skip.
        }
      }

      // 9) AnswerJiraIssueLink.runId
      const links = await tx.answerJiraIssueLink.findMany({
        where: {
          workspaceId: PULES,
          submissionId: { in: submissionIdsNeeded },
        },
      });
      for (const link of links) {
        const sub = await tx.standupSubmission.findUnique({
          where: { id: link.submissionId },
          select: { runId: true },
        });
        if (sub && link.runId !== sub.runId) {
          await tx.answerJiraIssueLink.update({
            where: { id: link.id },
            data: { runId: sub.runId },
          });
          stats.jiraLinksUpdated++;
        }
      }

      // 10) PulseBlocker FKs — prefer live submission.runId after move
      for (const b of blockersNeedingRepair) {
        const data = {
          teamId: pulesTeam.id,
          checkInId: checkIn.id,
        };
        if (b.submissionId) {
          const sub = await tx.standupSubmission.findUnique({
            where: { id: b.submissionId },
            select: { runId: true },
          });
          if (sub) data.runId = sub.runId;
        } else if (b.runId && runMap.has(b.runId)) {
          data.runId = runMap.get(b.runId);
        }
        await tx.pulseBlocker.update({
          where: { id: b.id },
          data,
        });
        stats.blockersUpdated++;
      }

      // 11) TeamMemoryDocument runId retarget
      const tmds = await tx.teamMemoryDocument.findMany({
        where: {
          workspaceId: PULES,
          runId: { in: runIdsNeeded },
        },
      });
      for (const doc of tmds) {
        const newRunId = runMap.get(doc.runId);
        if (newRunId && doc.runId !== newRunId) {
          await tx.teamMemoryDocument.update({
            where: { id: doc.id },
            data: { runId: newRunId },
          });
          stats.tmdsUpdated++;
        }
      }
    },
    { timeout: 120_000 },
  );

  return stats;
}

async function verify(db, planData) {
  const { PULES, TP, DEMO } = planData.ids;
  const pulesTeamId = planData.pulesTeam.id;

  const standupChunks = await db.memoryChunk.findMany({
    where: { workspaceId: PULES, sourceType: 'STANDUP_ANSWER' },
    select: {
      id: true,
      sourceId: true,
      ownerUserId: true,
      teamId: true,
      workspaceId: true,
      linkedIssueKey: true,
    },
  });

  let valid = 0;
  let invalid = 0;
  let crossWorkspace = 0;
  let matching = 0;
  let mismatching = 0;
  const invalidSamples = [];

  for (const c of standupChunks) {
    const a = await db.answer.findUnique({
      where: { id: c.sourceId },
      select: {
        id: true,
        userId: true,
        question: {
          select: {
            checkIn: {
              select: { team: { select: { workspaceId: true } } },
            },
          },
        },
        submission: {
          select: {
            run: {
              select: {
                teamId: true,
                team: { select: { workspaceId: true } },
                checkIn: {
                  select: { team: { select: { workspaceId: true } } },
                },
              },
            },
          },
        },
        user: { select: { workspaceId: true } },
      },
    });
    if (!a) {
      invalid++;
      invalidSamples.push({ chunk: c.id, reason: 'MISSING_ANSWER' });
      continue;
    }
    if (c.ownerUserId === a.userId) matching++;
    else {
      mismatching++;
      invalidSamples.push({
        chunk: c.id,
        reason: 'OWNER_MISMATCH',
        chunkOwner: c.ownerUserId,
        answerUser: a.userId,
      });
    }

    const subWs = a.submission?.run?.team?.workspaceId;
    const qWs = a.question?.checkIn?.team?.workspaceId;
    const runTeamOk = a.submission?.run?.teamId === pulesTeamId;
    const questionOk = !qWs || qWs === PULES;
    const allPules =
      subWs === PULES &&
      questionOk &&
      a.user.workspaceId === PULES &&
      runTeamOk;

    if (allPules) valid++;
    else if (subWs === TP || qWs === TP) {
      crossWorkspace++;
      invalidSamples.push({
        chunk: c.id,
        answerId: a.id,
        reason: 'CROSS_WS',
        subWs,
        qWs,
      });
    } else {
      invalid++;
      invalidSamples.push({
        chunk: c.id,
        answerId: a.id,
        reason: 'INVALID_GRAPH',
        subWs,
        qWs,
      });
    }
  }

  const chunkGroups = await db.memoryChunk.groupBy({
    by: ['sourceType'],
    where: { workspaceId: PULES },
    _count: true,
  });
  const byType = Object.fromEntries(
    chunkGroups.map((g) => [g.sourceType, g._count]),
  );

  const emb = await db.$queryRaw`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS with_json,
      COUNT(*) FILTER (WHERE embedding_vec IS NOT NULL)::int AS with_vec
    FROM "MemoryChunk"
    WHERE "workspaceId" = ${PULES}
  `;

  // Blockers
  const blockers = await db.pulseBlocker.findMany({
    where: { workspaceId: PULES },
  });
  const tpTeamIds = (
    await db.team.findMany({ where: { workspaceId: TP }, select: { id: true } })
  ).map((t) => t.id);

  const blockerCross = [];
  for (const b of blockers) {
    if (b.teamId && tpTeamIds.includes(b.teamId)) {
      blockerCross.push({ id: b.id, reason: 'teamId' });
      continue;
    }
    if (b.runId) {
      const run = await db.standupRun.findUnique({
        where: { id: b.runId },
        select: { team: { select: { workspaceId: true } } },
      });
      if (run?.team?.workspaceId === TP) {
        blockerCross.push({ id: b.id, reason: 'runId' });
      }
    }
  }

  // SCRUM-9
  const scrum9 = {
    cache: await db.jiraIssueCacheEntry.count({
      where: { workspaceId: PULES, issueKey: 'SCRUM-9' },
    }),
    links: await db.answerJiraIssueLink.count({
      where: { workspaceId: PULES, issueKey: 'SCRUM-9' },
    }),
    chunks: await db.memoryChunk.findMany({
      where: { workspaceId: PULES, linkedIssueKey: 'SCRUM-9' },
      select: { sourceType: true, sourceId: true, ownerUserId: true },
    }),
    jiraConnections: await db.jiraConnection.count({
      where: { workspaceId: PULES },
    }),
  };

  const demoAfter = await demoSnapshot(db, DEMO);
  const demoChanged =
    JSON.stringify(demoAfter) !== JSON.stringify(planData.demoBefore);

  // Simulate TeamPulse delete impact on Pules
  const tpTeamIdList = tpTeamIds;
  const tpRunIds = (
    await db.standupRun.findMany({
      where: { teamId: { in: emptySafe(tpTeamIdList) } },
      select: { id: true },
    })
  ).map((r) => r.id);
  const tpSubIds = (
    await db.standupSubmission.findMany({
      where: { runId: { in: emptySafe(tpRunIds) } },
      select: { id: true },
    })
  ).map((s) => s.id);
  const tpQIds = (
    await db.question.findMany({
      where: { checkIn: { teamId: { in: emptySafe(tpTeamIdList) } } },
      select: { id: true },
    })
  ).map((q) => q.id);

  const pulesAnswersStillOnTp = await db.answer.count({
    where: {
      user: { workspaceId: PULES },
      OR: [
        { submissionId: { in: emptySafe(tpSubIds) } },
        { questionId: { in: emptySafe(tpQIds) } },
      ],
    },
  });
  const pulesChunksFromThose = await db.memoryChunk.count({
    where: {
      workspaceId: PULES,
      sourceType: 'STANDUP_ANSWER',
      sourceId: {
        in: emptySafe(
          (
            await db.answer.findMany({
              where: {
                user: { workspaceId: PULES },
                OR: [
                  { submissionId: { in: emptySafe(tpSubIds) } },
                  { questionId: { in: emptySafe(tpQIds) } },
                ],
              },
              select: { id: true },
            })
          ).map((a) => a.id),
        ),
      },
    },
  });

  const pulesBlockersOnTp = blockerCross.length;

  const tpStillExists = !!(await db.workspace.findUnique({
    where: { id: TP },
  }));

  return {
    standup: {
      total: standupChunks.length,
      valid,
      invalid,
      crossWorkspace,
      matching,
      mismatching,
      invalidSamples: invalidSamples.slice(0, 20),
    },
    chunks: byType,
    chunksTotal: standupChunks.length +
      (byType.BLOCKER || 0) +
      (byType.BLOCKER_RESOLUTION || 0) +
      (byType.REPORT || 0),
    embedding: emb[0],
    blockersStillCross: blockerCross,
    scrum9,
    demoBefore: planData.demoBefore,
    demoAfter,
    demoChanged,
    deleteSim: {
      pulesAnswersStillOnTp,
      pulesStandupChunksAtRisk: pulesChunksFromThose,
      pulesBlockersOnTp,
    },
    tpStillExists,
  };
}

async function main() {
  console.log(`PULES UNTANGLE — ${DRY_RUN ? 'DRY-RUN' : 'APPLY'}`);

  const planData = await plan(prisma);
  printDryRunReport(planData);

  if (planData.criticalAmbiguous.length > 0) {
    console.error('STOP: critical ambiguous records > 0. Refusing to apply.');
    process.exitCode = 2;
    await prisma.$disconnect();
    return {
      dryRun: DRY_RUN ? 'FAIL' : 'FAIL',
      applied: false,
      reason: 'ambiguous',
      planData,
    };
  }

  let applyStats = null;
  if (APPLY) {
    if (planData.entangled.length === 0 && planData.blockersNeedingRepair.length === 0) {
      console.log('Nothing to repair — graph already untangled.');
    } else {
      console.log('Applying ownership repair in a transaction...');
      applyStats = await applyRepair(prisma, planData);
      console.log('Apply stats:', applyStats);
    }
  } else {
    console.log('Dry-run only. Re-run with --apply to mutate.');
  }

  // Re-plan entangled after apply for verification baseline
  const afterPlan = APPLY ? await plan(prisma) : planData;
  const verification = await verify(prisma, {
    ...planData,
    // use fresh entangled counts from afterPlan when applied
    entangled: afterPlan.entangled,
    demoBefore: planData.demoBefore,
  });

  console.log('\n========== VERIFICATION ==========');
  console.log(JSON.stringify(verification, null, 2));

  const dryPass =
    planData.criticalAmbiguous.length === 0 &&
    planData.entangled.length > 0 ||
    planData.entangled.length === 0;

  const result = {
    dryRunPass: planData.criticalAmbiguous.length === 0,
    applied: APPLY,
    applyStats,
    answersRepaired: APPLY
      ? applyStats?.answersQuestionRemapped ?? 0
      : planData.entangled.length,
    submissionsRepaired: APPLY
      ? applyStats?.submissionsMoved ?? 0
      : planData.submissionIdsNeeded.length,
    runsReconstructed: APPLY
      ? applyStats?.runsCreated ?? 0
      : planData.runIdsNeeded.length,
    checkInsReconstructed: APPLY
      ? applyStats?.checkInsCreated ?? 0
      : planData.tpCheckInId
        ? 1
        : 0,
    questionsCloned: APPLY
      ? applyStats?.questionsCreated ?? 0
      : planData.questionIdsNeeded.length,
    reportsRepaired: 0,
    blockersRepaired: APPLY
      ? applyStats?.blockersUpdated ?? 0
      : planData.blockersNeedingRepair.length,
    resolutionsPreserved: planData.resolutionUpdates.length,
    jiraLinks: APPLY
      ? applyStats?.jiraLinksUpdated ?? 0
      : planData.jiraLinks.length,
    authorsPreserved: true,
    verification,
    remainingEntangled: afterPlan.entangled.length,
    remainingAmbiguous: afterPlan.criticalAmbiguous.length,
  };

  console.log('\n========== RESULT SUMMARY ==========');
  console.log(JSON.stringify(result, null, 2));

  await prisma.$disconnect();
  return result;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
