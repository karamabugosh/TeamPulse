import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  CheckSquare,
  Lightbulb,
  Sparkles,
  Star,
  TrendingUp,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const chartTooltipStyle = {
  backgroundColor: '#111827',
  borderColor: '#1F2937',
  borderRadius: '12px',
  border: '1px solid #1F2937',
};

export interface AiAnalyticsBlocker {
  memberName: string;
  standup: string;
  description: string;
  severity: string;
  runId: string;
  source?: string;
}

export interface AiAnalyticsProductivityPoint {
  runId: string;
  label: string;
  checkInName: string;
  rate: number;
  completed?: number;
  total?: number;
}

export interface AiAnalyticsData {
  available: boolean;
  message?: string;
  teamHealth?: 'healthy' | 'needs_attention' | 'critical' | null;
  teamHealthLabel?: string;
  completionRate?: number | null;
  completionRateLabel?: string;
  completionTrendDelta?: number | null;
  activeBlockersCount?: number;
  activeBlockers?: AiAnalyticsBlocker[];
  averageConfidence?: number | null;
  averageConfidenceLabel?: string;
  averageConfidenceScale?: number;
  activeCheckIns?: number;
  productivityTrend?: AiAnalyticsProductivityPoint[];
  productivityTrendLabel?: string;
  insights?: string[];
  insightsLabel?: string;
  recommendations?: string[];
  recommendationsLabel?: string;
  basedOnRuns?: number;
  latestCheckInName?: string | null;
}

interface AiAnalyticsSectionProps {
  data: AiAnalyticsData | null | undefined;
}

const healthStyles = {
  healthy: {
    iconClass: 'bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20',
  },
  needs_attention: {
    iconClass: 'bg-amber-500/10 text-amber-400 group-hover:bg-amber-500/20',
  },
  critical: {
    iconClass: 'bg-red-500/10 text-red-400 group-hover:bg-red-500/20',
  },
};

