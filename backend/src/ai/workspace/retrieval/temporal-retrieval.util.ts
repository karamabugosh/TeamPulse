import { KnowledgeDocument, WorkspaceSearchFilters } from '../types/workspace-ai.types';

/** Normalized temporal retrieval constraints (not ranking hints). */
export type TemporalRetrievalScope = 'LATEST_STANDUP';

const LATEST_STANDUP_PATTERNS = [
  /\b(?:in\s+the\s+)?(?:latest|most\s+recent|last|current)\s+(?:standup|check-?in|daily\s+standup|update)\b/i,
  /\b(?:latest|most\s+recent|last|current)\s+(?:team\s+)?(?:standup|check-?in)\b/i,
  /\btoday'?s\s+(?:standup|check-?in|daily\s+standup)\b/i,
  /\bfrom\s+(?:the\s+)?(?:latest|most\s+recent|last)\s+(?:standup|check-?in)\b/i,
];

/**
 * Detect whether the question requires scoping to the latest standup/check-in.
 * Returns null for open-ended historical questions.
 */
export function detectTemporalRetrievalScope(
  question: string,
): TemporalRetrievalScope | null {
  const q = question?.trim() ?? '';
  if (!q) return null;
  for (const pattern of LATEST_STANDUP_PATTERNS) {
    if (pattern.test(q)) return 'LATEST_STANDUP';
  }
  return null;
}

export type ResolvedLatestStandupScope = {
  temporalScope: TemporalRetrievalScope;
  workspaceId: string;
  checkInId: string | null;
  teamId: string;
  runId: string;
  submissionId: string;
  subjectUserId: string;
  subjectDisplayName: string | null;
  runStartedAt: Date | null;
  runCompletedAt: Date | null;
  submissionCompletedAt: Date;
  /** Answer + blocker source IDs belonging to this scope (for V2 + legacy dedupe). */
  scopedSourceIds: string[];
};

export type TemporalScopeDiagnostics = {
  temporalIntent: TemporalRetrievalScope | null;
  resolvedUserId: string | null;
  resolvedRunId: string | null;
  resolvedSubmissionId: string | null;
  scopedSourceCount: number;
  resolutionReason: string | null;
};

/** Returns true when the document belongs to the resolved latest-standup scope. */
export function documentMatchesLatestStandupScope(
  doc: KnowledgeDocument,
  scope: ResolvedLatestStandupScope,
): boolean {
  const meta = doc.metadata ?? {};
  const memSourceId =
    typeof meta.memorySourceId === 'string' ? meta.memorySourceId : null;
  if (memSourceId && scope.scopedSourceIds.includes(memSourceId)) {
    return true;
  }

  const entityId = doc.reference?.entityId;
  if (entityId && scope.scopedSourceIds.includes(entityId)) {
    return true;
  }

  const runId = typeof meta.runId === 'string' ? meta.runId : null;
  const submissionId =
    typeof meta.submissionId === 'string' ? meta.submissionId : null;
  const userId = typeof meta.userId === 'string' ? meta.userId : null;

  if (submissionId && submissionId === scope.submissionId) {
    return true;
  }

  if (runId && runId === scope.runId) {
    if (userId && userId !== scope.subjectUserId) {
      return false;
    }
    return true;
  }

  return false;
}

export type LatestStandupMatchScope = Pick<
  ResolvedLatestStandupScope,
  'runId' | 'submissionId' | 'subjectUserId' | 'scopedSourceIds'
>;

export function latestStandupScopeFromFilters(
  filters: WorkspaceSearchFilters,
): LatestStandupMatchScope | null {
  if (
    filters.temporalScope !== 'LATEST_STANDUP' ||
    !filters.latestStandupRunId ||
    !filters.latestStandupSubmissionId ||
    !filters.subjectUserId
  ) {
    return null;
  }
  return {
    runId: filters.latestStandupRunId,
    submissionId: filters.latestStandupSubmissionId,
    subjectUserId: filters.subjectUserId,
    scopedSourceIds: filters.latestStandupScopedSourceIds ?? [],
  };
}

export function documentMatchesLatestStandupFilters(
  doc: KnowledgeDocument,
  filters: WorkspaceSearchFilters,
): boolean {
  const scope = latestStandupScopeFromFilters(filters);
  if (!scope) return true;
  return documentMatchesLatestStandupScope(
    doc,
    {
      temporalScope: 'LATEST_STANDUP',
      workspaceId: doc.workspaceId,
      checkInId: null,
      teamId: '',
      runStartedAt: null,
      runCompletedAt: null,
      submissionCompletedAt: new Date(0),
      subjectDisplayName: null,
      ...scope,
    },
  );
}
