import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiFetch } from '@/lib/api';

type PulseBlocker = {
  id: string;
  description: string;
  severity: string;
  dependency?: string | null;
  linkedIssueKey?: string | null;
  linkedIssueUrl?: string | null;
  status: string;
  createdAt: string;
  user?: {
    slackDisplayName?: string | null;
  };
};

function formatAge(createdAt: string): string {
  const created = new Date(createdAt);
  const days = Math.max(
    0,
    Math.floor((Date.now() - created.getTime()) / (1000 * 60 * 60 * 24)),
  );

  if (days === 0) {
    return 'Today';
  }

  if (days === 1) {
    return '1 day';
  }

  return `${days} days`;
}

function severityVariant(severity: string): 'destructive' | 'secondary' | 'outline' {
  if (severity === 'high') {
    return 'destructive';
  }

  if (severity === 'medium') {
    return 'secondary';
  }

  return 'outline';
}

export const BlockerRegisterCard: React.FC = () => {
  const [blockers, setBlockers] = useState<PulseBlocker[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBlockers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<PulseBlocker[]>('/api/blockers');
      setBlockers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      setBlockers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBlockers();
    const interval = setInterval(loadBlockers, 30000);
    return () => clearInterval(interval);
  }, [loadBlockers]);

  return (
    <Card className="card-lift">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <CardTitle>Blocker Register</CardTitle>
        </div>
        <CardDescription>
          Open blockers across the team with linked Jira context
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading blockers…</p>
        ) : blockers.length > 0 ? (
          blockers.map((blocker) => (
            <div
              key={blocker.id}
              className="rounded-xl border border-border bg-secondary/30 p-4 space-y-2 transition-colors hover:bg-secondary/50"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-foreground">{blocker.description}</p>
                <Badge variant={severityVariant(blocker.severity)}>{blocker.severity}</Badge>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Open for {formatAge(blocker.createdAt)}</span>
                {blocker.dependency ? <span>· Depends on: {blocker.dependency}</span> : null}
                {blocker.linkedIssueKey ? (
                  <span className="inline-flex items-center gap-1">
                    ·
                    {blocker.linkedIssueUrl ? (
                      <a
                        href={blocker.linkedIssueUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {blocker.linkedIssueKey}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      blocker.linkedIssueKey
                    )}
                  </span>
                ) : (
                  <span>· No linked Jira issue</span>
                )}
              </div>
            </div>
          ))
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No open blockers in the register.
          </p>
        )}
      </CardContent>
    </Card>
  );
};
