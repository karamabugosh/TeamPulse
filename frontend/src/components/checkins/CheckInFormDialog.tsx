import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, Loader2, Play } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent } from '@/components/ui/card';
import { QuestionBuilder, QuestionItem } from './QuestionBuilder';
import { ScheduleBuilder } from './ScheduleBuilder';
import { ParticipantPicker } from './ParticipantPicker';
import { SlackPreview } from './SlackPreview';
import { jiraApi } from '@/lib/jira-api';
import { parseCronToSchedule, scheduleToCron, ScheduleConfig, TIMEZONE_OPTIONS } from '@/lib/schedule';
import { apiFetch, ApiError } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export type CheckInFormState = {
  teamId: string;
  name: string;
  description: string;
  introMessage: string;
  outroMessage: string;
  timezone: string;
  collectionCron: string;
  updatesChannelId: string;
  reminderEnabled: boolean;
  reminderMinutesAfter: number;
  reminderRecurringEnabled: boolean;
  reminderIntervalMinutes: number;
  reminderOnlyNonResponders: boolean;
  reminderOnSlackActive: boolean;
  reportTriggerMode: 'scheduled' | 'all_answered' | 'timeout';
  reportCron: string;
  reportTimeoutMinutes: number;
  publishStatus: 'draft' | 'published';
  scheduleEnabled: boolean;
  enabled: boolean;
  participantIds: string[];
  questions: QuestionItem[];
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const mapQuestionFromApi = (q: any): QuestionItem => ({
  id: q.id,
  question: q.question,
  type: q.type || 'FREE_TEXT',
  options: Array.isArray(q.options) ? q.options : [],
  isRequired: q.isRequired ?? true,
  enabled: q.isActive !== false,
  order: q.order,
});

/** Exclude questions retired from config (kept in DB for historical Answers only). */
const activeConfigQuestions = (questions: any[] | undefined) =>
  (questions ?? []).filter((q) => q.retiredAt == null);

const DEFAULT_QUESTIONS: QuestionItem[] = [
  { id: 'q1', question: 'What did you complete since your last update?', type: 'FREE_TEXT', isRequired: true, order: 1 },
  { id: 'q2', question: 'What are you working on now?', type: 'FREE_TEXT', isRequired: true, order: 2 },
  { id: 'q3', question: 'Are you blocked?', type: 'BLOCKER', isRequired: true, order: 3 },
  { id: 'q4', question: 'Which Jira issue are you working on?', type: 'ISSUE_REF', isRequired: false, order: 4 },
  { id: 'q5', question: 'How confident are you about finishing today?', type: 'SCALE_1_5', isRequired: true, order: 5 },
  { id: 'q6', question: 'Estimated completion date?', type: 'FREE_TEXT', isRequired: false, order: 6 },
  { id: 'q7', question: 'Did anything slow you down today?', type: 'FREE_TEXT', isRequired: false, order: 7 },
  { id: 'q8', question: 'Do you need help from someone?', type: 'YES_NO', isRequired: true, order: 8 },
  { id: 'q9', question: 'Is this blocker linked to another Jira issue?', type: 'YES_NO', isRequired: false, order: 9 },
  { id: 'q10', question: 'Additional notes', type: 'FREE_TEXT', isRequired: false, order: 10 },
];

const defaultFormState = (): CheckInFormState => ({
  teamId: '',
  name: '',
  description: '',
  introMessage: "👋 Good morning!\n\nIt's time for your Daily Standup.\n\nLet's get started.",
  outroMessage: 'Perfect! Your responses have been recorded successfully. ✅',
  timezone: 'Asia/Hebron',
  collectionCron: '40 12 * * 1-5',
  updatesChannelId: '',
  reminderEnabled: true,
  reminderMinutesAfter: 30,
  reminderRecurringEnabled: false,
  reminderIntervalMinutes: 60,
  reminderOnlyNonResponders: true,
  reminderOnSlackActive: false,
  reportTriggerMode: 'scheduled',
  reportCron: '0 13 * * 1-5',
  reportTimeoutMinutes: 120,
  publishStatus: 'published',
  scheduleEnabled: true,
  enabled: true,
  participantIds: [],
  questions: [...DEFAULT_QUESTIONS],
});

interface CheckInFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingCheckIn?: any | null;
  teams: any[];
  onSaved: (saved?: any) => void;
}

