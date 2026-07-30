import { SchedulerService } from './scheduler.service';
export declare class SchedulerController {
    private readonly schedulerService;
    constructor(schedulerService: SchedulerService);
    runDailyDigest(): Promise<{
        status: string;
        generatedAt: string;
        responseCount?: undefined;
        digest?: undefined;
        slackDelivered?: undefined;
        slackError?: undefined;
    } | {
        status: string;
        responseCount: number;
        digest: string;
        slackDelivered: boolean;
        slackError: string;
        generatedAt: string;
    }>;
}
