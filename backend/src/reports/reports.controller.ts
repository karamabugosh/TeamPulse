// backend/src/reports/reports.controller.ts

import { Body, Controller, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { AiDigestResult } from '../ai/dto/ai-result.dto';

@Controller('internal/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post('export-csv')
  exportCsv(@Body() digest: AiDigestResult, @Res() res: Response): void {
    const csv = this.reportsService.generateCsvFromDigest(digest);
    const csvWithBom = '\uFEFF' + csv;

    const safeTeamId = this.sanitizeFileName(digest.teamId);
    const safeRunId = this.sanitizeFileName(digest.runId);
    const fileName = `pulse_report_${safeTeamId}_${safeRunId}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(csvWithBom);
  }

  private sanitizeFileName(value: string): string {
    return value.replace(/[^a-zA-Z0-9-_]/g, '_');
  }
}