export const AiAnalyticsSection: React.FC<AiAnalyticsSectionProps> = ({ data }) => {
  const [blockersOpen, setBlockersOpen] = useState(false);

  if (!data?.available) {
    return (
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">AI Analytics</h2>
            <p className="text-sm text-muted-foreground">
              Real metrics from completed standup reports and responses
            </p>
          </div>
        </div>
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {data?.message || 'No data available yet'}
            </p>
          </CardContent>
        </Card>
      </section>
    );
  }

  const healthKey = data.teamHealth ?? 'healthy';
  const health = healthStyles[healthKey] ?? healthStyles.healthy;
  const trendDelta = data.completionTrendDelta;
  const trendLabel =
    trendDelta !== null && trendDelta !== undefined
      ? `${trendDelta >= 0 ? '+' : ''}${trendDelta}% vs prev run`
      : undefined;
  const hasBlockers = (data.activeBlockersCount ?? 0) > 0;

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">AI Analytics</h2>
            <p className="text-sm text-muted-foreground">
              Latest completed standup
              {data.latestCheckInName ? `: ${data.latestCheckInName}` : ''}
              {data.basedOnRuns ? ` · ${data.basedOnRuns} run(s) in trend` : ''}
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="w-fit gap-1.5">
          <Sparkles className="h-3 w-3 text-primary" />
          Database-backed
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <KpiCard
          title="Team Health"
          value={data.teamHealthLabel || 'Not available'}
          icon={Activity}
          iconClassName={
            data.teamHealth ? health.iconClass : 'bg-secondary text-muted-foreground'
          }
          subtitle="Completion, blockers, and AI summary"
        />
        <KpiCard
          title="Completion Rate"
          value={data.completionRateLabel || 'Not enough responses'}
          icon={TrendingUp}
          trend={data.completionRate !== null ? trendLabel : undefined}
          trendUp={
            data.completionRate !== null && trendDelta !== null && trendDelta !== undefined
              ? trendDelta >= 0
              : undefined
          }
          subtitle="Latest run: completed / participants"
          iconClassName="bg-violet-500/10 text-violet-400 group-hover:bg-violet-500/20"
        />
        <button
          type="button"
          onClick={() => setBlockersOpen(true)}
          className="text-left"
          disabled={!hasBlockers}
        >
          <KpiCard
            title="Active Blockers"
            value={data.activeBlockersCount ?? 0}
            icon={AlertTriangle}
            subtitle={
              hasBlockers
                ? 'From standup answers and AI report'
                : 'No blockers detected'
            }
            iconClassName="bg-amber-500/10 text-amber-400 group-hover:bg-amber-500/20"
          />
        </button>
        <KpiCard
          title="Average Confidence"
          value={data.averageConfidenceLabel || 'Not available'}
          icon={Star}
          subtitle="Scale (1–5) rating questions only"
          iconClassName="bg-yellow-500/10 text-yellow-400 group-hover:bg-yellow-500/20"
        />
        <KpiCard
          title="Active CheckIns"
          value={data.activeCheckIns ?? 0}
          icon={CheckSquare}
          subtitle="Published and enabled"
        />
      </div>

      <Card className="card-lift">
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <CardTitle>Productivity Trend</CardTitle>
          </div>
          <CardDescription>
            {data.productivityTrendLabel || 'Not enough historical standup runs'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.productivityTrend && data.productivityTrend.length >= 2 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data.productivityTrend}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
                  <XAxis
                    dataKey="label"
                    stroke="#9CA3AF"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#9CA3AF"
                    fontSize={12}
                    domain={[0, 100]}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    formatter={(value: number, _name, item) => {
                      const point = item.payload as AiAnalyticsProductivityPoint;
                      const detail =
                        point.completed !== undefined && point.total !== undefined
                          ? ` (${point.completed}/${point.total})`
                          : '';
                      return [`${value}%${detail}`, 'Completion'];
                    }}
                    labelFormatter={(_, payload) => {
                      const point = payload?.[0]?.payload as AiAnalyticsProductivityPoint | undefined;
                      return point ? `${point.checkInName} · ${point.label}` : '';
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="rate"
                    stroke="#7C3AED"
                    strokeWidth={2}
                    dot={{ fill: '#7C3AED', r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {data.productivityTrendLabel || 'Not enough historical standup runs'}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="card-lift border-l-4 border-l-primary">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <CardTitle>AI Insights</CardTitle>
            </div>
            <CardDescription>
              {data.insights && data.insights.length > 0
                ? data.insightsLabel
                : data.insightsLabel || 'No data available yet'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.insights && data.insights.length > 0 ? (
              <ul className="space-y-3">
                {data.insights.map((insight) => (
                  <li
                    key={insight}
                    className="flex gap-3 rounded-xl border border-border bg-secondary/30 p-4 text-sm leading-relaxed text-muted-foreground"
                  >
                    <span className="mt-0.5 text-primary">•</span>
                    <span>{insight}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {data.insightsLabel || 'No data available yet'}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="card-lift border-l-4 border-l-amber-500/60">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-400" />
              <CardTitle>Recommendations</CardTitle>
            </div>
            <CardDescription>
              {data.recommendations && data.recommendations.length > 0
                ? data.recommendationsLabel
                : data.recommendationsLabel || 'No recommendations available'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.recommendations && data.recommendations.length > 0 ? (
              <ul className="space-y-3">
                {data.recommendations.map((item) => (
                  <li
                    key={item}
                    className="flex gap-3 rounded-xl border border-border bg-secondary/30 p-4 text-sm leading-relaxed text-muted-foreground"
                  >
                    <span className="mt-0.5 text-amber-400">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {data.recommendationsLabel || 'No recommendations available'}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={blockersOpen} onOpenChange={setBlockersOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Active Blockers</DialogTitle>
            <DialogDescription>
              Blockers from the latest standup answers and AI report analysis
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(data.activeBlockers ?? []).map((blocker, index) => (
              <div
                key={`${blocker.runId}-${blocker.memberName}-${index}`}
                className="rounded-xl border border-border bg-secondary/30 p-4 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{blocker.memberName}</p>
                  <Badge
                    variant={
                      blocker.severity === 'high'
                        ? 'danger'
                        : blocker.severity === 'medium'
                          ? 'warning'
                          : 'secondary'
                    }
                  >
                    {blocker.severity}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{blocker.standup}</p>
                <p className="text-sm text-muted-foreground">{blocker.description}</p>
                {blocker.source && (
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Source: {blocker.source === 'ai_report' ? 'AI report' : 'Standup answer'}
                  </p>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default AiAnalyticsSection;
