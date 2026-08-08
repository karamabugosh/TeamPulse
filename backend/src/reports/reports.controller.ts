// backend/src/reports/reports.controller.ts

import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { AiDigestResult } from '../ai/dto/ai-result.dto';

@Controller('internal/reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
  ) {}

  @Post('export-csv')
  exportCsv(
    @Body() digest: AiDigestResult,
    @Res() res: Response,
  ): void {
    this.validateDigest(digest);

    const csv =
      this.reportsService.generateCsvFromDigest(
        digest,
      );

    /*
     * UTF-8 BOM helps Excel display Arabic and other
     * non-ASCII characters correctly.
     */
    const csvWithBom = '\uFEFF' + csv;

    const safeTeamId =
      this.sanitizeFileName(
        digest.teamId,
      );

    const safeRunId =
      this.sanitizeFileName(
        digest.runId,
      );

    const fileName =
      `pulse_report_${safeTeamId}_${safeRunId}.csv`;

    res.setHeader(
      'Content-Type',
      'text/csv; charset=utf-8',
    );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName}"`,
    );

    res.send(csvWithBom);
  }

  private validateDigest(
    digest: AiDigestResult,
  ): void {
    if (
      !digest ||
      typeof digest !== 'object'
    ) {
      throw new BadRequestException(
        'A valid digest is required.',
      );
    }

    if (
      typeof digest.teamId !==
        'string' ||
      digest.teamId.trim().length === 0
    ) {
      throw new BadRequestException(
        'teamId is required.',
      );
    }

    if (
      typeof digest.runId !==
        'string' ||
      digest.runId.trim().length === 0
    ) {
      throw new BadRequestException(
        'runId is required.',
      );
    }

    if (
      typeof digest.generatedAt !==
        'string' ||
      digest.generatedAt.trim().length === 0
    ) {
      throw new BadRequestException(
        'generatedAt is required.',
      );
    }

    if (
      digest.source !== 'ai' &&
      digest.source !==
        'rules_fallback'
    ) {
      throw new BadRequestException(
        'source must be "ai" or "rules_fallback".',
      );
    }

    if (
      typeof digest.summary !==
        'string' ||
      digest.summary.trim().length === 0
    ) {
      throw new BadRequestException(
        'summary is required.',
      );
    }

    if (
      !Array.isArray(
        digest.blockers,
      )
    ) {
      throw new BadRequestException(
        'blockers must be an array.',
      );
    }

    if (
      !Array.isArray(
        digest.themes,
      )
    ) {
      throw new BadRequestException(
        'themes must be an array.',
      );
    }
  }

  private sanitizeFileName(
    value: string,
  ): string {
    const sanitized = value
      .trim()
      .replace(
        /[^a-zA-Z0-9._-]/g,
        '_',
      )
      .replace(/_+/g, '_');

    return sanitized || 'unknown';
  }
}