export type ThreadStatusCode = 'active' | 'creating' | 'failed' | 'not_started';
export type ReportStatusCode =
  | 'waiting'
  | 'generating'
  | 'ready'
  | 'posting'
  | 'posted'
  | 'generation_failed'
  | 'posting_failed';

export type RunStatusInfo = {
  code: ThreadStatusCode | ReportStatusCode;
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
  threadStatus: RunStatusInfo;
  reportStatus: RunStatusInfo;
  slackThreadUrl?: string | null;
  durationMinutes?: number | null;
  checkIn?: { id: string; name: string; timezone?: string };
  team?: { id: string; name: string };
  aiReport?: { id: string; summary: string; source: string; generatedAt: string } | null;
};

export const THREAD_STATUS_DOT: Record<ThreadStatusCode, string> = {
  active: '🟢',
  creating: '🟡',
  failed: '🔴',
  not_started: '⚪',
};

export const REPORT_STATUS_ICON: Record<ReportStatusCode, string> = {
  waiting: '🟡',
  generating: '🔄',
  ready: '✅',
  posting: '📤',
  posted: '📤',
  generation_failed: '❌',
  posting_failed: '⚠️',
};

export function formatStartedTime(iso: string, timezone?: string): string {
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

export function normalizeRun(run: Partial<EnrichedRun> & Record<string, unknown>): EnrichedRun {
  const participantsResponded =
    run.participantsResponded ??
    (Array.isArray(run.submissions)
      ? run.submissions.filter((s: { status?: string }) => s.status === 'completed').length
      : 0);

  const totalParticipants =
    run.totalParticipants ??
    (Array.isArray(run.submissions) ? run.submissions.length : 0);

  const hasThread = !!(run.slackChannelId && run.slackThreadTs);

  const threadStatus =
    run.threadStatus ??
    (hasThread
      ? { code: 'active' as const, label: 'Thread Active', tooltip: 'Slack thread is live.' }
      : { code: 'not_started' as const, label: 'Not Started', tooltip: 'No Slack thread yet.' });

  const reportStatus =
    run.reportStatus ??
    (run.reportGeneratedAt
      ? {
          code: 'posted' as const,
          label: 'Posted to Slack Thread',
          tooltip: 'AI report was posted in the Slack thread.',
        }
      : {
          code: 'waiting' as const,
          label: 'Waiting for Responses',
          tooltip: 'Collecting standup answers before the AI report can be generated.',
        });

  return {
    ...(run as EnrichedRun),
    participantsResponded,
    totalParticipants,
    threadStatus,
    reportStatus,
  };
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null) return '—';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function reportStatusIcon(code: string): string {
  return REPORT_STATUS_ICON[code as ReportStatusCode] ?? '🟡';
}
