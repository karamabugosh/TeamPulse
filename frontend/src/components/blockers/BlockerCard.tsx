import React from 'react';
import {
  AlertTriangle,
  ExternalLink,
  MessageSquare,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { JiraIssueStatusBadge } from '@/components/jira/JiraIssueStatusBadge';
import { formatHubDate } from '@/components/jira/jira-ui.utils';
import {
  DashboardBlocker,
  initialsFromName,
  normalizePriority,
} from './blockers.types';
import { BlockerSlackContext } from './BlockerSlackContext';
import { BlockerAiPlaceholders } from './BlockerAiSuggestions';
import { BlockerTimeline } from './BlockerTimeline';

interface BlockerCardProps {
  blocker: DashboardBlocker;
}

function priorityVariant(priority: string) {
  const p = normalizePriority(priority);
  if (p === 'critical') return 'destructive' as const;
  if (p === 'high') return 'warning' as const;
  if (p === 'medium') return 'secondary' as const;
  return 'outline' as const;
}

function formatExpectedResolution(value: string): string {
  // Slack date picker returns YYYY-MM-DD (date-only).
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
      new Date(`${value}T00:00:00`),
    );
  }
  return formatHubDate(value);
}

export const BlockerCard: React.FC<BlockerCardProps> = ({ blocker }) => {
  const initials = initialsFromName(blocker.slackDisplayName || blocker.reporter);
  const issue = blocker.jiraIssue;

  return (
    <article className="card-lift overflow-hidden rounded-xl border border-module-blockers/20 bg-card/95 shadow-card transition-all duration-300 hover:border-module-blockers/35 hover:shadow-glow-blockers">
      <div className="border-b border-white/[0.06] bg-gradient-to-r from-module-blockers/12 via-transparent to-module-reports/5 px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-module-blockers/12 text-red-300">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-2">
              <h3 className="text-lg font-semibold leading-snug">{blocker.title}</h3>
              <div className="flex flex-wrap items-center gap-3">
                <Avatar className="h-8 w-8 border-2 border-background">
                  {blocker.slackAvatarUrl ? (
                    <AvatarImage
                      src={blocker.slackAvatarUrl}
                      alt={blocker.slackDisplayName}
                    />
                  ) : null}
                  <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-foreground">{blocker.reporter}</p>
                  <p className="text-xs text-muted-foreground">
                    Slack: {blocker.slackDisplayName}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="gap-1 bg-[#36c5f0]/10 text-[#36c5f0]">
              <MessageSquare className="h-3 w-3" />
              Slack
            </Badge>
            <Badge variant={priorityVariant(blocker.priority)}>
              {normalizePriority(blocker.priority)}
            </Badge>
            <Badge variant="outline">{blocker.statusLabel}</Badge>
            {blocker.category ? (
              <Badge variant="secondary">{blocker.category}</Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {blocker.description ? (
          <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">
            {blocker.description}
          </p>
        ) : null}

        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <MetaTile label="Created At" value={formatHubDate(blocker.createdAt)} />
          <MetaTile
            label="Standup"
            value={blocker.standupName ?? '—'}
          />
          <MetaTile
            label="Expected Resolution"
            value={
              blocker.expectedResolution
                ? formatExpectedResolution(blocker.expectedResolution)
                : '—'
            }
          />
          <MetaTile
            label="Owner"
            value={blocker.ownerLabel ?? '—'}
          />
        </div>

        {issue ? (
          <div className="rounded-2xl border border-border/60 bg-secondary/10 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Linked Jira Issue
            </p>
            <div className="mt-3 flex flex-col gap-2 rounded-xl border border-border/50 bg-background/40 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {issue.url ? (
                  <a
                    href={issue.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                  >
                    {issue.key}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                ) : (
                  <p className="font-semibold">{issue.key}</p>
                )}
                {issue.summary ? (
                  <p className="mt-1 text-sm text-muted-foreground">{issue.summary}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <JiraIssueStatusBadge status={issue.status} />
                  {issue.assignee ? (
                    <span className="text-xs text-muted-foreground">
                      Assignee: {issue.assignee}
                    </span>
                  ) : null}
                </div>
              </div>
              {issue.url ? (
                <Button size="sm" variant="outline" asChild>
                  <a href={issue.url} target="_blank" rel="noreferrer">
                    Open in Jira
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-3 text-sm text-muted-foreground">
            No Jira issue linked.
          </div>
        )}

        <BlockerSlackContext blocker={blocker} />

        <BlockerTimeline
          updates={blocker.updates ?? []}
          createdAt={blocker.createdAt}
        />

        <BlockerAiPlaceholders blocker={blocker} />

        <div className="flex flex-wrap gap-2 border-t border-border/60 pt-4">
          {blocker.slackThreadUrl ? (
            <Button size="sm" variant="outline" asChild>
              <a href={blocker.slackThreadUrl} target="_blank" rel="noreferrer">
                <MessageSquare className="h-3.5 w-3.5" />
                Slack Thread Link
              </a>
            </Button>
          ) : null}
          {issue?.url ? (
            <Button size="sm" variant="outline" asChild>
              <a href={issue.url} target="_blank" rel="noreferrer">
                Jira Issue Link
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
};

function MetaTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

export default BlockerCard;
