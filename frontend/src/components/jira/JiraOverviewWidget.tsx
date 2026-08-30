import React, { useEffect, useState } from 'react';
import { ArrowRight, Link2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { jiraApi, JiraHubOverview } from '@/lib/jira-api';

export const JiraOverviewWidget: React.FC = () => {
  const [overview, setOverview] = useState<JiraHubOverview | null>(null);

  useEffect(() => {
    jiraApi.getOverview().then(setOverview).catch(console.error);
  }, []);

  const connected = overview?.connection.connected;

  return (
    <Card className="jira-premium-surface overflow-hidden rounded-3xl transition-all duration-300 hover:shadow-glow-jira">
      <div className="h-px w-full bg-gradient-to-r from-transparent via-[#6366F1]/60 to-transparent" />
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-[#6366F1]/30 bg-[#4F46E5]/15">
              <span className="pointer-events-none absolute inset-0 rounded-xl shadow-[0_0_22px_-4px_rgba(99,102,241,0.7)]" />
              <Link2 className="relative h-4 w-4 text-[#60A5FA]" />
            </div>
            <CardTitle className="text-base tracking-tight">Jira Hub</CardTitle>
          </div>
          <Badge
            className={
              connected
                ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                : 'border-white/10 bg-white/[0.04]'
            }
          >
            {connected ? 'Connected' : 'Not Connected'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {connected ? (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl border border-white/[0.07] bg-[#151D2D]/60 p-3.5">
              <p className="text-[11px] uppercase tracking-wide text-[#60A5FA]/80">Projects</p>
              <p className="mt-1.5 text-xl font-semibold tracking-tight">
                {overview?.connection.projectCount ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-[#151D2D]/60 p-3.5">
              <p className="text-[11px] uppercase tracking-wide text-[#60A5FA]/80">Linked Issues</p>
              <p className="mt-1.5 text-xl font-semibold tracking-tight">
                {overview?.summary.linkedIssues ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-[#151D2D]/60 p-3.5">
              <p className="text-[11px] uppercase tracking-wide text-[#60A5FA]/80">Open Blockers</p>
              <p className="mt-1.5 text-xl font-semibold tracking-tight">
                {overview?.summary.openBlockers ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-[#151D2D]/60 p-3.5">
              <p className="text-[11px] uppercase tracking-wide text-[#60A5FA]/80">Visible Issues</p>
              <p className="mt-1.5 text-xl font-semibold tracking-tight">
                {overview?.connection.visibleIssueCount ?? 0}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Connect Jira to browse projects, link standups, and unlock analytics.
          </p>
        )}
        <Button asChild className="btn-jira-primary w-full">
          <Link to="/jira">
            Open Jira Hub
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
};

export default JiraOverviewWidget;
