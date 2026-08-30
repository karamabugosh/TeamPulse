import React, { useState } from 'react';
import { CheckCircle2, RotateCcw, Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { JiraIssueCombobox } from '@/components/jira/JiraIssueCombobox';
import { BlockerDetailsSection } from './BlockerDetailsSection';
import { UserSearchSelect } from './UserSearchSelect';
import {
  BlockedAnswer,
  DailyStandupAnswers,
  DEFAULT_BLOCKER_DETAILS,
  DEFAULT_STANDUP_ANSWERS,
} from './standup-form.types';

interface DailyStandupFormProps {
  userName?: string;
}

function YesNoToggle({
  value,
  onChange,
}: {
  value: BlockedAnswer;
  onChange: (value: BlockedAnswer) => void;
}) {
  return (
    <div className="flex gap-2">
      {(['yes', 'no'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            'min-w-[88px] rounded-xl border px-4 py-2.5 text-sm font-semibold capitalize transition-all duration-200',
            value === option
              ? option === 'yes'
                ? 'border-amber-500/40 bg-amber-500/15 text-amber-300 shadow-sm'
                : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300 shadow-sm'
              : 'border-border/70 bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground',
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export const DailyStandupForm: React.FC<DailyStandupFormProps> = ({
  userName = 'Karam',
}) => {
  const [answers, setAnswers] = useState<DailyStandupAnswers>(DEFAULT_STANDUP_ANSWERS);
  const [savedPreview, setSavedPreview] = useState(false);

  const update = <K extends keyof DailyStandupAnswers>(
    key: K,
    value: DailyStandupAnswers[K],
  ) => {
    setAnswers((current) => ({ ...current, [key]: value }));
    setSavedPreview(false);
  };

  const handleBlockedChange = (value: BlockedAnswer) => {
    setAnswers((current) => ({
      ...current,
      isBlocked: value,
      blocker: value === 'yes' ? current.blocker : { ...DEFAULT_BLOCKER_DETAILS },
      blockerLinkedToJira: value === 'yes' ? current.blockerLinkedToJira : null,
    }));
    setSavedPreview(false);
  };

  const showBlockerSection = answers.isBlocked === 'yes';

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        setSavedPreview(true);
      }}
    >
      <Card className="border-border/80 shadow-lg shadow-black/10">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="h-3 w-3" />
              Dynamic Standup
            </Badge>
            <Badge variant="outline">UI only</Badge>
          </div>
          <CardTitle className="text-2xl">Daily Standup</CardTitle>
          <CardDescription>
            Answer your standup questions. Blocker fields appear only when you report being blocked.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <QuestionBlock
            number={1}
            title="What did you complete since your last update?"
          >
            <Textarea
              value={answers.completedSinceLast}
              onChange={(event) => update('completedSinceLast', event.target.value)}
              placeholder="Summarize completed work…"
              rows={3}
              className="rounded-xl"
            />
          </QuestionBlock>

          <QuestionBlock number={2} title="What are you working on now?">
            <Textarea
              value={answers.workingOnNow}
              onChange={(event) => update('workingOnNow', event.target.value)}
              placeholder="Current focus…"
              rows={3}
              className="rounded-xl"
            />
          </QuestionBlock>

          <QuestionBlock number={3} title="Are you blocked?">
            <YesNoToggle value={answers.isBlocked} onChange={handleBlockedChange} />
            {answers.isBlocked === 'no' ? (
              <p className="mt-3 text-sm text-emerald-400">
                Great — blocker-related fields stay hidden.
              </p>
            ) : null}
          </QuestionBlock>

          <BlockerDetailsSection
            answers={answers}
            visible={showBlockerSection}
            onChange={(blocker) => update('blocker', blocker)}
          />

          <QuestionBlock number={4} title="Which Jira issue are you working on?">
            <JiraIssueCombobox
              value={answers.jiraIssueWorkingOn}
              onSelect={(issue) => update('jiraIssueWorkingOn', issue)}
              onClear={() => update('jiraIssueWorkingOn', null)}
            />
          </QuestionBlock>

          <QuestionBlock
            number={5}
            title="How confident are you about finishing today?"
          >
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((score) => (
                <button
                  key={score}
                  type="button"
                  onClick={() => update('confidence', score)}
                  className={cn(
                    'flex h-11 w-11 items-center justify-center rounded-xl border text-sm font-semibold transition-all duration-200',
                    answers.confidence === score
                      ? 'border-primary/40 bg-primary text-primary-foreground shadow-md shadow-primary/20'
                      : 'border-border/70 bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground',
                  )}
                >
                  {score}
                </button>
              ))}
            </div>
          </QuestionBlock>

          <QuestionBlock number={6} title="Estimated completion date?">
            <Input
              type="date"
              value={answers.estimatedCompletionDate}
              onChange={(event) => update('estimatedCompletionDate', event.target.value)}
              className="h-11 max-w-xs rounded-xl"
            />
          </QuestionBlock>

          <QuestionBlock number={7} title="Did anything slow you down today?">
            <Textarea
              value={answers.slowedDown}
              onChange={(event) => update('slowedDown', event.target.value)}
              placeholder="Optional — meetings, reviews, tooling, etc."
              rows={2}
              className="rounded-xl"
            />
          </QuestionBlock>

          <QuestionBlock number={8} title="Do you need help from someone?">
            <YesNoToggle
              value={answers.needHelp}
              onChange={(value) => update('needHelp', value)}
            />
            {answers.needHelp === 'yes' ? (
              <div className="mt-3 max-w-md">
                <Label className="mb-2 block text-xs text-muted-foreground">Who?</Label>
                <UserSearchSelect
                  value={answers.helpFrom}
                  onChange={(user) => update('helpFrom', user)}
                />
              </div>
            ) : null}
          </QuestionBlock>

          {showBlockerSection ? (
            <QuestionBlock
              number={9}
              title="Is this blocker linked to another Jira issue?"
            >
              <YesNoToggle
                value={answers.blockerLinkedToJira}
                onChange={(value) => update('blockerLinkedToJira', value)}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Use the Related Jira Issue field in Blocker Details to pick the issue.
              </p>
            </QuestionBlock>
          ) : null}

          <QuestionBlock number={10} title="Additional notes">
            <Textarea
              value={answers.additionalNotes}
              onChange={(event) => update('additionalNotes', event.target.value)}
              placeholder="Anything else the team should know…"
              rows={3}
              className="rounded-xl"
            />
          </QuestionBlock>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setAnswers(DEFAULT_STANDUP_ANSWERS);
            setSavedPreview(false);
          }}
        >
          <RotateCcw className="h-4 w-4" />
          Reset
        </Button>
        <div className="flex items-center gap-3">
          {savedPreview ? (
            <p className="flex items-center gap-1.5 text-sm text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              Form state saved locally (no backend submit)
            </p>
          ) : null}
          <Button type="submit" className="rounded-xl px-6 shadow-lg shadow-primary/20">
            Save Standup Draft
          </Button>
        </div>
      </div>
    </form>
  );
};

function QuestionBlock({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-border/60 bg-secondary/5 p-5 transition-colors hover:border-primary/20">
      <div className="flex items-start gap-3">
        <Badge variant="secondary" className="mt-0.5 shrink-0">
          Q{number}
        </Badge>
        <Label className="text-base font-medium leading-snug text-foreground">{title}</Label>
      </div>
      <div className="pl-0 sm:pl-12">{children}</div>
    </div>
  );
}

export default DailyStandupForm;