function buildFormFromCheckIn(checkIn: any): CheckInFormState {
  return {
    teamId: checkIn.teamId,
    name: checkIn.name,
    description: checkIn.description || '',
    introMessage: checkIn.introMessage || '',
    outroMessage: checkIn.outroMessage || '',
    timezone: checkIn.timezone || 'Asia/Riyadh',
    collectionCron: checkIn.collectionCron || '0 9 * * 1-5',
    updatesChannelId: checkIn.updatesChannelId || '',
    reminderEnabled: checkIn.reminderEnabled ?? true,
    reminderMinutesAfter: checkIn.reminderMinutesAfter ?? 30,
    reminderRecurringEnabled: checkIn.reminderRecurringEnabled ?? false,
    reminderIntervalMinutes: checkIn.reminderIntervalMinutes ?? 60,
    reminderOnlyNonResponders: checkIn.reminderOnlyNonResponders ?? true,
    reminderOnSlackActive: checkIn.reminderOnSlackActive ?? false,
    reportTriggerMode: checkIn.reportTriggerMode || 'scheduled',
    reportCron: checkIn.reportCron || '30 9 * * 1-5',
    reportTimeoutMinutes: checkIn.reportTimeoutMinutes ?? 120,
    publishStatus: checkIn.publishStatus || 'published',
    scheduleEnabled: checkIn.scheduleEnabled ?? true,
    enabled: checkIn.enabled ?? true,
    participantIds: (checkIn.participants || []).map((p: any) => p.teamMemberId),
    questions: checkIn.questions?.length
      ? activeConfigQuestions(checkIn.questions)
          .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
          .map(mapQuestionFromApi)
      : [...DEFAULT_QUESTIONS],
  };
}

