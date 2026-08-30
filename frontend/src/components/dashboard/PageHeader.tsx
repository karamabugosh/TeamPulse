import React from 'react';
import { cn } from '@/lib/utils';

type ModuleAccent = 'ai' | 'jira' | 'slack' | 'reports' | 'blockers' | 'default';

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
  accent?: ModuleAccent;
  badge?: React.ReactNode;
}

const ACCENT_BAR: Record<ModuleAccent, string> = {
  default: 'from-primary/60 to-primary/0',
  ai: 'from-module-ai/70 to-module-ai/0',
  jira: 'from-module-jira/70 to-module-jira/0',
  slack: 'from-module-slack/70 to-module-slack/0',
  reports: 'from-module-reports/70 to-module-reports/0',
  blockers: 'from-module-blockers/70 to-module-blockers/0',
};

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  children,
  className,
  accent = 'default',
  badge,
}) => {
  return (
    <div
      className={cn(
        'relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="space-y-2.5">
        {badge ? <div className="mb-1">{badge}</div> : null}
        <div className="relative">
          <span
            aria-hidden
            className={cn(
              'absolute -left-3 top-1.5 hidden h-6 w-0.5 rounded-full bg-gradient-to-b sm:block',
              ACCENT_BAR[accent],
            )}
          />
          <h1 className="text-page-title text-foreground">{title}</h1>
        </div>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
            {description}
          </p>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 flex-wrap items-center gap-3">{children}</div>
      ) : null}
    </div>
  );
};

export default PageHeader;
