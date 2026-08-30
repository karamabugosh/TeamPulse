import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Button } from '@/components/ui/button';
import { DailyStandupForm } from '@/components/standup/DailyStandupForm';

const DailyStandupPage: React.FC = () => (
  <div className="mx-auto max-w-4xl space-y-8 pb-12">
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/checkins">
          <ArrowLeft className="h-4 w-4" />
          Back to CheckIns
        </Link>
      </Button>
    </div>

    <PageHeader
      title="Daily Standup Form"
      description="Interactive standup answers with a smart, conditional Blocker Details workflow. UI only — nothing is sent to Slack or Jira."
      accent="slack"
    />

    <DailyStandupForm userName="Karam" />
  </div>
);

export default DailyStandupPage;
