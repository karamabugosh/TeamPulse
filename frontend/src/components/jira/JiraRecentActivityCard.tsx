import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ExternalLink,
  Loader2,
  Search,
  ArrowRight,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  jiraApi,
  JiraActivityFeed,
  JiraActivityItem,
  JiraActivityType,
} from '@/lib/jira-api';

type TypeFilter =
  | 'all'
  | 'status'
  | 'assignment'
  | 'comments'
  | 'sprint';

type RangeFilter = '24h' | '7d' | '30d';

const TYPE_FILTERS: Array<{ id: TypeFilter; label: string }> = [
  { id: 'all', label: 'All Activities' },
  { id: 'status', label: 'Status' },
  { id: 'assignment', label: 'Assignment' },
  { id: 'comments', label: 'Comments' },
  { id: 'sprint', label: 'Sprint' },
];

const RANGE_FILTERS: Array<{ id: RangeFilter; label: string; days: number }> = [
  { id: '24h', label: 'Last 24 Hours', days: 1 },
  { id: '7d', label: 'Last 7 Days', days: 7 },
  { id: '30d', label: 'Last 30 Days', days: 30 },
];

const PAGE_SIZE = 8;

function matchesTypeFilter(type: JiraActivityType, filter: TypeFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'status') {
    return (
      type === 'Status Changed' ||
      type === 'Resolved' ||
      type === 'Reopened' ||
      type === 'Created' ||
      type === 'Priority Changed' ||
      type === 'Label Added'
    );
  }
  if (filter === 'assignment') return type === 'Assigned';
  if (filter === 'comments') return type === 'Comment Added';
  if (filter === 'sprint') return type === 'Sprint Changed';
  return true;
}

