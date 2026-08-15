type QuestionRef = {
  id: string;
  isRequired?: boolean;
  isActive?: boolean;
};

type AnswerRef = {
  questionId: string;
};

type SubmissionRef = {
  status: string;
  answers?: AnswerRef[];
};

type CheckInRef = {
  reportTriggerMode?: string | null;
  reportTimeoutMinutes?: number | null;
  questions?: QuestionRef[];
};

type RunRef = {
  status: string;
  startedAt: Date | string;
  completedAt?: Date | string | null;
  reportDueAt?: Date | string | null;
  reportGeneratedAt?: Date | string | null;
  reportStatus?: string | null;
  slackChannelId?: string | null;
  slackThreadTs?: string | null;
  slackThreadUrl?: string | null;
  checkIn?: CheckInRef | null;
  submissions?: SubmissionRef[];
  aiDigest?: {
    id?: string;
    source?: string;
    generationError?: string | null;
  } | null;
};

export type RunDisplayStatusCode =
  | 'completed'
  | 'in_progress'
  | 'partial'
  | 'expired'
  | 'cancelled'
  | 'failed';

export type RunThreadDisplayCode =
  | 'active'
  | 'waiting_for_responses'
  | 'closed'
  | 'missing';

export type RunReportDisplayCode =
  | 'generated'
  | 'generating'
  | 'queued'
  | 'failed'
  | 'not_generated';

export type RunStatusInfo = {
  code: string;
  label: string;
  tooltip: string;
};

export function getRequiredQuestions(checkIn?: CheckInRef | null): QuestionRef[] {
  return (checkIn?.questions ?? []).filter(
    (question) => question.isActive !== false && question.isRequired !== false,
  );
}

export function isSubmissionFullyResponded(
  submission: SubmissionRef,
  requiredQuestions: QuestionRef[],
): boolean {
  const answers = submission.answers ?? [];

  if (submission.status === 'cancelled') {
    return false;
  }

  if (requiredQuestions.length === 0) {
    return answers.length > 0;
  }

  const answeredQuestionIds = new Set(answers.map((answer) => answer.questionId));
  return requiredQuestions.every((question) => answeredQuestionIds.has(question.id));
}

export function computeParticipantCounts(
  submissions: SubmissionRef[] | undefined,
  requiredQuestions: QuestionRef[],
): { participantsResponded: number; totalParticipants: number } {
  const rows = submissions ?? [];
  const participantsResponded = rows.filter((submission) =>
    isSubmissionFullyResponded(submission, requiredQuestions),
  ).length;

  return {
    participantsResponded,
    totalParticipants: rows.length,
  };
}

export function resolveRunDisplayStatus(
  run: RunRef,
  participantsResponded: number,
  totalParticipants: number,
): RunStatusInfo {
  const code = resolveRunDisplayStatusCode(run, participantsResponded, totalParticipants);

  const labels: Record<RunDisplayStatusCode, RunStatusInfo> = {
    completed: {
      code: 'completed',
      label: 'Completed',
      tooltip:
        'Every assigned participant submitted all required answers before this run closed.',
    },
    in_progress: {
      code: 'in_progress',
      label: 'In Progress',
      tooltip: 'This run is still accepting participant responses.',
    },
    partial: {
      code: 'partial',
      label: 'Partial',
      tooltip:
        'This run closed before every assigned participant submitted all required answers.',
    },
    expired: {
      code: 'expired',
      label: 'Expired',
      tooltip:
        'The response deadline passed before every assigned participant completed the check-in.',
    },
    cancelled: {
      code: 'cancelled',
      label: 'Cancelled',
      tooltip: 'This run was cancelled before collection finished.',
    },
    failed: {
      code: 'failed',
      label: 'Failed',
      tooltip: 'This run ended because of an unexpected execution failure.',
    },
  };

  return labels[code];
}

function resolveRunDisplayStatusCode(
  run: RunRef,
  participantsResponded: number,
  totalParticipants: number,
): RunDisplayStatusCode {
  if (run.status === 'failed') {
    return 'failed';
  }

  if (run.status === 'cancelled') {
    return 'cancelled';
  }

  const cancelledSubmissions =
    run.submissions?.every((submission) => submission.status === 'cancelled') ?? false;
  if (cancelledSubmissions && totalParticipants > 0) {
    return 'cancelled';
  }

  if (run.status === 'collecting') {
    return 'in_progress';
  }

  if (totalParticipants === 0) {
    return 'failed';
  }

  if (participantsResponded >= totalParticipants) {
    return 'completed';
  }

  const reportDueAt = run.reportDueAt ? new Date(run.reportDueAt) : null;
  const completedAt = run.completedAt ? new Date(run.completedAt) : null;
  const timedOut =
    run.checkIn?.reportTriggerMode === 'timeout' &&
    reportDueAt &&
    completedAt &&
    completedAt.getTime() >= reportDueAt.getTime();

  if (timedOut) {
    return 'expired';
  }

  return 'partial';
}

