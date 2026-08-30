import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquare,
  Sparkles,
  Users,
  BarChart3,
} from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { apiFetch, ApiError } from '@/lib/api';
import {
  displayAnswerValue,
  FormattedAnswer,
  sentimentTextClass,
} from '@/lib/answer-semantics';

type NamedPersonSection = {
  displayName: string;
  items: string[];
};

type ParticipantProfile = {
  slackUserId: string;
  displayName: string;
  yesterdaysWork: string;
  todaysPlan: string;
  blocked: boolean;
  blockedDetail: string;
  confidence: number | null;
  helpRequested: boolean;
  helpDetail: string;
  taskStatus: string;
};

type ReportStatistics = {
  completedTasksCount: number;
  blockedMembersCount: number;
  helpRequestedCount: number;
  atRiskCount: number;
  averageConfidence: number | null;
  completionRate: number;
  teamProgressBullets: string[];
  respondedCount: number;
  totalParticipants: number;
};

type ReportDetail = {
  id: string;
  runId: string;
  checkInName: string;
  teamName: string;
  runDate: string;
  generatedAt: string;
  aiProvider: string;
  source: string;
  summary: string;
  totalParticipants: number;
  participantsResponded: number;
  completionRate: number;
  slackThreadUrl?: string | null;
  runStatus: string;
  reportPosted: boolean;
  reportSections: {
    keyAccomplishments: string[];
    risks: string[];
    aiInsights: string[];
    actionItems: string[];
    participantUpdates: Array<{
      slackUserId: string;
      displayName: string;
      answers: FormattedAnswer[];
    }>;
    overallProgress: string;
    namedBlockers?: NamedPersonSection[];
    helpRequests?: NamedPersonSection[];
    namedRisks?: NamedPersonSection[];
    namedAccomplishments?: NamedPersonSection[];
    teamProgress?: string[];
  };
  participants: Array<{
    slackUserId: string;
    displayName: string;
    answers: FormattedAnswer[];
  }>;
  participantProfiles?: ParticipantProfile[];
  statistics?: ReportStatistics | null;
  nonResponderNames?: string[];
  slackReportText?: string | null;
  generationError?: string | null;
  blockers: Array<{
    userId?: string;
    displayName?: string;
    description: string;
    severity?: string;
    dependency?: string | null;
  }>;
  themes: Array<{ theme: string; mentionCount?: number; summary?: string }>;
};

