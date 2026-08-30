import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Download,
  FlaskConical,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react';
import { apiFetch, ApiError } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

type Dashboard = {
  workspaceId: string | null;
  totalQuestions: number;
  passed: number;
  failed: number;
  averageAccuracy: number;
  averageConfidence: number;
  averageResponseTimeMs: number;
  overallScore: number;
  latestRunId: string | null;
  caseCount: number;
  runs: number;
  passThreshold?: number;
};

type EvalRun = {
  id: string;
  label: string | null;
  status: string;
  totalQuestions: number;
  passed: number;
  failed: number;
  overallScore: number;
  averageAccuracy: number;
  averageConfidenceScore: number;
  averageResponseTimeMs: number;
  startedAt: string;
  finishedAt: string | null;
};

type EvalResult = {
  id: string;
  caseKey: string;
  category: string;
  question: string;
  expectedAnswer: string;
  aiAnswer: string;
  overallScore: number;
  passed: boolean;
  aiConfidence: string | null;
  responseTimeMs: number;
  hallucinationFlags: unknown;
  missingContext: unknown;
};

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

const AiEvaluationPage: React.FC = () => {
  const { workspaceId, activeWorkspace } = useWorkspace();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setDashboard(null);
      setRuns([]);
      setResults([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = `workspaceId=${encodeURIComponent(workspaceId)}`;
      const [dash, runList] = await Promise.all([
        apiFetch<Dashboard>(`/api/ai/eval/dashboard?${qs}`),
        apiFetch<{ runs: EvalRun[] }>(`/api/ai/eval/runs?${qs}&limit=10`),
      ]);
      setDashboard(dash);
      setRuns(runList.runs ?? []);
      const latest = dash.latestRunId || runList.runs?.[0]?.id || null;
      setSelectedRunId(latest);
      if (latest) {
        const detail = await apiFetch<{ results: EvalResult[] }>(
          `/api/ai/eval/runs/${encodeURIComponent(latest)}?${qs}`,
        );
        setResults(detail.results ?? []);
      } else {
        setResults([]);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load evaluation data.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const seedCases = async (preferDemo: boolean) => {
    if (!workspaceId && !preferDemo) return;
    setError(null);
    try {
      const result = await apiFetch<{
        upserted: number;
        workspaceName: string;
      }>('/api/ai/eval/cases/seed', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          preferDemo,
        }),
      });
      setNotice(
        `Seeded ${result.upserted} gold cases into ${result.workspaceName}`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Seed failed.');
    }
  };

  const runEval = async (preferDemo: boolean) => {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const run = await apiFetch<EvalRun & { results?: EvalResult[] }>(
        '/api/ai/eval/runs',
        {
          method: 'POST',
          body: JSON.stringify({
            workspaceId,
            preferDemo,
            seedIfEmpty: true,
            label: preferDemo ? 'Demo regression' : 'Workspace regression',
          }),
        },
      );
      setNotice(
        `Run complete · score ${run.overallScore}/100 · ${run.passed} passed / ${run.failed} failed`,
      );
      await refresh();
      setSelectedRunId(run.id);
      setResults(run.results ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Evaluation run failed.');
    } finally {
      setRunning(false);
    }
  };

  const openExport = (format: 'markdown' | 'csv' | 'pdf') => {
    if (!selectedRunId || !workspaceId) return;
    const url = `/api/ai/eval/runs/${encodeURIComponent(selectedRunId)}/export?workspaceId=${encodeURIComponent(workspaceId)}&format=${format}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 pb-10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">
            <FlaskConical className="h-3.5 w-3.5" />
            AI Evaluation Framework
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Evaluation Dashboard
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Measure AI Workspace answer quality against gold answers. Runs are
            workspace-isolated and do not change the live chat pipeline.
            {activeWorkspace ? ` Active: ${activeWorkspace.name}.` : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={running || loading}
            onClick={() => void seedCases(false)}
          >
            Seed cases
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={running || loading}
            onClick={() => void seedCases(true)}
          >
            Seed Demo
          </Button>
          <Button
            type="button"
            className="gap-1.5"
            disabled={running || loading || !workspaceId}
            onClick={() => void runEval(false)}
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run evaluation
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="gap-1.5"
            disabled={running || loading}
            onClick={() => void runEval(true)}
          >
            Run on Demo
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label="Total Questions"
          value={String(dashboard?.totalQuestions ?? 0)}
          hint={`${dashboard?.caseCount ?? 0} gold cases seeded`}
        />
        <Stat label="Passed" value={String(dashboard?.passed ?? 0)} />
        <Stat label="Failed" value={String(dashboard?.failed ?? 0)} />
        <Stat
          label="Average Accuracy"
          value={`${Math.round(dashboard?.averageAccuracy ?? 0)}`}
        />
        <Stat
          label="Average Confidence"
          value={`${Math.round(dashboard?.averageConfidence ?? 0)}`}
        />
        <Stat
          label="Avg Response Time"
          value={`${Math.round(dashboard?.averageResponseTimeMs ?? 0)} ms`}
          hint={`Overall ${Math.round(dashboard?.overallScore ?? 0)}/100`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent runs</CardTitle>
            <CardDescription>Regression history for this workspace</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No runs yet. Seed cases and run an evaluation.
              </p>
            ) : (
              runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    selectedRunId === run.id
                      ? 'border-violet-500/40 bg-violet-500/10'
                      : 'border-white/10 hover:bg-white/[0.04]'
                  }`}
                  onClick={() => {
                    setSelectedRunId(run.id);
                    void (async () => {
                      if (!workspaceId) return;
                      const detail = await apiFetch<{ results: EvalResult[] }>(
                        `/api/ai/eval/runs/${encodeURIComponent(run.id)}?workspaceId=${encodeURIComponent(workspaceId)}`,
                      );
                      setResults(detail.results ?? []);
                    })();
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {run.label || run.id.slice(0, 8)}
                    </span>
                    <Badge variant="secondary">{Math.round(run.overallScore)}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {run.passed}/{run.totalQuestions} passed ·{' '}
                    {new Date(run.startedAt).toLocaleString()}
                  </p>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Run details</CardTitle>
                <CardDescription>
                  Question · expected · AI answer · score
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={!selectedRunId}
                  onClick={() => openExport('markdown')}
                >
                  <Download className="h-3.5 w-3.5" />
                  Markdown
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={!selectedRunId}
                  onClick={() => openExport('csv')}
                >
                  <Download className="h-3.5 w-3.5" />
                  CSV
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={!selectedRunId}
                  onClick={() => openExport('pdf')}
                >
                  <Download className="h-3.5 w-3.5" />
                  PDF
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {results.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <ClipboardList className="h-4 w-4" />
                Select a run to inspect results.
              </p>
            ) : (
              results.map((result) => (
                <div
                  key={result.id}
                  className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {result.passed ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-400" />
                    )}
                    <p className="text-sm font-medium text-foreground">
                      {result.caseKey}
                    </p>
                    <Badge variant="secondary">{result.category}</Badge>
                    <Badge variant={result.passed ? 'success' : 'destructive'}>
                      {Math.round(result.overallScore)}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {result.responseTimeMs} ms
                      {result.aiConfidence
                        ? ` · ${result.aiConfidence}`
                        : ''}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-foreground/90">
                    <span className="text-muted-foreground">Q:</span>{' '}
                    {result.question}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Expected: {result.expectedAnswer.slice(0, 220)}
                    {result.expectedAnswer.length > 220 ? '…' : ''}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/85">
                    {result.aiAnswer.slice(0, 500)}
                    {result.aiAnswer.length > 500 ? '…' : ''}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AiEvaluationPage;
