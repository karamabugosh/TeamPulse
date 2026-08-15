export type RunDisplayStatusCode =
  | 'completed'
  | 'in_progress'
  | 'partial'
  | 'expired'
  | 'cancelled'
  | 'failed';

export type ThreadStatusCode =
  | 'active'
  | 'waiting_for_responses'
  | 'closed'
  | 'missing';

export type ReportStatusCode =
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

export type EnrichedRun = {
  id: string;
  status: string;
  startedAt: string;
  completedAt?: string | null;
  reportGeneratedAt?: string | null;
  participantsResponded: number;
  totalParticipants: number;
  displayStatus: RunStatusInfo;
  threadStatus: RunStatusInfo;
  reportStatus: RunStatusInfo;
  slackThreadUrl?: string | null;
  durationMinutes?: number | null;
  durationLabel?: string;
  durationKind?: 'final' | 'elapsed' | 'unavailable';
  durationDefinition?: string;
  checkIn?: { id: string; name: string; timezone?: string } | null;
  team?: { id: string; name: string } | null;
  aiReport?: { id: string; summary: string; source: string; generatedAt: string } | null;
};

export const DISPLAY_STATUS_VARIANT: Record<
  RunDisplayStatusCode,
  'secondary' | 'success' | 'warning' | 'destructive' | 'outline'
> = {
  completed: 'success',
  in_progress: 'outline',
  partial: 'warning',
  expired: 'warning',
  cancelled: 'secondary',
  failed: 'destructive',
};

export const THREAD_STATUS_ICON: Record<ThreadStatusCode, string> = {
  active: '🟢',
  waiting_for_responses: '🟡',
  closed: '⚪',
  missing: '—',
};

export const REPORT_STATUS_ICON: Record<ReportStatusCode, string> = {
  generated: '✅',
  generating: '🔄',
  queued: '🕒',
  failed: '❌',
  not_generated: '—',
};

export function formatStartedTime(iso: string | null | undefined, timezone?: string): string {
  if (!iso) return 'Unavailable';

  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone || undefined,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
}

function countFullyRespondedFromSubmissions(
  run: Partial<EnrichedRun> & Record<string, unknown>,
): number {
  const submissions = Array.isArray(run.submissions) ? run.submissions : [];
  const checkIn = run.checkIn as { questions?: Array<{ id: string; isActive?: boolean; isRequired?: boolean }> } | undefined;
  const requiredQuestionIds = new Set(
    (Array.isArray(checkIn?.questions) ? checkIn.questions : [])
      .filter((question) => question.isActive !== false && question.isRequired !== false)
      .map((question) => question.id),
  );

  return submissions.filter((submission: { status?: string; answers?: { questionId: string }[] }) => {
    if (submission.status === 'cancelled') return false;
    const answers = submission.answers ?? [];
    if (requiredQuestionIds.size === 0) return answers.length > 0;
    const answered = new Set(answers.map((answer) => answer.questionId));
    for (const questionId of requiredQuestionIds) {
      if (!answered.has(questionId)) return false;
    }
    return true;
  }).length;
}

export function normalizeRun(run: Partial<EnrichedRun> & Record<string, unknown>): EnrichedRun {
  const participantsResponded =
    typeof run.participantsResponded === 'number'
      ? run.participantsResponded
      : countFullyRespondedFromSubmissions(run);

  const totalParticipants =
    typeof run.totalParticipants === 'number'
      ? run.totalParticipants
      : Array.isArray(run.submissions)
        ? run.submissions.length
        : 0;

  const displayStatus = run.displayStatus ?? {
    code: 'failed',
    label: 'Unavailable',
    tooltip: 'Run status is unavailable for this record.',
  };

  const threadStatus = run.threadStatus ?? {
    code: 'missing',
    label: 'Missing',
    tooltip: 'Thread status is unavailable for this record.',
  };

  const reportStatus = run.reportStatus ?? {
    code: 'not_generated',
    label: 'Not Generated',
    tooltip: 'Report status is unavailable for this record.',
  };

  const aiReport =
    run.aiReport ??
    (run.aiDigest && typeof run.aiDigest === 'object'
      ? (run.aiDigest as EnrichedRun['aiReport'])
      : null);

  return {
    ...(run as EnrichedRun),
    participantsResponded,
    totalParticipants,
    displayStatus,
    threadStatus,
    reportStatus,
    aiReport,
  };
}

export function formatDurationLabel(run: Pick<EnrichedRun, 'durationLabel' | 'durationMinutes' | 'durationKind' | 'status' | 'startedAt'>): string {
  const isActive = run.durationKind === 'elapsed' || run.status === 'collecting';

  if (isActive) {
    const elapsedMinutes =
      run.durationMinutes ??
      (run.startedAt
        ? Math.max(0, Math.round((Date.now() - new Date(run.startedAt).getTime()) / 60000))
        : 0);

    if (elapsedMinutes < 1) {
      return 'Running';
    }

    return `Running (${elapsedMinutes} min elapsed)`;
  }

  if (run.durationMinutes == null) {
    return '—';
  }

  if (run.durationMinutes < 60) {
    return `${run.durationMinutes} min`;
  }

  const hours = Math.floor(run.durationMinutes / 60);
  const minutes = run.durationMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null) return '—';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatParticipants(responded: number, total: number): string {
  if (total <= 0) return '—';
  return `${responded}/${total}`;
}

export function reportStatusIcon(code: string): string {
  return REPORT_STATUS_ICON[code as ReportStatusCode] ?? '—';
}

export function threadStatusIcon(code: string): string {
  return THREAD_STATUS_ICON[code as ThreadStatusCode] ?? '—';
}

export function displayStatusVariant(code: string) {
  return DISPLAY_STATUS_VARIANT[code as RunDisplayStatusCode] ?? 'secondary';
}
