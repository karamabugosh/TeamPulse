import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckSquare,
  Users,
  CheckCircle2,
  Clock,
  FileText,
  AlertTriangle,
  Sparkles,
  Calendar,
  Zap,
  Activity,
  ArrowRight,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { apiFetch } from '@/lib/api';
import { EnrichedRun, normalizeRun, reportStatusIcon } from '@/lib/run-status';

const chartTooltipStyle = {
  backgroundColor: '#111827',
  borderColor: '#1F2937',
  borderRadius: '12px',
  border: '1px solid #1F2937',
};

export const OverviewPage: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [activeRuns, setActiveRuns] = useState<EnrichedRun[]>([]);

  const loadActiveRuns = useCallback(async () => {
    try {
      const runs = await apiFetch<EnrichedRun[]>('/api/check-ins/runs/active');
      setActiveRuns(Array.isArray(runs) ? runs.map(normalizeRun) : []);
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    const loadOverview = () => {
      apiFetch('/api/admin/overview')
        .then((resData) => setData(resData))
        .catch(console.error);
    };

    loadOverview();
    loadActiveRuns();
    const runsInterval = setInterval(loadActiveRuns, 10000);
    const overviewInterval = setInterval(loadOverview, 30000);
    return () => {
      clearInterval(runsInterval);
      clearInterval(overviewInterval);
    };
  }, [loadActiveRuns]);

  const stats = {
    activeCheckIns: data?.stats?.activeCheckIns ?? 0,
    activeTeams: data?.stats?.activeTeams ?? 0,
    completionRate: data?.stats?.completionRate ?? 0,
    pendingResponses: data?.stats?.pendingResponses ?? 0,
    avgResponseTimeMinutes: data?.stats?.avgResponseTimeMinutes ?? 0,
    todayReports: data?.stats?.todayReports ?? 0,
  };

  const weeklyParticipation = data?.weeklyParticipation || [];
  const completionTrend = data?.completionTrend || [];
  const topBlockers = data?.topBlockers || [];
  const recentActivity = data?.recentActivity || [];
  const upcomingCheckIns = data?.upcomingCheckIns || [];
  const aiInsights = data?.aiInsights;

  const severityVariant = (severity: string) => {
    if (severity === 'high') return 'danger' as const;
    if (severity === 'medium') return 'warning' as const;
    return 'secondary' as const;
  };

  return (
    <div className="space-y-10">
      {/* Hero Section */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-8 lg:p-10">
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <Badge variant="secondary" className="gap-1.5">
              <Zap className="h-3 w-3 text-primary" />
              Live Sync Active
            </Badge>
            <PageHeader
              title="Welcome back"
              description="Your team check-in dashboard — real-time standup metrics, participation trends, and AI-powered insights."
              className="!flex-col !gap-2"
            />
          </div>
          <div className="flex gap-3">
            <Button variant="outline">View Reports</Button>
            <Button>
              Create CheckIn
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-primary/10 blur-2xl" />
      </div>

      {/* Active CheckIns Status */}
      {activeRuns.length > 0 && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle>Active Runs</CardTitle>
            <CardDescription>Standups currently collecting responses</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {activeRuns.map((run) => {
              const pct = run.totalParticipants > 0
                ? Math.round((run.participantsResponded / run.totalParticipants) * 100)
                : 0;
              return (
                <div key={run.id} className="rounded-xl border border-border bg-secondary/30 p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">{run.checkIn?.name}</p>
                    <Badge variant="success">Collecting</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{run.team?.name}</p>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {run.participantsResponded}/{run.totalParticipants} responses · {pct}% complete
                  </p>
                  <p className="text-sm font-medium">
                    {reportStatusIcon(run.reportStatus.code)} {run.reportStatus.label}
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard title="Active CheckIns" value={stats.activeCheckIns} icon={CheckSquare} />
        <KpiCard title="Active Teams" value={stats.activeTeams} icon={Users} subtitle="Across workspace" />
        <KpiCard title="Completion Rate" value={`${stats.completionRate}%`} icon={CheckCircle2} iconClassName="bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20" />
        <KpiCard title="Pending Responses" value={stats.pendingResponses} icon={Clock} subtitle="Awaiting submission" iconClassName="bg-amber-500/10 text-amber-400 group-hover:bg-amber-500/20" />
        <KpiCard title="Today's Reports" value={stats.todayReports} icon={FileText} subtitle="Generated today" />
        <KpiCard title="Avg Response Time" value={`${stats.avgResponseTimeMinutes} min`} icon={Activity} iconClassName="bg-cyan-500/10 text-cyan-400 group-hover:bg-cyan-500/20" />
      </div>

      {aiInsights && (
        <Card className="border-l-4 border-l-primary bg-gradient-to-r from-primary/5 to-transparent">
          <CardContent className="flex gap-4 p-6">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-semibold">{aiInsights.headline}</h3>
                <Badge variant="secondary">Insights</Badge>
              </div>
              <p className="text-base text-muted-foreground leading-relaxed">{aiInsights.summary}</p>
              {aiInsights.recommendation && (
                <p className="text-sm text-primary">{aiInsights.recommendation}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts — 2x2 Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="card-lift">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Weekly Participation</CardTitle>
                <CardDescription>Daily submission rates vs 85% target</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {weeklyParticipation.length > 0 ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyParticipation} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
                    <XAxis dataKey="day" stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#9CA3AF" fontSize={12} domain={[0, 100]} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Bar dataKey="completion" fill="#7C3AED" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">No participation data yet.</p>
            )}
          </CardContent>
        </Card>

        <Card className="card-lift">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Completion Trend</CardTitle>
                <CardDescription>7-day historical completion rate</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {completionTrend.length > 0 ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={completionTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorRate" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#7C3AED" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#7C3AED" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
                    <XAxis dataKey="date" stroke="#9CA3AF" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#9CA3AF" fontSize={12} domain={[0, 100]} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Area type="monotone" dataKey="rate" stroke="#7C3AED" fillOpacity={1} fill="url(#colorRate)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="py-16 text-center text-sm text-muted-foreground">No completion trend data yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Section — Activity, Upcoming, Blockers */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Activity Timeline */}
        <Card className="card-lift lg:col-span-1">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent Activity</CardTitle>
              <Badge variant="secondary">Live</Badge>
            </div>
            <CardDescription>Latest events across your workspace</CardDescription>
          </CardHeader>
          <CardContent>
            {recentActivity.length > 0 ? (
              <div className="relative space-y-0">
                {recentActivity.map((act: any, idx: number) => (
                <div key={act.id} className="relative flex gap-4 pb-8 last:pb-0">
                  {idx < recentActivity.length - 1 && (
                    <div className="absolute left-[7px] top-4 h-full w-px bg-border" />
                  )}
                  <div className="relative z-10 mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2 border-primary bg-background" />
                  <div className="flex-1 space-y-1 rounded-xl border border-border bg-secondary/30 p-4 transition-colors hover:bg-secondary/50">
                    <p className="text-sm font-medium">{act.title}</p>
                    <p className="text-xs text-muted-foreground">{act.team} · {act.timestamp}</p>
                  </div>
                </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No recent activity yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Upcoming CheckIns Timeline */}
        <Card className="card-lift lg:col-span-1">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-primary" />
              <CardTitle>Upcoming CheckIns</CardTitle>
            </div>
            <CardDescription>Scheduled runs for today and this week</CardDescription>
          </CardHeader>
          <CardContent>
            {upcomingCheckIns.length > 0 ? (
              <div className="relative space-y-0">
                {upcomingCheckIns.map((sch: any, idx: number) => (
                <div key={sch.id} className="relative flex gap-4 pb-8 last:pb-0">
                  {idx < upcomingCheckIns.length - 1 && (
                    <div className="absolute left-[7px] top-4 h-full w-px bg-border" />
                  )}
                  <div className="relative z-10 mt-1 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full bg-primary">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                  </div>
                  <div className="flex flex-1 items-center justify-between gap-3 rounded-xl border border-border bg-secondary/30 p-4 transition-colors hover:bg-secondary/50">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{sch.name}</p>
                      <p className="text-xs text-muted-foreground">{sch.team}</p>
                      <code className="text-[10px] text-primary font-mono">{sch.cron}</code>
                    </div>
                    <Badge className="shrink-0">{sch.time}</Badge>
                  </div>
                </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No scheduled check-ins configured.</p>
            )}
          </CardContent>
        </Card>

        {/* Top Blockers */}
        <Card className="card-lift lg:col-span-1">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <CardTitle>Top Blockers</CardTitle>
            </div>
            <CardDescription>Active issues reported by teams</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {topBlockers.length > 0 ? (
              topBlockers.map((blocker: any) => (
                <div key={blocker.id} className="rounded-xl border border-border bg-secondary/30 p-4 space-y-2 transition-colors hover:bg-secondary/50">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{blocker.team}</span>
                    <Badge variant={severityVariant(blocker.severity)}>{blocker.severity}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{blocker.description}</p>
                  <Separator />
                  <p className="text-xs text-muted-foreground text-right">{blocker.count} member(s) impacted</p>
                </div>
              ))
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No blockers reported yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default OverviewPage;
