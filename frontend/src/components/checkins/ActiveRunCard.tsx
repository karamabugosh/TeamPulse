import React from 'react';
import { ExternalLink, MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  EnrichedRun,
  formatStartedTime,
  normalizeRun,
  reportStatusIcon,
  threadStatusIcon,
} from '@/lib/run-status';
import { cn } from '@/lib/utils';

interface ActiveRunCardProps {
  run: EnrichedRun;
  compact?: boolean;
}

export const ActiveRunCard: React.FC<ActiveRunCardProps> = ({ run: rawRun, compact = false }) => {
  const run = normalizeRun(rawRun);
  const isCollecting = run.status === 'collecting';
  const threadDot = threadStatusIcon(run.threadStatus.code);
  const reportIcon = reportStatusIcon(run.reportStatus.code);
  const canOpenThread =
    ['active', 'waiting_for_responses'].includes(run.threadStatus.code) && !!run.slackThreadUrl;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-emerald-200/60 bg-emerald-50/30 dark:border-emerald-900/40 dark:bg-emerald-950/20',
        compact ? 'p-3 sm:flex-row sm:items-center sm:justify-between' : 'rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between',
      )}
    >
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-medium text-foreground">
            {run.checkIn?.name ?? 'CheckIn'}
          </h3>
          <Badge variant={isCollecting ? 'success' : 'secondary'} className="shrink-0 text-[10px]">
            {isCollecting ? 'Collecting' : 'Run Complete'}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {run.participantsResponded}/{run.totalParticipants} responded
          {' · '}
          Started {formatStartedTime(run.startedAt, run.checkIn?.timezone)}
        </p>
        {compact && (
          <p className="text-xs font-medium text-foreground">
            {reportIcon} {run.reportStatus.label}
          </p>
        )}
      </div>

      {!compact && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:flex sm:items-center sm:gap-6">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-default">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Thread</p>
                <p className="font-medium">
                  {threadDot} {run.threadStatus.label}
                </p>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              {run.threadStatus.tooltip}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-default">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Report</p>
                <p className="font-medium">
                  {reportIcon} {run.reportStatus.label}
                </p>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              {run.reportStatus.tooltip}
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      <div className="shrink-0">
        {canOpenThread ? (
          <Button asChild size="sm" variant="outline" className="h-8">
            <a href={run.slackThreadUrl!} target="_blank" rel="noopener noreferrer">
              <MessageSquare className="h-3.5 w-3.5" />
              Open Thread
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button size="sm" variant="outline" disabled className="h-8 pointer-events-none">
                  <MessageSquare className="h-3.5 w-3.5" />
                  Open Thread
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              {run.threadStatus.code === 'active'
                ? 'Thread link unavailable — check Slack workspace configuration.'
                : run.threadStatus.tooltip}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
};

export default ActiveRunCard;
