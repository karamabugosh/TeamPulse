import { AiService } from './ai.service';
import { AiDigestResult, RawResponseForAnalysis } from './dto/ai-result.dto';
export declare class AiController {
    private readonly aiService;
    constructor(aiService: AiService);
    analyze(teamId: string, runId: string, responses: RawResponseForAnalysis[]): Promise<AiDigestResult>;
}
