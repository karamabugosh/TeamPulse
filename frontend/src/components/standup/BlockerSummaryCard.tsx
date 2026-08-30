import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  BlockerDetailsState,
  SEVERITY_OPTIONS,
  formatExpectedResolutionLabel,
  resolveCategoryLabel,
} from './standup-form.types';

interface BlockerSummaryCardProps {
  blocker: BlockerDetailsState;
  className?: string;
}

export const BlockerSummaryCard: React.FC<BlockerSummaryCardProps> = ({
  blocker,
  className,
}) => {
  const severity = SEVERITY_OPTIONS.find((option) => option.value === blocker.severity);
  const categoryLabel = resolveCategoryLabel(blocker);

  return (
    <div
      className={cn(
        'rounded-2xl border p-5 transition-all duration-300',
        blocker.preventingAllWork
          ? 'border-red-500/40 bg-red-500/5 shadow-lg shadow-red-500/5'
          : 'border-border/70 bg-secondary/10',
        className,
      )}
    >
      <div className="mb-4 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-400" />
        <h4 className="text-sm font-semibold">🚨 Blocker Summary</h4>
        {blocker.preventingAllWork ? (
          <Badge variant="destructive" className="ml-auto">
            Blocking
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryRow label="Title" value={blocker.title.trim() || '—'} />
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Severity</p>
          <div className="mt-1">
            <span
              className={cn(
                'inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                severity?.badgeClass,
              )}
            >
              {severity?.label ?? '—'}
            </span>
          </div>
        </div>
        <SummaryRow label="Category" value={categoryLabel} />
        <SummaryRow
          label="Blocking"
          value={blocker.preventingAllWork ? 'Yes' : 'No'}
        />
        <SummaryRow
          label="Owner"
          value={blocker.blockedByUser?.name ?? '—'}
        />
        <SummaryRow
          label="Jira"
          value={blocker.relatedIssue?.key ?? '—'}
        />
        <SummaryRow
          label="ETA"
          value={formatExpectedResolutionLabel(blocker.expectedResolution)}
        />
        <SummaryRow
          label="Continue other task"
          value={
            blocker.canContinueOtherTask === 'yes'
              ? 'Yes'
              : blocker.canContinueOtherTask === 'no'
                ? 'No'
                : '—'
          }
        />
      </div>
    </div>
  );
};

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

export default BlockerSummaryCard;
