export type StandupHistoryRecord = {
  id: string;
  userId: string;
  userName: string;
  userAvatar?: string | null;
  userInitials: string;
  date: string;
  standupName: string;
  checkInId?: string | null;
  yesterdayAnswer: string;
  todayAnswer: string;
  blockersAnswer: string;
  linkedJiraIssue: {
    key: string;
    summary: string;
    url: string;
  } | null;
  linkedIssueKeys?: string[];
  slackThreadUrl: string | null;
  runId: string;
  submissionId: string;
  hasBlocker: boolean;
  reportGeneratedAt: string | null;
  reportSummary?: string | null;
  issueLinkedAt: string | null;
};

export type StandupHistoryTimelineEvent = {
  id: string;
  recordId: string;
  type: 'standup_submitted' | 'issue_linked' | 'blocker_mentioned' | 'report_generated';
  title: string;
  description: string;
  timestamp: string;
  userName: string;
  standupName: string;
};

export type StandupHistoryFilterOption = {
  value: string;
  label: string;
};

export function buildStandupTimelineEvents(
  records: StandupHistoryRecord[],
): StandupHistoryTimelineEvent[] {
  const events: StandupHistoryTimelineEvent[] = [];

  for (const record of records) {
    events.push({
      id: `${record.id}-submitted`,
      recordId: record.id,
      type: 'standup_submitted',
      title: 'Standup Completed',
      description: `${record.userName} completed ${record.standupName}`,
      timestamp: record.date,
      userName: record.userName,
      standupName: record.standupName,
    });

    if (record.issueLinkedAt && record.linkedJiraIssue) {
      events.push({
        id: `${record.id}-linked`,
        recordId: record.id,
        type: 'issue_linked',
        title: 'Issue Linked',
        description: `${record.userName} linked ${record.linkedJiraIssue.key} · ${record.linkedJiraIssue.summary}`,
        timestamp: record.issueLinkedAt,
        userName: record.userName,
        standupName: record.standupName,
      });
    }

    if (record.hasBlocker) {
      events.push({
        id: `${record.id}-blocker`,
        recordId: record.id,
        type: 'blocker_mentioned',
        title: 'Blocker Reported',
        description: `${record.userName} reported a blocker in ${record.standupName}: ${record.blockersAnswer.slice(0, 140)}`,
        timestamp: record.date,
        userName: record.userName,
        standupName: record.standupName,
      });
    }

    if (record.reportGeneratedAt) {
      events.push({
        id: `${record.id}-report`,
        recordId: record.id,
        type: 'report_generated',
        title: 'AI Digest Generated',
        description: record.reportSummary
          ? `AI Digest generated for ${record.standupName}: ${record.reportSummary.slice(0, 140)}`
          : `AI Digest generated for ${record.standupName}`,
        timestamp: record.reportGeneratedAt,
        userName: record.userName,
        standupName: record.standupName,
      });
    }
  }

  return events.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}
