import React from 'react';
import { JiraIssueSummary } from '@/lib/jira-api';
import { JiraIssueCombobox } from './JiraIssueCombobox';

interface JiraLinkIssueFieldProps {
  value?: JiraIssueSummary | null;
  onSelect: (issue: JiraIssueSummary) => void;
  onClear?: () => void;
  disabled?: boolean;
  helperText?: string;
  className?: string;
}

export const JiraLinkIssueField: React.FC<JiraLinkIssueFieldProps> = ({
  value,
  onSelect,
  onClear,
  disabled = false,
  helperText = '',
  className,
}) => (
  <div className={className}>
    <p className="mb-2 text-sm font-semibold text-foreground">🔗 Link Jira Issue</p>
    <JiraIssueCombobox
      value={value}
      onSelect={onSelect}
      onClear={onClear}
      disabled={disabled}
    />
    {helperText ? (
      <p className="mt-2 text-xs text-muted-foreground">{helperText}</p>
    ) : null}
  </div>
);

export default JiraLinkIssueField;
