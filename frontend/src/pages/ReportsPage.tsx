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

type WorkspaceAnalyticsSnapshot = {
  generatedAt: string;
  blockers: { openBlockers: number; total: number; critical: number };
  jira: { totalIssues: number; openIssues: number; inProgressIssues: number };
  standups: {
    completedSubmissions: number;
    participationRate: number | null;
    runsInRange: number;
  };
  members: { total: number; activeParticipants: number };
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
  const [analytics, setAnalytics] = useState<WorkspaceAnalyticsSnapshot | null>(
    null,
  );

  const loadAnalytics = useCallback(async () => {
    try {
      const data = await apiFetch<WorkspaceAnalyticsSnapshot>(
        '/api/admin/analytics/snapshot',
      );
      setAnalytics(data);
    } catch (err) {
      console.error('Failed to load workspace analytics:', err);
    }
  }, []);

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
    loadAnalytics();
    const interval = setInterval(() => {
      loadReports();
      loadAnalytics();
    }, 15000);
    return () => clearInterval(interval);
  }, [loadReports, loadAnalytics]);

  return (
    <div className="mx-auto max-w-4xl space-y-8 accent-reports">
      <PageHeader
        title="Reports"
        description="Saved standup reports — one per completed Check-In run (same content as Slack)."
        accent="reports"
        badge={
          <span className="inline-flex items-center rounded-full border border-module-reports/25 bg-module-reports/10 px-2.5 py-0.5 text-xs font-medium text-orange-300">
            Standup intelligence
          </span>
        }
      />

      {analytics && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-module-reports/20">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Open blockers
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {analytics.blockers.openBlockers}
              </p>
              <p className="text-xs text-muted-foreground">
                {analytics.blockers.total} total · {analytics.blockers.critical}{' '}
                critical
              </p>
            </CardContent>
          </Card>
          <Card className="border-module-reports/20">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Jira issues
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {analytics.jira.totalIssues}
              </p>
              <p className="text-xs text-muted-foreground">
                {analytics.jira.openIssues} open ·{' '}
                {analytics.jira.inProgressIssues} in progress
              </p>
            </CardContent>
          </Card>
          <Card className="border-module-reports/20">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Standups (7d)
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {analytics.standups.completedSubmissions}
              </p>
              <p className="text-xs text-muted-foreground">
                {analytics.standups.participationRate ?? 'n/a'}% participation ·{' '}
                {analytics.standups.runsInRange} runs
              </p>
            </CardContent>
          </Card>
          <Card className="border-module-reports/20">
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Workspace members
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {analytics.members.total}
              </p>
              <p className="text-xs text-muted-foreground">
                {analytics.members.activeParticipants} active participants
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground/70">
                Recalculated {formatGenerated(analytics.generatedAt)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

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
              <Card key={group.checkInId} className="card-lift overflow-hidden border-module-reports/15 hover:border-module-reports/30 hover:shadow-glow-reports">
                <CardContent className="p-0">
                  <div className="border-b border-white/[0.06] bg-gradient-to-r from-module-reports/8 via-transparent to-transparent px-6 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold tracking-tight">
                          {group.checkInName}
                        </h2>
                        <p className="text-sm text-muted-foreground">{group.teamName}</p>
                      </div>
                      <Badge variant={report.reportPosted ? 'success' : 'reports'}>
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
