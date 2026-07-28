import { DigestService } from '../digest/digest.service';
export declare class SchedulerService {
    private readonly digestService;
    constructor(digestService: DigestService);
    runDailyDigest(): {
        status: string;
        digest: string;
        generatedAt: string;
    };
}
