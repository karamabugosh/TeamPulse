import React from 'react';
import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Accent = 'purple' | 'blue' | 'green' | 'orange' | 'cyan' | 'red' | 'ai' | 'jira' | 'slack' | 'reports' | 'blockers';

interface KpiCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  trendUp?: boolean;
  subtitle?: string;
  iconClassName?: string;
  accent?: Accent;
}

const ACCENT_STYLES: Record<Accent, string> = {
  purple: 'bg-violet-500/12 text-violet-300 group-hover:bg-violet-500/20',
  blue: 'bg-blue-500/12 text-blue-300 group-hover:bg-blue-500/20',
  green: 'bg-emerald-500/12 text-emerald-300 group-hover:bg-emerald-500/20',
  orange: 'bg-orange-500/12 text-orange-300 group-hover:bg-orange-500/20',
  cyan: 'bg-cyan-500/12 text-cyan-300 group-hover:bg-cyan-500/20',
  red: 'bg-red-500/12 text-red-300 group-hover:bg-red-500/20',
  ai: 'bg-module-ai/12 text-violet-300 group-hover:bg-module-ai/20',
  jira: 'bg-[#4F46E5]/12 text-[#60A5FA] group-hover:bg-[#4F46E5]/20',
  slack: 'bg-module-slack/12 text-emerald-300 group-hover:bg-module-slack/20',
  reports: 'bg-module-reports/12 text-orange-300 group-hover:bg-module-reports/20',
  blockers: 'bg-module-blockers/12 text-red-300 group-hover:bg-module-blockers/20',
};

const ACCENT_BORDER: Record<Accent, string> = {
  purple: 'hover:border-violet-500/20 hover:shadow-glow-ai',
  blue: 'hover:border-blue-500/20 hover:shadow-glow-jira',
  green: 'hover:border-emerald-500/20 hover:shadow-glow-slack',
  orange: 'hover:border-orange-500/20 hover:shadow-glow-reports',
  cyan: 'hover:border-cyan-500/20',
  red: 'hover:border-red-500/20 hover:shadow-glow-blockers',
  ai: 'hover:border-module-ai/25 hover:shadow-glow-ai',
  jira: 'hover:border-module-jira/25 hover:shadow-glow-jira',
  slack: 'hover:border-module-slack/25 hover:shadow-glow-slack',
  reports: 'hover:border-module-reports/25 hover:shadow-glow-reports',
  blockers: 'hover:border-module-blockers/25 hover:shadow-glow-blockers',
};

export const KpiCard: React.FC<KpiCardProps> = ({
  title,
  value,
  icon: Icon,
  trend,
  trendUp,
  subtitle,
  iconClassName,
  accent = 'purple',
}) => {
  return (
    <Card
      className={cn(
        'group card-lift overflow-hidden bg-card/95',
        ACCENT_BORDER[accent],
      )}
    >
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {title}
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tracking-tight text-foreground">{value}</span>
              {trend ? (
                <span
                  className={cn(
                    'flex items-center gap-0.5 text-xs font-semibold',
                    trendUp ? 'text-emerald-400' : 'text-red-400',
                  )}
                >
                  {trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {trend}
                </span>
              ) : null}
            </div>
            {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
          </div>
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl transition-colors duration-250',
              ACCENT_STYLES[accent],
              iconClassName,
            )}
          >
            <Icon className="h-4.5 w-4.5 h-[18px] w-[18px]" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default KpiCard;
