import { CollectionService } from '../collection/collection.service';
import { DigestService } from '../digest/digest.service';
import { SlackService } from '../slack/slack.service';
export declare class SchedulerService {
    private readonly collectionService;
    private readonly digestService;
    private readonly slackService;
    private readonly logger;
    constructor(collectionService: CollectionService, digestService: DigestService, slackService: SlackService);
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
