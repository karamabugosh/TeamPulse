import React from 'react';
import {
  AlertTriangle,
  Bot,
  ClipboardList,
  FileText,
  Link2,
  MessageSquare,
  Sparkles,
  Target,
} from 'lucide-react';
import { formatHubDate } from './jira-ui.utils';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

export type WorkspaceTimelineEventDto = {
  id: string;
  workspaceId: string;
  workspaceName?: string;
  type: string;
  timestamp: string;
  userName: string;
  userId: string | null;
  eventType: string;
  description: string;
  jiraIssueKey: string | null;
  jiraIssueUrl: string | null;
  href: string | null;
  related: Record<string, string | null | undefined>;
};

const EVENT_META: Record<
  string,
  { icon: typeof MessageSquare; color: string; group: string }
> = {
  standup_submitted: {
    icon: ClipboardList,
    color: 'text-sky-300 border-sky-400/70 bg-sky-500/10',
    group: 'Standup',
  },
  jira_status_change: {
    icon: Target,
    color: 'text-[#60A5FA] border-[#3B82F6]/70 bg-[#3B82F6]/10',
    group: 'Jira',
  },
  jira_update: {
    icon: Target,
    color: 'text-sky-300 border-sky-400/70 bg-sky-500/10',
    group: 'Jira',
  },
  jira_comment: {
    icon: MessageSquare,
    color: 'text-blue-300 border-blue-400/70 bg-blue-500/10',
    group: 'Jira',
  },
  jira_link: {
    icon: Link2,
    color: 'text-[#60A5FA] border-[#3B82F6]/70 bg-[#3B82F6]/10',
    group: 'Jira',
  },
  blocker_created: {
    icon: AlertTriangle,
    color: 'text-orange-400 border-orange-400/70 bg-orange-500/10',
    group: 'Blocker',
  },
  blocker_update: {
    icon: AlertTriangle,
    color: 'text-amber-300 border-amber-400/70 bg-amber-500/10',
    group: 'Blocker',
  },
  blocker_resolved: {
    icon: AlertTriangle,
    color: 'text-emerald-400 border-emerald-400/70 bg-emerald-500/10',
    group: 'Blocker',
  },
  ai_digest: {
    icon: Bot,
    color: 'text-fuchsia-300 border-fuchsia-400/70 bg-fuchsia-500/10',
    group: 'AI',
  },
  ai_report: {
    icon: FileText,
    color: 'text-violet-300 border-violet-400/70 bg-violet-500/10',
    group: 'Report',
  },
  team_memory: {
    icon: Sparkles,
    color: 'text-cyan-300 border-cyan-400/70 bg-cyan-500/10',
    group: 'Team Memory',
  },
  slack_thread: {
    icon: MessageSquare,
    color: 'text-emerald-300 border-emerald-400/70 bg-emerald-500/10',
    group: 'Slack',
  },
};

const DEFAULT_META = {
  icon: FileText,
  color: 'text-muted-foreground border-border bg-secondary/20',
  group: 'Activity',
};

interface WorkspaceTimelineProps {
  events: WorkspaceTimelineEventDto[];
}

export const WorkspaceTimeline: React.FC<WorkspaceTimelineProps> = ({
  events,
}) => {
  const navigate = useNavigate();

  if (events.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        No timeline activity found.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-2">
      {events.map((event, index) => {
        const meta = EVENT_META[event.type] ?? DEFAULT_META;
        const Icon = meta.icon;

        return (
          <button
            key={event.id}
            type="button"
            className="relative w-full pl-10 text-left"
            onClick={() => {
              if (event.href?.startsWith('/blockers') || event.href?.startsWith('/reports')) {
                navigate(event.href);
                return;
              }
              if (event.jiraIssueUrl) {
                window.open(event.jiraIssueUrl, '_blank', 'noopener,noreferrer');
                return;
              }
              if (event.href) {
                navigate(event.href);
                return;
              }
              if (event.jiraIssueKey) {
                navigate(`/jira?issue=${encodeURIComponent(event.jiraIssueKey)}`);
              }
            }}
          >
            {index < events.length - 1 ? (
              <span className="absolute left-[15px] top-10 h-[calc(100%-12px)] w-px bg-gradient-to-b from-[#6366F1]/50 to-border/80" />
            ) : null}
            <span
              className={cn(
                'absolute left-0 top-3 flex h-8 w-8 items-center justify-center rounded-full border-2 shadow-[0_0_16px_-4px_rgba(99,102,241,0.6)]',
                meta.color,
              )}
              title={meta.group}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="rounded-2xl border border-white/[0.08] bg-[#151D2D]/55 p-5 transition-all duration-200 hover:border-[#6366F1]/35 hover:bg-[#4F46E5]/[0.08]">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#60A5FA]">
                {meta.group} · {event.eventType}
              </p>
              <p className="mt-2 text-base font-semibold leading-snug">
                {event.description}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span>{event.userName}</span>
                <span>{formatHubDate(event.timestamp)}</span>
                {event.workspaceName ? (
                  <span>{event.workspaceName}</span>
                ) : null}
                {event.jiraIssueKey ? (
                  <span className="font-mono text-[#60A5FA]">
                    {event.jiraIssueKey}
                  </span>
                ) : null}
                {event.related?.blockerId ? (
                  <span className="text-orange-300/90">Blocker</span>
                ) : null}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default WorkspaceTimeline;
