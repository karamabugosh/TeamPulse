import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { JiraConnectionCard } from '@/components/jira/JiraConnectionCard';
import { JiraProjectsCard } from '@/components/jira/JiraProjectsCard';
import { JiraBlockersCard } from '@/components/jira/JiraBlockersCard';
import { JiraStandupHistorySection } from '@/components/jira/JiraStandupHistorySection';
import { JiraAiInsightsCard } from '@/components/jira/JiraAiInsightsCard';
import { JiraTeamMemoryCard } from '@/components/jira/JiraTeamMemoryCard';
import { JiraRecentActivityCard } from '@/components/jira/JiraRecentActivityCard';
import { JiraIssueDrawer } from '@/components/jira/JiraIssueDrawer';
import { JiraHubProvider, useJiraHub } from '@/components/jira/JiraHubContext';
import { JiraConnectionStatus } from '@/lib/jira-api';

const JiraHubDeepLink: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { openDrawer } = useJiraHub();
  const issueKey = searchParams.get('issue');

  useEffect(() => {
    if (!issueKey?.trim()) return;
    const key = issueKey.trim().toUpperCase();
    openDrawer({
      id: key,
      issueKey: key,
      summary: key,
      status: null,
      issueUrl: null,
      linkedCheckIn: '',
      linkedBy: '',
      linkedAt: new Date().toISOString(),
      submissionId: '',
      runId: null,
    });
  }, [issueKey, openDrawer]);

  return null;
};

const JiraHubPage: React.FC = () => {
  const [connection, setConnection] = useState<JiraConnectionStatus | null>(null);
  const connected = Boolean(connection?.connected);

  return (
    <JiraHubProvider>
      <JiraHubDeepLink />
      <div className="space-y-10 pb-12 animate-fade-in accent-jira">
        <PageHeader
          title="Jira Hub"
          description="Connect Jira, track blockers, browse projects, and explore linked standup history."
          accent="jira"
          badge={
            <span className="inline-flex items-center rounded-full border border-[#6366F1]/30 bg-[#4F46E5]/15 px-2.5 py-0.5 text-xs font-medium text-[#60A5FA]">
              Atlassian
            </span>
          }
        />

        <JiraConnectionCard onStatusChange={setConnection} />

        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <JiraBlockersCard />
          <JiraAiInsightsCard />
        </div>

        <JiraProjectsCard connected={connected} />

        <JiraRecentActivityCard connected={connected} />

        <JiraStandupHistorySection />

        <JiraTeamMemoryCard />
      </div>

      <JiraIssueDrawer />
    </JiraHubProvider>
  );
};

export default JiraHubPage;
