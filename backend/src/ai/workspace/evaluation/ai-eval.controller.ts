import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { AiEvalDatasetService } from './ai-eval-dataset.service';
import { AiEvalRunnerService } from './ai-eval-runner.service';
import { AiEvalExportService } from './ai-eval-export.service';

@Controller('ai/eval')
export class AiEvalController {
  constructor(
    private readonly dataset: AiEvalDatasetService,
    private readonly runner: AiEvalRunnerService,
    private readonly exporter: AiEvalExportService,
  ) {}

  @Get('health')
  health() {
    return {
      ok: true,
      module: 'ai-evaluation-framework',
      chatFlowModified: false,
      templateCases: this.dataset.listTemplates().length,
      categories: this.dataset.categories(),
    };
  }

  @Get('cases/templates')
  templates() {
    return {
      cases: this.dataset.listTemplates(),
      categories: this.dataset.categories(),
    };
  }

  @Get('cases')
  listCases(
    @Query('workspaceId') workspaceId?: string,
    @Query('category') category?: string,
  ) {
    return this.dataset.listCases({ workspaceId, category });
  }

  @Post('cases/seed')
  seed(
    @Body()
    body: {
      workspaceId?: string | null;
      preferDemo?: boolean;
    },
  ) {
    return this.dataset.seedForWorkspace({
      workspaceId: body?.workspaceId,
      preferDemo: body?.preferDemo,
    });
  }

  @Get('dashboard')
  dashboard(@Query('workspaceId') workspaceId?: string) {
    return this.runner.dashboard({ workspaceId });
  }

  @Get('runs')
  listRuns(
    @Query('workspaceId') workspaceId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.runner.listRuns({
      workspaceId,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Get('runs/:id')
  getRun(
    @Param('id') id: string,
    @Query('workspaceId') workspaceId?: string,
  ) {
    return this.runner.getRun({ runId: id, workspaceId });
  }

  @Post('runs')
  run(
    @Body()
    body: {
      workspaceId?: string | null;
      preferDemo?: boolean;
      label?: string | null;
      caseKeys?: string[] | null;
      limit?: number | null;
      passThreshold?: number | null;
      seedIfEmpty?: boolean;
    },
  ) {
    return this.runner.run({
      workspaceId: body?.workspaceId,
      preferDemo: body?.preferDemo,
      label: body?.label,
      caseKeys: body?.caseKeys,
      limit: body?.limit,
      passThreshold: body?.passThreshold,
      seedIfEmpty: body?.seedIfEmpty,
    });
  }

  @Get('runs/:id/export')
  async exportRun(
    @Param('id') id: string,
    @Query('workspaceId') workspaceId: string | undefined,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ) {
    const normalized = (format || 'markdown').toLowerCase();
    if (!['markdown', 'md', 'csv', 'pdf'].includes(normalized)) {
      throw new BadRequestException('format must be markdown, csv, or pdf');
    }
    const mapped =
      normalized === 'md' || normalized === 'markdown'
        ? 'markdown'
        : (normalized as 'csv' | 'pdf');

    const file = await this.exporter.exportRun({
      runId: id,
      workspaceId,
      format: mapped,
    });

    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    res.send(file.body);
  }
}
