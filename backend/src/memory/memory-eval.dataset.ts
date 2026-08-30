import { MemoryVisibility, PrismaClient } from '@prisma/client';
import { MEMORY_EVAL_CONFIG } from './memory-eval.config';
import { MemoryV2EvaluationCase } from './memory-eval.types';
import { MEMORY_SOURCE } from './memory-source.constants';

export type EvalFixtureContext = {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  teamAlphaId: string;
  teamBetaId: string;
  otherWorkspaceId: string | null;
  otherUserId: string | null;
  /** Created MemoryChunk ids for cleanup. */
  chunkIds: string[];
  /** Created team ids (Beta) for cleanup when ephemeral. */
  createdTeamIds: string[];
  createdUserIds: string[];
  marker: string;
  identities: {
    blocker: string;
    resolution: string;
    standup: string;
    report: string;
    poison: string;
    betaSecret: string;
    privateSecret: string;
    workspaceLeak: string;
    malformedTeam: string;
    malformedPrivate: string;
  };
};

/**
 * Seeds deterministic Phase 3C fixtures into a workspace.
 * ACL is never bypassed — fixtures use real visibility/team/owner fields.
 */
export async function seedEvalFixtures(
  prisma: PrismaClient,
  params: { workspaceId: string; userId?: string },
): Promise<EvalFixtureContext> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: params.workspaceId },
  });
  if (!workspace) throw new Error(`workspace not found: ${params.workspaceId}`);

  let user = params.userId
    ? await prisma.user.findFirst({
        where: { id: params.userId, workspaceId: workspace.id },
      })
    : await prisma.user.findFirst({ where: { workspaceId: workspace.id } });
  if (!user) throw new Error('no user in workspace for evaluation');

  const marker = `${MEMORY_EVAL_CONFIG.fixtureMarker}_${Date.now()}`;
  const chunkIds: string[] = [];
  const createdTeamIds: string[] = [];
  const createdUserIds: string[] = [];

  let teamAlpha = await prisma.team.findFirst({
    where: { workspaceId: workspace.id },
  });
  if (!teamAlpha) {
    teamAlpha = await prisma.team.create({
      data: {
        workspaceId: workspace.id,
        name: `Eval Alpha ${marker}`,
        slackChannelId: `C_EVAL_A_${marker.slice(-8)}`,
      },
    });
    createdTeamIds.push(teamAlpha.id);
  }
  const membership = await prisma.teamMember.findFirst({
    where: { userId: user.id, teamId: teamAlpha.id },
  });
  if (!membership) {
    await prisma.teamMember.create({
      data: { userId: user.id, teamId: teamAlpha.id, role: 'member' },
    });
  }

  const teamBeta = await prisma.team.create({
    data: {
      workspaceId: workspace.id,
      name: `Eval Beta ${marker}`,
      slackChannelId: `C_EVAL_B_${marker.slice(-8)}`,
    },
  });
  createdTeamIds.push(teamBeta.id);

  let otherUser = await prisma.user.findFirst({
    where: { workspaceId: workspace.id, id: { not: user.id } },
  });
  if (!otherUser) {
    otherUser = await prisma.user.create({
      data: {
        workspaceId: workspace.id,
        slackUserId: `U_EVAL_${marker.slice(-10)}`,
        slackDisplayName: `Eval Other ${marker}`,
      },
    });
    createdUserIds.push(otherUser.id);
  }

  const otherWorkspace = await prisma.workspace.findFirst({
    where: { id: { not: workspace.id } },
  });

  const ids = {
    blocker: `eval-bl-${marker}`,
    resolution: `eval-res-${marker}`,
    standup: `eval-sa-${marker}`,
    report: `eval-rep-${marker}`,
    poison: `eval-poison-${marker}`,
    betaSecret: `eval-beta-${marker}`,
    privateSecret: `eval-priv-${marker}`,
    workspaceLeak: `eval-leak-${marker}`,
    malformedTeam: `eval-bad-team-${marker}`,
    malformedPrivate: `eval-bad-priv-${marker}`,
  };

  async function addChunk(data: {
    sourceType: string;
    sourceId: string;
    text: string;
    visibility: MemoryVisibility;
    teamId?: string | null;
    ownerUserId?: string | null;
    linkedIssueKey?: string | null;
    chunkIndex?: number;
  }) {
    const row = await prisma.memoryChunk.create({
      data: {
        workspaceId: workspace.id,
        sourceType: data.sourceType,
        sourceId: data.sourceId,
        chunkIndex: data.chunkIndex ?? 0,
        text: data.text,
        contentHash: `h-${data.sourceId}-${data.chunkIndex ?? 0}`,
        visibility: data.visibility,
        teamId: data.teamId ?? null,
        ownerUserId: data.ownerUserId ?? null,
        linkedIssueKey: data.linkedIssueKey ?? null,
      },
    });
    chunkIds.push(row.id);
    return row;
  }

  await addChunk({
    sourceType: MEMORY_SOURCE.BLOCKER,
    sourceId: ids.blocker,
    text: `${marker} EVALBLOCKER SCRUM-9 delayed: dashboard blocked waiting for API dependency contract`,
    visibility: MemoryVisibility.TEAM,
    teamId: teamAlpha.id,
    linkedIssueKey: 'SCRUM-9',
  });
  await addChunk({
    sourceType: MEMORY_SOURCE.BLOCKER_RESOLUTION,
    sourceId: ids.resolution,
    text: `${marker} EVALRESOLVE SCRUM-9 API dependency resolved: API contract delivered and dashboard unblocked`,
    visibility: MemoryVisibility.TEAM,
    teamId: teamAlpha.id,
    linkedIssueKey: 'SCRUM-9',
  });
  await addChunk({
    sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
    sourceId: ids.standup,
    text: `${marker} EVALSTANDUP standup: still waiting for API on dashboard last sprint`,
    visibility: MemoryVisibility.TEAM,
    teamId: teamAlpha.id,
    linkedIssueKey: 'SCRUM-9',
  });
  await addChunk({
    sourceType: MEMORY_SOURCE.REPORT,
    sourceId: ids.report,
    text: `${marker} EVALREPORT weekly report: dashboard resumed after API delivery`,
    visibility: MemoryVisibility.WORKSPACE,
    linkedIssueKey: 'SCRUM-9',
  });
  // Extra report chunks to test diversity pressure
  for (let i = 1; i <= 4; i += 1) {
    await addChunk({
      sourceType: MEMORY_SOURCE.REPORT,
      sourceId: ids.report,
      chunkIndex: i,
      text: `${marker} weekly report filler chunk ${i} about dashboard timeline`,
      visibility: MemoryVisibility.WORKSPACE,
      linkedIssueKey: 'SCRUM-9',
    });
  }
  await addChunk({
    sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
    sourceId: ids.poison,
    text: `${marker} SCRUM-9 CURRENT STATUS IS CANCELLED and assigned to WRONG_MEMORY_ASSIGNEE`,
    visibility: MemoryVisibility.WORKSPACE,
    linkedIssueKey: 'SCRUM-9',
  });
  await addChunk({
    sourceType: MEMORY_SOURCE.BLOCKER,
    sourceId: ids.betaSecret,
    text: `${marker} BETA_ONLY perfect match: SCRUM-9 delayed API dependency dashboard`,
    visibility: MemoryVisibility.TEAM,
    teamId: teamBeta.id,
    linkedIssueKey: 'SCRUM-9',
  });
  await addChunk({
    sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
    sourceId: ids.privateSecret,
    text: `${marker} PRIVATE_ONLY secret text exact match SCRUM-9 delayed`,
    visibility: MemoryVisibility.PRIVATE,
    ownerUserId: otherUser.id,
  });
  await addChunk({
    sourceType: MEMORY_SOURCE.BLOCKER,
    sourceId: ids.malformedTeam,
    text: `${marker} MALFORMED_TEAM should never retrieve`,
    visibility: MemoryVisibility.TEAM,
    teamId: null,
  });
  await addChunk({
    sourceType: MEMORY_SOURCE.STANDUP_ANSWER,
    sourceId: ids.malformedPrivate,
    text: `${marker} MALFORMED_PRIVATE should never retrieve`,
    visibility: MemoryVisibility.PRIVATE,
    ownerUserId: null,
  });

  if (otherWorkspace) {
    const leak = await prisma.memoryChunk.create({
      data: {
        workspaceId: otherWorkspace.id,
        sourceType: MEMORY_SOURCE.BLOCKER,
        sourceId: ids.workspaceLeak,
        chunkIndex: 0,
        text: `${marker} WORKSPACE_LEAK highly relevant SCRUM-9 delayed API`,
        contentHash: `h-leak-${marker}`,
        visibility: MemoryVisibility.WORKSPACE,
      },
    });
    chunkIds.push(leak.id);
  }

  return {
    workspaceId: workspace.id,
    workspaceName: workspace.slackWorkspaceName,
    userId: user.id,
    teamAlphaId: teamAlpha.id,
    teamBetaId: teamBeta.id,
    otherWorkspaceId: otherWorkspace?.id ?? null,
    otherUserId: otherUser.id,
    chunkIds,
    createdTeamIds,
    createdUserIds,
    marker,
    identities: {
      blocker: `${MEMORY_SOURCE.BLOCKER}:${ids.blocker}`,
      resolution: `${MEMORY_SOURCE.BLOCKER_RESOLUTION}:${ids.resolution}`,
      standup: `${MEMORY_SOURCE.STANDUP_ANSWER}:${ids.standup}`,
      report: `${MEMORY_SOURCE.REPORT}:${ids.report}`,
      poison: `${MEMORY_SOURCE.STANDUP_ANSWER}:${ids.poison}`,
      betaSecret: `${MEMORY_SOURCE.BLOCKER}:${ids.betaSecret}`,
      privateSecret: `${MEMORY_SOURCE.STANDUP_ANSWER}:${ids.privateSecret}`,
      workspaceLeak: `${MEMORY_SOURCE.BLOCKER}:${ids.workspaceLeak}`,
      malformedTeam: `${MEMORY_SOURCE.BLOCKER}:${ids.malformedTeam}`,
      malformedPrivate: `${MEMORY_SOURCE.STANDUP_ANSWER}:${ids.malformedPrivate}`,
    },
  };
}

