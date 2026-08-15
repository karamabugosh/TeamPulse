import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  Loader2,
  History,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  MessageSquare,
  Sparkles,
  FileText,
  FileSpreadsheet,
  Link2,
  Trash2,
  BarChart3,
} from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  EnrichedRun,
  displayStatusVariant,
  formatDurationLabel,
  formatParticipants,
  formatStartedTime,
  normalizeRun,
  reportStatusIcon,
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

function hasGeneratedReport(run: EnrichedRun): boolean {
  return (
    run.reportStatus.code === 'generated' ||
    !!run.reportGeneratedAt ||
    (!!run.aiReport?.id && run.aiReport.source === 'ai')
  );
}

function hasReportContent(run: EnrichedRun): boolean {
  return hasGeneratedReport(run) || !!run.aiReport?.id;
}

function hasRunExportData(run: EnrichedRun): boolean {
  return run.totalParticipants > 0;
}

function hasSlackThread(run: EnrichedRun): boolean {
  return run.threadStatus.code !== 'missing';
}

async function downloadRunExport(runId: string, type: 'csv' | 'pdf'): Promise<void> {
  const response = await fetch(`/api/check-ins/runs/${runId}/export/${type}`);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'message' in body
        ? String(body.message)
        : `Export failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download =
    type === 'csv' ? `checkin-run-${runId}.csv` : `checkin-run-${runId}-report.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

type RunActionsMenuProps = {
  run: EnrichedRun;
  onRefresh: () => void;
};

const RunActionsMenu: React.FC<RunActionsMenuProps> = ({ run, onRefresh }) => {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);

  const reportGenerated = hasGeneratedReport(run);
  const showGenerate = !reportGenerated;
  const showRegenerate = reportGenerated;
  const canViewReport = hasReportContent(run);
  const canExportPdf = hasReportContent(run);
  const canExportCsv = hasRunExportData(run);
  const canGenerate = showGenerate && run.reportStatus.code !== 'generating';
  const canRegenerate = showRegenerate && run.reportStatus.code !== 'generating';
  const canOpenThread = hasSlackThread(run);
  const canCopyThreadLink = !!run.slackThreadUrl;

  const closeMenu = () => setOpen(false);

  const handleGenerateReport = async (forceRegenerate: boolean) => {
    if (forceRegenerate) {
      const confirmed = window.confirm(
        'Regenerating will replace the saved report and post an updated version to the Slack thread. Continue?',
      );
      if (!confirmed) return;
    }

    setGeneratingReport(true);
    try {
      const result = await apiFetch<{
        status: string;
        message?: string;
        slackDelivered?: boolean;
      }>(`/api/check-ins/runs/${run.id}/generate-report`, {
        method: 'POST',
        body: JSON.stringify({ forceRegenerate }),
      });

      closeMenu();

      if (result.status === 'success' || result.status === 'partial_success') {
        toast({
          title: forceRegenerate ? 'Report regenerated' : 'Report generated',
          description:
            result.message ??
            (result.slackDelivered
              ? 'The AI report was generated and posted to Slack.'
              : 'The AI report was saved for this run.'),
        });
      } else {
        toast({
          title: 'Report request finished',
          description: result.message ?? 'Check run status for details.',
        });
      }

      onRefresh();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to generate report';
      toast({ title: 'Report generation failed', description: message, variant: 'destructive' });
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleOpenThread = () => {
    closeMenu();
    if (run.slackThreadUrl) {
      window.open(run.slackThreadUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    toast({
      title: 'Thread link unavailable',
      description: 'A Slack thread exists for this run, but no permalink is stored yet.',
      variant: 'destructive',
    });
  };

  const handleExport = async (type: 'csv' | 'pdf') => {
    closeMenu();
    setBusyAction(type);
    try {
      await downloadRunExport(run.id, type);
      toast({
        title: type === 'csv' ? 'CSV exported' : 'Report exported',
        description: `Download started for ${run.checkIn?.name ?? 'this run'}.`,
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Export failed';
      toast({ title: 'Export failed', description: message, variant: 'destructive' });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCopyLink = async () => {
    closeMenu();
    if (!run.slackThreadUrl) return;

    try {
      await navigator.clipboard.writeText(run.slackThreadUrl);
      toast({ title: 'Link copied', description: 'Slack thread link copied to clipboard.' });
    } catch {
      toast({
        title: 'Copy failed',
        description: 'Could not copy the Slack thread link.',
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    closeMenu();

    const confirmed = window.confirm(
      `Delete this run for "${run.checkIn?.name ?? 'Check-In'}"? This permanently removes submissions, answers, and the AI report for this run only.`,
    );
    if (!confirmed) return;

    setBusyAction('delete');
    try {
      await apiFetch(`/api/check-ins/runs/${run.id}`, { method: 'DELETE' });
      toast({ title: 'Run deleted', description: 'The run and its data were removed.' });
      onRefresh();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to delete run';
      toast({ title: 'Delete failed', description: message, variant: 'destructive' });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="flex h-full items-center justify-end">
      <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="Run actions"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem disabled={!canViewReport} asChild={canViewReport}>
          {canViewReport ? (
            <Link to={`/reports/run/${run.id}`} onClick={closeMenu}>
              <BarChart3 className="mr-2 h-4 w-4" />
              View Report
            </Link>
          ) : (
            <span className="flex items-center">
              <BarChart3 className="mr-2 h-4 w-4" />
              View Report
            </span>
          )}
        </DropdownMenuItem>

        {showGenerate ? (
          <DropdownMenuItem
            disabled={!canGenerate || generatingReport}
            onClick={() => handleGenerateReport(false)}
          >
            {generatingReport ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Generate AI Report
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={!canRegenerate || generatingReport}
            onClick={() => handleGenerateReport(true)}
          >
            {generatingReport ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Regenerate AI Report
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem disabled={!canOpenThread} onClick={handleOpenThread}>
          <MessageSquare className="mr-2 h-4 w-4" />
          Open Slack Thread
        </DropdownMenuItem>

        <DropdownMenuItem disabled={!canCopyThreadLink} onClick={handleCopyLink}>
          <Link2 className="mr-2 h-4 w-4" />
          Copy Slack Thread Link
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={!canExportPdf || busyAction === 'pdf'}
          onClick={() => handleExport('pdf')}
        >
          {busyAction === 'pdf' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileText className="mr-2 h-4 w-4" />
          )}
          Export as PDF
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canExportCsv || busyAction === 'csv'}
          onClick={() => handleExport('csv')}
        >
          {busyAction === 'csv' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="mr-2 h-4 w-4" />
          )}
          Export as CSV
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          disabled={busyAction === 'delete'}
          onClick={handleDelete}
        >
          {busyAction === 'delete' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="mr-2 h-4 w-4" />
          )}
          Delete Run
        </DropdownMenuItem>
      </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export const CheckInHistoryPage: React.FC = () => {
  const { toast } = useToast();
  const [runs, setRuns] = useState<EnrichedRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1, limit: 25 });
  const [, setClock] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    const hasActiveRun = runs.some((run) => run.durationKind === 'elapsed');
    if (!hasActiveRun) return;

    const timer = window.setInterval(() => {
      setClock((value) => value + 1);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [runs]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pagination.limit),
      });
      if (debouncedSearch) {
        params.set('search', debouncedSearch);
      }

      const data = await apiFetch<HistoryResponse>(
        `/api/check-ins/runs/history?${params.toString()}`,
      );
      setRuns((data.runs ?? []).map(normalizeRun));
      setPagination(data.pagination);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to load history';
      toast({ title: 'Could not load history', description: message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, pagination.limit, toast]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const counterLabel =
    debouncedSearch.length > 0
      ? `${pagination.total} matching run${pagination.total !== 1 ? 's' : ''}`
      : `${pagination.total} historical run${pagination.total !== 1 ? 's' : ''}`;

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <PageHeader
          title="Run History"
          description="Real execution history for every Check-In run."
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
                placeholder="Search by Check-In, team, status, or date..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              <History className="mr-1.5 inline h-4 w-4" />
              {counterLabel}
            </p>
          </CardContent>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading history...
          </div>
        ) : runs.length === 0 ? (
          <Card>
            <CardContent className="py-20 text-center">
              <History className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="font-medium text-foreground">No historical runs</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {debouncedSearch
                  ? 'Try a different search term.'
                  : 'Runs appear here once a Check-In has started collecting responses.'}
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
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Team</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date &amp; Time</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Participants</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Report</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Duration</th>
                    <th className="w-20 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-border/60 hover:bg-secondary/20">
                      <td className="px-4 py-3">
                        <p className="font-medium">{run.checkIn?.name ?? 'Unavailable'}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {run.team?.name ?? 'Unavailable'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatStartedTime(run.startedAt, run.checkIn?.timezone)}
                      </td>
                      <td className="px-4 py-3">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant={displayStatusVariant(run.displayStatus.code)}>
                              {run.displayStatus.label}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>{run.displayStatus.tooltip}</TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="px-4 py-3 tabular-nums">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-default">
                              {formatParticipants(run.participantsResponded, run.totalParticipants)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {run.participantsResponded} of {run.totalParticipants} assigned participants submitted all required answers.
                          </TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="px-4 py-3">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-default text-xs">
                              {reportStatusIcon(run.reportStatus.code)} {run.reportStatus.label}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{run.reportStatus.tooltip}</TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                        {formatDurationLabel(run)}
                      </td>
                      <td className="w-20 px-2 py-3">
                        <RunActionsMenu run={run} onRefresh={loadHistory} />
                      </td>
                    </tr>
                  ))}
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
