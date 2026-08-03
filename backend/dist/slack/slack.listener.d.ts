import { OnModuleInit } from '@nestjs/common';
import { CollectionService } from '../collection/collection.service';
import { ReportsService } from '../reports/reports.service';
import { SlackGateway } from './slack.gateway';
import { SlackService } from './slack.service';
export declare class SlackListener implements OnModuleInit {
    private readonly slackService;
    private readonly slackGateway;
    private readonly collectionService;
    private readonly reportsService;
    private readonly logger;
    constructor(slackService: SlackService, slackGateway: SlackGateway, collectionService: CollectionService, reportsService: ReportsService);
    onModuleInit(): void;
    private registerListeners;
}
