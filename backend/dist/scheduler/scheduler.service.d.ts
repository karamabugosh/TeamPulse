import { DigestService } from '../digest/digest.service';
import { SlackService } from '../slack/slack.service';
export declare class SchedulerService {
    private readonly digestService;
    private readonly slackService;
    private readonly logger;
    constructor(digestService: DigestService, slackService: SlackService);
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
