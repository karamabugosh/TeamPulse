import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, Link2, ShieldCheck, Unplug } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { apiFetch } from '@/lib/api';
import { buildJiraOAuthStartUrl } from '@/lib/jira-oauth';
import { useWorkspace } from '@/lib/workspace-context';
import { useToast } from '@/hooks/use-toast';

type JiraStatus = {
  connected: boolean;
  atlassianDisplayName?: string;
  siteName?: string;
  lastSyncAt?: string;
  connectedAt?: string;
};

type LoadState = 'loading' | 'connected' | 'disconnected' | 'error';

function formatSyncDate(value?: string): string {
  if (!value) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export const JiraIntegrationCard: React.FC = () => {
  const { toast } = useToast();
  const { workspaceId } = useWorkspace();
  const [status, setStatus] = useState<JiraStatus | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showManage, setShowManage] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoadState('loading');
    try {
      const data = await apiFetch<JiraStatus>('/api/auth/jira/status');
      setStatus(data);
      setLoadState(data.connected ? 'connected' : 'disconnected');
    } catch (error) {
      console.error(error);
      setStatus(null);
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus, workspaceId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jiraParam = params.get('jira');

    if (jiraParam === 'connected') {
      toast({
        title: 'Jira connected',
        description: 'Your Atlassian account is now linked to this Pulse workspace.',
      });
      void loadStatus();
      params.delete('jira');
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
      window.history.replaceState({}, '', nextUrl);
    }

    if (jiraParam === 'error') {
      toast({
        title: 'Jira connection failed',
        description: params.get('message') || 'Unable to complete Atlassian OAuth.',
        variant: 'destructive',
      });
      params.delete('jira');
      params.delete('message');
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
      window.history.replaceState({}, '', nextUrl);
    }
  }, [loadStatus, toast]);

  const handleConnect = () => {
    window.location.href = buildJiraOAuthStartUrl(workspaceId);
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await apiFetch('/api/auth/jira', { method: 'DELETE' });
      setStatus({ connected: false });
      setShowManage(false);
      toast({
        title: 'Jira disconnected',
        description: 'The Atlassian connection has been removed.',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: 'Disconnect failed',
        description: 'Could not remove the Jira connection.',
        variant: 'destructive',
      });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await apiFetch('/api/jira/sync', { method: 'POST' });
      await loadStatus();
      toast({
        title: 'Jira synced',
        description: 'Successfully verified Jira API access.',
      });
    } catch (error) {
      console.error(error);
      toast({
        title: 'Jira sync failed',
        description: 'Could not synchronize with Jira. Check your connection.',
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  const connected = loadState === 'connected';

  return (
    <Card className="card-lift">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
              <Link2 className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Jira Integration</CardTitle>
              <CardDescription>
                Connect Atlassian to link standup updates with Jira issues
              </CardDescription>
            </div>
          </div>
          {!loadState || loadState === 'loading' ? null : (
            <Badge
              variant={
                loadState === 'connected'
                  ? 'success'
                  : loadState === 'error'
                    ? 'danger'
                    : 'secondary'
              }
              className="gap-1"
            >
              {loadState === 'connected' && (
                <>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Connected
                </>
              )}
              {loadState === 'disconnected' && 'Not Connected'}
              {loadState === 'error' && 'Connection Error'}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadState === 'loading' ? (
          <p className="text-sm text-muted-foreground">Checking Jira connection…</p>
        ) : loadState === 'error' ? (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Could not load Jira connection status from the backend.
            </p>
            <Button variant="outline" onClick={loadStatus}>
              Retry
            </Button>
          </div>
        ) : connected ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-1 rounded-xl border border-border bg-secondary/30 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Connected as</p>
                <p className="text-sm font-medium">{status?.atlassianDisplayName || '—'}</p>
              </div>
              <div className="space-y-1 rounded-xl border border-border bg-secondary/30 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Workspace</p>
                <p className="text-sm font-medium">{status?.siteName || '—'}</p>
              </div>
              <div className="space-y-1 rounded-xl border border-border bg-secondary/30 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Last Sync</p>
                <p className="text-sm font-medium">{formatSyncDate(status?.lastSyncAt)}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => setShowManage((value) => !value)}>
                Manage Connection
              </Button>
              {showManage && (
                <>
                  <Button variant="outline" onClick={handleSync} disabled={syncing}>
                    {syncing ? 'Syncing…' : 'Sync Now'}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                  >
                    <Unplug className="h-4 w-4" />
                    {disconnecting ? 'Disconnecting…' : 'Disconnect Jira'}
                  </Button>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">Jira</p>
              <p className="text-sm text-muted-foreground">Not Connected</p>
            </div>
            <Button onClick={handleConnect}>
              <ExternalLink className="h-4 w-4" />
              Connect Jira
            </Button>
          </div>
        )}

        <Separator />
        <p className="text-xs text-muted-foreground">
          OAuth scopes: read:jira-work, write:jira-work, read:jira-user
        </p>
      </CardContent>
    </Card>
  );
};

export default JiraIntegrationCard;
