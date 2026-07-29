import { DigestService } from '../digest/digest.service';
export declare class SchedulerService {
    private readonly digestService;
    private readonly logger;
    constructor(digestService: DigestService);
    runDailyDigest(): {
        status: string;
        generatedAt: string;
        digest?: undefined;
    } | {
        status: string;
        digest: string;
        generatedAt: string;
    };
}
