import React from 'react';
import { CheckCircle2, GitBranch, MessageSquare, AlertTriangle } from 'lucide-react';
import { formatHubDate } from '@/components/jira/jira-ui.utils';
import { cn } from '@/lib/utils';
import type { BlockerUpdate } from './blockers.types';

interface BlockerTimelineProps {
  updates: BlockerUpdate[];
  createdAt: string;
}

function eventTitle(update: BlockerUpdate): string {
  const status = update.newStatus.toLowerCase();
  if (update.previousStatus === 'none') {
    return 'Created';
  }
  if (status === 'resolved') return 'Resolved';
  if (status === 'in_progress') return 'Follow-up — Still Working';
  if (status === 'open') return 'Follow-up — Still Blocked';
  return `Status → ${update.newStatusLabel}`;
}

function eventIcon(update: BlockerUpdate) {
  const status = update.newStatus.toLowerCase();
  if (status === 'resolved') return CheckCircle2;
  if (update.previousStatus === 'none') return AlertTriangle;
  if (status === 'in_progress') return GitBranch;
  return MessageSquare;
}

export const BlockerTimeline: React.FC<BlockerTimelineProps> = ({
  updates,
  createdAt,
}) => {
  const events =
    updates.length > 0
      ? updates
      : [
          {
            id: 'created',
            createdAt,
            previousStatus: 'none',
            newStatus: 'open',
            newStatusLabel: 'Open',
            notes: null,
            resolutionType: null,
            needsHelp: null,
            needsEscalation: null,
            daysOpen: 0,
            updatedFrom: 'Slack Standup',
            userName: null,
          } satisfies BlockerUpdate,
        ];

  return (
    <section className="rounded-2xl border border-border/60 bg-secondary/10 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Follow-up Timeline
      </p>
      <div className="mt-4 space-y-0">
        {events.map((update, index) => {
          const Icon = eventIcon(update);
          const isLast = index === events.length - 1;

          return (
            <div key={update.id} className="relative pl-10 pb-5 last:pb-0">
              {!isLast ? (
                <span className="absolute left-[15px] top-8 h-[calc(100%-8px)] w-px bg-gradient-to-b from-orange-400/50 to-border/60" />
              ) : null}
              <span
                className={cn(
                  'absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full border-2',
                  update.newStatus === 'resolved'
                    ? 'border-emerald-400/70 bg-emerald-500/10 text-emerald-300'
                    : 'border-orange-400/70 bg-orange-500/10 text-orange-300',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="rounded-xl border border-border/50 bg-background/40 px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {formatHubDate(update.createdAt)}
                  {typeof update.daysOpen === 'number'
                    ? ` · Day ${update.daysOpen + 1}`
                    : null}
                </p>
                <p className="mt-1 text-sm font-semibold">{eventTitle(update)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {update.newStatusLabel}
                  {update.updatedFrom ? ` · ${update.updatedFrom}` : ''}
                  {update.userName ? ` · ${update.userName}` : ''}
                </p>
                {update.notes ? (
                  <p className="mt-2 text-sm text-muted-foreground whitespace-pre-wrap">
                    {update.notes}
                  </p>
                ) : null}
                {update.resolutionType ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Resolution type: {update.resolutionType}
                  </p>
                ) : null}
                {update.needsHelp != null || update.needsEscalation != null ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Help: {update.needsHelp ? 'Yes' : 'No'} · Escalation:{' '}
                    {update.needsEscalation ? 'Yes' : 'No'}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default BlockerTimeline;
