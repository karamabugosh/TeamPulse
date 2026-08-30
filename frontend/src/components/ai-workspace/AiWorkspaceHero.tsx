import React from 'react';
import { Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export const AiWorkspaceHero: React.FC = () => (
  <header className="relative mx-auto max-w-3xl px-4 pt-2 text-center sm:pt-4">
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-0 h-32 w-[min(100%,28rem)] -translate-x-1/2 rounded-full bg-gradient-to-r from-module-ai/20 via-fuchsia-500/10 to-cyan-400/10 blur-3xl"
    />
    <div className="relative space-y-3 animate-fade-in">
      <Badge variant="ai" className="mx-auto gap-1.5">
        <Sparkles className="h-3 w-3" />
        Grounded AI
      </Badge>
      <h1 className="bg-gradient-to-b from-white via-white to-white/65 bg-clip-text text-3xl font-semibold tracking-tight text-transparent sm:text-4xl">
        AI Workspace
      </h1>
      <p className="mx-auto max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
        Ask questions about your Slack standups, Jira issues, blockers, reports, and team activity.
      </p>
    </div>
  </header>
);

export default AiWorkspaceHero;
