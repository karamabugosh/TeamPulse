import { SchedulerService } from './scheduler.service';
export declare class SchedulerController {
    private readonly schedulerService;
    constructor(schedulerService: SchedulerService);
    runDailyDigest(): Promise<{
        status: string;
        generatedAt: string;
        digest?: undefined;
        slackDelivered?: undefined;
    } | {
        status: string;
        digest: string;
        slackDelivered: boolean;
        generatedAt: string;
    }>;
}
