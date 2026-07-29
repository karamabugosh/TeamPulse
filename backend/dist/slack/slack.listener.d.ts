import { OnModuleInit } from '@nestjs/common';
import { SlackService } from './slack.service';
import { SlackGateway } from './slack.gateway';
import { CollectionService } from '../collection/collection.service';
export declare class SlackListener implements OnModuleInit {
    private readonly slackService;
    private readonly slackGateway;
    private readonly collectionService;
    private readonly logger;
    constructor(slackService: SlackService, slackGateway: SlackGateway, collectionService: CollectionService);
    onModuleInit(): void;
    private registerListeners;
}
