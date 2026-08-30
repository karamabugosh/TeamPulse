import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { resolveActiveWorkspaceId } from '../../../common/workspace-context';
import { buildSimplePdf } from '../slack/simple-pdf.util';

@Injectable()
export class AiEvalExportService {
  constructor(private readonly prisma: PrismaService) {}

  async exportRun(params: {
    runId: string;
    workspaceId?: string | null;
    format: 'markdown' | 'csv' | 'pdf';
  }): Promise<{ filename: string; contentType: string; body: Buffer | string }> {
    const workspaceId = await resolveActiveWorkspaceId(
      this.prisma,
      params.workspaceId,
    );
    const run = await this.prisma.aiEvalRun.findFirst({
      where: {
        id: params.runId,
        ...(workspaceId ? { workspaceId } : {}),
      },
      include: {
        results: { orderBy: { createdAt: 'asc' } },
        workspace: { select: { slackWorkspaceName: true } },
      },
    });
    if (!run) throw new NotFoundException('Evaluation run not found');

    const stamp = (run.finishedAt ?? run.startedAt).toISOString().slice(0, 10);
    if (params.format === 'csv') {
      return {
        filename: `ai-eval-${stamp}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: this.toCsv(run),
      };
    }
    if (params.format === 'pdf') {
      const text = this.toMarkdown(run);
      return {
        filename: `ai-eval-${stamp}.pdf`,
        contentType: 'application/pdf',
        body: buildSimplePdf(
          `AI Evaluation — ${run.workspace.slackWorkspaceName}`,
          text,
        ),
      };
    }

    return {
      filename: `ai-eval-${stamp}.md`,
      contentType: 'text/markdown; charset=utf-8',
      body: this.toMarkdown(run),
    };
  }

  private toMarkdown(run: {
    id: string;
    label: string | null;
    overallScore: number;
    passed: number;
    failed: number;
    totalQuestions: number;
    averageAccuracy: number;
    averageConfidenceScore: number;
    averageResponseTimeMs: number;
    passThreshold: number;
    startedAt: Date;
    finishedAt: Date | null;
    workspace: { slackWorkspaceName: string };
    results: Array<{
      caseKey: string;
      category: string;
      question: string;
      expectedAnswer: string;
      aiAnswer: string;
      overallScore: number;
      passed: boolean;
      aiConfidence: string | null;
      responseTimeMs: number;
    }>;
  }): string {
    const lines: string[] = [
      `# AI Evaluation Report`,
      '',
      `- Workspace: ${run.workspace.slackWorkspaceName}`,
      `- Run: ${run.label ?? run.id}`,
      `- Started: ${run.startedAt.toISOString()}`,
      `- Finished: ${run.finishedAt?.toISOString() ?? 'n/a'}`,
      `- Overall score: ${run.overallScore}/100`,
      `- Passed: ${run.passed}/${run.totalQuestions} (threshold ${run.passThreshold})`,
      `- Avg accuracy: ${run.averageAccuracy}`,
      `- Avg confidence score: ${run.averageConfidenceScore}`,
      `- Avg response time: ${Math.round(run.averageResponseTimeMs)} ms`,
      '',
      `## Results`,
      '',
    ];

    for (const result of run.results) {
      lines.push(`### ${result.caseKey} (${result.category})`);
      lines.push('');
      lines.push(`- Score: **${result.overallScore}** · ${result.passed ? 'PASS' : 'FAIL'}`);
      lines.push(`- Confidence: ${result.aiConfidence ?? 'n/a'}`);
      lines.push(`- Response time: ${result.responseTimeMs} ms`);
      lines.push(`- Question: ${result.question}`);
      lines.push('');
      lines.push('**Expected**');
      lines.push('');
      lines.push(result.expectedAnswer);
      lines.push('');
      lines.push('**AI Answer**');
      lines.push('');
      lines.push(result.aiAnswer);
      lines.push('');
    }

    return lines.join('\n');
  }

  private toCsv(run: {
    results: Array<{
      caseKey: string;
      category: string;
      question: string;
      expectedAnswer: string;
      aiAnswer: string;
      overallScore: number;
      passed: boolean;
      aiConfidence: string | null;
      responseTimeMs: number;
    }>;
  }): string {
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = [
      [
        'caseKey',
        'category',
        'passed',
        'overallScore',
        'aiConfidence',
        'responseTimeMs',
        'question',
        'expectedAnswer',
        'aiAnswer',
      ],
    ];
    for (const result of run.results) {
      rows.push([
        result.caseKey,
        result.category,
        String(result.passed),
        String(result.overallScore),
        result.aiConfidence ?? '',
        String(result.responseTimeMs),
        result.question,
        result.expectedAnswer,
        result.aiAnswer,
      ]);
    }
    return rows.map((row) => row.map((cell) => escape(cell)).join(',')).join('\n');
  }
}
