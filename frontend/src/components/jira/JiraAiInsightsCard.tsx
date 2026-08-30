import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { jiraApi, AiInsight } from '@/lib/jira-api';
import { INSIGHT_PRESENTATION } from './jira-ui.utils';

const DEFAULT_INSIGHT_TYPES = [
  'most_mentioned',
  'inactive_issue',
  'estimated_completion',
  'likely_blocked',
];

export const JiraAiInsightsCard: React.FC = () => {
  const [insights, setInsights] = useState<AiInsight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    jiraApi
      .getInsights()
      .then((res) => setInsights(res.insights))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const cards = useMemo(() => {
    const byType = new Map(insights.map((insight) => [insight.type, insight]));
    return DEFAULT_INSIGHT_TYPES.map((type) => ({
      type,
      insight: byType.get(type) ?? null,
      presentation: INSIGHT_PRESENTATION[type] || INSIGHT_PRESENTATION.likely_blocked,
    }));
  }, [insights]);

  return (
    <Card className="card-lift h-full border-border/80 shadow-lg shadow-black/10">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-fuchsia-400" />
          <CardTitle>AI Insights</CardTitle>
        </div>
        <CardDescription>Smart cards derived from real linked issue activity</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 px-6 pb-6 sm:grid-cols-2">
        {loading ? (
          <p className="col-span-full py-10 text-center text-sm text-muted-foreground">
            Computing insights…
          </p>
        ) : (
          cards.map(({ type, insight, presentation }) => (
            <div
              key={type}
              className={`rounded-xl border p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-card-hover ${presentation.accent}`}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {presentation.emoji} {presentation.title}
                </p>
                {insight?.issueKey ? (
                  <Badge variant="purple">{insight.issueKey}</Badge>
                ) : null}
              </div>
              {insight ? (
                <>
                  <p className="text-base font-semibold text-foreground">{insight.summary}</p>
                  <p className="mt-3 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    {insight.metric}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Not enough linked activity yet to generate this insight.
                </p>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
};

export default JiraAiInsightsCard;