export function resolveThreadDisplayStatus(
  run: RunRef,
  participantsResponded: number,
  totalParticipants: number,
): RunStatusInfo {
  const hasThread = !!(run.slackChannelId && run.slackThreadTs);
  const code = resolveThreadDisplayStatusCode(
    run,
    hasThread,
    participantsResponded,
    totalParticipants,
  );

  const labels: Record<RunThreadDisplayCode, RunStatusInfo> = {
    active: {
      code: 'active',
      label: 'Active',
      tooltip: 'A Slack thread exists and this run is still open.',
    },
    waiting_for_responses: {
      code: 'waiting_for_responses',
      label: 'Waiting for Responses',
      tooltip:
        'A Slack thread exists, but one or more assigned participants have not finished.',
    },
    closed: {
      code: 'closed',
      label: 'Closed',
      tooltip: 'This run finished and its Slack thread remains available.',
    },
    missing: {
      code: 'missing',
      label: 'Missing',
      tooltip: 'No Slack thread anchor was stored for this run.',
    },
  };

  return labels[code];
}

function resolveThreadDisplayStatusCode(
  run: RunRef,
  hasThread: boolean,
  participantsResponded: number,
  totalParticipants: number,
): RunThreadDisplayCode {
  if (!hasThread) {
    return 'missing';
  }

  if (run.status === 'collecting') {
    if (totalParticipants > participantsResponded) {
      return 'waiting_for_responses';
    }
    return 'active';
  }

  return 'closed';
}

export function resolveReportDisplayStatus(run: RunRef): RunStatusInfo {
  const code = resolveReportDisplayStatusCode(run);

  const labels: Record<RunReportDisplayCode, RunStatusInfo> = {
    generated: {
      code: 'generated',
      label: 'Generated',
      tooltip: 'An AI report was generated and stored for this run.',
    },
    generating: {
      code: 'generating',
      label: 'Generating',
      tooltip: 'AI report generation is currently in progress.',
    },
    queued: {
      code: 'queued',
      label: 'Queued',
      tooltip: 'This run is waiting for report generation to start.',
    },
    failed: {
      code: 'failed',
      label: 'Failed',
      tooltip: 'AI report generation or delivery failed for this run.',
    },
    not_generated: {
      code: 'not_generated',
      label: 'Not Generated',
      tooltip: 'No AI report has been generated for this run yet.',
    },
  };

  return labels[code];
}

function resolveReportDisplayStatusCode(run: RunRef): RunReportDisplayCode {
  const digest = run.aiDigest;
  const reportStatus = run.reportStatus ?? 'waiting_for_responses';

  if (reportStatus === 'generating' || reportStatus === 'posting') {
    return 'generating';
  }

  if (
    reportStatus === 'generation_failed' ||
    reportStatus === 'posting_failed' ||
    digest?.source === 'failed' ||
    digest?.generationError
  ) {
    return 'failed';
  }

  if (
    reportStatus === 'completed' ||
    reportStatus === 'generated' ||
    (digest?.source === 'ai' && !!digest.id) ||
    !!run.reportGeneratedAt
  ) {
    return 'generated';
  }

  if (
    reportStatus === 'waiting_for_responses' &&
    (run.reportDueAt || run.checkIn?.reportTriggerMode === 'all_answered')
  ) {
    return 'queued';
  }

  return 'not_generated';
}

/**
 * Canonical Run History duration definition.
 *
 * Final duration (closed runs):
 *   StandupRun.completedAt minus StandupRun.startedAt
 *   = total time the Check-In run stayed open collecting responses.
 *
 * Active runs (still collecting):
 *   elapsed time from StandupRun.startedAt until now.
 *   Displayed as "Running" (under 1 minute) or "{N} min elapsed".
 */
export const RUN_DURATION_DEFINITION =
  'Final duration is StandupRun.completedAt minus StandupRun.startedAt — the total time the Check-In run stayed open collecting responses. Active runs show elapsed time since StandupRun.startedAt.';

export type RunDurationView = {
  definition: string;
  kind: 'final' | 'elapsed' | 'unavailable';
  minutes: number | null;
  label: string;
};

