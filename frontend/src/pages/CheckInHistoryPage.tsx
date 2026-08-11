import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  Loader2,
  ExternalLink,
  MessageSquare,
  History,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  EnrichedRun,
  THREAD_STATUS_DOT,
  formatDuration,
  formatStartedTime,
  normalizeRun,
} from '@/lib/run-status';

type HistoryResponse = {
  runs: EnrichedRun[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export const CheckInHistoryPage: React.FC = () => {
  const { toast } = useToast();
  const [runs, setRuns] = useState<EnrichedRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1, limit: 25 });

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<HistoryResponse>(
        `/api/check-ins/runs/history?page=${page}&limit=25`,
      );
      setRuns((data.runs ?? []).map(normalizeRun));
      setPagination(data.pagination);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to load history';
      toast({ title: 'Could not load history', description: message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [page, toast]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const filtered = runs.filter((run) => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return (
      run.checkIn?.name?.toLowerCase().includes(q) ||
      run.team?.name?.toLowerCase().includes(q)
    );
  });

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <PageHeader
          title="CheckIn History"
          description="Completed standup runs — including today's finished runs, Slack threads, and AI reports."
        >
          <Button variant="outline" asChild>
            <Link to="/checkins">
              Back to CheckIns
            </Link>
          </Button>
        </PageHeader>

        <Card>
          <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by CheckIn or team..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              <History className="mr-1.5 inline h-4 w-4" />
              {pagination.total} historical run{pagination.total !== 1 ? 's' : ''}
            </p>
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading history...
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-20 text-center">
              <History className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="font-medium text-foreground">No historical runs</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {searchTerm.trim()
                  ? 'Try a different search term.'
                  : 'Completed runs appear here. Active collection stays on the CheckIns page.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/40">
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">CheckIn</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Participants</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Thread</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Report</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Duration</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((run) => {
                    const threadDot =
                      THREAD_STATUS_DOT[run.threadStatus.code as keyof typeof THREAD_STATUS_DOT] ?? '⚪';
                    const canOpen = run.threadStatus.code === 'active' && !!run.slackThreadUrl;

                    return (
                      <tr key={run.id} className="border-b border-border/60 hover:bg-secondary/20">
                        <td className="px-4 py-3">
                          <p className="font-medium">{run.checkIn?.name}</p>
                          <p className="text-xs text-muted-foreground">{run.team?.name}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                          {formatStartedTime(run.startedAt, run.checkIn?.timezone)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={run.status === 'completed' ? 'secondary' : 'success'}>
                            {run.status === 'completed' ? 'Completed' : run.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {run.participantsResponded}/{run.totalParticipants}
                        </td>
                        <td className="px-4 py-3">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default text-xs">
                                {threadDot} {run.threadStatus.label}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{run.threadStatus.tooltip}</TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="px-4 py-3">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="cursor-default text-xs">{run.reportStatus.label}</span>
                            </TooltipTrigger>
                            <TooltipContent>{run.reportStatus.tooltip}</TooltipContent>
                          </Tooltip>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {formatDuration(run.durationMinutes)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {canOpen ? (
                            <Button asChild size="sm" variant="ghost">
                              <a href={run.slackThreadUrl!} target="_blank" rel="noopener noreferrer">
                                <MessageSquare className="h-3.5 w-3.5" />
                                Thread
                                <ExternalLink className="h-3 w-3 opacity-50" />
                              </a>
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagination.totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};

export default CheckInHistoryPage;
