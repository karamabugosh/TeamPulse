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
  formatDuration,
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

function hasExportableReport(run: EnrichedRun): boolean {
  return (
    !!run.aiReport?.id &&
    run.aiReport.source === 'ai' &&
    !['waiting', 'generating', 'generation_failed'].includes(run.reportStatus.code)
  );
}

function hasExistingReport(run: EnrichedRun): boolean {
  return (
    !!run.aiReport?.id ||
    !!run.reportGeneratedAt ||
    ['ready', 'posting', 'posted'].includes(run.reportStatus.code)
  );
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
  const [busy, setBusy] = useState(false);

  const hasThread = run.threadStatus.code === 'active' && !!run.slackThreadUrl;
  const canExport = hasExportableReport(run);
  const canGenerate =
    run.status !== 'collecting' && run.reportStatus.code !== 'generating';
  const reportLabel = hasExistingReport(run)
    ? 'Regenerate AI Report'
    : 'Generate AI Report';

  const closeMenu = () => setOpen(false);

  const handleGenerateReport = async () => {
    closeMenu();

    if (hasExistingReport(run)) {
      const confirmed = window.confirm(
        'A report already exists for this run. Regenerating will replace the saved report and post an updated version to the Slack thread. Continue?',
      );
      if (!confirmed) return;
    }

    setBusy(true);
    try {
      const result = await apiFetch<{
        status: string;
        message?: string;
        slackDelivered?: boolean;
      }>(`/api/check-ins/runs/${run.id}/generate-report`, {
        method: 'POST',
        body: JSON.stringify({
          forceRegenerate: hasExistingReport(run),
        }),
      });

      toast({
        title: result.status === 'success' ? 'Report updated' : 'Report request finished',
        description:
          result.message ??
          (result.slackDelivered
            ? 'The AI report was generated and posted to Slack.'
            : 'Check run status for details.'),
      });
      onRefresh();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to generate report';
      toast({ title: 'Report generation failed', description: message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async (type: 'csv' | 'pdf') => {
    closeMenu();
    setBusy(true);
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
      setBusy(false);
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

    setBusy(true);
    try {
      await apiFetch(`/api/check-ins/runs/${run.id}`, { method: 'DELETE' });
      toast({ title: 'Run deleted', description: 'The run and its data were removed.' });
      onRefresh();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to delete run';
      toast({ title: 'Delete failed', description: message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={busy}
          aria-label="Run actions"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {canExport ? (
          <DropdownMenuItem asChild>
            <Link to={`/reports/run/${run.id}`} onClick={closeMenu}>
              <BarChart3 className="mr-2 h-4 w-4" />
              View Report
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <BarChart3 className="mr-2 h-4 w-4" />
            No report has been generated yet.
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {hasThread ? (
          <>
            <DropdownMenuItem asChild>
              <a
                href={run.slackThreadUrl!}
                target="_blank"
                rel="noopener noreferrer"
                onClick={closeMenu}
                className="flex cursor-pointer items-center"
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                Open Slack Thread
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleCopyLink}>
              <Link2 className="mr-2 h-4 w-4" />
              Copy Slack Thread Link
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}

        <DropdownMenuItem disabled={!canGenerate} onClick={handleGenerateReport}>
          <Sparkles className="mr-2 h-4 w-4" />
          {reportLabel}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem disabled={!canExport} onClick={() => handleExport('pdf')}>
          <FileText className="mr-2 h-4 w-4" />
          Export as PDF
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canExport} onClick={() => handleExport('csv')}>
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Export as CSV
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={handleDelete}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Run
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
          title="Run History"
          description="Completed standup runs — Slack threads and AI reports."
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
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI Report</th>
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Duration</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground w-12" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((run) => (
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
                              {reportStatusIcon(run.reportStatus.code)} {run.reportStatus.label}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{run.reportStatus.tooltip}</TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDuration(run.durationMinutes)}
                      </td>
                      <td className="px-4 py-3 text-right">
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
