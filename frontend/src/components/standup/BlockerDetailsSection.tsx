import React, { useRef } from 'react';
import { AlertTriangle, Info, Paperclip, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { JiraIssueCombobox } from '@/components/jira/JiraIssueCombobox';
import { UserSearchSelect } from './UserSearchSelect';
import { BlockerSummaryCard } from './BlockerSummaryCard';
import {
  BLOCKER_CATEGORIES,
  BlockedAnswer,
  BlockerDetailsState,
  DailyStandupAnswers,
  SEVERITY_OPTIONS,
} from './standup-form.types';

interface BlockerDetailsSectionProps {
  answers: DailyStandupAnswers;
  onChange: (blocker: BlockerDetailsState) => void;
  visible: boolean;
}

export const BlockerDetailsSection: React.FC<BlockerDetailsSectionProps> = ({
  answers,
  onChange,
  visible,
}) => {
  const blocker = answers.blocker;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = <K extends keyof BlockerDetailsState>(
    key: K,
    value: BlockerDetailsState[K],
  ) => {
    onChange({ ...blocker, [key]: value });
  };

  return (
    <div
      className={cn(
        'grid transition-all duration-500 ease-out',
        visible ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="overflow-hidden">
        <section
          className={cn(
            'mt-6 space-y-6 rounded-2xl border p-6 shadow-lg shadow-black/10 transition-all duration-300',
            blocker.preventingAllWork
              ? 'border-red-500/40 bg-red-500/5 ring-1 ring-red-500/30'
              : 'border-border/80 bg-card/90',
          )}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <h3 className="text-lg font-semibold">Blocker Details</h3>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Structured context for this standup blocker.
              </p>
            </div>
            {blocker.preventingAllWork ? (
              <Badge variant="destructive">
                Critical blocker affecting current work.
              </Badge>
            ) : null}
          </div>

          {blocker.severity === 'critical' ? (
            <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200 transition-all duration-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>🚨 This blocker requires immediate attention.</p>
            </div>
          ) : null}

          {blocker.category === 'Authentication' ? (
            <div className="flex items-start gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-200 transition-all duration-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>OAuth / Login related issue detected.</p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="blocker-title">
              Blocker Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="blocker-title"
              value={blocker.title}
              onChange={(event) => update('title', event.target.value)}
              className="h-11 rounded-xl"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="blocker-description">
              Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="blocker-description"
              value={blocker.description}
              onChange={(event) => update('description', event.target.value)}
              placeholder="Describe what is blocking your work..."
              rows={5}
              className="rounded-xl"
            />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-3">
              <Label>
                Severity <span className="text-destructive">*</span>
              </Label>
              <div className="grid grid-cols-2 gap-2">
                {SEVERITY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => update('severity', option.value)}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all duration-200',
                      blocker.severity === option.value
                        ? option.selectedClass
                        : 'border-border/70 bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="blocker-category">
                Category <span className="text-destructive">*</span>
              </Label>
              <select
                id="blocker-category"
                value={blocker.category}
                onChange={(event) =>
                  update(
                    'category',
                    event.target.value as BlockerDetailsState['category'],
                  )
                }
                className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-sm transition-colors"
              >
                <option value="">Select category…</option>
                {BLOCKER_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              {blocker.category === 'Other' ? (
                <Input
                  value={blocker.categoryOther}
                  onChange={(event) => update('categoryOther', event.target.value)}
                  placeholder="Specify category"
                  className="mt-2 h-10 rounded-xl transition-all duration-300"
                />
              ) : null}
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Who is blocking you?</Label>
              <UserSearchSelect
                value={blocker.blockedByUser}
                onChange={(user) => update('blockedByUser', user)}
                placeholder="Search teammate or team…"
              />
              <p className="text-xs text-muted-foreground">Optional</p>
            </div>
            <div className="space-y-2">
              <Label>Related Jira Issue</Label>
              <JiraIssueCombobox
                value={blocker.relatedIssue}
                onSelect={(issue) => update('relatedIssue', issue)}
                onClear={() => update('relatedIssue', null)}
              />
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="expected-resolution">Expected Resolution</Label>
              <Input
                id="expected-resolution"
                type="date"
                value={blocker.expectedResolution}
                onChange={(event) => update('expectedResolution', event.target.value)}
                className="h-11 rounded-xl"
              />
              <p className="text-xs text-muted-foreground">Optional</p>
            </div>

            <div className="space-y-2">
              <Label>Attach Screenshot (Optional)</Label>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  update('attachmentName', file?.name ?? null);
                }}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="h-4 w-4" />
                  Choose image
                </Button>
                {blocker.attachmentName ? (
                  <Badge variant="secondary" className="gap-1">
                    {blocker.attachmentName}
                    <button
                      type="button"
                      onClick={() => {
                        update('attachmentName', null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">PNG, JPG, JPEG</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-secondary/10 px-4 py-3">
            <div>
              <p className="text-sm font-medium">
                Is this blocker preventing all your work?
              </p>
              <p className="text-xs text-muted-foreground">Toggle Yes / No</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {blocker.preventingAllWork ? 'Yes' : 'No'}
              </span>
              <Switch
                checked={blocker.preventingAllWork}
                onCheckedChange={(checked) => update('preventingAllWork', checked)}
              />
            </div>
          </div>

          <div className="space-y-3">
            <Label>Can you continue working on another task?</Label>
            <div className="flex gap-2">
              {(['yes', 'no'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() =>
                    update(
                      'canContinueOtherTask',
                      (blocker.canContinueOtherTask === option
                        ? null
                        : option) as BlockedAnswer,
                    )
                  }
                  className={cn(
                    'min-w-[88px] rounded-xl border px-4 py-2.5 text-sm font-semibold capitalize transition-all duration-200',
                    blocker.canContinueOtherTask === option
                      ? 'border-primary/40 bg-primary/15 text-primary'
                      : 'border-border/70 bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground',
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Optional — used later by AI reports.
            </p>
          </div>

          <BlockerSummaryCard blocker={blocker} />
        </section>
      </div>
    </div>
  );
};

export default BlockerDetailsSection;
