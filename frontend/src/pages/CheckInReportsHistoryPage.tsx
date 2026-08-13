import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, Loader2, History } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiFetch, ApiError } from '@/lib/api';

type ReportListItem = {
  id: string;
  runId: string;
  checkInName: string;
  teamName: string;
  generatedAt: string;
  runDate: string;
  aiProvider: string;
  source: string;
  summary: string;
  totalParticipants: number;
  participantsResponded: number;
  completionRate: number;
};

type HistoryResponse = {
  checkInId: string;
  checkInName: string;
  teamName: string;
  reports: ReportListItem[];
};

function formatGenerated(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export const CheckInReportsHistoryPage: React.FC = () => {
  const { checkInId } = useParams<{ checkInId: string }>();
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    if (!checkInId) return;
    try {
      const result = await apiFetch<HistoryResponse>(
        `/api/admin/reports/by-checkin/${checkInId}`,
      );
      setData(result);
      setError(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load history';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [checkInId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading history...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4 py-12 text-center">
        <p className="text-destructive">{error ?? 'History not found'}</p>
        <Button asChild variant="outline">
          <Link to="/reports">Back to Reports</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title={data.checkInName}
        description={`${data.teamName} · Report history`}
      >
        <Button variant="outline" size="sm" asChild>
          <Link to="/reports">
            <ArrowLeft className="h-4 w-4" />
            Reports
          </Link>
        </Button>
      </PageHeader>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <History className="h-4 w-4" />
        {data.reports.length} report{data.reports.length !== 1 ? 's' : ''}
      </div>

      <div className="space-y-3">
        {data.reports.map((report, index) => (
          <Card key={report.id}>
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {index === 0 && <Badge variant="success">Latest</Badge>}
                  <Badge variant={report.source === 'ai' ? 'default' : 'secondary'}>
                    {report.aiProvider}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Generated {formatGenerated(report.generatedAt)}
                </p>
                <p className="line-clamp-2 text-sm">{report.summary}</p>
                <p className="text-xs text-muted-foreground">
                  Participants {report.participantsResponded}/{report.totalParticipants}
                </p>
              </div>
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <Link to={`/reports/run/${report.runId}`}>
                  <Eye className="h-3.5 w-3.5" />
                  View
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default CheckInReportsHistoryPage;
