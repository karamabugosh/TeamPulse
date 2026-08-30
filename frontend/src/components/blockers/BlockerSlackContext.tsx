import React from 'react';
import { HelpCircle, MessageSquare, Quote, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatHubDate } from '@/components/jira/jira-ui.utils';
import { DashboardBlocker } from './blockers.types';

interface BlockerSlackContextProps {
  blocker: DashboardBlocker;
}

export const BlockerSlackContext: React.FC<BlockerSlackContextProps> = ({
  blocker,
}) => {
  const ctx = blocker.slackContext;

  return (
    <section className="rounded-2xl border border-[#35373b]/80 bg-[#1a1d21]/60 p-5">
      <div className="mb-4 flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-[#36c5f0]" />
        <h4 className="text-sm font-semibold">Slack Context</h4>
        <Badge variant="secondary" className="ml-auto gap-1 bg-[#36c5f0]/10 text-[#36c5f0]">
          <MessageSquare className="h-3 w-3" />
          Slack Source
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ContextTile
          icon={<HelpCircle className="h-3.5 w-3.5" />}
          label="Question"
          value={ctx.question ?? '—'}
        />
        <ContextTile
          icon={<User className="h-3.5 w-3.5" />}
          label="Slack User"
          value={ctx.slackUser ?? blocker.slackDisplayName}
        />
      </div>

      <div className="mt-4 rounded-xl border border-[#35373b] bg-[#222529] p-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Quote className="h-3.5 w-3.5" />
          Answer
        </div>
        {ctx.answer ? (
          <p className="text-sm leading-relaxed text-[#d1d2d3] whitespace-pre-wrap">
            {ctx.answer}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No answer text available.</p>
        )}
        {ctx.timestamp ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {formatHubDate(ctx.timestamp)}
          </p>
        ) : null}
      </div>

      {ctx.threadUrl || blocker.slackThreadUrl ? (
        <Button size="sm" variant="outline" className="mt-4" asChild>
          <a
            href={ctx.threadUrl ?? blocker.slackThreadUrl ?? undefined}
            target="_blank"
            rel="noreferrer"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Open Slack Thread
          </a>
        </Button>
      ) : null}
    </section>
  );
};

function ContextTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1.5 text-sm font-medium leading-snug">{value}</p>
    </div>
  );
}

export default BlockerSlackContext;
