import { AiDigestResult, RawResponseForAnalysis } from './dto/ai-result.dto';
import { PrismaService } from '../prisma/prisma.service';
export declare class AiService {
    private readonly prisma;
    private readonly logger;
    private readonly costAccumulator;
    constructor(prisma: PrismaService);
    analyzeRun(teamId: string, runId: string, responses: RawResponseForAnalysis[]): Promise<AiDigestResult>;
    private saveDigest;
    getCostSummary(): {
        totalCost: number;
        callCount: number;
        averageCostPerCall: number | null;
    };
    private runAiExtraction;
}
