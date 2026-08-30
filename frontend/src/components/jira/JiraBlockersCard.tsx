import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { jiraApi, HubBlocker } from '@/lib/jira-api';
import { formatHubDate } from './jira-ui.utils';

export const JiraBlockersCard: React.FC = () => {
  const [blockers, setBlockers] = useState<HubBlocker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    jiraApi
      .getBlockers()
      .then(setBlockers)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card className="card-lift h-full border-border/80 shadow-lg shadow-black/10">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <CardTitle>Blocker Register</CardTitle>
        </div>
        <CardDescription>Open blockers detected from Slack standups and Jira context</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-6 pb-6">
        {loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading blockers…</p>
        ) : blockers.length === 0 ? (
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-8 py-14 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            </div>
            <p className="text-lg font-semibold text-emerald-300">No active blockers.</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              When a blocker is detected from Slack or Jira it will appear here.
            </p>
          </div>
        ) : (
          blockers.map((blocker) => (
            <div
              key={blocker.id}
              className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-amber-500/5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{blocker.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reporter {blocker.reporter} · {formatHubDate(blocker.createdAt)}
                  </p>
                </div>
                <Badge variant="secondary">{blocker.severity}</Badge>
              </div>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Owner</p>
                  <p className="mt-1 font-medium">{blocker.owner || '—'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Current Status</p>
                  <p className="mt-1 font-medium">{blocker.status}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Linked Jira Issue</p>
                  {blocker.linkedIssueKey ? (
                    blocker.linkedIssueUrl ? (
                      <a
                        href={blocker.linkedIssueUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 font-medium text-primary hover:underline"
                      >
                        {blocker.linkedIssueKey}
                        {blocker.linkedIssueSummary ? ` · ${blocker.linkedIssueSummary}` : ''}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      <p className="mt-1 font-medium">{blocker.linkedIssueKey}</p>
                    )
                  ) : (
                    <p className="mt-1 text-muted-foreground">No linked Jira issue</p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
};

export default JiraBlockersCard;
