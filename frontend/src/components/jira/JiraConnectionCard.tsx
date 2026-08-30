import React, { useCallback, useEffect, useState } from 'react';
import {
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Settings2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { jiraApi, JiraConnectionStatus } from '@/lib/jira-api';
import { buildJiraOAuthStartUrl } from '@/lib/jira-oauth';
import { useWorkspace } from '@/lib/workspace-context';
import { formatHubDate } from './jira-ui.utils';

type Props = {
  compact?: boolean;
  onStatusChange?: (status: JiraConnectionStatus | null) => void;
};

const OAUTH_SCOPES = 'read:jira-work, write:jira-work, read:jira-user, offline_access';

export const JiraConnectionCard: React.FC<Props> = ({
  compact = false,
  onStatusChange,
}) => {
  const { toast } = useToast();
  const { workspaceId } = useWorkspace();
  const [status, setStatus] = useState<JiraConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showManage, setShowManage] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const overview = await jiraApi.getOverview();
      setStatus(overview.connection);
      onStatusChange?.(overview.connection);
    } catch (error) {
      console.error(error);
      setStatus(null);
      onStatusChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [onStatusChange]);

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
      window.history.replaceState({}, '', `${window.location.pathname}${params.toString() ? `?${params}` : ''}`);
    }

    if (jiraParam === 'error') {
      toast({
        title: 'Jira connection failed',
        description: params.get('message') || 'Unable to complete Atlassian OAuth.',
        variant: 'destructive',
      });
      params.delete('jira');
      params.delete('message');
      window.history.replaceState({}, '', `${window.location.pathname}${params.toString() ? `?${params}` : ''}`);
    }
  }, [loadStatus, toast]);

  const handleConnect = () => {
    window.location.href = buildJiraOAuthStartUrl(workspaceId);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await jiraApi.sync();
      await loadStatus();
      toast({ title: 'Jira synced', description: 'Live Jira data refreshed successfully.' });
    } catch (error) {
      console.error(error);
      toast({
        title: 'Sync failed',
        description: 'Could not synchronize with Jira.',
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await jiraApi.disconnect();
      setStatus({ connected: false });
      onStatusChange?.({ connected: false });
      toast({ title: 'Jira disconnected', description: 'The Atlassian connection was removed.' });
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

  const connected = status?.connected;

  return (
    <Card className="jira-premium-surface overflow-hidden rounded-3xl">
      <div className="h-px w-full bg-gradient-to-r from-transparent via-[#6366F1]/70 to-transparent" />
      <CardHeader className={compact ? 'pb-4' : undefined}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-[#6366F1]/30 bg-[#4F46E5]/15">
              <span className="pointer-events-none absolute inset-0 rounded-2xl shadow-[0_0_28px_-4px_rgba(99,102,241,0.75)]" />
              <svg viewBox="0 0 24 24" className="relative h-7 w-7 text-[#60A5FA]" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.004-1.005zm5.058 0h-2.13v2.057a5.215 5.215 0 0 0 5.214 5.214V12.518a1.005 1.005 0 0 0-1.004-1.005h-2.08zm-5.058-7.02H5.232A5.218 5.218 0 0 0 0 9.708h11.571V4.493a1.005 1.005 0 0 0-1.004-1.005zm7.288 0h-2.08v5.215H24a5.218 5.218 0 0 0-5.215-5.215h-2.086z"
                />
              </svg>
            </div>
            <div>
              <CardTitle className="text-xl tracking-tight">Jira Connection</CardTitle>
              <CardDescription className="mt-1.5 max-w-2xl text-[13px] leading-relaxed">
                Secure OAuth connection to your Atlassian workspace for live issue data and standup linking.
              </CardDescription>
            </div>
          </div>
          {!loading && (
            <Badge
              className={
                connected
                  ? 'gap-1 self-start border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-emerald-300'
                  : 'gap-1 self-start border-white/10 bg-white/[0.04] px-3 py-1'
              }
            >
              {connected ? (
                <>
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Connected
                </>
              ) : (
                'Not Connected'
              )}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Checking connection…</p>
        ) : connected ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {[
                { label: 'Connected Account', value: status?.atlassianDisplayName || '—' },
                { label: 'Workspace', value: status?.siteName || '—' },
                { label: 'OAuth Status', value: 'Active' },
                { label: 'Scopes', value: OAUTH_SCOPES },
                { label: 'Last Sync', value: status?.lastSyncAt ? formatHubDate(status.lastSyncAt) : '—' },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-white/[0.07] bg-[#151D2D]/65 p-4 transition-colors hover:border-[#6366F1]/30"
                >
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#60A5FA]/80">
                    {item.label}
                  </p>
                  <p className="mt-2.5 text-sm font-medium leading-relaxed text-foreground break-words">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>

            <Separator className="bg-white/[0.06]" />

            <div className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                className="border-white/[0.1] bg-transparent hover:border-[#3B82F6]/40 hover:bg-[#3B82F6]/10 hover:text-[#60A5FA]"
                onClick={() => setShowManage((value) => !value)}
              >
                <Settings2 className="h-4 w-4" />
                Manage Connection
              </Button>
              <Button
                variant="outline"
                className="border-white/[0.1] bg-transparent hover:border-[#3B82F6]/40 hover:bg-[#3B82F6]/10 hover:text-[#60A5FA]"
                onClick={handleSync}
                disabled={syncing}
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
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
              {status?.siteUrl ? (
                <Button className="btn-jira-primary" asChild>
                  <a href={status.siteUrl} target="_blank" rel="noreferrer">
                    Open Workspace
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              ) : null}
            </div>

            {showManage ? (
              <div className="rounded-2xl border border-[#6366F1]/20 bg-[#4F46E5]/10 p-4 text-sm text-muted-foreground">
                Pulse uses OAuth to read and update Jira issues on your behalf. Use Sync Now to refresh
                cached issue data for Slack pickers and analytics.
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col gap-4 rounded-2xl border border-dashed border-white/[0.1] bg-[#151D2D]/40 p-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Connect Jira to browse projects, link standups, and unlock analytics.
            </p>
            <Button className="btn-jira-primary" onClick={handleConnect}>
              <ExternalLink className="h-4 w-4" />
              Connect Jira
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default JiraConnectionCard;
