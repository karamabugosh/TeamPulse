import { LucideIcon } from 'lucide-react';

export type StatusBucket = 'done' | 'in_progress' | 'todo' | 'blocked';

export function bucketStatus(status: string | null | undefined): StatusBucket {
  const normalized = (status ?? '').trim().toLowerCase();
  if (!normalized) return 'todo';
  if (
    normalized.includes('done') ||
    normalized.includes('closed') ||
    normalized.includes('resolved') ||
    normalized.includes('complete')
  ) {
    return 'done';
  }
  if (normalized.includes('block')) return 'blocked';
  if (
    normalized.includes('progress') ||
    normalized.includes('review') ||
    normalized.includes('testing')
  ) {
    return 'in_progress';
  }
  return 'todo';
}

export function formatHubDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatHubDay(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

export const STATUS_LABELS: Record<StatusBucket, string> = {
  done: 'Done',
  in_progress: 'In Progress',
  todo: 'To Do',
  blocked: 'Blocked',
};

export const STATUS_COLORS: Record<StatusBucket, string> = {
  done: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400',
  in_progress: 'border-[#6366F1]/35 bg-[#4F46E5]/15 text-[#A5B4FC]',
  todo: 'border-slate-500/35 bg-slate-500/15 text-slate-300',
  blocked: 'border-orange-500/35 bg-orange-500/15 text-orange-400',
};

export const STATUS_EMOJI: Record<StatusBucket, string> = {
  todo: '',
  in_progress: '',
  done: '',
  blocked: '',
};

export function filterJiraIssues<T extends { key: string; summary: string }>(
  issues: T[],
  query: string,
): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return issues;
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);

  return issues.filter((issue) => {
    const key = issue.key.toLowerCase();
    const summary = issue.summary.toLowerCase();
    const haystack = `${key} ${summary}`;

    return tokens.every((token) => haystack.includes(token));
  });
}

export const CHART_COLORS = ['#34d399', '#6366F1', '#60A5FA', '#f97316'];

export type HubKpiItem = {
  title: string;
  value: number;
  icon: LucideIcon;
  accent: string;
};

export const INSIGHT_PRESENTATION: Record<
  string,
  { emoji: string; title: string; accent: string }
> = {
  most_mentioned: {
    emoji: '🤖',
    title: 'Most Mentioned Issue',
    accent:
      'border-violet-500/25 bg-gradient-to-br from-violet-500/10 to-transparent hover:border-violet-500/40',
  },
  inactive_issue: {
    emoji: '⚠',
    title: 'Risk Prediction',
    accent:
      'border-amber-500/25 bg-gradient-to-br from-amber-500/10 to-transparent hover:border-amber-500/40',
  },
  estimated_completion: {
    emoji: '✅',
    title: 'Closest To Completion',
    accent:
      'border-emerald-500/25 bg-gradient-to-br from-emerald-500/10 to-transparent hover:border-emerald-500/40',
  },
  likely_blocked: {
    emoji: '🚧',
    title: 'Likely Blocked',
    accent:
      'border-orange-500/25 bg-gradient-to-br from-orange-500/10 to-transparent hover:border-orange-500/40',
  },
  repeated_standup: {
    emoji: '🧠',
    title: 'AI Recommendation',
    accent:
      'border-cyan-500/25 bg-gradient-to-br from-cyan-500/10 to-transparent hover:border-cyan-500/40',
  },
};

export function countStatusBuckets(
  statuses: Array<string | null | undefined>,
): Record<StatusBucket, number> {
  return statuses.reduce(
    (acc, status) => {
      acc[bucketStatus(status)] += 1;
      return acc;
    },
    { done: 0, in_progress: 0, todo: 0, blocked: 0 },
  );
}
