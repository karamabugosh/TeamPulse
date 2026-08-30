import React from 'react';
import { cn } from '@/lib/utils';

export interface BlockersFilterState {
  datePreset: 'today' | 'last7' | 'last30' | 'all';
  search: string;
  reporter: string;
  status: string;
  priority: string;
  category: string;
  issue: string;
  standup: string;
}

export const DEFAULT_BLOCKER_FILTERS: BlockersFilterState = {
  datePreset: 'all',
  search: '',
  reporter: 'all',
  status: 'all',
  priority: 'all',
  category: 'all',
  issue: 'all',
  standup: 'all',
};

interface BlockersFiltersProps {
  filters: BlockersFilterState;
  onChange: (filters: BlockersFilterState) => void;
  resultCount: number;
  reporters: string[];
  categories: string[];
  standups: string[];
  issues: string[];
}

const selectClassName =
  'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export const BlockersFilters: React.FC<BlockersFiltersProps> = ({
  filters,
  onChange,
  resultCount,
  reporters,
  categories,
  standups,
  issues,
}) => {
  const update = <K extends keyof BlockersFilterState>(
    key: K,
    value: BlockersFilterState[K],
  ) => onChange({ ...filters, [key]: value });

  return (
    <div className="space-y-4 rounded-2xl border border-border/80 bg-secondary/10 p-4 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold">Filters</p>
          <p className="text-xs text-muted-foreground">{resultCount} blocker(s)</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['all', 'All Time'],
              ['today', 'Today'],
              ['last7', 'Last 7 Days'],
              ['last30', 'Last 30 Days'],
            ] as const
          ).map(([preset, label]) => (
            <button
              key={preset}
              type="button"
              onClick={() => update('datePreset', preset)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200',
                filters.datePreset === preset
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-border/70 bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-1.5 md:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Search</label>
          <input
            type="search"
            value={filters.search}
            onChange={(event) => update('search', event.target.value)}
            placeholder="Search title, description, reporter, Jira…"
            className={selectClassName}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Reporter</label>
          <select
            value={filters.reporter}
            onChange={(event) => update('reporter', event.target.value)}
            className={selectClassName}
          >
            <option value="all">All Reporters</option>
            {reporters.map((reporter) => (
              <option key={reporter} value={reporter}>
                {reporter}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Status</label>
          <select
            value={filters.status}
            onChange={(event) => update('status', event.target.value)}
            className={selectClassName}
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="in_progress">In Progress</option>
            <option value="waiting">Waiting</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Priority</label>
          <select
            value={filters.priority}
            onChange={(event) => update('priority', event.target.value)}
            className={selectClassName}
          >
            <option value="all">All Priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Category</label>
          <select
            value={filters.category}
            onChange={(event) => update('category', event.target.value)}
            className={selectClassName}
          >
            <option value="all">All Categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Jira Issue</label>
          <select
            value={filters.issue}
            onChange={(event) => update('issue', event.target.value)}
            className={selectClassName}
          >
            <option value="all">All Issues</option>
            {issues.map((issue) => (
              <option key={issue} value={issue}>
                {issue}
              </option>
            ))}
            <option value="none">No Linked Issue</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Standup</label>
          <select
            value={filters.standup}
            onChange={(event) => update('standup', event.target.value)}
            className={selectClassName}
          >
            <option value="all">All Standups</option>
            {standups.map((standup) => (
              <option key={standup} value={standup}>
                {standup}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

export default BlockersFilters;
