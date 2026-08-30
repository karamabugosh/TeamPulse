import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  AiPipelineTrace,
  PipelineHealth,
  PipelineStageStatus,
  PipelineStageTrace,
} from './ai-pipeline-trace.types';

type AiPipelineTracePanelProps = {
  trace: AiPipelineTrace;
};

const STATUS_SYMBOL: Record<PipelineStageStatus, string> = {
  PENDING: '○',
  RUNNING: '◉',
  SUCCESS: '✓',
  WARNING: '⚠',
  FAILED: '✕',
  SKIPPED: '—',
};

function statusVariant(
  status: PipelineStageStatus,
): 'success' | 'warning' | 'destructive' | 'secondary' | 'cyan' {
  switch (status) {
    case 'SUCCESS':
      return 'success';
    case 'WARNING':
      return 'warning';
    case 'FAILED':
      return 'destructive';
    case 'RUNNING':
      return 'cyan';
    case 'SKIPPED':
    case 'PENDING':
    default:
      return 'secondary';
  }
}

function healthLabel(health: PipelineHealth): string {
  switch (health) {
    case 'ALL_STAGES_PASSED':
      return 'All stages passed';
    case 'PARTIAL_SUCCESS':
      return 'Completed with warnings';
    case 'FALLBACK_USED':
      return 'Fallback — API/source failure';
    case 'FAILED':
      return 'Pipeline failure';
    default:
      return health;
  }
}

function healthBadgeVariant(
  health: PipelineHealth,
): 'success' | 'warning' | 'destructive' {
  if (health === 'ALL_STAGES_PASSED') return 'success';
  if (health === 'FAILED') return 'destructive';
  if (health === 'FALLBACK_USED') return 'warning';
  return 'warning';
}

function formatMs(ms?: number): string {
  if (ms == null) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms} ms`;
}

function StageDetail({ stage }: { stage: PipelineStageTrace }) {
  const meta = stage.metadata ?? {};
  const entries = Object.entries(meta).filter(
    ([, v]) => v !== null && v !== undefined && v !== '',
  );

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-white/[0.08] bg-black/20 p-3 text-[11px]">
      <p className="font-semibold uppercase tracking-wide text-muted-foreground">
        {stage.label}
      </p>
      <dl className="grid gap-1.5 sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground/80">Status</dt>
          <dd>{stage.status}</dd>
        </div>
        {stage.durationMs != null ? (
          <div>
            <dt className="text-muted-foreground/80">Duration</dt>
            <dd>{formatMs(stage.durationMs)}</dd>
          </div>
        ) : null}
        {stage.summary ? (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground/80">Summary</dt>
            <dd>{stage.summary}</dd>
          </div>
        ) : null}
      </dl>
      {entries.length > 0 ? (
        <div className="space-y-1 border-t border-white/[0.06] pt-2">
          {entries.map(([key, value]) => (
            <div key={key} className="flex flex-wrap gap-x-2">
              <span className="text-muted-foreground/70">{key}:</span>
              <span className="break-all font-mono text-foreground/90">
                {typeof value === 'object'
                  ? JSON.stringify(value)
                  : String(value)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const AiPipelineTracePanel: React.FC<AiPipelineTracePanelProps> = ({
  trace,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selectedStage = useMemo(
    () => trace.stages.find((s) => s.key === selectedKey) ?? null,
    [trace.stages, selectedKey],
  );

  if (!trace.visible) return null;

  return (
    <div
      className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.02]"
      data-ai-pipeline-trace
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          View AI Trace
        </Button>
        <Badge variant={healthBadgeVariant(trace.pipelineHealth)}>
          {healthLabel(trace.pipelineHealth)}
        </Badge>
        <span className="text-[10px] font-mono text-muted-foreground">
          Trace #{trace.requestId}
        </span>
        {trace.totalDurationMs != null ? (
          <span className="ml-auto text-[10px] text-muted-foreground">
            Total {formatMs(trace.totalDurationMs)}
          </span>
        ) : null}
      </div>

      {expanded ? (
        <div className="space-y-3 p-3">
          {trace.warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100">
              {trace.warnings.map((w) => (
                <p key={w}>{w}</p>
              ))}
            </div>
          ) : null}

          <div className="overflow-x-auto pb-1">
            <div className="flex min-w-max items-start gap-1">
              {trace.stages.map((stage, index) => (
                <React.Fragment key={stage.key}>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedKey((k) =>
                        k === stage.key ? null : stage.key,
                      )
                    }
                    className={cn(
                      'flex min-w-[5.5rem] flex-col items-center rounded-lg border px-2 py-2 text-center transition-colors',
                      selectedKey === stage.key
                        ? 'border-cyan-400/40 bg-cyan-400/10'
                        : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]',
                    )}
                  >
                    <Badge
                      variant={statusVariant(stage.status)}
                      className="mb-1 h-5 min-w-[1.5rem] justify-center px-1 text-[10px]"
                    >
                      {STATUS_SYMBOL[stage.status]}
                    </Badge>
                    <span className="text-[10px] font-medium leading-tight text-foreground">
                      {stage.label.replace('Retrieval Policy', 'Policy').replace('Identity / ACL', 'ACL').replace('Temporal Scope', 'Temporal').replace('Evidence Merge', 'Merge').replace('Legacy Retrieval', 'Legacy')}
                    </span>
                    {stage.durationMs != null ? (
                      <span className="mt-0.5 text-[9px] text-muted-foreground">
                        {formatMs(stage.durationMs)}
                      </span>
                    ) : null}
                  </button>
                  {index < trace.stages.length - 1 ? (
                    <span
                      className="mt-5 text-muted-foreground/50"
                      aria-hidden
                    >
                      →
                    </span>
                  ) : null}
                </React.Fragment>
              ))}
            </div>
          </div>

          {selectedStage ? <StageDetail stage={selectedStage} /> : null}

          <div className="border-t border-white/[0.06] pt-2 text-[10px] text-muted-foreground">
            <p className="font-medium uppercase tracking-wide">Timings</p>
            <div className="mt-1 grid gap-0.5 sm:grid-cols-2 lg:grid-cols-3">
              {trace.stages
                .filter((s) => s.durationMs != null && s.durationMs > 0)
                .map((s) => (
                  <div key={`t-${s.key}`} className="flex justify-between gap-2 pr-4">
                    <span>{s.label}</span>
                    <span className="font-mono">{formatMs(s.durationMs)}</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AiPipelineTracePanel;
