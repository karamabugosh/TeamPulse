import React from 'react';
import { MessageSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DailyStandupAnswers,
  formatExpectedResolutionLabel,
  resolveCategoryLabel,
} from './standup-form.types';

interface StandupSlackPreviewProps {
  answers: DailyStandupAnswers;
  userName?: string;
}

export const StandupSlackPreview: React.FC<StandupSlackPreviewProps> = ({
  answers,
  userName = 'Karam',
}) => {
  const blocker = answers.blocker;
  const issueKey =
    blocker.relatedIssue?.key ?? answers.jiraIssueWorkingOn?.key ?? '—';
  const severityLabel =
    blocker.severity.charAt(0).toUpperCase() + blocker.severity.slice(1);

  return (
    <div className="rounded-2xl border border-[#35373b] bg-[#1a1d21] p-5 shadow-lg shadow-black/20">
      <div className="mb-4 flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-[#36c5f0]" />
        <h4 className="text-sm font-semibold text-white">Slack Preview</h4>
        <Badge variant="secondary" className="ml-auto bg-[#36c5f0]/10 text-[#36c5f0]">
          What will be sent
        </Badge>
      </div>

      <div className="rounded-xl border border-[#35373b] bg-[#222529] p-4 text-sm text-[#d1d2d3]">
        <p className="text-base font-semibold text-white">✅ Blocker saved successfully</p>
        <div className="mt-4 space-y-2.5">
          <PreviewLine label="User" value={userName} />
          <PreviewLine label="Title" value={blocker.title.trim() || '—'} />
          <PreviewLine label="Severity" value={severityLabel} />
          <PreviewLine label="Category" value={resolveCategoryLabel(blocker)} />
          <PreviewLine
            label="Linked Jira Issue"
            value={issueKey}
          />
          <PreviewLine
            label="Blocking"
            value={blocker.preventingAllWork ? 'Yes' : 'No'}
          />
          {blocker.blockedByUser ? (
            <PreviewLine label="Owner" value={blocker.blockedByUser.name} />
          ) : null}
          {blocker.expectedResolution ? (
            <PreviewLine
              label="ETA"
              value={formatExpectedResolutionLabel(blocker.expectedResolution)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};

function PreviewLine({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="font-semibold text-white">{label}:</span>{' '}
      <span className="text-[#d1d2d3]">{value}</span>
    </p>
  );
}

export default StandupSlackPreview;
