import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ExternalLink, MessageSquare, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { jiraApi, LinkedStandupIssue } from '@/lib/jira-api';
import { useJiraHub } from './JiraHubContext';
import { formatHubDay } from './jira-ui.utils';

export const JiraLinkedStandupsCard: React.FC = () => {
  const [issues, setIssues] = useState<LinkedStandupIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const { openDrawer } = useJiraHub();

  useEffect(() => {
    jiraApi
      .getLinkedStandups()
      .then((res) => setIssues(res.issues))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const flattenedTimeline = useMemo(() => {
    return issues.flatMap((issue) =>
      issue.timeline.map((entry) => ({
        ...entry,
        issueKey: issue.issueKey,
        issueSummary: issue.summary,
        issueUrl: issue.issueUrl,
      })),
    ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [issues]);

  return (
    <Card id="linked-standups" className="card-lift border-border/80 shadow-lg shadow-black/10">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-cyan-400" />
          <CardTitle>Linked Standups</CardTitle>
        </div>
        <CardDescription>Timeline of standup activity connected to Jira issues</CardDescription>
      </CardHeader>
      <CardContent className="px-6 pb-8">
        {loading ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Loading standup history…</p>
        ) : flattenedTimeline.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No linked standup history yet.
          </p>
        ) : (
          <div className="mx-auto max-w-3xl space-y-2">
            {flattenedTimeline.map((entry, index) => (
              <div key={`${entry.issueKey}-${entry.submissionId}-${entry.date}`} className="relative pl-10">
                {index < flattenedTimeline.length - 1 ? (
                  <span className="absolute left-[15px] top-10 h-[calc(100%-12px)] w-px bg-gradient-to-b from-primary/50 to-border/80" />
                ) : null}
                <span className="absolute left-0 top-3 flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary/70 bg-background shadow-sm">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                </span>
                <div className="rounded-2xl border border-border/60 bg-secondary/10 p-5 pb-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                    {formatHubDay(entry.date)}
                  </p>
                  <p className="mt-2 text-lg font-semibold leading-snug">{entry.update}</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {entry.issueKey} · {entry.participant} · {entry.checkInName}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {entry.issueUrl ? (
                      <Button size="sm" variant="outline" asChild>
                        <a href={entry.issueUrl} target="_blank" rel="noreferrer">
                          Jira Issue
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    ) : null}
                    {entry.runId ? (
                      <Button size="sm" variant="outline" asChild>
                        <Link to={`/reports/run/${entry.runId}`}>
                          <FileText className="h-3.5 w-3.5" />
                          Standup Run
                        </Link>
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        openDrawer({
                          id: entry.submissionId,
                          issueKey: entry.issueKey,
                          summary: entry.issueSummary,
                          status: null,
                          issueUrl: entry.issueUrl,
                          linkedCheckIn: entry.checkInName,
                          linkedBy: entry.participant,
                          linkedAt: entry.date,
                          submissionId: entry.submissionId,
                          runId: entry.runId,
                          timeline: [
                            {
                              date: entry.date,
                              checkInName: entry.checkInName,
                              participant: entry.participant,
                              update: entry.update,
                              submissionId: entry.submissionId,
                              runId: entry.runId,
                            },
                          ],
                        })
                      }
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Slack Thread
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default JiraLinkedStandupsCard;
