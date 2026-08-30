import React from 'react';
import { AlertTriangle, FileText, GitBranch, MessageSquare } from 'lucide-react';
import { StandupHistoryTimelineEvent } from './standup-history.types';
import { formatHubDate } from './jira-ui.utils';
import { cn } from '@/lib/utils';

const EVENT_META = {
  standup_submitted: {
    icon: MessageSquare,
    color: 'text-[#60A5FA] border-[#6366F1]/70 bg-[#4F46E5]/15',
  },
  issue_linked: {
    icon: GitBranch,
    color: 'text-[#60A5FA] border-[#3B82F6]/70 bg-[#3B82F6]/10',
  },
  blocker_mentioned: {
    icon: AlertTriangle,
    color: 'text-orange-400 border-orange-400/70 bg-orange-500/10',
  },
  report_generated: {
    icon: FileText,
    color: 'text-emerald-400 border-emerald-400/70 bg-emerald-500/10',
  },
} as const;

interface StandupHistoryTimelineProps {
  events: StandupHistoryTimelineEvent[];
}

export const StandupHistoryTimeline: React.FC<StandupHistoryTimelineProps> = ({ events }) => (
  <div className="mx-auto max-w-3xl space-y-2">
    {events.length === 0 ? (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No timeline events match your filters.
      </p>
    ) : (
      events.map((event, index) => {
        const meta = EVENT_META[event.type];
        const Icon = meta.icon;

        return (
          <div key={event.id} className="relative pl-10">
            {index < events.length - 1 ? (
              <span className="absolute left-[15px] top-10 h-[calc(100%-12px)] w-px bg-gradient-to-b from-[#6366F1]/50 to-border/80" />
            ) : null}
            <span
              className={cn(
                'absolute left-0 top-3 flex h-8 w-8 items-center justify-center rounded-full border-2 shadow-[0_0_16px_-4px_rgba(99,102,241,0.6)]',
                meta.color,
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="rounded-2xl border border-white/[0.08] bg-[#151D2D]/55 p-5 transition-all duration-200 hover:border-[#6366F1]/35 hover:bg-[#4F46E5]/[0.08]">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#60A5FA]">
                {formatHubDate(event.timestamp)}
              </p>
              <p className="mt-2 text-base font-semibold">{event.title}</p>
              <p className="mt-1.5 text-sm text-muted-foreground">{event.description}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {event.userName} · {event.standupName}
              </p>
            </div>
          </div>
        );
      })
    )}
  </div>
);

export default StandupHistoryTimeline;
