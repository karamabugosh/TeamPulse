import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DashboardBlocker, initialsFromName } from './blockers.types';

interface BlockerReporterAvatarsProps {
  blocker: DashboardBlocker;
}

/** Single-reporter avatar from real Slack user data. */
export const BlockerReporterAvatars: React.FC<BlockerReporterAvatarsProps> = ({
  blocker,
}) => {
  const name = blocker.slackDisplayName || blocker.reporter;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Avatar className="h-8 w-8 border-2 border-background">
        {blocker.slackAvatarUrl ? (
          <AvatarImage src={blocker.slackAvatarUrl} alt={name} />
        ) : null}
        <AvatarFallback className="text-xs">{initialsFromName(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{name}</p>
      </div>
    </div>
  );
};

export default BlockerReporterAvatars;
