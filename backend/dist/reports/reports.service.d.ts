import { PrismaService } from '../prisma/prisma.service';
import { AiDigestResult } from '../ai/dto/ai-result.dto';
export declare class ReportsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getLatestDigestForSlackUser(slackUserId: string, teamSearch?: string): Promise<AiDigestResult>;
    getDigestHistoryForSlackUser(slackUserId: string, limit?: number, teamSearch?: string): Promise<AiDigestResult[]>;
    formatDigestForSlack(digest: AiDigestResult): string;
    formatHistoryForSlack(digests: AiDigestResult[]): string;
    generateCsvFromDigest(digest: AiDigestResult): string;
    private mapDigest;
    private formatDate;
    private truncate;
    private escapeCsvField;
}
