import React, { createContext, useContext, useMemo, useState } from 'react';
import { LinkedIssueRow, LinkedStandupIssue } from '@/lib/jira-api';

type DrawerIssue = LinkedIssueRow & {
  timeline?: LinkedStandupIssue['timeline'];
};

type JiraHubContextValue = {
  drawerIssue: DrawerIssue | null;
  openDrawer: (issue: DrawerIssue) => void;
  closeDrawer: () => void;
  scrollToTimeline: () => void;
  timelineRef: React.RefObject<HTMLDivElement | null>;
};

const JiraHubContext = createContext<JiraHubContextValue | null>(null);

export const JiraHubProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [drawerIssue, setDrawerIssue] = useState<DrawerIssue | null>(null);
  const timelineRef = React.useRef<HTMLDivElement | null>(null);

  const value = useMemo(
    () => ({
      drawerIssue,
      openDrawer: setDrawerIssue,
      closeDrawer: () => setDrawerIssue(null),
      scrollToTimeline: () => {
        document.getElementById('standup-history')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      },
      timelineRef,
    }),
    [drawerIssue],
  );

  return <JiraHubContext.Provider value={value}>{children}</JiraHubContext.Provider>;
};

export function useJiraHub() {
  const context = useContext(JiraHubContext);
  if (!context) {
    throw new Error('useJiraHub must be used within JiraHubProvider');
  }
  return context;
}
