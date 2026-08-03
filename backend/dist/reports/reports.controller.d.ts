import { Response } from 'express';
import { ReportsService } from './reports.service';
import { AiDigestResult } from '../ai/dto/ai-result.dto';
export declare class ReportsController {
    private readonly reportsService;
    constructor(reportsService: ReportsService);
    exportCsv(digest: AiDigestResult, res: Response): void;
    private sanitizeFileName;
}
