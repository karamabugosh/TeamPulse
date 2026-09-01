import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Settings, MessageSquare, Cpu, Clock, CheckCircle2, ShieldCheck, Save } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const [openaiModel, setOpenaiModel] = useState('gpt-4o-mini');
  const [aiEnabled, setAiEnabled] = useState(true);
  const [timezone, setTimezone] = useState('Asia/Riyadh');
  const [digestChannel, setDigestChannel] = useState('C0BLMEY71QR');

  useEffect(() => {
    apiFetch<any>('/api/admin/settings')
      .then((data) => {
        setSettings(data);
        if (data.openai?.model) setOpenaiModel(data.openai.model);
        if (data.openai?.enabled !== undefined) setAiEnabled(data.openai.enabled);
        if (data.system?.timezone) setTimezone(data.system.timezone);
        if (data.slack?.defaultDigestChannel) setDigestChannel(data.slack.defaultDigestChannel);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load settings:', err);
        setLoading(false);
      });
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ openaiModel, aiEnabled, timezone, digestChannel }),
      });
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title="Settings"
        description="Manage Slack Bot tokens, OpenAI configuration, system timezones, and cron defaults."
      >
        {savedSuccess && (
          <Badge variant="success" className="gap-1.5 px-3 py-1.5">
            <CheckCircle2 className="h-4 w-4" />
            Settings Saved
          </Badge>
        )}
      </PageHeader>

      <form onSubmit={handleSaveSettings} className="space-y-6">
        {/* Workspace */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Settings className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Workspace Configuration</CardTitle>
                <CardDescription>Connected Slack Workspace settings</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Workspace Name</Label>
                <Input disabled value={settings?.workspace?.name || '—'} className="bg-secondary/50 text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <Label>Slack Workspace ID</Label>
                <Input disabled value={settings?.workspace?.slackWorkspaceId || 'T0BKKJNTQJ3'} className="bg-secondary/50 font-mono text-muted-foreground" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Slack Integration */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle>Slack Integration</CardTitle>
                  <CardDescription>Bot token, Socket mode, and channel destinations</CardDescription>
                </div>
              </div>
              <Badge variant="success" className="gap-1">
                <ShieldCheck className="h-3.5 w-3.5" />
                Socket Mode Online
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="digest-channel">Default Digest Channel ID</Label>
                <Input id="digest-channel" value={digestChannel} onChange={(e) => setDigestChannel(e.target.value)} className="font-mono text-emerald-400" />
              </div>
              <div className="space-y-2">
                <Label>Socket Mode Status</Label>
                <Input
                  disabled
                  value={settings?.slack?.socketModeEnabled ? 'Enabled (Active WebSocket)' : 'Disabled'}
                  className="bg-secondary/50 text-emerald-400 font-medium"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* OpenAI */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
                  <Cpu className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle>OpenAI Intelligence Engine</CardTitle>
                  <CardDescription>Model selection and AI summary generation</CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="ai-toggle" className="text-sm text-muted-foreground">Enable AI</Label>
                <Switch id="ai-toggle" checked={aiEnabled} onCheckedChange={setAiEnabled} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="model">OpenAI Model</Label>
                <select
                  id="model"
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="gpt-4o-mini">gpt-4o-mini (Recommended)</option>
                  <option value="gpt-4o">gpt-4o (High Precision)</option>
                  <option value="gpt-3.5-turbo">gpt-3.5-turbo (Legacy)</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>API Key Status</Label>
                <Input
                  disabled
                  value={settings?.openai?.apiKeySet ? 'Key Configured (OPENAI_API_KEY Active)' : 'Missing Key'}
                  className="bg-secondary/50 font-mono text-primary"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* System */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>System & Timezone</CardTitle>
                <CardDescription>Global timezone settings and cron defaults</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="timezone">Default System Timezone</Label>
                <Input id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Default Collection Cron</Label>
                <Input disabled value={settings?.system?.collectionCron || '8 11 * * 1-5'} className="bg-secondary/50 font-mono text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <Label>Database Health</Label>
                <Input
                  disabled
                  value={settings?.system?.databaseStatus || 'Healthy (PostgreSQL Connected)'}
                  className="bg-secondary/50 text-emerald-400 font-medium"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Separator />

        <div className="flex justify-end">
          <Button type="submit" size="lg">
            <Save className="h-4 w-4" />
            Save Configuration
          </Button>
        </div>
      </form>
    </div>
  );
};

export default SettingsPage;
