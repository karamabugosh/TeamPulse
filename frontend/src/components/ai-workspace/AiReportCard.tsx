import React, { useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Check,
  Building2,
  Clock,
  MessageSquare,
  Search,
  Shield,
  Sparkles,
  TreePalm,
  UserRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { GeneratedWorkspaceReport } from './ai-workspace.types';
import {
  downloadReportCsv,
  downloadReportMarkdown,
  downloadReportPdf,
  parseReportSectionMarkdown,
  reportToPlainText,
} from './report-display.util';
import {
  SendToSlackDialog,
  type SlackSendPayload,
} from './SendToSlackDialog';

interface AiReportCardProps {
  report: GeneratedWorkspaceReport;
  stickyActions?: boolean;
}

function confidenceVariant(confidence: GeneratedWorkspaceReport['confidence']) {
  if (confidence === 'High') return 'success' as const;
  if (confidence === 'Medium') return 'warning' as const;
  return 'secondary' as const;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

const SECTION_ICONS: Record<string, React.ReactNode> = {
  participation: <Building2 className="h-4 w-4 text-cyan-300" />,
  team_activity: <Building2 className="h-4 w-4 text-cyan-300" />,
  completed_work: <Check className="h-4 w-4 text-emerald-300" />,
  jira_progress: <Sparkles className="h-4 w-4 text-violet-300" />,
  jira_updates: <Sparkles className="h-4 w-4 text-violet-300" />,
  blockers: <AlertTriangle className="h-4 w-4 text-amber-300" />,
  new_blockers: <AlertTriangle className="h-4 w-4 text-amber-300" />,
  resolved_blockers: <Check className="h-4 w-4 text-emerald-300" />,
  discussions: <MessageSquare className="h-4 w-4 text-sky-300" />,
  attention: <AlertTriangle className="h-4 w-4 text-red-300" />,
  mentions: <UserRound className="h-4 w-4 text-cyan-300" />,
  risks: <AlertTriangle className="h-4 w-4 text-red-300" />,
  ai_summary: <Sparkles className="h-4 w-4 text-fuchsia-300" />,
  recommendations: <Sparkles className="h-4 w-4 text-sky-300" />,
  weekly_trends: <Clock className="h-4 w-4 text-cyan-300" />,
  highlights: <Sparkles className="h-4 w-4 text-violet-300" />,
  sprint_progress: <Sparkles className="h-4 w-4 text-violet-300" />,
  empty: <TreePalm className="h-4 w-4 text-emerald-300" />,
  focus: <Search className="h-4 w-4 text-cyan-300" />,
  timeline: <Clock className="h-4 w-4 text-sky-300" />,
  patterns: <Sparkles className="h-4 w-4 text-violet-300" />,
  root_causes: <AlertTriangle className="h-4 w-4 text-amber-300" />,
  decisions: <Search className="h-4 w-4 text-violet-300" />,
  ai_conclusion: <Sparkles className="h-4 w-4 text-fuchsia-300" />,
  confidence: <Shield className="h-4 w-4 text-emerald-300" />,
  sources: <Building2 className="h-4 w-4 text-cyan-300" />,
  insufficient: <AlertTriangle className="h-4 w-4 text-amber-300" />,
};

/**
 * Renders a grounded workspace report as structured UI (no raw markdown).
 * Action bar sits above the report body and can stick while scrolling.
 */
export const AiReportCard: React.FC<AiReportCardProps> = ({
  report,
  stickyActions = true,
}) => {
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [slackOpen, setSlackOpen] = useState(false);
  const [slackPayload, setSlackPayload] = useState<SlackSendPayload | null>(
    null,
  );

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 4000);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(reportToPlainText(report));
      setCopied(true);
      showNotice('Copied clean report text');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showNotice('Copy failed');
    }
  };

  const handleExportMarkdown = () => {
    downloadReportMarkdown(report);
    showNotice('Markdown downloaded');
  };

  const handleExportCsv = () => {
    downloadReportCsv(report);
    showNotice('CSV downloaded');
  };

  const handleExportPdf = () => {
    downloadReportPdf(report);
    showNotice('PDF print dialog opened');
  };

  const handleSendToSlack = () => {
    const recommendation = report.sections.find(
      (section) =>
        section.id === 'recommendations' ||
        section.id === 'ai_conclusion' ||
        /recommend/i.test(section.title),
    )?.markdown;

    setSlackPayload({
      contentType: 'report',
      title: report.title,
      body: reportToPlainText(report),
      confidence: report.confidence,
      sources: report.sourcesUsed.map((label) => ({ label })),
      recommendation: recommendation ?? null,
      reportType: report.reportType,
      report,
    });
    setSlackOpen(true);
  };

  return (
    <div className="w-full space-y-3" data-ai-report>
      <div
        className={
          stickyActions
            ? 'sticky top-[4.75rem] z-10 rounded-xl border border-white/10 bg-background/90 p-3 shadow-card backdrop-blur-md'
            : 'rounded-xl border border-white/10 bg-white/[0.03] p-3'
        }
        data-ai-report-actions
      >
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-9 gap-1.5"
            onClick={() => void handleCopy()}
          >
            <span aria-hidden>{copied ? '✅' : '📋'}</span>
            Copy
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-9 gap-1.5"
            onClick={handleExportPdf}
          >
            <span aria-hidden>📄</span>
            Export PDF
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-9 gap-1.5"
            onClick={handleExportCsv}
          >
            <span aria-hidden>📊</span>
            Export CSV
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-9 gap-1.5"
            onClick={handleExportMarkdown}
          >
            <span aria-hidden>📝</span>
            Export Markdown
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-9 gap-1.5"
            onClick={handleSendToSlack}
          >
            <span aria-hidden>📨</span>
            Send to Slack
          </Button>
        </div>
        {notice ? (
          <p className="mt-2 text-[11px] text-cyan-200/80">{notice}</p>
        ) : null}
      </div>

      <article
        className="overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] shadow-card backdrop-blur-sm"
        data-ai-report-body
      >
        <header className="border-b border-white/[0.08] bg-gradient-to-br from-module-ai/12 via-transparent to-cyan-400/8 px-5 py-5 sm:px-6">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {report.reportType === 'vacation_catchup'
              ? 'Vacation catch-up'
              : report.reportType === 'project_detective'
                ? 'Project detective'
                : report.reportType === 'decision_replay'
                  ? 'Decision replay'
                  : report.reportType === 'executive'
                    ? 'Executive report'
                    : 'Generated report'}
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {report.title}
          </h2>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetaItem
              icon={<Calendar className="h-3.5 w-3.5" />}
              label="Generated"
              value={formatDate(report.generatedAt)}
            />
            <MetaItem
              icon={<Building2 className="h-3.5 w-3.5" />}
              label="Workspace"
              value={report.workspaceName}
            />
            {typeof report.metrics?.teamName === 'string' ? (
              <MetaItem
                icon={<UserRound className="h-3.5 w-3.5" />}
                label="Team"
                value={String(report.metrics.teamName)}
              />
            ) : null}
            {typeof report.metrics?.ownerName === 'string' ||
            typeof report.metrics?.focusUserName === 'string' ? (
              <MetaItem
                icon={<UserRound className="h-3.5 w-3.5" />}
                label="Owner"
                value={String(
                  report.metrics.ownerName ?? report.metrics.focusUserName,
                )}
              />
            ) : null}
            {typeof report.metrics?.sprintName === 'string' ? (
              <MetaItem
                icon={<Sparkles className="h-3.5 w-3.5" />}
                label="Sprint"
                value={String(report.metrics.sprintName)}
              />
            ) : null}
            <MetaItem
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Time Range"
              value={report.timeRange.label}
            />
            <div className="flex items-start gap-2">
              <Shield className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Confidence
                </p>
                <Badge
                  variant={confidenceVariant(report.confidence)}
                  className="mt-1"
                >
                  {report.confidence}
                </Badge>
              </div>
            </div>
          </div>

          {Array.isArray(report.metrics?.linkedIssues) &&
          (report.metrics.linkedIssues as unknown[]).length > 0 ? (
            <div className="mt-4">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Linked Issues
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(report.metrics.linkedIssues as Array<string | { key?: string }>)
                  .slice(0, 12)
                  .map((item, index) => {
                    const key =
                      typeof item === 'string'
                        ? item
                        : item?.key || `issue-${index}`;
                    return (
                      <span
                        key={key}
                        className="rounded-md border border-violet-400/20 bg-violet-400/10 px-2 py-1 text-[11px] text-violet-100"
                      >
                        {key}
                      </span>
                    );
                  })}
              </div>
            </div>
          ) : null}

          <div className="mt-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Sources
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {report.sourcesUsed.map((source) => (
                <span
                  key={source}
                  className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[11px] text-cyan-100"
                >
                  {source}
                </span>
              ))}
            </div>
          </div>
        </header>

        <div className="divide-y divide-white/10">
          {report.sections.map((section) => {
            const blocks = parseReportSectionMarkdown(section.markdown);
            const icon =
              SECTION_ICONS[section.id] ?? (
                <Sparkles className="h-4 w-4 text-muted-foreground" />
              );

            return (
              <section key={section.id} className="px-5 py-5 sm:px-6">
                <div className="mb-3 flex items-center gap-2">
                  {icon}
                  <h3 className="text-sm font-semibold text-foreground">
                    {section.title}
                  </h3>
                </div>

                <div className="space-y-2 text-sm leading-relaxed text-foreground/90">
                  {blocks.length === 0 ? (
                    <p className="text-muted-foreground">No data in this section.</p>
                  ) : (
                    blocks.map((block, index) => {
                      if (block.type === 'bullet') {
                        return (
                          <div key={`${section.id}-${index}`} className="flex gap-2">
                            <span className="mt-1 text-cyan-300/80">•</span>
                            <p>{block.text}</p>
                          </div>
                        );
                      }
                      if (block.type === 'subheading') {
                        return (
                          <p
                            key={`${section.id}-${index}`}
                            className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                          >
                            {block.text}
                          </p>
                        );
                      }
                      return (
                        <p key={`${section.id}-${index}`}>{block.text}</p>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <footer className="border-t border-white/10 px-5 py-3 text-[11px] text-muted-foreground sm:px-6">
          Grounded on {report.sourcesUsed.length} workspace source
          {report.sourcesUsed.length === 1 ? '' : 's'} · {report.dataPoints} data
          point{report.dataPoints === 1 ? '' : 's'}
        </footer>
      </article>

      <SendToSlackDialog
        open={slackOpen}
        onOpenChange={setSlackOpen}
        payload={slackPayload}
        onSuccess={({ channelName, sentAt }) => {
          showNotice(
            `✓ Successfully sent to Slack · ${channelName} · ${new Date(sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          );
        }}
      />
    </div>
  );
};

function MetaItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-0.5 text-sm text-foreground">{value}</p>
      </div>
    </div>
  );
}

export default AiReportCard;
