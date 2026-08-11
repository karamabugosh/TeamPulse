import React, { useEffect, useState } from 'react';
import { FileText, Search, Eye, Sparkles, Download } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export const ReportsPage: React.FC = () => {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedReport, setSelectedReport] = useState<any | null>(null);

  const loadReports = () => {
    fetch('/api/admin/reports')
      .then((res) => res.json())
      .then((data) => {
        setReports(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load reports:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadReports();
  }, []);

  const handleExportCsv = (id: string) => {
    window.open(`/api/admin/reports/${id}/export/csv`, '_blank');
  };

  const handleExportPdf = (id: string) => {
    window.open(`/api/admin/reports/${id}/export/pdf`, '_blank');
  };

  const filteredReports = reports.filter(
    (r) =>
      r.teamName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.summary.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <TooltipProvider>
      <div className="space-y-8">
        <PageHeader
          title="Reports"
          description="Review AI-generated daily summaries, team blockers, and export digest history."
        />

        <Card>
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search reports by team or keywords..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Tabs defaultValue="all">
              <TabsList>
                <TabsTrigger value="all">All Time</TabsTrigger>
                <TabsTrigger value="week">This Week</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Team</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Generated At</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Source</th>
                  <th className="px-6 py-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI Summary</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredReports.length > 0 ? (
                  filteredReports.map((report) => (
                    <tr key={report.id} className="border-b border-border transition-colors hover:bg-secondary/30">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 font-medium">
                          <FileText className="h-4 w-4 text-primary" />
                          {report.teamName}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-muted-foreground font-mono text-xs">
                        {new Date(report.generatedAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant={report.source === 'ai' ? 'default' : 'warning'}>
                          {report.source === 'ai' ? 'AI GPT-4o' : 'Rules Fallback'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 max-w-md">
                        <p className="truncate text-muted-foreground">{report.summary}</p>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="outline" size="sm" onClick={() => setSelectedReport(report)}>
                                <Eye className="h-3.5 w-3.5" />
                                View
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>View full digest</TooltipContent>
                          </Tooltip>
                          <Button variant="ghost" size="sm" onClick={() => handleExportCsv(report.id)} className="text-emerald-400">
                            CSV
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleExportPdf(report.id)} className="text-primary">
                            PDF
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground">
                      No reports match your filter criteria.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Dialog open={!!selectedReport} onOpenChange={() => setSelectedReport(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            {selectedReport && (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    Standup Digest — {selectedReport.teamName}
                  </DialogTitle>
                  <DialogDescription>
                    Generated: {new Date(selectedReport.generatedAt).toLocaleString()}
                  </DialogDescription>
                </DialogHeader>

                <Card className="border-primary/20 bg-primary/5">
                  <CardContent className="p-5 space-y-2">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-primary">Executive Summary</h3>
                    <p className="text-base leading-relaxed text-muted-foreground">{selectedReport.summary}</p>
                  </CardContent>
                </Card>

                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400">Extracted Blockers</h3>
                  {Array.isArray(selectedReport.blockers) && selectedReport.blockers.length > 0 ? (
                    selectedReport.blockers.map((b: any, idx: number) => (
                      <Card key={idx}>
                        <CardContent className="p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">User: {b.userId}</span>
                            <Badge variant="warning">Severity: {b.severity || 'Medium'}</Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">{b.description}</p>
                          {b.dependency && <p className="text-xs text-muted-foreground">Dependency: {b.dependency}</p>}
                        </CardContent>
                      </Card>
                    ))
                  ) : (
                    <Card>
                      <CardContent className="p-4 text-sm italic text-muted-foreground">
                        No blockers reported for this standup run.
                      </CardContent>
                    </Card>
                  )}
                </div>

                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-primary">Themes & Topics</h3>
                  {Array.isArray(selectedReport.themes) && selectedReport.themes.length > 0 ? (
                    selectedReport.themes.map((t: any, idx: number) => (
                      <Card key={idx}>
                        <CardContent className="p-4 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-primary">{t.theme}</span>
                            <span className="text-xs text-muted-foreground">Mentions: {t.mentionCount}</span>
                          </div>
                          <p className="text-sm text-muted-foreground">{t.summary}</p>
                        </CardContent>
                      </Card>
                    ))
                  ) : (
                    <Card>
                      <CardContent className="p-4 text-sm italic text-muted-foreground">
                        No specific themes categorized.
                      </CardContent>
                    </Card>
                  )}
                </div>

                <Separator />

                <DialogFooter className="flex-col sm:flex-row gap-2">
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleExportCsv(selectedReport.id)}>
                      <Download className="h-3.5 w-3.5" />
                      CSV
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleExportPdf(selectedReport.id)}>
                      <Download className="h-3.5 w-3.5" />
                      PDF
                    </Button>
                  </div>
                  <Button onClick={() => setSelectedReport(null)}>Close</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
};

export default ReportsPage;
