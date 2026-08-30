import React from 'react';
import { cn } from '@/lib/utils';
import { StandupHistoryFilterOption } from './standup-history.types';

export type DateRangePreset = 'today' | 'yesterday' | 'last7' | 'custom';

export interface StandupHistoryFilterState {
  preset: DateRangePreset;
  customFrom: string;
  customTo: string;
  user: string;
  standup: string;
  linkedIssue: string;
  search: string;
}

export const DEFAULT_STANDUP_FILTERS: StandupHistoryFilterState = {
  preset: 'last7',
  customFrom: '',
  customTo: '',
  user: 'all',
  standup: 'all',
  linkedIssue: 'all',
  search: '',
};

interface StandupHistoryFiltersProps {
  filters: StandupHistoryFilterState;
  onChange: (filters: StandupHistoryFilterState) => void;
  resultCount: number;
  users: StandupHistoryFilterOption[];
  standups: StandupHistoryFilterOption[];
  issues: StandupHistoryFilterOption[];
}

const selectClassName =
  'h-10 w-full rounded-xl border border-white/[0.08] bg-[#151D2D]/80 px-3 text-sm text-foreground transition-all duration-200 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1]/45 focus-visible:border-[#6366F1]/40';

export const StandupHistoryFilters: React.FC<StandupHistoryFiltersProps> = ({
  filters,
  onChange,
  resultCount,
  users,
  standups,
  issues,
}) => {
  const update = <K extends keyof StandupHistoryFilterState>(
    key: K,
    value: StandupHistoryFilterState[K],
  ) => onChange({ ...filters, [key]: value });

  return (
    <div className="space-y-4 rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#4F46E5]/10 via-[#151D2D]/60 to-transparent p-4 shadow-[0_0_40px_-20px_rgba(79,70,229,0.45)]">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Filters</p>
          <p className="text-xs text-muted-foreground">{resultCount} standup record(s)</p>
        </div>
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
              onClick={() => update('preset', preset)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-200',
                filters.preset === preset
                  ? 'border-[#6366F1]/50 bg-gradient-to-r from-[#4F46E5]/25 to-[#3B82F6]/20 text-[#60A5FA] shadow-[0_0_20px_-8px_rgba(99,102,241,0.7)]'
                  : 'border-white/[0.08] bg-[#151D2D]/50 text-muted-foreground hover:border-[#6366F1]/35 hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filters.preset === 'custom' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">From</label>
            <input
              type="date"
              value={filters.customFrom}
              onChange={(event) => update('customFrom', event.target.value)}
              className={selectClassName}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">To</label>
            <input
              type="date"
              value={filters.customTo}
              onChange={(event) => update('customTo', event.target.value)}
              className={selectClassName}
            />
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div className="space-y-1.5 xl:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Search</label>
          <input
            type="search"
            value={filters.search}
            onChange={(event) => update('search', event.target.value)}
            placeholder="User, issue key, answer, or blocker…"
            className={selectClassName}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">User</label>
          <select
            value={filters.user}
            onChange={(event) => update('user', event.target.value)}
            className={selectClassName}
          >
            <option value="all">All Users</option>
            {users.length === 0 ? (
              <option value="" disabled>
                No Slack members found.
              </option>
            ) : (
              users.map((user) => (
                <option key={user.value} value={user.value}>
                  {user.label}
                </option>
              ))
            )}
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
              <option key={standup.value} value={standup.value}>
                {standup.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Linked Jira Issue</label>
          <select
            value={filters.linkedIssue}
            onChange={(event) => update('linkedIssue', event.target.value)}
            className={selectClassName}
          >
            <option value="all">All Issues</option>
            {issues.map((issue) => (
              <option key={issue.value} value={issue.value}>
                {issue.label}
              </option>
            ))}
            <option value="none">No Linked Issue</option>
          </select>
        </div>
      </div>
    </div>
  );
};

export default StandupHistoryFilters;
