import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronsUpDown, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { jiraApi, JiraIssueSummary } from '@/lib/jira-api';
import { cn } from '@/lib/utils';
import { filterJiraIssues } from './jira-ui.utils';
import { JiraIssueStatusBadge } from './JiraIssueStatusBadge';

interface JiraIssueComboboxProps {
  value?: JiraIssueSummary | null;
  onSelect: (issue: JiraIssueSummary) => void;
  onClear?: () => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export const JiraIssueCombobox: React.FC<JiraIssueComboboxProps> = ({
  value,
  onSelect,
  onClear,
  disabled = false,
  placeholder = '🔍 Search Jira issue...',
  className,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [issues, setIssues] = useState<JiraIssueSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  const loadIssues = useCallback(async (options?: { refresh?: boolean; search?: string }) => {
    const requestId = ++requestIdRef.current;
    setLoadState('loading');
    setErrorMessage(null);

    try {
      const response = await jiraApi.getPickerIssues({
        q: options?.search?.trim() || undefined,
        maxResults: 50,
        refresh: options?.refresh === true,
      });

      if (requestId !== requestIdRef.current) {
        return;
      }

      if (response.error) {
        setIssues([]);
        setErrorMessage(response.error);
        setLoadState('error');
        return;
      }

      setIssues(response.issues);
      setLoadState(response.issues.length === 0 ? 'empty' : 'ready');
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }
      console.error(error);
      setIssues([]);
      setErrorMessage('Unable to load Jira issues.');
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadIssues();
    setQuery('');
    setHighlightIndex(0);

    const focusTimer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [open, loadIssues]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadIssues({ search: query });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [open, query, loadIssues]);

  const filteredIssues = useMemo(
    () => filterJiraIssues(issues, query),
    [issues, query],
  );

  useEffect(() => {
    setHighlightIndex(0);
  }, [query, filteredIssues.length]);

  useEffect(() => {
    const highlighted = listRef.current?.children[highlightIndex] as
      | HTMLElement
      | undefined;
    highlighted?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, filteredIssues.length]);

  const handleSelect = (issue: JiraIssueSummary) => {
    onSelect({
      id: issue.id,
      key: issue.key,
      summary: issue.summary,
      status: issue.status,
      issueType: issue.issueType,
      assignee: issue.assignee,
      assigneeAccountId: issue.assigneeAccountId,
      projectKey: issue.projectKey,
      projectName: issue.projectName,
      priority: issue.priority,
      updatedAt: issue.updatedAt,
      issueUrl: issue.issueUrl,
    });
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightIndex((current) =>
        filteredIssues.length === 0
          ? 0
          : Math.min(current + 1, filteredIssues.length - 1),
      );
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const selected = filteredIssues[highlightIndex];
      if (selected) {
        handleSelect(selected);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'h-11 w-full justify-between rounded-xl border-border/70 bg-background px-3 text-left font-normal transition-all duration-200 hover:border-primary/40 hover:bg-secondary/20',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
            {value ? (
              <>
                <span className="font-semibold text-foreground">{value.key}</span>
                <span className="truncate text-muted-foreground">{value.summary}</span>
              </>
            ) : (
              placeholder
            )}
          </span>
          <span className="ml-2 flex shrink-0 items-center gap-1">
            {value && onClear ? (
              <span
                role="button"
                tabIndex={0}
                className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  onClear();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    onClear();
                  }
                }}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            ) : null}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] overflow-hidden p-0 shadow-lg shadow-black/20"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="sticky top-0 z-10 space-y-2 border-b border-border/80 bg-popover p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search by key or summary..."
              className="h-10 rounded-lg pl-9"
            />
          </div>
          <div className="flex items-center justify-between gap-2 px-1">
            <p className="text-xs text-muted-foreground">Live from connected Jira</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1 rounded-lg px-2 text-xs"
              disabled={loadState === 'loading'}
              onClick={() => void loadIssues({ refresh: true, search: query })}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loadState === 'loading' && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </div>

        <div ref={listRef} className="max-h-72 overflow-y-auto p-2">
          {loadState === 'loading' ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading Jira issues...
            </div>
          ) : loadState === 'error' ? (
            <div className="space-y-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                {errorMessage || 'Unable to load Jira issues.'}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => void loadIssues({ refresh: true, search: query })}
              >
                Retry
              </Button>
            </div>
          ) : filteredIssues.length === 0 || loadState === 'empty' ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No Jira issues found.
            </p>
          ) : (
            filteredIssues.map((issue, index) => (
              <button
                key={issue.key}
                type="button"
                onMouseEnter={() => setHighlightIndex(index)}
                onClick={() => handleSelect(issue)}
                className={cn(
                  'mb-1 w-full rounded-xl border border-transparent px-3 py-3 text-left transition-all duration-200 last:mb-0 hover:-translate-y-0.5 hover:border-primary/20 hover:bg-secondary/40 hover:shadow-md hover:shadow-primary/5',
                  index === highlightIndex &&
                    'border-primary/30 bg-primary/10 shadow-md shadow-primary/10',
                )}
              >
                <p className="font-semibold tracking-tight text-foreground">{issue.key}</p>
                <p className="mt-1 text-sm leading-snug text-muted-foreground">
                  {issue.summary}
                </p>
                <div className="mt-2">
                  <JiraIssueStatusBadge status={issue.status} />
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default JiraIssueCombobox;
