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
} from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { apiFetch, ApiError } from '@/lib/api';

type ReportDetail = {
  id: string;
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
      answers: Array<{ question: string; answer: string }>;
    }>;
    overallProgress: string;
  };
  participants: Array<{
    slackUserId: string;
    displayName: string;
    status: string;
    answers: Array<{ question: string; answer: string }>;
  }>;
  blockers: any[];
  themes: any[];
};

export const ReportDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    if (!id) return;
    try {
      const data = await apiFetch<ReportDetail>(`/api/admin/reports/${id}`);
      setReport(data);
      setError(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to load report';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

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
    return (
      <div className="space-y-4 py-12 text-center">
        <p className="text-destructive">{error ?? 'Report not found'}</p>
        <Button asChild variant="outline">
          <Link to="/reports">Back to Reports</Link>
        </Button>
      </div>
    );
  }

  const sections = report.reportSections;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title={report.checkInName}
        description={`${report.teamName} · Run ${new Date(report.runDate).toLocaleString()}`}
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
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Generated</p>
            <p className="font-medium">{new Date(report.generatedAt).toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">AI Provider</p>
            <p className="font-medium">{report.aiProvider}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Participants</p>
            <p className="font-medium">
              {report.participantsResponded}/{report.totalParticipants}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Completion</p>
            <p className="font-medium">{report.completionRate}%</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Executive Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="leading-relaxed text-muted-foreground">{report.summary}</p>
        </CardContent>
      </Card>

      {sections.overallProgress && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Overall Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{sections.overallProgress}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            Participant Updates
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {report.participants.map((participant) => (
            <div key={participant.slackUserId} className="rounded-lg border border-border p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{participant.displayName}</p>
                <Badge variant={participant.status === 'completed' ? 'success' : 'secondary'}>
                  {participant.status === 'completed' ? 'Submitted' : participant.status}
                </Badge>
              </div>
              {participant.answers.length > 0 ? (
                <div className="space-y-2">
                  {participant.answers.map((answer, idx) => (
                    <div key={idx} className="text-sm">
                      <p className="font-medium text-foreground">{answer.question}</p>
                      <p className="text-muted-foreground">{answer.answer}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm italic text-muted-foreground">No answers submitted.</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionList title="Key Accomplishments" items={sections.keyAccomplishments} />
        <SectionList title="Risks" items={sections.risks} />
        <SectionList title="AI Insights" items={sections.aiInsights} />
        <SectionList title="Action Items" items={sections.actionItems} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Blockers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.isArray(report.blockers) && report.blockers.length > 0 ? (
            report.blockers.map((blocker: any, idx: number) => (
              <div key={idx} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">{blocker.description}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Severity: {blocker.severity}
                  {blocker.dependency ? ` · ${blocker.dependency}` : ''}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No blockers reported.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Common Themes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.isArray(report.themes) && report.themes.length > 0 ? (
            report.themes.map((theme: any, idx: number) => (
              <div key={idx} className="rounded-lg border border-border p-3">
                <p className="font-medium text-primary">{theme.theme}</p>
                <p className="text-sm text-muted-foreground">{theme.summary}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No themes identified.</p>
          )}
        </CardContent>
      </Card>

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
          <p className="text-sm text-muted-foreground">None reported.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default ReportDetailPage;
