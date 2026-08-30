import React from 'react';
import { DashboardBlocker } from './blockers.types';

/**
 * Future OpenAI slot.
 * Renders nothing until the backend returns real AI fields.
 * Do not invent summaries, root causes, or confidence scores here.
 */
export const BlockerAiPlaceholders: React.FC<{ blocker: DashboardBlocker }> = ({
  blocker,
}) => {
  const hasAi =
    Boolean(blocker.aiSummary) ||
    Boolean(blocker.aiRootCause) ||
    Boolean(blocker.aiRecommendation) ||
    Boolean(blocker.aiPriority);

  if (!hasAi) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-border/60 bg-secondary/10 p-4">
      <p className="text-sm font-semibold">AI Insights</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {blocker.aiSummary ? (
          <InsightTile label="Summary" value={blocker.aiSummary} />
        ) : null}
        {blocker.aiRootCause ? (
          <InsightTile label="Root Cause" value={blocker.aiRootCause} />
        ) : null}
        {blocker.aiRecommendation ? (
          <InsightTile label="Recommendation" value={blocker.aiRecommendation} />
        ) : null}
        {blocker.aiPriority ? (
          <InsightTile label="Suggested Priority" value={blocker.aiPriority} />
        ) : null}
      </div>
    </section>
  );
};

function InsightTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-foreground">{value}</p>
    </div>
  );
}

export default BlockerAiPlaceholders;