export function buildDurationView(run: RunRef): RunDurationView {
  if (!run.startedAt) {
    return {
      definition: RUN_DURATION_DEFINITION,
      kind: 'unavailable',
      minutes: null,
      label: '—',
    };
  }

  const startedAt = new Date(run.startedAt).getTime();
  if (!Number.isFinite(startedAt)) {
    return {
      definition: RUN_DURATION_DEFINITION,
      kind: 'unavailable',
      minutes: null,
      label: '—',
    };
  }

  const isActive = run.status === 'collecting';

  if (isActive) {
    const elapsedMinutes = Math.max(
      0,
      Math.round((Date.now() - startedAt) / 60000),
    );
    return {
      definition: RUN_DURATION_DEFINITION,
      kind: 'elapsed',
      minutes: elapsedMinutes,
      label: elapsedMinutes < 1 ? 'Running' : `${elapsedMinutes} min elapsed`,
    };
  }

  if (!run.completedAt) {
    return {
      definition: RUN_DURATION_DEFINITION,
      kind: 'unavailable',
      minutes: null,
      label: '—',
    };
  }

  const completedAt = new Date(run.completedAt).getTime();
  if (!Number.isFinite(completedAt) || completedAt < startedAt) {
    return {
      definition: RUN_DURATION_DEFINITION,
      kind: 'unavailable',
      minutes: null,
      label: '—',
    };
  }

  const minutes = Math.round((completedAt - startedAt) / 60000);
  return {
    definition: RUN_DURATION_DEFINITION,
    kind: 'final',
    minutes,
    label: formatDurationLabel(minutes),
  };
}

function formatDurationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** @deprecated Use buildDurationView for Run History display semantics. */
export function computeDurationMinutes(run: RunRef): number | null {
  return buildDurationView(run).minutes;
}

export function parseHistorySearch(search: string): {
  text?: string;
  status?: RunDisplayStatusCode;
  date?: Date;
} {
  const trimmed = search.trim();
  if (!trimmed) {
    return {};
  }

  const lower = trimmed.toLowerCase();

  const statusAliases: Record<string, RunDisplayStatusCode> = {
    completed: 'completed',
    complete: 'completed',
    'in progress': 'in_progress',
    in_progress: 'in_progress',
    progress: 'in_progress',
    partial: 'partial',
    expired: 'expired',
    cancelled: 'cancelled',
    canceled: 'cancelled',
    failed: 'failed',
    fail: 'failed',
  };

  for (const [alias, status] of Object.entries(statusAliases)) {
    if (lower === alias || lower.includes(alias)) {
      return { status };
    }
  }

  const parsedDate = new Date(trimmed);
  if (!Number.isNaN(parsedDate.getTime()) && /\d/.test(trimmed)) {
    return { date: parsedDate };
  }

  return { text: trimmed };
}

export function matchesHistorySearch(
  run: {
    startedAt: Date | string;
    checkIn?: { name?: string | null } | null;
    team?: { name?: string | null } | null;
    displayStatus: RunStatusInfo;
  },
  search: string,
): boolean {
  const parsed = parseHistorySearch(search);
  if (!parsed.text && !parsed.status && !parsed.date) {
    return true;
  }

  if (parsed.status && run.displayStatus.code !== parsed.status) {
    return false;
  }

  if (parsed.date) {
    const runDate = new Date(run.startedAt);
    const sameDay =
      runDate.getFullYear() === parsed.date.getFullYear() &&
      runDate.getMonth() === parsed.date.getMonth() &&
      runDate.getDate() === parsed.date.getDate();
    if (!sameDay) {
      return false;
    }
  }

  if (parsed.text) {
    const q = parsed.text.toLowerCase();
    const checkInName = run.checkIn?.name?.toLowerCase() ?? '';
    const teamName = run.team?.name?.toLowerCase() ?? '';
    const statusLabel = run.displayStatus.label.toLowerCase();
    const startedLabel = new Date(run.startedAt).toLocaleDateString().toLowerCase();

    return (
      checkInName.includes(q) ||
      teamName.includes(q) ||
      statusLabel.includes(q) ||
      startedLabel.includes(q)
    );
  }

  return true;
}

export function buildHistoryRunView(run: RunRef) {
  const requiredQuestions = getRequiredQuestions(run.checkIn);
  const { participantsResponded, totalParticipants } = computeParticipantCounts(
    run.submissions,
    requiredQuestions,
  );

  const displayStatus = resolveRunDisplayStatus(
    run,
    participantsResponded,
    totalParticipants,
  );
  const threadStatus = resolveThreadDisplayStatus(
    run,
    participantsResponded,
    totalParticipants,
  );
  const reportStatus = resolveReportDisplayStatus(run);
  const duration = buildDurationView(run);

  return {
    participantsResponded,
    totalParticipants,
    displayStatus,
    threadStatus,
    reportStatus,
    durationMinutes: duration.minutes,
    durationLabel: duration.label,
    durationKind: duration.kind,
    durationDefinition: duration.definition,
  };
}
