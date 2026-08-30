import React from 'react';
import { ExternalLink, MessageSquare, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StandupHistoryRecord } from './standup-history.types';
import { formatHubDate } from './jira-ui.utils';

interface StandupHistoryCardProps {
  record: StandupHistoryRecord;
}

function AnswerBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-[#151D2D]/55 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#60A5FA]/80">
        {label}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-foreground">{value}</p>
    </div>
  );
}

export const StandupHistoryCard: React.FC<StandupHistoryCardProps> = ({ record }) => (
  <article className="group rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#4F46E5]/[0.07] via-[#151D2D]/80 to-transparent p-5 shadow-[0_12px_40px_-24px_rgba(0,0,0,0.8)] transition-all duration-300 hover:-translate-y-0.5 hover:border-[#6366F1]/35 hover:shadow-[0_18px_48px_-20px_rgba(79,70,229,0.45)]">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <Avatar className="h-11 w-11 ring-2 ring-[#6366F1]/25">
          <AvatarFallback className="bg-[#4F46E5]/20 text-[#60A5FA]">
            {record.userInitials}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="font-semibold text-foreground">{record.userName}</p>
          <p className="text-sm text-muted-foreground">{formatHubDate(record.date)}</p>
          <Badge className="mt-2 border-[#6366F1]/30 bg-[#4F46E5]/15 text-[#60A5FA]">
            {record.standupName}
          </Badge>
        </div>
      </div>
      {record.hasBlocker ? (
        <Badge variant="warning">Blocker Mentioned</Badge>
      ) : null}
    </div>

    <div className="mt-5 grid gap-3 md:grid-cols-3">
      <AnswerBlock label="Yesterday" value={record.yesterdayAnswer} />
      <AnswerBlock label="Today" value={record.todayAnswer} />
      <AnswerBlock label="Blockers" value={record.blockersAnswer} />
    </div>

    <div className="mt-5 flex flex-col gap-3 border-t border-white/[0.06] pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Linked Jira Issue</p>
        {record.linkedJiraIssue ? (
          <a
            href={record.linkedJiraIssue.url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-[#60A5FA] transition-colors hover:text-[#93C5FD] hover:underline"
          >
            {record.linkedJiraIssue.key} · {record.linkedJiraIssue.summary}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">No linked issue</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {record.slackThreadUrl ? (
          <Button
            size="sm"
            variant="outline"
            className="border-white/[0.1] bg-transparent hover:border-[#3B82F6]/40 hover:bg-[#3B82F6]/10 hover:text-[#60A5FA]"
            asChild
          >
            <a href={record.slackThreadUrl} target="_blank" rel="noreferrer">
              <MessageSquare className="h-3.5 w-3.5" />
              Slack Thread
            </a>
          </Button>
        ) : null}
        {record.reportGeneratedAt ? (
          <Button
            size="sm"
            variant="outline"
            className="border-white/[0.1] bg-transparent hover:border-[#3B82F6]/40 hover:bg-[#3B82F6]/10 hover:text-[#60A5FA]"
            asChild
          >
            <Link to={`/reports/run/${record.runId}`}>
              <FileText className="h-3.5 w-3.5" />
              View Report
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  </article>
);

export default StandupHistoryCard;
