import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Send } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { apiFetch, ApiError } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import type { GeneratedWorkspaceReport } from './ai-workspace.types';

export type SlackSendPayload = {
  contentType: 'report' | 'answer';
  title: string;
  body: string;
  confidence?: string | null;
  sources?: Array<{ label: string; title?: string | null; url?: string | null }>;
  recommendation?: string | null;
  reportType?: string | null;
  report?: GeneratedWorkspaceReport | null;
};

type DestinationType = 'default' | 'dm' | 'channel' | 'team_channel';

type DestinationsResponse = {
  workspaceId: string;
  workspaceName: string;
  slackConnected: boolean;
  defaultChannel: {
    channelId: string | null;
    channelName: string | null;
    source: string;
  };
  channels: Array<{ id: string; name: string; channelId?: string | null }>;
  teams: Array<{ id: string; name: string; channelId?: string | null }>;
  members: Array<{ id: string; name: string; slackUserId?: string | null }>;
};

type SendResponse = {
  ok: boolean;
  channelName: string | null;
  sentAt: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  attachmentsUploaded?: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payload: SlackSendPayload | null;
  onSuccess?: (result: { channelName: string; sentAt: string }) => void;
};

const selectClassName =
  'flex h-10 w-full rounded-md border border-white/10 bg-background px-3 py-2 text-sm text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:cursor-not-allowed disabled:opacity-50';