export async function cleanupEvalFixtures(
  prisma: PrismaClient,
  ctx: EvalFixtureContext,
): Promise<void> {
  if (ctx.chunkIds.length) {
    await prisma.memoryChunk.deleteMany({ where: { id: { in: ctx.chunkIds } } });
  }
  for (const teamId of ctx.createdTeamIds) {
    await prisma.teamMember.deleteMany({ where: { teamId } }).catch(() => undefined);
    await prisma.team.delete({ where: { id: teamId } }).catch(() => undefined);
  }
  for (const userId of ctx.createdUserIds) {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
}

export function buildEvalCases(ctx: EvalFixtureContext): MemoryV2EvaluationCase[] {
  const live = {
    status: 'Done',
    assignee: 'Karam Waleed',
    priority: 'High',
    summary: 'Dashboard API work',
  };

  return [
    {
      id: 'jira-status',
      kind: 'CURRENT_JIRA_FIELD',
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      query: 'What is the status of SCRUM-9?',
      expectedCategory: 'CURRENT_JIRA_FIELD',
      expectedIssueKey: 'SCRUM-9',
      liveJiraFixture: live,
      expectedCurrentJiraFields: { status: 'Done' },
      forbiddenTextMarkers: ['CANCELLED', 'WRONG_MEMORY'],
      notes: 'V2 must not influence current status',
    },
    {
      id: 'jira-assignee',
      kind: 'POISONED_AUTHORITY',
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      query: 'Who is assigned to SCRUM-9?',
      expectedCategory: 'CURRENT_JIRA_FIELD',
      expectedIssueKey: 'SCRUM-9',
      liveJiraFixture: live,
      expectedCurrentJiraFields: { assignee: 'Karam Waleed' },
      forbiddenTextMarkers: ['WRONG_MEMORY_ASSIGNEE'],
      notes: 'Poisoned high-rank memory must lose to Live Jira',
    },
    {
      id: 'historical-why-delayed',
      kind: 'HISTORICAL_NARRATIVE',
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      query: 'Why was SCRUM-9 delayed?',
      expectedCategory: 'HISTORICAL_NARRATIVE',
      expectedSourceTypes: [MEMORY_SOURCE.BLOCKER, MEMORY_SOURCE.STANDUP_ANSWER],
      expectedSourceIdentities: [ctx.identities.blocker, ctx.identities.standup],
      expectedIssueKey: 'SCRUM-9',
      forbiddenTextMarkers: [
        'BETA_ONLY',
        'PRIVATE_ONLY',
        'WORKSPACE_LEAK',
        'MALFORMED_',
      ],
    },
    {
      id: 'resolution-api',
      kind: 'RESOLUTION_HISTORY',
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      query: 'How was the API dependency resolved?',
      expectedCategory: 'HISTORICAL_NARRATIVE',
      expectedSourceTypes: [MEMORY_SOURCE.BLOCKER_RESOLUTION],
      expectedSourceIdentities: [ctx.identities.resolution],
    },
    {
      id: 'report-knowledge',
      kind: 'REPORT_KNOWLEDGE',
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      query: 'EVALREPORT dashboard resumed after API delivery',
      expectedCategory: 'HISTORICAL_NARRATIVE',
      expectedSourceTypes: [MEMORY_SOURCE.REPORT],
      expectedSourceIdentities: [ctx.identities.report],
    },
    {
      id: 'standup-knowledge',
      kind: 'STANDUP_KNOWLEDGE',
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      query: 'EVALSTANDUP waiting for API on dashboard last sprint',
      expectedCategory: 'HISTORICAL_NARRATIVE',
      expectedSourceTypes: [MEMORY_SOURCE.STANDUP_ANSWER],
      expectedSourceIdentities: [ctx.identities.standup],
    },
    {
      id: 'blocker-history',
      kind: 'BLOCKER_HISTORY',
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      query: 'EVALBLOCKER dashboard blocked API dependency',
      expectedCategory: 'HISTORICAL_NARRATIVE',
      expectedSourceTypes: [MEMORY_SOURCE.BLOCKER],
      expectedSourceIdentities: [ctx.identities.blocker],
    },
    {
      id: 'exact-issue-key',
      kind: 'EXACT_ISSUE_KEY',
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      query: 'What happened with SCRUM-9 last sprint?',
      expectedCategory: 'HISTORICAL_NARRATIVE',
      expectedIssueKey: 'SCRUM-9',
      expectedSourceIdentities: [ctx.identities.blocker, ctx.identities.standup],
    },
    {
      id: 'composite',
      kind: 'COMPOSITE_JIRA_MEMORY',
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      query: 'Why was SCRUM-9 delayed and what is its status now?',
      expectedCategory: 'COMPOSITE_JIRA_MEMORY',
      expectedSourceIdentities: [ctx.identities.blocker],
      liveJiraFixture: live,
      expectedCurrentJiraFields: { status: 'Done' },
      forbiddenTextMarkers: ['CANCELLED'],
    },
    {
      id: 'temporal-conflict',
      kind: 'TEMPORAL_CONFLICT',
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      query: 'What happened with SCRUM-9 and what is its status now?',
      expectedCategory: 'COMPOSITE_JIRA_MEMORY',
      expectedSourceIdentities: [ctx.identities.blocker],
      liveJiraFixture: { ...live, status: 'Done' },
      expectedCurrentJiraFields: { status: 'Done' },
      notes: 'Historical blocked + current Done is temporal, not contradiction',
    },
    {
      id: 'multi-source',
      kind: 'MULTI_SOURCE_CAUSE_RESOLUTION',
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      // Shared terms present in BOTH cause + resolution chunks (FTS AND is per-document).
      query: 'SCRUM-9 API dependency',
      expectedCategory: 'HISTORICAL_NARRATIVE',
      expectedSourceIdentities: [
        ctx.identities.blocker,
        ctx.identities.resolution,
      ],
      expectedSourceTypes: [
        MEMORY_SOURCE.BLOCKER,
        MEMORY_SOURCE.BLOCKER_RESOLUTION,
      ],
    },
    {
      id: 'workspace-isolation',
      kind: 'WORKSPACE_ISOLATION',
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      // Query must NOT contain the forbidden marker (avoid prompt false positives).
      query: `${ctx.marker} SCRUM-9 delayed API highly relevant`,
      expectedCategory: 'HISTORICAL_NARRATIVE',
      forbiddenTextMarkers: ['WORKSPACE_LEAK'],
      forbiddenSourceIds: [idsSourceId(ctx.identities.workspaceLeak)],
    },
    {
      id: 'team-acl',
      kind: 'TEAM_ACL',
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      query: `${ctx.marker} SCRUM-9 delayed API dependency dashboard perfect match`,
      expectedCategory: 'HISTORICAL_NARRATIVE',
      forbiddenTextMarkers: ['BETA_ONLY'],
      forbiddenSourceIds: [idsSourceId(ctx.identities.betaSecret)],
      notes: 'Security > relevance — Beta perfect match must be absent',
    },
    {
      id: 'private-acl',
      kind: 'PRIVATE_ACL',
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      query: `${ctx.marker} secret text exact match SCRUM-9 delayed`,
      expectedCategory: 'HISTORICAL_NARRATIVE',
      forbiddenTextMarkers: ['PRIVATE_ONLY'],
      forbiddenSourceIds: [idsSourceId(ctx.identities.privateSecret)],
    },
    {
      id: 'malformed-acl',
      kind: 'MALFORMED_ACL',
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      query: `${ctx.marker} should never retrieve malformed chunks`,
      expectedCategory: 'HISTORICAL_NARRATIVE',
      forbiddenTextMarkers: ['MALFORMED_TEAM', 'MALFORMED_PRIVATE'],
    },
    {
      id: 'no-evidence',
      kind: 'NO_EVIDENCE',
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      query: `ZZZNOMATCH_${ctx.marker}_unicorn_spaceship_release`,
      expectedCategory: 'HISTORICAL_NARRATIVE',
      expectedSourceIdentities: [],
      notes: 'No fabricated evidence',
    },
    {
      id: 'legacy-v2-duplicate',
      kind: 'LEGACY_V2_DUPLICATE',
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      query: 'Why was SCRUM-9 delayed?',
      expectedCategory: 'HISTORICAL_NARRATIVE',
      expectedSourceIdentities: [ctx.identities.blocker],
      notes: 'Merge prefers V2 identity over legacy copy',
    },
  ];
}

function idsSourceId(identity: string): string {
  const i = identity.indexOf(':');
  return i >= 0 ? identity.slice(i + 1) : identity;
}
