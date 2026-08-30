import { JiraIssueSummary } from '@/lib/jira-api';

export type BlockedAnswer = 'yes' | 'no' | null;

export type BlockerSeverity = 'low' | 'medium' | 'high' | 'critical';

export type BlockerCategory =
  | 'Backend'
  | 'Frontend'
  | 'API'
  | 'Authentication'
  | 'Database'
  | 'QA'
  | 'DevOps'
  | 'Infrastructure'
  | 'Design'
  | 'Deployment'
  | 'Review'
  | 'Testing'
  | 'Documentation'
  | 'Other';

export type StandupUserOption = {
  id: string;
  name: string;
  initials: string;
};

export type BlockerDetailsState = {
  title: string;
  description: string;
  category: BlockerCategory | '';
  categoryOther: string;
  severity: BlockerSeverity;
  preventingAllWork: boolean;
  canContinueOtherTask: BlockedAnswer;
  blockedByUser: StandupUserOption | null;
  relatedIssue: JiraIssueSummary | null;
  expectedResolution: string;
  attachmentName: string | null;
};

export type DailyStandupAnswers = {
  completedSinceLast: string;
  workingOnNow: string;
  isBlocked: BlockedAnswer;
  jiraIssueWorkingOn: JiraIssueSummary | null;
  confidence: number | null;
  estimatedCompletionDate: string;
  slowedDown: string;
  needHelp: BlockedAnswer;
  helpFrom: StandupUserOption | null;
  blockerLinkedToJira: BlockedAnswer;
  additionalNotes: string;
  blocker: BlockerDetailsState;
};

export const BLOCKER_CATEGORIES: BlockerCategory[] = [
  'Backend',
  'Frontend',
  'API',
  'Authentication',
  'Database',
  'QA',
  'DevOps',
  'Infrastructure',
  'Design',
  'Deployment',
  'Review',
  'Testing',
  'Documentation',
  'Other',
];

export const SEVERITY_OPTIONS: Array<{
  value: BlockerSeverity;
  label: string;
  badgeClass: string;
  selectedClass: string;
}> = [
  {
    value: 'low',
    label: 'Low',
    badgeClass: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400',
    selectedClass: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300',
  },
  {
    value: 'medium',
    label: 'Medium',
    badgeClass: 'border-amber-500/30 bg-amber-500/15 text-amber-400',
    selectedClass: 'border-amber-500/50 bg-amber-500/15 text-amber-300',
  },
  {
    value: 'high',
    label: 'High',
    badgeClass: 'border-orange-500/30 bg-orange-500/15 text-orange-400',
    selectedClass: 'border-orange-500/50 bg-orange-500/15 text-orange-300',
  },
  {
    value: 'critical',
    label: 'Critical',
    badgeClass: 'border-red-500/30 bg-red-500/15 text-red-400',
    selectedClass: 'border-red-500/50 bg-red-500/15 text-red-300',
  },
];

export const MOCK_STANDUP_USERS: StandupUserOption[] = [
  { id: 'team-backend', name: 'Backend Team', initials: 'BE' },
  { id: 'team-frontend', name: 'Frontend Team', initials: 'FE' },
  { id: 'team-qa', name: 'QA', initials: 'QA' },
  { id: 'team-devops', name: 'DevOps', initials: 'DO' },
  { id: 'u-ahmad', name: 'Ahmad', initials: 'AH' },
  { id: 'u-lina', name: 'Lina', initials: 'LA' },
  { id: 'u-mohammad', name: 'Mohammad', initials: 'MO' },
  { id: 'u-karam', name: 'Karam Waleed', initials: 'KW' },
  { id: 'u-sarah', name: 'Sarah Chen', initials: 'SC' },
];

export const DEFAULT_BLOCKER_DETAILS: BlockerDetailsState = {
  title: '',
  description: '',
  category: '',
  categoryOther: '',
  severity: 'medium',
  preventingAllWork: false,
  canContinueOtherTask: null,
  blockedByUser: null,
  relatedIssue: null,
  expectedResolution: '',
  attachmentName: null,
};

export const DEFAULT_STANDUP_ANSWERS: DailyStandupAnswers = {
  completedSinceLast: '',
  workingOnNow: '',
  isBlocked: null,
  jiraIssueWorkingOn: null,
  confidence: null,
  estimatedCompletionDate: '',
  slowedDown: '',
  needHelp: null,
  helpFrom: null,
  blockerLinkedToJira: null,
  additionalNotes: '',
  blocker: { ...DEFAULT_BLOCKER_DETAILS },
};

export function formatExpectedResolutionLabel(value: string): string {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.getTime() === today.getTime()) return 'Today';
  if (date.getTime() === tomorrow.getTime()) return 'Tomorrow';

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function resolveCategoryLabel(blocker: BlockerDetailsState): string {
  if (blocker.category === 'Other' && blocker.categoryOther.trim()) {
    return blocker.categoryOther.trim();
  }
  return blocker.category || '—';
}
