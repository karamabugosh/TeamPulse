import React, { useEffect, useState } from 'react';
import { ExternalLink, X, Clock3, User, Flag, GitBranch, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useJiraHub } from './JiraHubContext';
import { formatHubDate, formatHubDay } from './jira-ui.utils';
import { jiraApi } from '@/lib/jira-api';

type IssueDetails = {
  assignee: string | null;
  priority: string | null;
  status: string | null;
};

export const JiraIssueDrawer: React.FC = () => {
  const { drawerIssue, closeDrawer } = useJiraHub();
  const [details, setDetails] = useState<IssueDetails | null>(null);

  useEffect(() => {
    if (!drawerIssue?.issueKey) {
      setDetails(null);
      return;
    }

    jiraApi
      .searchIssues(drawerIssue.issueKey, 1)
      .then((response) => {
        const issue = response.issues[0];
        if (!issue) {
          setDetails(null);
          return;
        }
        setDetails({
          assignee: issue.assignee,
          priority: issue.priority,
          status: issue.status,
        });
      })
      .catch(() => setDetails(null));
  }, [drawerIssue?.issueKey]);

  const open = Boolean(drawerIssue);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeDrawer()}>
      <DialogContent className="fixed right-0 top-0 h-[100dvh] max-h-[100dvh] w-full max-w-xl translate-x-0 translate-y-0 rounded-none border-l border-border bg-background p-0 data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right sm:rounded-none">
        {drawerIssue ? (
          <div className="flex h-full flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-border p-6">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Badge variant="outline" className="border-blue-500/30 text-blue-400">
                    {drawerIssue.issueKey}
                  </Badge>
                  <Badge variant="secondary">
                    {details?.status || drawerIssue.status || 'Unknown'}
                  </Badge>
                </div>
                <h2 className="text-xl font-semibold tracking-tight">{drawerIssue.summary}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Linked by {drawerIssue.linkedBy} · {formatHubDate(drawerIssue.linkedAt)}
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeDrawer}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto p-6">
              <section className="grid gap-3 sm:grid-cols-2">
                <InfoTile icon={User} label="Assignee" value={details?.assignee || 'Unassigned'} />
                <InfoTile icon={Flag} label="Priority" value={details?.priority || '—'} />
                <InfoTile icon={GitBranch} label="Check-in" value={drawerIssue.linkedCheckIn} />
                <InfoTile icon={Clock3} label="Linked" value={formatHubDate(drawerIssue.linkedAt)} />
              </section>

              <Separator />

              <section>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="h-4 w-4 text-fuchsia-400" />
                  Standup History
                </h3>
                {drawerIssue.timeline && drawerIssue.timeline.length > 0 ? (
                  <div className="space-y-0">
                    {drawerIssue.timeline.map((entry, index) => (
                      <div key={`${entry.submissionId}-${entry.date}`} className="relative pl-6">
                        {index < drawerIssue.timeline!.length - 1 ? (
                          <span className="absolute left-[7px] top-5 h-full w-px bg-border" />
                        ) : null}
                        <span className="absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-primary bg-background" />
                        <div className="pb-5">
                          <p className="text-xs font-medium uppercase tracking-wide text-primary">
                            {formatHubDay(entry.date)}
                          </p>
                          <p className="mt-1 text-sm">{entry.update}</p>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            {entry.runId ? (
                              <Link
                                to={`/reports/run/${entry.runId}`}
                                className="text-primary hover:underline"
                              >
                                Standup Run
                              </Link>
                            ) : null}
                            {drawerIssue.issueUrl ? (
                              <a
                                href={drawerIssue.issueUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary hover:underline"
                              >
                                Jira Issue
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No standup timeline available yet.</p>
                )}
              </section>
            </div>

            <div className="border-t border-border p-6">
              <div className="flex flex-wrap gap-3">
                {drawerIssue.issueUrl ? (
                  <Button asChild>
                    <a href={drawerIssue.issueUrl} target="_blank" rel="noreferrer">
                      Open in Jira
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                ) : null}
                {drawerIssue.runId ? (
                  <Button variant="outline" asChild>
                    <Link to={`/reports/run/${drawerIssue.runId}`}>View Standup Run</Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

function InfoTile({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-3">
      <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

export default JiraIssueDrawer;
