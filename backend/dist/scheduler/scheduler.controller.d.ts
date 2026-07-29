import { SchedulerService } from './scheduler.service';
export declare class SchedulerController {
    private readonly schedulerService;
    constructor(schedulerService: SchedulerService);
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
