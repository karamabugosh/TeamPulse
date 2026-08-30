import React from 'react';
import { AlertTriangle, Clock, CheckCircle2, Flame } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { BlockerStats } from './blockers.types';

interface BlockersStatsRowProps {
  stats: BlockerStats;
}

const statItems = [
  {
    key: 'openBlockers' as const,
    label: 'Open Blockers',
    icon: AlertTriangle,
    accent: 'text-orange-300 bg-orange-500/15 border-orange-500/25',
    subtitle: 'Active now',
  },
  {
    key: 'critical' as const,
    label: 'Critical',
    icon: Flame,
    accent: 'text-red-300 bg-red-500/15 border-red-500/25',
    subtitle: 'Needs attention',
  },
  {
    key: 'waitingMoreThan3Days' as const,
    label: 'Waiting > 3 Days',
    icon: Clock,
    accent: 'text-amber-300 bg-amber-500/15 border-amber-500/25',
    subtitle: 'Aging risk',
  },
  {
    key: 'resolvedThisWeek' as const,
    label: 'Resolved This Week',
    icon: CheckCircle2,
    accent: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/25',
    subtitle: 'Cleared',
  },
];

export const BlockersStatsRow: React.FC<BlockersStatsRowProps> = ({ stats }) => (
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    {statItems.map(({ key, label, icon: Icon, accent, subtitle }) => (
      <Card
        key={key}
        className="card-lift border-white/[0.06] bg-card/95 backdrop-blur-sm"
      >
        <CardContent className="flex items-center gap-4 p-5">
          <div
            className={`flex h-11 w-11 items-center justify-center rounded-xl border ${accent}`}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-2xl font-bold tracking-tight">{stats[key]}</p>
            <p className="text-xs font-medium text-foreground">{label}</p>
            <p className="text-[11px] text-muted-foreground">{subtitle}</p>
          </div>
        </CardContent>
      </Card>
    ))}
  </div>
);

export default BlockersStatsRow;
