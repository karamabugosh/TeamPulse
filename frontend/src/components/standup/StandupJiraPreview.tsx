import React from 'react';
import { AlertTriangle, Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DailyStandupAnswers } from './standup-form.types';
import { JiraIssueStatusBadge } from '@/components/jira/JiraIssueStatusBadge';

interface StandupJiraPreviewProps {
  answers: DailyStandupAnswers;
  userName?: string;
}

export const StandupJiraPreview: React.FC<StandupJiraPreviewProps> = ({
  answers,
  userName = 'Karam',
}) => {
  const issue = answers.blocker.relatedIssue ?? answers.jiraIssueWorkingOn;
  const blockerTitle = answers.blocker.title.trim() || '—';

  return (
    <div className="rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-card p-5 shadow-lg shadow-black/10">
      <div className="mb-4 flex items-center gap-2">
        <Layers className="h-4 w-4 text-blue-400" />
        <h4 className="text-sm font-semibold">Jira Preview</h4>
        <Badge variant="secondary" className="ml-auto">
          Link preview
        </Badge>
      </div>

      {!issue && !answers.blocker.title ? (
        <p className="text-sm text-muted-foreground">
          Select a related Jira issue or add a blocker title to preview the link payload.
        </p>
      ) : (
        <div className="space-y-3 rounded-xl border border-border/60 bg-background/40 p-4 text-sm">
          <Row label="Issue" value={issue?.key ?? '—'} />
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
            <div className="mt-1">
              {issue?.status ? (
                <JiraIssueStatusBadge status={issue.status} />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          </div>
          <Row label="Assignee" value={issue?.assignee || userName} />
          <Row label="Linked Blocker" value={blockerTitle} />
          {issue?.summary ? <Row label="Summary" value={issue.summary} /> : null}
        </div>
      )}
    </div>
  );
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium text-foreground">{value}</p>
    </div>
  );
}

export default StandupJiraPreview;