function formatActivityWhen(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startToday = new Date(now);
  startToday.setHours(0, 0, 0, 0);
  const startYesterday = new Date(startToday);
  startYesterday.setDate(startYesterday.getDate() - 1);

  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (date >= startToday) return `Today · ${time}`;
  if (date >= startYesterday) return `Yesterday · ${time}`;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function activityBadgeClass(type: JiraActivityType): string {
  switch (type) {
    case 'Status Changed':
    case 'Reopened':
      return 'border-violet-500/30 bg-violet-500/15 text-violet-300';
    case 'Resolved':
      return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400';
    case 'Assigned':
      return 'border-blue-500/30 bg-blue-500/15 text-blue-400';
    case 'Comment Added':
      return 'border-cyan-500/30 bg-cyan-500/15 text-cyan-300';
    case 'Sprint Changed':
      return 'border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-300';
    case 'Priority Changed':
    case 'Label Added':
      return 'border-amber-500/30 bg-amber-500/15 text-amber-300';
    default:
      return 'border-white/15 bg-white/[0.06] text-slate-200';
  }
}

export const JiraRecentActivityCard: React.FC<{ connected: boolean }> = ({
  connected,
}) => {
  const [feed, setFeed] = useState<JiraActivityFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('30d');
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    if (!connected) {
      setFeed(null);
      setLoading(false);
      return;
    }

    const days =
      RANGE_FILTERS.find((item) => item.id === rangeFilter)?.days ?? 30;

    setLoading(true);
    jiraApi
      .getActivity({ days, limit: 120, maxIssues: 30 })
      .then(setFeed)
      .catch((error) => {
        console.error(error);
        setFeed({
          available: false,
          message: 'No recent Jira activity available.',
          activities: [],
          total: 0,
          fetchedIssueCount: 0,
        });
      })
      .finally(() => setLoading(false));
  }, [connected, rangeFilter]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [typeFilter, rangeFilter, search, feed?.activities.length]);

  const filtered = useMemo(() => {
    const activities = feed?.activities ?? [];
    const query = search.trim().toLowerCase();
    const rangeMs =
      (RANGE_FILTERS.find((item) => item.id === rangeFilter)?.days ?? 30) *
      24 *
      60 *
      60 *
      1000;
    const cutoff = Date.now() - rangeMs;

    return activities.filter((activity) => {
      if (!matchesTypeFilter(activity.activityType, typeFilter)) return false;
      if (new Date(activity.occurredAt).getTime() < cutoff) return false;
      if (!query) return true;
      return (
        activity.issueKey.toLowerCase().includes(query) ||
        activity.summary.toLowerCase().includes(query) ||
        (activity.author ?? '').toLowerCase().includes(query)
      );
    });
  }, [feed, typeFilter, rangeFilter, search]);

  const visible = filtered.slice(0, visibleCount);
  const hasMore = visibleCount < filtered.length;

  return (
    <Card className="card-lift border-border/80 shadow-lg shadow-black/10">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-violet-400" />
          <CardTitle>Recent Jira Activity</CardTitle>
        </div>
        <CardDescription>
          Recent changes detected from your connected Jira workspace.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {!connected ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Connect Jira to load recent activity.
          </p>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by issue key, summary, or user…"
                className="h-11 rounded-xl border-white/10 bg-white/[0.03] pl-10"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {TYPE_FILTERS.map((filter) => (
                <FilterChip
                  key={filter.id}
                  active={typeFilter === filter.id}
                  label={filter.label}
                  onClick={() => setTypeFilter(filter.id)}
                />
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {RANGE_FILTERS.map((filter) => (
                <FilterChip
                  key={filter.id}
                  active={rangeFilter === filter.id}
                  label={filter.label}
                  onClick={() => setRangeFilter(filter.id)}
                />
              ))}
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-violet-300" />
                Loading Jira changelog…
              </div>
            ) : !feed?.available || filtered.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {feed?.message ?? 'No recent Jira activity available.'}
              </p>
            ) : (
              <div className="relative space-y-0">
                <div
                  aria-hidden
                  className="absolute bottom-4 left-[1.15rem] top-4 w-px bg-gradient-to-b from-violet-500/50 via-white/10 to-transparent"
                />

                <ul className="space-y-4">
                  {visible.map((activity) => (
                    <li key={activity.id} className="relative pl-10">
                      <span
                        aria-hidden
                        className="absolute left-[0.85rem] top-6 h-3 w-3 rounded-full border-2 border-violet-400/80 bg-background shadow-[0_0_12px_rgba(139,92,246,0.45)]"
                      />
                      <ActivityCard activity={activity} />
                    </li>
                  ))}
                </ul>

                {hasMore ? (
                  <div className="pt-4 text-center">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full"
                      onClick={() =>
                        setVisibleCount((count) => count + PAGE_SIZE)
                      }
                    >
                      Load more ({filtered.length - visibleCount} remaining)
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-full border border-violet-400/40 bg-violet-500/20 px-3 py-1.5 text-xs font-medium text-violet-100'
          : 'rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-muted-foreground transition hover:border-violet-400/30 hover:text-foreground'
      }
    >
      {label}
    </button>
  );
}

function ActivityCard({ activity }: { activity: JiraActivityItem }) {
  const previousLabel = activity.previousValue ?? 'Unassigned';
  const nextLabel = activity.newValue ?? '—';
  const showTransition =
    activity.activityType !== 'Comment Added' &&
    activity.activityType !== 'Created' &&
    (activity.previousValue != null || activity.newValue != null);

  return (
    <article className="rounded-xl border border-white/[0.08] bg-gradient-to-br from-violet-500/[0.07] via-white/[0.02] to-transparent p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-violet-400/30 hover:shadow-card-hover sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-blue-500/30 font-mono text-blue-300"
            >
              {activity.issueKey}
            </Badge>
            {activity.projectKey ? (
              <span className="text-xs text-muted-foreground">
                {activity.projectName
                  ? `${activity.projectKey} · ${activity.projectName}`
                  : activity.projectKey}
              </span>
            ) : null}
          </div>
          <h3 className="text-base font-semibold text-foreground">
            {activity.summary}
          </h3>
        </div>

        <Badge className={activityBadgeClass(activity.activityType)}>
          {activity.activityType}
        </Badge>
      </div>

      {showTransition ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-foreground/90">
          <span className="rounded-md bg-white/[0.04] px-2 py-1 text-muted-foreground">
            {previousLabel}
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-violet-300" />
          <span className="rounded-md bg-violet-500/15 px-2 py-1 text-violet-100">
            {nextLabel}
          </span>
        </p>
      ) : activity.activityType === 'Comment Added' && activity.newValue ? (
        <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">
          {activity.newValue}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1 text-xs text-muted-foreground">
          {activity.author ? <p>By: {activity.author}</p> : null}
          <p>{formatActivityWhen(activity.occurredAt)}</p>
        </div>

        {activity.issueUrl ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() =>
              window.open(activity.issueUrl!, '_blank', 'noopener,noreferrer')
            }
          >
            Open in Jira
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export default JiraRecentActivityCard;
