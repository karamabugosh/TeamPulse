import React, { useEffect, useMemo, useState } from 'react';
import { FolderKanban, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { jiraApi, JiraIssueSummary, JiraProjectCard } from '@/lib/jira-api';
import { STATUS_LABELS, bucketStatus, countStatusBuckets } from './jira-ui.utils';

export const JiraProjectsCard: React.FC<{ connected: boolean }> = ({ connected }) => {
  const [projects, setProjects] = useState<JiraProjectCard[]>([]);
  const [issues, setIssues] = useState<JiraIssueSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!connected) {
      setProjects([]);
      setIssues([]);
      setLoading(false);
      return;
    }

    Promise.all([jiraApi.getProjects(), jiraApi.getIssues(100)])
      .then(([projectResponse, issueResponse]) => {
        setProjects(projectResponse.projects);
        setIssues(issueResponse.issues);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [connected]);

  const projectStats = useMemo(() => {
    const map = new Map<string, ReturnType<typeof countStatusBuckets>>();

    for (const issue of issues) {
      const key = issue.projectKey || 'UNKNOWN';
      const current = map.get(key) || countStatusBuckets([]);
      const bucket = bucketStatus(issue.status);
      current[bucket] += 1;
      map.set(key, current);
    }

    return map;
  }, [issues]);

  return (
    <Card className="jira-premium-surface h-full overflow-hidden rounded-3xl">
      <div className="h-px w-full bg-gradient-to-r from-transparent via-[#6366F1]/50 to-transparent" />
      <CardHeader>
        <div className="flex items-center gap-2">
          <FolderKanban className="h-4 w-4 text-[#60A5FA]" />
          <CardTitle>Projects</CardTitle>
        </div>
        <CardDescription>Every Jira project with live issue breakdown</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-6 pb-6">
        {!connected ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Connect Jira to load projects.
          </p>
        ) : loading ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Loading projects…</p>
        ) : projects.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No projects found.</p>
        ) : (
          projects.map((project) => {
            const buckets = projectStats.get(project.key) || countStatusBuckets([]);
            const siteUrl = project.recentIssues[0]?.issueUrl?.split('/browse/')[0];

            return (
              <div
                key={project.id}
                className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#4F46E5]/10 via-[#151D2D]/50 to-transparent p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-[#6366F1]/35 hover:shadow-[0_16px_40px_-20px_rgba(79,70,229,0.45)]"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4F46E5]/15 text-sm font-bold text-[#60A5FA] shadow-[0_0_20px_-6px_rgba(99,102,241,0.7)]">
                        {project.key.slice(0, 2)}
                      </div>
                      <div>
                        <p className="text-lg font-semibold">{project.key}</p>
                        <p className="text-sm text-muted-foreground">{project.name}</p>
                      </div>
                    </div>
                    <p className="mt-4 text-2xl font-bold">{project.issueCount} Issues</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {(['done', 'in_progress', 'todo', 'blocked'] as const).map((key) => (
                      <div
                        key={key}
                        className="rounded-xl border border-white/[0.07] bg-[#151D2D]/55 px-3 py-2 text-center"
                      >
                        <p className="text-lg font-semibold">{buckets[key]}</p>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          {STATUS_LABELS[key]}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {siteUrl ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-white/[0.1] bg-transparent hover:border-[#3B82F6]/40 hover:bg-[#3B82F6]/10 hover:text-[#60A5FA]"
                      asChild
                    >
                      <a href={siteUrl} target="_blank" rel="noreferrer">
                        Open Jira
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      className="hover:bg-[#4F46E5]/15 hover:text-[#60A5FA]"
                    >
                      Sync
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      className="hover:bg-[#4F46E5]/15 hover:text-[#60A5FA]"
                    >
                      View Issues
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
};

export default JiraProjectsCard;
