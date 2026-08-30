import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  STATUS_COLORS,
  STATUS_LABELS,
  bucketStatus,
} from './jira-ui.utils';

interface JiraIssueStatusBadgeProps {
  status: string | null | undefined;
  className?: string;
}

function reviewLike(status: string | null | undefined): boolean {
  const normalized = (status ?? '').toLowerCase();
  return normalized.includes('review') || normalized.includes('qa');
}

function criticalLike(status: string | null | undefined): boolean {
  const normalized = (status ?? '').toLowerCase();
  return normalized.includes('critical') || normalized.includes('sev');
}

export const JiraIssueStatusBadge: React.FC<JiraIssueStatusBadgeProps> = ({
  status,
  className,
}) => {
  const bucket = bucketStatus(status);
  const label = status?.trim() || STATUS_LABELS[bucket];
  const isReview = reviewLike(status);
  const isCritical = criticalLike(status);

  return (
    <Badge
      variant="outline"
      className={cn(
        'mt-2 rounded-full px-2.5 py-0.5 font-medium',
        isCritical
          ? 'border-red-500/35 bg-red-500/15 text-red-400'
          : isReview
            ? 'border-cyan-500/35 bg-cyan-500/15 text-cyan-300'
            : STATUS_COLORS[bucket],
        className,
      )}
    >
      {label}
    </Badge>
  );
};

export default JiraIssueStatusBadge;
