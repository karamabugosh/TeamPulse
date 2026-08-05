import { SchedulerService } from './scheduler.service';
export declare class SchedulerController {
    private readonly schedulerService;
    constructor(schedulerService: SchedulerService);
    runDailyDigest(): Promise<{
        status: string;
        generatedAt: string;
        mode?: undefined;
        results?: undefined;
        startedAt?: undefined;
        teamCount?: undefined;
    } | {
        status: "success" | "partial_success" | "failed" | "skipped";
        mode: string;
        results: {
            teamId: string | null;
            teamName: string;
            status: "success" | "partial_success" | "failed" | "skipped";
            responseCount: number;
            digest?: string;
            slackDelivered: boolean;
            slackError: string | null;
            generatedAt: string;
        }[];
        startedAt: string;
        generatedAt: string;
        teamCount?: undefined;
    } | {
        status: string;
        mode: string;
        teamCount: number;
        results: {
            teamId: string | null;
            teamName: string;
            status: "success" | "partial_success" | "failed" | "skipped";
            responseCount: number;
            digest?: string;
            slackDelivered: boolean;
            slackError: string | null;
            generatedAt: string;
        }[];
        startedAt: string;
        generatedAt: string;
    }>;
}