export const CheckInFormDialog: React.FC<CheckInFormDialogProps> = ({
  open,
  onOpenChange,
  editingCheckIn,
  teams,
  onSaved,
}) => {
  const { toast } = useToast();
  const [form, setForm] = useState<CheckInFormState>(defaultFormState());
  const [schedule, setSchedule] = useState<ScheduleConfig>(parseCronToSchedule('0 9 * * 1-5'));
  const [reportSchedule, setReportSchedule] = useState<ScheduleConfig>(parseCronToSchedule('30 9 * * 1-5'));
  const [saving, setSaving] = useState(false);
  const [startingRun, setStartingRun] = useState(false);
  const [loadingForm, setLoadingForm] = useState(false);
  const [jiraConnected, setJiraConnected] = useState(false);
  const initializedKeyRef = useRef<string | null>(null);
  const formRef = useRef<CheckInFormState>(defaultFormState());
  formRef.current = form;

  const applyFormState = useCallback((nextForm: CheckInFormState) => {
    setForm(nextForm);
    setSchedule(parseCronToSchedule(nextForm.collectionCron || '0 9 * * 1-5'));
    setReportSchedule(parseCronToSchedule(nextForm.reportCron || '30 9 * * 1-5'));
  }, []);

  // Initialize form ONLY when the dialog opens — never on background refetches.
  useEffect(() => {
    if (!open) {
      initializedKeyRef.current = null;
      return;
    }

    const initKey = editingCheckIn?.id ?? 'new';
    if (initializedKeyRef.current === initKey) {
      return;
    }
    initializedKeyRef.current = initKey;

    let cancelled = false;

    const load = async () => {
      if (editingCheckIn?.id) {
        setLoadingForm(true);
        try {
          const fresh = await apiFetch<any>(`/api/check-ins/${editingCheckIn.id}`);
          if (!cancelled) {
            applyFormState(buildFormFromCheckIn(fresh));
          }
        } catch (error) {
          if (!cancelled) {
            const message = error instanceof ApiError ? error.message : 'Failed to load CheckIn';
            toast({ title: 'Could not load CheckIn', description: message, variant: 'destructive' });
            applyFormState(buildFormFromCheckIn(editingCheckIn));
          }
        } finally {
          if (!cancelled) {
            setLoadingForm(false);
          }
        }
        return;
      }

      applyFormState({
        ...defaultFormState(),
        teamId: teams[0]?.id || '',
      });
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [open, editingCheckIn?.id, applyFormState, toast]);

  useEffect(() => {
    if (!open) {
      return;
    }

    jiraApi
      .getStatus()
      .then((status) => setJiraConnected(Boolean(status.connected)))
      .catch(() => setJiraConnected(false));
  }, [open]);

  // If teams load after opening the create dialog, set teamId once without resetting questions.
  useEffect(() => {
    if (!open || editingCheckIn?.id || form.teamId || !teams[0]?.id) {
      return;
    }
    if (initializedKeyRef.current !== 'new') {
      return;
    }
    setForm((current) => ({ ...current, teamId: teams[0].id }));
  }, [open, editingCheckIn?.id, teams, form.teamId]);

  useEffect(() => {
    setForm((f) => ({ ...f, collectionCron: scheduleToCron(schedule) }));
  }, [schedule]);

  useEffect(() => {
    setForm((f) => ({ ...f, reportCron: scheduleToCron(reportSchedule) }));
  }, [reportSchedule]);

  const update = <K extends keyof CheckInFormState>(key: K, value: CheckInFormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const currentForm = formRef.current;

    if (!currentForm.teamId?.trim()) {
      toast({
        title: 'Team required',
        description: 'Select a team before saving this CheckIn.',
        variant: 'destructive',
      });
      return;
    }

    if (!currentForm.name.trim()) {
      toast({
        title: 'Name required',
        description: 'Enter a CheckIn name before saving.',
        variant: 'destructive',
      });
      return;
    }

    if (currentForm.questions.some((q) => !q.question.trim())) {
      toast({
        title: 'Empty question',
        description: 'Every question needs text before saving.',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);

    // Explicit payload — map form state 1:1 to the NestJS create/update DTOs.
    const payload = {
      teamId: currentForm.teamId,
      name: currentForm.name.trim(),
      description: currentForm.description.trim() || null,
      introMessage: currentForm.introMessage.trim() || null,
      outroMessage: currentForm.outroMessage.trim() || null,
      enabled: currentForm.enabled,
      timezone: currentForm.timezone,
      collectionCron: currentForm.collectionCron,
      updatesChannelId: currentForm.updatesChannelId.trim() || null,
      reminderEnabled: currentForm.reminderEnabled,
      reminderMinutesAfter: currentForm.reminderMinutesAfter,
      reminderRecurringEnabled: currentForm.reminderRecurringEnabled,
      reminderIntervalMinutes: currentForm.reminderIntervalMinutes,
      reminderOnlyNonResponders: currentForm.reminderOnlyNonResponders,
      reminderOnSlackActive: currentForm.reminderOnSlackActive,
      reportTriggerMode: currentForm.reportTriggerMode,
      reportCron: currentForm.reportCron?.trim() || null,
      reportTimeoutMinutes: currentForm.reportTimeoutMinutes,
      publishStatus: currentForm.publishStatus,
      scheduleEnabled: currentForm.scheduleEnabled,
      participantIds: currentForm.participantIds,
      questions: currentForm.questions.map((q, idx) => ({
        ...(UUID_RE.test(q.id) ? { id: q.id } : {}),
        question: q.question.trim(),
        type: q.type,
        options: q.type === 'MULTIPLE_CHOICE' ? (q.options ?? []) : undefined,
        isRequired: q.isRequired,
        isActive: q.enabled !== false,
        order: idx + 1,
      })),
    };

    if (import.meta.env.DEV) {
      console.debug('[CheckIn save] payload questions:', payload.questions);
    }

    try {
      const url = editingCheckIn ? `/api/check-ins/${editingCheckIn.id}` : '/api/check-ins';
      const method = editingCheckIn ? 'PATCH' : 'POST';
      const saved = await apiFetch<any>(url, {
        method,
        body: JSON.stringify(payload),
      });

      const checkInId = editingCheckIn?.id ?? saved?.id;
      const resolved = checkInId
        ? await apiFetch<any>(`/api/check-ins/${checkInId}`)
        : saved;

      toast({
        title: editingCheckIn ? 'CheckIn updated successfully.' : 'CheckIn created',
        description: editingCheckIn
          ? `"${resolved.name}" was saved with ${resolved.questions?.length ?? 0} question(s).`
          : `"${resolved.name}" was created successfully.`,
        variant: 'success',
      });

      onOpenChange(false);
      onSaved(resolved);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to save CheckIn';
      toast({ title: 'Save failed', description: message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleStartRun = async () => {
    if (!editingCheckIn?.id) return;
    setStartingRun(true);
    try {
      const result = await apiFetch<any>(`/api/check-ins/${editingCheckIn.id}/runs`, { method: 'POST' });
      const delivery = result.delivery;
      toast({
        title: 'CheckIn run started',
        description: delivery
          ? `${delivery.delivered ?? 0} DM(s) sent${delivery.failed ? `, ${delivery.failed} failed` : ''}.`
          : 'Run created successfully.',
        variant: delivery?.failed > 0 && !delivery?.delivered ? 'destructive' : 'success',
      });
      onSaved();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Failed to start run';
      toast({ title: 'Run failed', description: message, variant: 'destructive' });
    } finally {
      setStartingRun(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingCheckIn ? 'Edit CheckIn' : 'Create CheckIn'}</DialogTitle>
          <DialogDescription>
            Configure participants, questions, schedule, reminders, and report settings.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          {loadingForm && (
            <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading CheckIn...
            </div>
          )}
          <div className={loadingForm ? 'pointer-events-none opacity-60' : undefined}>
          <Tabs defaultValue="general" className="w-full">
            <TabsList className="mb-6 grid w-full grid-cols-3 lg:grid-cols-6">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="questions">Questions</TabsTrigger>
              <TabsTrigger value="schedule">Schedule</TabsTrigger>
              <TabsTrigger value="reminders">Reminders</TabsTrigger>
              <TabsTrigger value="reports">Reports</TabsTrigger>
              <TabsTrigger value="participants">Participants</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Team *</Label>
                  <select
                    required
                    value={form.teamId}
                    onChange={(e) => update('teamId', e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Select team...</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>CheckIn Name *</Label>
                  <Input required value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="Daily Engineering Standup" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => update('description', e.target.value)} rows={2} />
              </div>
              <div className="space-y-2">
                <Label>Intro Message (DM)</Label>
                <Textarea value={form.introMessage} onChange={(e) => update('introMessage', e.target.value)} rows={3} placeholder="First message sent in the participant's DM" />
              </div>
              <div className="space-y-2">
                <Label>Outro Message (DM)</Label>
                <Textarea value={form.outroMessage} onChange={(e) => update('outroMessage', e.target.value)} rows={2} placeholder="Sent after all questions are answered" />
              </div>
              <div className="space-y-2">
                <Label>Slack Updates Channel ID (optional)</Label>
                <Input value={form.updatesChannelId} onChange={(e) => update('updatesChannelId', e.target.value)} className="font-mono" placeholder="Channel for standup parent message & thread" />
                <p className="text-xs text-muted-foreground">Reports and participant updates are posted inside this thread. Falls back to team channel or SLACK_UPDATES_CHANNEL_ID.</p>
              </div>
            </TabsContent>

            <TabsContent value="questions" className="space-y-6">
              <QuestionBuilder questions={form.questions} onChange={(q) => update('questions', q)} />
              <div className="space-y-3">
                <div>
                  <h3 className="font-semibold">Slack Preview</h3>
                  <p className="text-sm text-muted-foreground">
                    Preview the standup DM layout, including the searchable Jira issue picker.
                  </p>
                </div>
                <SlackPreview
                  introMessage={form.introMessage}
                  outroMessage={form.outroMessage}
                  questions={form.questions}
                  showJiraLink={jiraConnected}
                />
              </div>
            </TabsContent>

            <TabsContent value="schedule" className="space-y-6">
              <div className="space-y-2">
                <Label>Timezone</Label>
                <select value={form.timezone} onChange={(e) => update('timezone', e.target.value)} className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-4">
                <div>
                  <Label>Enable Scheduling</Label>
                  <p className="text-xs text-muted-foreground">Automatically send DMs at scheduled time</p>
                </div>
                <Switch checked={form.scheduleEnabled} onCheckedChange={(v) => update('scheduleEnabled', v)} />
              </div>
              <ScheduleBuilder value={schedule} onChange={setSchedule} cronPreview={form.collectionCron} timezone={form.timezone} />
            </TabsContent>

            <TabsContent value="reminders" className="space-y-6">
              <Card>
                <CardContent className="space-y-4 p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Enable Reminders</Label>
                      <p className="text-xs text-muted-foreground">Send reminders to participants who haven't responded</p>
                    </div>
                    <Switch checked={form.reminderEnabled} onCheckedChange={(v) => update('reminderEnabled', v)} />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Minutes After Start</Label>
                      <Input type="number" min={0} value={form.reminderMinutesAfter} onChange={(e) => update('reminderMinutesAfter', Number(e.target.value))} />
                    </div>
                    <div className="space-y-2">
                      <Label>Recurring Interval (minutes)</Label>
                      <Input type="number" min={0} value={form.reminderIntervalMinutes} onChange={(e) => update('reminderIntervalMinutes', Number(e.target.value))} disabled={!form.reminderRecurringEnabled} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Recurring Reminders</Label>
                    <Switch checked={form.reminderRecurringEnabled} onCheckedChange={(v) => update('reminderRecurringEnabled', v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Only Non-Responders</Label>
                    <Switch checked={form.reminderOnlyNonResponders} onCheckedChange={(v) => update('reminderOnlyNonResponders', v)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Remind on Slack Activity</Label>
                      <p className="text-xs text-muted-foreground">Send reminder when user becomes active on Slack</p>
                    </div>
                    <Switch checked={form.reminderOnSlackActive} onCheckedChange={(v) => update('reminderOnSlackActive', v)} />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="reports" className="space-y-6">
              <div className="space-y-2">
                <Label>Report Trigger</Label>
                <select value={form.reportTriggerMode} onChange={(e) => update('reportTriggerMode', e.target.value as any)} className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm">
                  <option value="scheduled">Scheduled time</option>
                  <option value="all_answered">After everyone answered</option>
                  <option value="timeout">After timeout</option>
                </select>
              </div>
              {form.reportTriggerMode === 'scheduled' && (
                <ScheduleBuilder value={reportSchedule} onChange={setReportSchedule} cronPreview={form.reportCron} />
              )}
              {form.reportTriggerMode === 'timeout' && (
                <div className="space-y-2">
                  <Label>Timeout (minutes after start)</Label>
                  <Input type="number" min={1} value={form.reportTimeoutMinutes} onChange={(e) => update('reportTimeoutMinutes', Number(e.target.value))} />
                </div>
              )}
              <p className="text-sm text-muted-foreground rounded-lg border border-border p-4">
                AI reports are posted inside the CheckIn Slack thread — no separate report channel is needed.
              </p>
            </TabsContent>

            <TabsContent value="participants">
              {form.teamId ? (
                <ParticipantPicker teamId={form.teamId} selectedIds={form.participantIds} onChange={(ids) => update('participantIds', ids)} />
              ) : (
                <p className="text-sm text-muted-foreground">Select a team first to choose participants.</p>
              )}
            </TabsContent>
          </Tabs>
          </div>

          <DialogFooter className="mt-6 gap-2">
            <div className="mr-auto flex items-center gap-3">
              <Label className="text-sm">Status</Label>
              <select
                value={form.publishStatus}
                onChange={(e) => update('publishStatus', e.target.value as 'draft' | 'published')}
                className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
              >
                <option value="draft">Save as Draft</option>
                <option value="published">Published</option>
              </select>
            </div>
            {editingCheckIn && (
              <Button type="button" variant="outline" onClick={handleStartRun} disabled={startingRun}>
                {startingRun ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Start Run Now
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || loadingForm}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              {saving ? 'Saving...' : editingCheckIn ? 'Save CheckIn' : 'Create CheckIn'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CheckInFormDialog;
