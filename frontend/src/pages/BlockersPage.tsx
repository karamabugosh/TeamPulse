import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Button } from '@/components/ui/button';
import { BlockersStatsRow } from '@/components/blockers/BlockersStatsRow';
import {
  BlockersFilters,
  DEFAULT_BLOCKER_FILTERS,
  BlockersFilterState,
} from '@/components/blockers/BlockersFilters';
import { BlockerCard } from '@/components/blockers/BlockerCard';
import { useBlockersDashboard } from '@/components/blockers/useBlockersDashboard';
import {
  extractFilterOptions,
  filterBlockers,
} from '@/components/blockers/blockers.utils';
import { computeBlockerStats } from '@/components/blockers/blockers.types';
import { cn } from '@/lib/utils';

const BlockersPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('id');
  const [filters, setFilters] = useState<BlockersFilterState>(DEFAULT_BLOCKER_FILTERS);
  const { loading, error, blockers, reload } = useBlockersDashboard();

  const filterOptions = useMemo(() => extractFilterOptions(blockers), [blockers]);

  // Same collection used for the list AND the summary cards.
  const filteredBlockers = useMemo(
    () => filterBlockers(blockers, filters),
    [blockers, filters],
  );

  const stats = useMemo(() => computeBlockerStats(filteredBlockers), [filteredBlockers]);

  useEffect(() => {
    if (!focusId || loading) return;
    const timer = window.setTimeout(() => {
      document
        .getElementById(`blocker-${focusId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [focusId, loading, filteredBlockers]);

  const showEmptyState = !loading && !error && blockers.length === 0;
  const showNoFilterMatches =
    !loading && !error && blockers.length > 0 && filteredBlockers.length === 0;

  return (
    <div className="section-stack pb-12 animate-fade-in accent-blockers">
      <PageHeader
        title="Blockers"
        description="Blockers reported from Slack standup answers."
        accent="blockers"
        badge={
          <span className="inline-flex items-center rounded-full border border-module-blockers/25 bg-module-blockers/10 px-2.5 py-0.5 text-xs font-medium text-red-300">
            Needs attention
          </span>
        }
      >
        <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </PageHeader>

      <BlockersStatsRow stats={stats} />

      {!showEmptyState ? (
        <BlockersFilters
          filters={filters}
          onChange={setFilters}
          resultCount={filteredBlockers.length}
          reporters={filterOptions.reporters}
          categories={filterOptions.categories}
          standups={filterOptions.standups}
          issues={filterOptions.issues}
        />
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading blockers…
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center">
          <p className="font-medium text-destructive">{error}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      ) : showEmptyState ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-6 py-16 text-center">
          <p className="text-2xl">🚀</p>
          <p className="mt-3 text-lg font-semibold text-emerald-300">Great!</p>
          <p className="mt-1 text-base font-medium text-foreground">
            No blockers reported.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Your team has no active blockers today.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-6"
            onClick={() => void reload()}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      ) : showNoFilterMatches ? (
        <div className="rounded-2xl border border-border/70 bg-secondary/10 px-6 py-12 text-center">
          <p className="font-medium">No blockers match these filters.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => setFilters(DEFAULT_BLOCKER_FILTERS)}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="grid gap-5">
          {filteredBlockers.map((blocker) => (
            <div
              key={blocker.id}
              id={`blocker-${blocker.id}`}
              className={cn(
                focusId === blocker.id &&
                  'rounded-2xl ring-2 ring-orange-400/60 ring-offset-2 ring-offset-background',
              )}
            >
              <BlockerCard blocker={blocker} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BlockersPage;
