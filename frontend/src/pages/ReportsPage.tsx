import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Eye, Loader2, History, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';

type ReportListItem = {
  id: string;
  runId: string;
  checkInId: string | null;
  checkInName: string;
  teamName: string;
  runDate: string;
  generatedAt: string;
  aiProvider: string;
  source: string;
  summary: string;
  totalParticipants: number;
  participantsResponded: number;
  completionRate: number;
  reportPosted: boolean;
};

type ReportGroup = {
  checkInId: string;
  checkInName: string;
  teamName: string;
  latestReport: ReportListItem;
  totalReports: number;
};

function formatGenerated(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export const ReportsPage: React.FC = () => {
  const [groups, setGroups] = useState<ReportGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const loadReports = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchTerm.trim()) params.set('search', searchTerm.trim());
      const query = params.toString();
      const data = await apiFetch<ReportGroup[]>(
        `/api/admin/reports/grouped${query ? `?${query}` : ''}`,
      );
      setGroups(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load reports:', err);
    } finally {
      setLoading(false);
    }
  }, [searchTerm]);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(loadReports, searchTerm ? 300 : 0);
    return () => clearTimeout(timer);
  }, [loadReports, searchTerm]);

  useEffect(() => {
    const interval = setInterval(loadReports, 15000);
    return () => clearInterval(interval);
  }, [loadReports]);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="Reports"
        description="Saved standup reports — one per completed Check-In run (same content as Slack)."
      />

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search CheckIns..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="h-10 pl-9"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading reports...
        </div>
      ) : groups.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center text-muted-foreground">
            <Sparkles className="mx-auto mb-3 h-8 w-8 opacity-40" />
            <p className="font-medium text-foreground">No reports yet</p>
            <p className="mt-1 text-sm">
              Reports appear here after a CheckIn run completes and the report is generated and saved.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const report = group.latestReport;
            const hasHistory = group.totalReports > 1;

            return (
              <Card key={group.checkInId} className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="border-b border-border/60 px-6 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold tracking-tight">
                          {group.checkInName}
                        </h2>
                        <p className="text-sm text-muted-foreground">{group.teamName}</p>
                      </div>
                      <Badge variant={report.reportPosted ? 'success' : 'secondary'}>
                        {report.reportPosted ? 'Posted' : 'Saved'}
                      </Badge>
                    </div>
                  </div>

                  <div className="space-y-4 px-6 py-5">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Latest Report
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Run {formatGenerated(report.runDate)} · Generated{' '}
                        {formatGenerated(report.generatedAt)}
                      </p>
                    </div>

                    <p className="line-clamp-2 text-sm leading-relaxed text-foreground/90">
                      {report.summary}
                    </p>

                    <p className="text-sm text-muted-foreground">
                      Participants{' '}
                      <span className="font-medium text-foreground">
                        {report.participantsResponded}/{report.totalParticipants}
                      </span>
                      {report.completionRate < 100 && (
                        <span className="ml-1">({report.completionRate}%)</span>
                      )}
                    </p>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button asChild size="sm">
                        <Link to={`/reports/run/${report.runId}`}>
                          <Eye className="h-3.5 w-3.5" />
                          View Report
                        </Link>
                      </Button>
                      {hasHistory && (
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/reports/checkins/${group.checkInId}/history`}>
                            <History className="h-3.5 w-3.5" />
                            History
                            <span className="ml-1 text-muted-foreground">
                              ({group.totalReports})
                            </span>
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ReportsPage;
