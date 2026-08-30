import React, { useCallback, useEffect, useState } from 'react';
import { History, LayoutGrid, GitBranch, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { jiraApi } from '@/lib/jira-api';
import { useWorkspace } from '@/lib/workspace-context';
import {
  StandupHistoryFilterOption,
  StandupHistoryRecord,
} from './standup-history.types';
import {
  DEFAULT_STANDUP_FILTERS,
  StandupHistoryFilterState,
  StandupHistoryFilters,
} from './StandupHistoryFilters';
import { StandupHistoryCard } from './StandupHistoryCard';
import {
  WorkspaceTimeline,
  type WorkspaceTimelineEventDto,
} from './WorkspaceTimeline';

type ViewMode = 'cards' | 'timeline';

const POLL_MS = 20000;

function presetToRange(preset: string): { from?: string; to?: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  if (preset === 'today') {
    return { from: to, to };
  }
  if (preset === 'yesterday') {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    const day = y.toISOString().slice(0, 10);
    return { from: day, to: day };
  }
  if (
    preset === '7d' ||
    preset === 'last7' ||
    preset === 'last_7_days'
  ) {
    const from = new Date(now);
    from.setDate(from.getDate() - 7);
    return { from: from.toISOString().slice(0, 10), to };
  }
  if (preset === '30d' || preset === 'last_30_days') {
    const from = new Date(now);
    from.setDate(from.getDate() - 30);
    return { from: from.toISOString().slice(0, 10), to };
  }
  return {};
}

export const JiraStandupHistorySection: React.FC = () => {
  const { workspaceId } = useWorkspace();
  const [filters, setFilters] = useState<StandupHistoryFilterState>(DEFAULT_STANDUP_FILTERS);
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [records, setRecords] = useState<StandupHistoryRecord[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<WorkspaceTimelineEventDto[]>(
    [],
  );
  const [users, setUsers] = useState<StandupHistoryFilterOption[]>([]);
  const [standups, setStandups] = useState<StandupHistoryFilterOption[]>([]);
  const [issues, setIssues] = useState<StandupHistoryFilterOption[]>([]);
  const [eventTypes, setEventTypes] = useState<StandupHistoryFilterOption[]>([]);
  const [timelineEventType, setTimelineEventType] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(filters.search), 250);
    return () => window.clearTimeout(timer);
  }, [filters.search]);

  const loadHistory = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const response = await jiraApi.getStandupHistory({
          search: debouncedSearch || undefined,
          userId: filters.user,
          checkInId: filters.standup,
          issueKey: filters.linkedIssue,
          preset: filters.preset,
          from: filters.customFrom || undefined,
          to: filters.customTo || undefined,
          limit: 150,
        });
        setRecords(response.records);
        setUsers(response.filters.users);
        setStandups(response.filters.standups);
        setIssues(response.filters.issues);
      } catch (err) {
        console.error(err);
        setError('Could not load standup history for this workspace.');
        setRecords([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      debouncedSearch,
      filters.user,
      filters.standup,
      filters.linkedIssue,
      filters.preset,
      filters.customFrom,
      filters.customTo,
    ],
  );

  const loadTimeline = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const range =
          filters.preset === 'custom' || filters.customFrom || filters.customTo
            ? { from: filters.customFrom || undefined, to: filters.customTo || undefined }
            : presetToRange(filters.preset);
        const response = await jiraApi.getWorkspaceTimeline({
          workspaceId: workspaceId || undefined,
          userId: filters.user !== 'all' ? filters.user : undefined,
          eventType: timelineEventType !== 'all' ? timelineEventType : undefined,
          issueKey:
            filters.linkedIssue !== 'all' ? filters.linkedIssue : undefined,
          from: range.from,
          to: range.to,
          limit: 150,
        });
        setTimelineEvents(response.events);
        if (response.filters.users.length) setUsers(response.filters.users);
        if (response.filters.issues?.length) setIssues(response.filters.issues);
        setEventTypes(response.filters.eventTypes);
      } catch (err) {
        console.error(err);
        setError('Could not load workspace timeline.');
        setTimelineEvents([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [
      workspaceId,
      filters.user,
      filters.linkedIssue,
      filters.preset,
      filters.customFrom,
      filters.customTo,
      timelineEventType,
    ],
  );

  useEffect(() => {
    if (viewMode === 'timeline') {
      void loadTimeline();
    } else {
      void loadHistory();
    }
  }, [viewMode, loadHistory, loadTimeline, workspaceId]);

  useEffect(() => {
    const loader = viewMode === 'timeline' ? loadTimeline : loadHistory;
    const timer = window.setInterval(() => {
      void loader({ silent: true });
    }, POLL_MS);

    const onFocus = () => void loader({ silent: true });
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadHistory, loadTimeline, viewMode]);

  const refresh = () => {
    if (viewMode === 'timeline') void loadTimeline({ silent: true });
    else void loadHistory({ silent: true });
  };

  return (
    <Card
      id="standup-history"
      className="overflow-hidden border-white/[0.08] bg-gradient-to-br from-[#4F46E5]/[0.08] via-card to-[#151D2D]/80 shadow-[0_20px_60px_-30px_rgba(79,70,229,0.4)]"
    >
      <div className="h-px w-full bg-gradient-to-r from-transparent via-[#6366F1]/60 to-transparent" />
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#4F46E5]/15 shadow-[0_0_24px_-6px_rgba(99,102,241,0.8)]">
                <History className="h-4 w-4 text-[#60A5FA]" />
              </div>
              <CardTitle>
                {viewMode === 'timeline' ? 'Workspace Timeline' : 'Standup History'}
              </CardTitle>
            </div>
            <CardDescription>
              {viewMode === 'timeline'
                ? 'Live activity from standups, Jira, blockers, Slack, AI reports, and team memory'
                : 'Live Slack standup submissions for the selected workspace'}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-white/[0.1] bg-transparent hover:border-[#3B82F6]/40 hover:bg-[#3B82F6]/10"
              onClick={refresh}
              disabled={refreshing}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
              Refresh
            </Button>
            <div className="flex rounded-xl border border-white/[0.08] bg-[#151D2D]/50 p-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  'rounded-lg',
                  viewMode === 'cards' &&
                    'bg-gradient-to-r from-[#4F46E5] to-[#3B82F6] text-white shadow-[0_0_20px_-6px_rgba(59,130,246,0.8)] hover:text-white',
                )}
                onClick={() => setViewMode('cards')}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Cards
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn(
                  'rounded-lg',
                  viewMode === 'timeline' &&
                    'bg-gradient-to-r from-[#4F46E5] to-[#3B82F6] text-white shadow-[0_0_20px_-6px_rgba(59,130,246,0.8)] hover:text-white',
                )}
                onClick={() => setViewMode('timeline')}
              >
                <GitBranch className="h-3.5 w-3.5" />
                Timeline
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6 px-6 pb-8">
        {viewMode === 'cards' ? (
          <StandupHistoryFilters
            filters={filters}
            onChange={setFilters}
            resultCount={records.length}
            users={users}
            standups={standups}
            issues={issues}
          />
        ) : (
          <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#4F46E5]/10 via-[#151D2D]/60 to-transparent p-4">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['today', 'Today'],
                  ['yesterday', 'Yesterday'],
                  ['last7', 'Last 7 Days'],
                  ['custom', 'Custom Range'],
                ] as const
              ).map(([preset, label]) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() =>
                    setFilters((prev) => ({ ...prev, preset }))
                  }
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200',
                    filters.preset === preset
                      ? 'border-[#6366F1]/50 bg-gradient-to-r from-[#4F46E5]/25 to-[#3B82F6]/20 text-[#60A5FA]'
                      : 'border-white/[0.08] bg-[#151D2D]/50 text-muted-foreground hover:border-[#6366F1]/35 hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {filters.preset === 'custom' ? (
              <div className="flex flex-wrap gap-3">
                <label className="space-y-1 text-xs text-muted-foreground">
                  From
                  <input
                    type="date"
                    className="block h-9 rounded-lg border border-white/10 bg-[#151D2D]/80 px-2 text-sm text-foreground"
                    value={filters.customFrom}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        customFrom: e.target.value,
                      }))
                    }
                  />
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">
                  To
                  <input
                    type="date"
                    className="block h-9 rounded-lg border border-white/10 bg-[#151D2D]/80 px-2 text-sm text-foreground"
                    value={filters.customTo}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        customTo: e.target.value,
                      }))
                    }
                  />
                </label>
              </div>
            ) : null}
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1 text-xs text-muted-foreground">
                Member
                <select
                  className="block h-9 min-w-[160px] rounded-lg border border-white/10 bg-[#151D2D]/80 px-2 text-sm text-foreground"
                  value={filters.user}
                  onChange={(e) =>
                    setFilters((prev) => ({ ...prev, user: e.target.value }))
                  }
                >
                  <option value="all">All members</option>
                  {users.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Event type
                <select
                  className="block h-9 min-w-[180px] rounded-lg border border-white/10 bg-[#151D2D]/80 px-2 text-sm text-foreground"
                  value={timelineEventType}
                  onChange={(e) => setTimelineEventType(e.target.value)}
                >
                  <option value="all">All events</option>
                  {eventTypes.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Jira issue
                <select
                  className="block h-9 min-w-[200px] rounded-lg border border-white/10 bg-[#151D2D]/80 px-2 text-sm text-foreground"
                  value={filters.linkedIssue}
                  onChange={(e) =>
                    setFilters((prev) => ({
                      ...prev,
                      linkedIssue: e.target.value,
                    }))
                  }
                >
                  <option value="all">All issues</option>
                  {issues.map((issue) => (
                    <option key={issue.value} value={issue.value}>
                      {issue.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="pb-2 text-xs text-muted-foreground">
                {timelineEvents.length} event
                {timelineEvents.length === 1 ? '' : 's'}
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {viewMode === 'timeline'
              ? 'Loading workspace timeline…'
              : 'Loading standup history…'}
          </p>
        ) : error ? (
          <p className="py-12 text-center text-sm text-destructive">{error}</p>
        ) : viewMode === 'cards' ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {records.length === 0 ? (
              <p className="col-span-full py-12 text-center text-sm text-muted-foreground">
                No standup records match your filters.
              </p>
            ) : (
              records.map((record) => (
                <StandupHistoryCard key={record.id} record={record} />
              ))
            )}
          </div>
        ) : (
          <WorkspaceTimeline events={timelineEvents} />
        )}
      </CardContent>
    </Card>
  );
};

export default JiraStandupHistorySection;