export const SendToSlackDialog: React.FC<Props> = ({
  open,
  onOpenChange,
  payload,
  onSuccess,
}) => {
  const { workspaceId } = useWorkspace();
  const [loadingDestinations, setLoadingDestinations] = useState(false);
  const [sending, setSending] = useState(false);
  const [destinations, setDestinations] = useState<DestinationsResponse | null>(
    null,
  );
  const [destinationType, setDestinationType] =
    useState<DestinationType>('default');
  const [channelId, setChannelId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [slackUserId, setSlackUserId] = useState('');
  const [attachPdf, setAttachPdf] = useState(true);
  const [attachMarkdown, setAttachMarkdown] = useState(true);
  const [attachCsv, setAttachCsv] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    channelName: string;
    sentAt: string;
  } | null>(null);

  const loadDestinations = useCallback(async () => {
    if (!workspaceId) return;
    setLoadingDestinations(true);
    setError(null);
    try {
      const data = await apiFetch<DestinationsResponse>(
        `/api/ai/workspace/slack/destinations?workspaceId=${encodeURIComponent(workspaceId)}`,
      );
      setDestinations(data);
      if (!data.slackConnected) {
        setError(
          'Slack is not connected for this workspace. Reinstall the Pulse Slack app or configure a valid bot token.',
        );
      }
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : 'Could not load Slack destinations.';
      setError(message);
      setDestinations(null);
    } finally {
      setLoadingDestinations(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!open) return;
    setSuccess(null);
    setError(null);
    setDestinationType('default');
    setChannelId('');
    setTeamId('');
    setSlackUserId('');
    setAttachPdf(true);
    setAttachMarkdown(true);
    setAttachCsv(Boolean(payload?.report));
    void loadDestinations();
  }, [open, loadDestinations, payload?.report]);

  const defaultLabel = useMemo(() => {
    if (!destinations?.defaultChannel.channelId) {
      return 'No default engineering channel configured';
    }
    return (
      destinations.defaultChannel.channelName ||
      destinations.defaultChannel.channelId
    );
  }, [destinations]);

  const handleSend = async () => {
    if (!payload || !workspaceId) return;
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await apiFetch<SendResponse>('/api/ai/workspace/slack/send', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          destinationType,
          channelId: destinationType === 'channel' ? channelId : undefined,
          teamId: destinationType === 'team_channel' ? teamId : undefined,
          slackUserId: destinationType === 'dm' ? slackUserId : undefined,
          contentType: payload.contentType,
          title: payload.title,
          body: payload.body,
          confidence: payload.confidence,
          sources: payload.sources,
          recommendation: payload.recommendation,
          reportType: payload.reportType,
          report: payload.report,
          attachments: {
            pdf: attachPdf,
            markdown: attachMarkdown,
            csv: attachCsv,
          },
        }),
      });

      if (!result.ok) {
        setError(result.errorMessage || 'Failed to send to Slack.');
        return;
      }

      const channelName = result.channelName || 'Slack';
      const sentAt = result.sentAt;
      setSuccess({ channelName, sentAt });
      onSuccess?.({ channelName, sentAt });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'Failed to send to Slack.';
      setError(message);
    } finally {
      setSending(false);
    }
  };

  const canSend =
    Boolean(payload) &&
    Boolean(destinations?.slackConnected) &&
    !sending &&
    !loadingDestinations &&
    (destinationType === 'default' ||
      (destinationType === 'channel' && channelId) ||
      (destinationType === 'team_channel' && teamId) ||
      (destinationType === 'dm' && slackUserId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Send to Slack</DialogTitle>
          <DialogDescription>
            Deliver this AI response to a Slack DM or channel in the active
            workspace only.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-5 text-sm">
            <div className="flex items-start gap-2 text-emerald-100">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-medium">Successfully sent to Slack</p>
                <p className="mt-1 text-emerald-100/80">
                  Channel: {success.channelName}
                </p>
                <p className="text-emerald-100/80">
                  Time sent:{' '}
                  {new Date(success.sentAt).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
              </div>
            </div>
            <DialogFooter className="mt-4 sm:justify-end">
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            {loadingDestinations ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading Slack destinations…
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="slack-destination-type">Destination</Label>
                  <select
                    id="slack-destination-type"
                    className={selectClassName}
                    value={destinationType}
                    onChange={(event) =>
                      setDestinationType(event.target.value as DestinationType)
                    }
                  >
                    <option value="default">
                      Default engineering channel ({defaultLabel})
                    </option>
                    <option value="dm">Current / selected user DM</option>
                    <option value="channel">Selected Slack channel</option>
                    <option value="team_channel">Selected team channel</option>
                  </select>
                </div>

                {destinationType === 'channel' ? (
                  <div className="space-y-2">
                    <Label htmlFor="slack-channel">Slack channel</Label>
                    <select
                      id="slack-channel"
                      className={selectClassName}
                      value={channelId}
                      onChange={(event) => setChannelId(event.target.value)}
                    >
                      <option value="">Select a channel…</option>
                      {(destinations?.channels ?? []).map((channel) => (
                        <option
                          key={channel.id}
                          value={channel.channelId || channel.id}
                        >
                          {channel.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {destinationType === 'team_channel' ? (
                  <div className="space-y-2">
                    <Label htmlFor="slack-team">Team channel</Label>
                    <select
                      id="slack-team"
                      className={selectClassName}
                      value={teamId}
                      onChange={(event) => setTeamId(event.target.value)}
                    >
                      <option value="">Select a team…</option>
                      {(destinations?.teams ?? []).map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                {destinationType === 'dm' ? (
                  <div className="space-y-2">
                    <Label htmlFor="slack-member">Send DM to</Label>
                    <select
                      id="slack-member"
                      className={selectClassName}
                      value={slackUserId}
                      onChange={(event) => setSlackUserId(event.target.value)}
                    >
                      <option value="">Select a member…</option>
                      {(destinations?.members ?? []).map((member) => (
                        <option
                          key={member.id}
                          value={member.slackUserId || ''}
                        >
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label>Attachments</Label>
                  <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={attachPdf}
                        onChange={(event) => setAttachPdf(event.target.checked)}
                      />
                      PDF
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={attachMarkdown}
                        onChange={(event) =>
                          setAttachMarkdown(event.target.checked)
                        }
                      />
                      Markdown
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={attachCsv}
                        onChange={(event) => setAttachCsv(event.target.checked)}
                      />
                      CSV
                    </label>
                  </div>
                </div>
              </>
            )}

            {error ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={sending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="gap-1.5"
                disabled={!canSend}
                onClick={() => void handleSend()}
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SendToSlackDialog;
