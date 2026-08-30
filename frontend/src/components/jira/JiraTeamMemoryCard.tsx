import React, { useState } from 'react';
import { Brain, Search, FileText, MessageSquare, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { jiraApi, TeamMemoryResult } from '@/lib/jira-api';
import { formatHubDate } from './jira-ui.utils';

const SUGGESTIONS = [
  'Who worked on OAuth?',
  'Show blocker history',
  'Summarize yesterday',
  'Generate sprint report',
];

export const JiraTeamMemoryCard: React.FC = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TeamMemoryResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (nextQuery?: string) => {
    const value = (nextQuery ?? query).trim();
    if (!value) return;
    setQuery(value);
    setLoading(true);
    setSearched(true);
    try {
      const response = await jiraApi.searchMemory(value);
      setResults(response.results);
    } catch (error) {
      console.error(error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="card-lift border-module-ai/15 bg-gradient-to-br from-card via-card to-module-ai/6 shadow-card">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <CardTitle>Team Memory</CardTitle>
        </div>
        <CardDescription>
          AI search across standups, linked issues, reports, and AI summaries
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 px-6 pb-8">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 backdrop-blur-md">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Sparkles className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Ask team memory anything…"
                className="h-12 rounded-xl border-white/10 bg-background/60 pl-10 text-base"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleSearch();
                  }
                }}
              />
            </div>
            <Button
              className="h-12 px-5"
              onClick={() => void handleSearch()}
              disabled={loading || !query.trim()}
            >
              <Search className="h-4 w-4" />
              Search
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void handleSearch(suggestion)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-muted-foreground transition-all duration-250 hover:border-primary/30 hover:bg-primary/10 hover:text-foreground"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Searching team memory…</p>
        ) : searched && results.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matching memory entries yet.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {results.map((result) => (
              <div
                key={result.id}
                className="rounded-2xl border border-border/80 bg-secondary/10 p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-lg hover:shadow-primary/5"
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{result.sourceType.replace('_', ' ')}</Badge>
                  {result.issueKey ? <Badge variant="outline">{result.issueKey}</Badge> : null}
                  <span className="text-xs text-muted-foreground">
                    {formatHubDate(result.indexedAt)}
                  </span>
                </div>
                <p className="font-semibold">{result.title}</p>
                <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{result.excerpt}</p>

                <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <p>Summary: {result.title}</p>
                  <p>Issue: {result.issueKey || '—'}</p>
                  <p>Standup: {result.runId ? 'Available' : '—'}</p>
                  <p className="flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    AI Summary: {result.sourceType === 'ai_summary' ? 'Yes' : 'Related'}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {result.runId ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/reports/run/${result.runId}`}>
                        <FileText className="h-3.5 w-3.5" />
                        View Report
                      </Link>
                    </Button>
                  ) : null}
                  {result.submissionId ? (
                    <Button size="sm" variant="ghost" disabled title="Slack thread link requires run context">
                      <MessageSquare className="h-3.5 w-3.5" />
                      Open Thread
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default JiraTeamMemoryCard;