export const ReportDetailPage: React.FC = () => {
  const { id, runId } = useParams<{ id?: string; runId?: string }>();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    if (!id && !runId) return;
    try {
      const path = runId
        ? `/api/admin/reports/by-run/${runId}`
        : `/api/admin/reports/${id}`;
      const data = await apiFetch<ReportDetail>(path);
      setReport(data);
      setError(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load report';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [id, runId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading report...
      </div>
    );
  }

  if (error || !report) {
    const notGenerated =
      error?.toLowerCase().includes('not generated') ||
      error?.toLowerCase().includes('not found');
    return (
      <div className="space-y-4 py-12 text-center">
        <p className={notGenerated ? 'text-muted-foreground' : 'text-destructive'}>
          {notGenerated ? 'Report is not generated yet.' : (error ?? 'Report not found')}
        </p>
        <Button asChild variant="outline">
          <Link to="/reports">Back to Reports</Link>
        </Button>
      </div>
    );
  }

  if (report.generationError) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 py-12">
      <PageHeader
        title={report.checkInName}
        description={`${report.teamName} · Report generation failed`}
        accent="reports"
      />
        <Card className="border-destructive/40">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-destructive">AI report generation failed</p>
            <p className="mt-2 text-sm text-muted-foreground">{report.generationError}</p>
          </CardContent>
        </Card>
        <Button asChild variant="outline">
          <Link to="/reports">Back to Reports</Link>
        </Button>
      </div>
    );
  }

  const sections = report.reportSections;
  const stats = report.statistics;
  const profiles = report.participantProfiles ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title={report.checkInName}
        description={`${report.teamName} · Run ${new Date(report.runDate).toLocaleString()}`}
        accent="reports"
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/reports">
              <ArrowLeft className="h-4 w-4" />
              Reports
            </Link>
          </Button>
          {report.slackThreadUrl && (
            <Button size="sm" asChild>
              <a href={report.slackThreadUrl} target="_blank" rel="noopener noreferrer">
                <MessageSquare className="h-4 w-4" />
                Open Slack Thread
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            </Button>
          )}
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Generated" value={new Date(report.generatedAt).toLocaleString()} />
        <StatCard label="AI Provider" value={report.aiProvider} />
        <StatCard
          label="Participants"
          value={`${report.participantsResponded}/${report.totalParticipants}`}
        />
        <StatCard label="Completion" value={`${report.completionRate}%`} />
      </div>

      {stats && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4" />
              Statistics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatInline label="Completed Tasks" value={String(stats.completedTasksCount)} />
              <StatInline label="Blocked Members" value={String(stats.blockedMembersCount)} />
              <StatInline label="Help Requests" value={String(stats.helpRequestedCount)} />
              <StatInline label="Members At Risk" value={String(stats.atRiskCount)} />
              <StatInline
                label="Average Confidence"
                value={stats.averageConfidence != null ? `${stats.averageConfidence} / 5` : '—'}
              />
              <StatInline label="Completion Rate" value={`${stats.completionRate}%`} />
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Report (as posted to Slack)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.slackReportText ? (
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-muted-foreground">
              {report.slackReportText}
            </pre>
          ) : (
            <p className="leading-relaxed text-muted-foreground">{report.summary}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Executive Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="leading-relaxed text-muted-foreground">{report.summary}</p>
        </CardContent>
      </Card>

      {(sections.teamProgress?.length ?? 0) > 0 && (
        <SectionList title="Team Progress" items={sections.teamProgress ?? []} />
      )}

      {sections.overallProgress && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Overall Team Status</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{sections.overallProgress}</p>
          </CardContent>
        </Card>
      )}

      <NamedSectionList title="Key Accomplishments" sections={sections.namedAccomplishments ?? []} />
      <NamedSectionList title="Blockers" sections={sections.namedBlockers ?? []} />
      <NamedSectionList title="Help Requests" sections={sections.helpRequests ?? []} />
      <NamedSectionList title="Risks" sections={sections.namedRisks ?? []} />

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionList title="AI Insights" items={sections.aiInsights} />
        <SectionList title="Action Items" items={sections.actionItems} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Common Themes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.isArray(report.themes) && report.themes.length > 0 ? (
            report.themes.map((theme, idx) => (
              <div key={idx} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-primary">{theme.theme}</p>
                  {theme.mentionCount != null && (
                    <Badge variant="secondary">{theme.mentionCount} mentions</Badge>
                  )}
                </div>
                {theme.summary && (
                  <p className="mt-1 text-sm text-muted-foreground">{theme.summary}</p>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No themes identified from submitted answers.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Participants
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {profiles.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Yesterday&apos;s Work</th>
                    <th className="px-3 py-2">Today&apos;s Plan</th>
                    <th className="px-3 py-2">Blocked</th>
                    <th className="px-3 py-2">Confidence</th>
                    <th className="px-3 py-2">Help Requested</th>
                    <th className="px-3 py-2">Task Status</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((profile) => (
                    <tr key={profile.slackUserId} className="border-b border-border/60 align-top">
                      <td className="px-3 py-3 font-medium">{profile.displayName}</td>
                      <td className="px-3 py-3 text-muted-foreground">{profile.yesterdaysWork}</td>
                      <td className="px-3 py-3 text-muted-foreground">{profile.todaysPlan}</td>
                      <td className="px-3 py-3">
                        <Badge variant={profile.blocked ? 'destructive' : 'secondary'}>
                          {profile.blocked ? 'Yes' : 'No'}
                        </Badge>
                        {profile.blocked && profile.blockedDetail ? (
                          <p className="mt-1 text-xs text-muted-foreground">{profile.blockedDetail}</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-muted-foreground">
                        {profile.confidence != null ? `${profile.confidence} / 5` : '—'}
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={profile.helpRequested ? 'secondary' : 'outline'}>
                          {profile.helpRequested ? 'Yes' : 'No'}
                        </Badge>
                        {profile.helpRequested && profile.helpDetail ? (
                          <p className="mt-1 text-xs text-muted-foreground">{profile.helpDetail}</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">{profile.taskStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : report.participants.length > 0 ? (
            report.participants.map((participant) => (
              <div key={participant.slackUserId} className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">{participant.displayName}</p>
                  <Badge variant="success">Submitted</Badge>
                </div>
                {participant.answers.length > 0 ? (
                  <div className="space-y-2">
                    {participant.answers.map((answer, idx) => (
                      <div key={idx} className="text-sm space-y-2">
                        <p className="font-medium text-foreground">{answer.question}</p>
                        <p className={sentimentTextClass(answer.sentiment)}>
                          {displayAnswerValue(answer)}
                        </p>
                        {answer.linkedJiraIssues && answer.linkedJiraIssues.length > 0 ? (
                          <div className="rounded-lg border border-border/60 bg-secondary/20 p-3 space-y-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Linked Jira Issues
                            </p>
                            {answer.linkedJiraIssues.map((issue) => (
                              <div key={issue.issueKey} className="space-y-0.5">
                                {issue.issueUrl ? (
                                  <a
                                    href={issue.issueUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                                  >
                                    {issue.issueKey}
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : (
                                  <p className="text-sm font-medium">{issue.issueKey}</p>
                                )}
                                <p className="text-sm text-muted-foreground">{issue.summary}</p>
                                {issue.status ? (
                                  <p className="text-xs text-muted-foreground">{issue.status}</p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {answer.semanticInterpretation ? (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {answer.semanticInterpretation}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm italic text-muted-foreground">No answers submitted.</p>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No participant submissions for this run.</p>
          )}
        </CardContent>
      </Card>

      {report.nonResponderNames && report.nonResponderNames.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No Response</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {report.nonResponderNames.map((name) => (
                <li key={name}>• {name}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Separator />

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <FileText className="h-4 w-4" />
        <span>Run status: {report.runStatus}</span>
        <span>·</span>
        <span>{report.reportPosted ? 'Posted to Slack thread' : 'Saved in database'}</span>
      </div>
    </div>
  );
};

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium">{value}</p>
      </CardContent>
    </Card>
  );
}

function StatInline({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function SectionList({ title, items }: { title: string; items: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length > 0 ? (
          <ul className="space-y-2 text-sm text-muted-foreground">
            {items.map((item, idx) => (
              <li key={idx} className="flex gap-2">
                <span className="text-primary">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">None identified from submitted answers.</p>
        )}
      </CardContent>
    </Card>
  );
}

function NamedSectionList({
  title,
  sections,
}: {
  title: string;
  sections: NamedPersonSection[];
}) {
  if (sections.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {sections.map((section) => (
          <div key={section.displayName} className="rounded-lg border border-border p-4">
            <p className="font-medium">{section.displayName}</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {section.items.map((item, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="text-primary">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default ReportDetailPage;

